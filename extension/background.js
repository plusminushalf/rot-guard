import {
  getSettings, saveSettings, DEFAULT_SETTINGS, fmtDuration, pageKey, hostOf, isAllowlisted, timeBucket, todayKey, endOfToday,
  REJUDGE_EVERY_MINUTES_AFTER,
} from "./shared.js";
import { signature, settingsFingerprint, cacheGet, cacheGetMany, cacheSet, cacheStats, cacheClear } from "./cache.js";
import {
  judgePage, decide, judgeAppeal, judgeFeedItems, decideFeedItem, FEED_KIND_LABELS,
  rateCreators, creatorTier, TIER_LABELS,
} from "./jev.js";

const BLOCKED_PAGE = chrome.runtime.getURL("blocked.html");
const RETRY_AFTER_ERROR_MS = 60_000;

// Serialize read-modify-write on storage: ticks from several tabs arrive concurrently.
let chain = Promise.resolve();
function locked(fn) {
  const p = chain.then(fn);
  chain = p.catch(() => {});
  return p;
}

async function load() {
  const s = await chrome.storage.local.get(["day", "locks", "passes", "blocks"]);
  let day = s.day;
  if (!day || day.date !== todayKey()) day = { date: todayKey(), pages: {}, domains: {}, judged: {} };
  const now = Date.now();
  const prune = (m) => Object.fromEntries(Object.entries(m || {}).filter(([, v]) => (v.until ?? v) > now));
  return { day, locks: prune(s.locks), passes: s.passes || {}, blocks: s.blocks || {} };
}

const mutate = (fn) =>
  locked(async () => {
    const st = await load();
    const out = await fn(st);
    await chrome.storage.local.set(st);
    return out;
  });

const setTabState = (tabId, state) =>
  chrome.storage.session.set({ [`tab_${tabId}`]: { ...state, at: Date.now() } });

function hash(obj) {
  const s = JSON.stringify(obj);
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (Math.imul(31, h) + s.charCodeAt(i)) | 0;
  return h;
}

// --- Creator reputation store: { [key]: { platform, name, handle, prior, priorConf, ratedAt, n, relSum, lastSeen } }
const CREATOR_RERATE_MS = 14 * 24 * 3600 * 1000;

const MAX_CREATORS = 4000;

function creatorKey(c) {
  if (!c) return null;
  const id = (c.handle || c.name || "").trim().toLowerCase();
  return id ? `${c.platform === "X" ? "x" : "yt"}:${id}` : null;
}

// Rates any creator not yet rated (one batched Jev call) and returns tiers by key.
async function creatorTiers(settings, creators) {
  const uniq = new Map();
  for (const c of creators) {
    const k = creatorKey(c);
    if (!k) continue;
    if (!uniq.has(k)) uniq.set(k, { ...c, key: k });
  }
  if (!uniq.size) return {};
  const { creators: store = {} } = await chrome.storage.local.get("creators");
  const now = Date.now();
  const toRate = [...uniq.values()].filter((c) => !store[c.key]?.ratedAt || now - store[c.key].ratedAt > CREATOR_RERATE_MS);
  let rated = {};
  if (toRate.length) {
    try {
      rated = await rateCreators(settings, toRate.slice(0, 40));
    } catch {
      rated = {}; // no prior this time; the track record still works
    }
  }
  await locked(async () => {
    const { creators: cur = {} } = await chrome.storage.local.get("creators");
    for (const c of uniq.values()) {
      const rec = cur[c.key] || { platform: c.platform, name: c.name, handle: c.handle, n: 0, relSum: 0 };
      if (rated[c.key]) Object.assign(rec, rated[c.key], { ratedAt: now });
      if (c.name) rec.name = c.name;
      rec.lastSeen = now;
      cur[c.key] = rec;
    }
    const keys = Object.keys(cur);
    if (keys.length > MAX_CREATORS) {
      keys.sort((a, b) => (cur[a].lastSeen || 0) - (cur[b].lastSeen || 0));
      for (const k of keys.slice(0, keys.length - MAX_CREATORS)) delete cur[k];
    }
    await chrome.storage.local.set({ creators: cur });
    Object.assign(store, cur);
  });
  return Object.fromEntries([...uniq.values()].map((c) => [c.key, creatorTier(settings, c, store[c.key])]));
}

// Track record: every freshly judged item feeds its creator's average relevance.
async function recordCreatorItems(entries) {
  if (!entries.length) return;
  await locked(async () => {
    const { creators: cur = {} } = await chrome.storage.local.get("creators");
    for (const { key, rel } of entries) {
      if (!key || !cur[key] || rel == null) continue;
      cur[key].n = (cur[key].n || 0) + 1;
      cur[key].relSum = (cur[key].relSum || 0) + rel;
    }
    await chrome.storage.local.set({ creators: cur });
  });
}

function pageCreator(url, context) {
  if (context.site === "YouTube" && context.kind === "video" && context.channel) return { platform: "YouTube", name: context.channel };
  if (context.site === "X (Twitter)" && /single post/.test(context.kind || "")) {
    const handle = new URL(url).pathname.split("/")[1];
    if (handle) return { platform: "X", handle: `@${handle}`, name: (context.post || "").split(":")[0] };
  }
  return null;
}

// --- Budgets: things Jev can't judge because they're about counting ---
const isX = (url) => /^(x|twitter)\.com$/.test(hostOf(url));
const isSinglePost = (context) => /single post/.test(context?.kind || "");
const isNewsletter = (context) => /newsletter/.test(context?.kind || "");
const clock = (t) => new Date(t).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });

// The X check-in you're in right now, or null if the next visit starts a new one.
function currentXSession(day, settings, now = Date.now()) {
  const last = (day.xSessions || []).at(-1);
  return last && now - last.last <= settings.xCheckinGapMinutes * 60_000 ? last : null;
}

function budgetReasons(settings, day, url, context) {
  const reasons = [];
  if (isX(url) && !isSinglePost(context)) {
    const sessions = day.xSessions || [];
    const cur = currentXSession(day, settings);
    const used = sessions.length;
    const limit = settings.xCheckinsPerDay;
    if (!cur && used >= limit) {
      reasons.push(`You've already checked X ${used} time${used === 1 ? "" : "s"} today (${sessions.map((x) => clock(x.start)).join(", ")}). ${limit} is enough to know what's happening; the rest is doomscrolling.`);
    } else if (cur && cur.seconds >= settings.xCheckinMinutes * 60) {
      const left = Math.max(0, limit - used);
      reasons.push(`This X check-in has run ${fmtDuration(cur.seconds)}, past your ${settings.xCheckinMinutes}-minute limit. ${left ? `${left} check-in${left === 1 ? "" : "s"} left today, come back later.` : "That was your last one today."}`);
    }
  }
  if (isNewsletter(context) && (day.readingSeconds || 0) >= settings.readingMinutesPerDay * 60) {
    reasons.push(`You've read ${fmtDuration(day.readingSeconds)} of newsletters today, past your ${settings.readingMinutesPerDay}-minute budget. Good in moderation; this isn't moderation.`);
  }
  return reasons;
}

const inFlight = new Set();
const lastError = new Map();

async function redirectToBlock(tabId, record) {
  const id = crypto.randomUUID();
  await mutate((st) => {
    st.blocks[id] = { ...record, blockedAt: Date.now() };
    const ids = Object.keys(st.blocks);
    for (const old of ids.slice(0, Math.max(0, ids.length - 50))) delete st.blocks[old];
  });
  await chrome.tabs.update(tabId, { url: `${BLOCKED_PAGE}#${id}` });
}

async function evaluate(tabId, url, context, { force = false } = {}) {
  if (!/^https?:/.test(url)) return;
  const settings = await getSettings();
  if (!settings.enabled) return setTabState(tabId, { url, context, status: "disabled" });
  if (isAllowlisted(url, settings.allowlist)) return setTabState(tabId, { url, context, status: "allowlisted" });

  const key = pageKey(url);
  if (inFlight.has(key)) return;
  inFlight.add(key);
  try {
    const st = await load();
    const now = Date.now();
    const lock = st.locks[key];
    if (lock) return redirectToBlock(tabId, { ...lock, url, key, locked: true });
    if (st.passes[key] > now) return setTabState(tabId, { url, context, status: "pass", passUntil: st.passes[key] });

    // Budgets first: no need to ask Jev about something you've simply had enough of today.
    const budget = budgetReasons(settings, st.day, url, context);
    if (budget.length) {
      const verdict = { block: true, budget: true, reasons: budget, categoryLabel: "over budget" };
      await setTabState(tabId, { url, context, status: "blocked", verdict });
      const tab = await chrome.tabs.get(tabId).catch(() => null);
      if (tab && pageKey(tab.url) === key) {
        await redirectToBlock(tabId, { url, key, context, verdict, pageSeconds: st.day.pages[key] || 0, domainSeconds: st.day.domains[hostOf(url)] || 0 });
      }
      return;
    }

    // Rate the creator first: their reputation is part of what Jev sees.
    const creator = pageCreator(url, context);
    const cKey = creatorKey(creator);
    const tier = creator ? (await creatorTiers(settings, [creator]))[cKey] || "neutral" : "neutral";
    if (tier !== "neutral") context = { ...context, creator_reputation: TIER_LABELS[tier] };

    const pageSeconds = st.day.pages[key] || 0;
    const domainSeconds = st.day.domains[hostOf(url)] || 0;
    const bucket = timeBucket(pageSeconds);
    const h = hash(context);
    const pageSig = signature("page", key, context);
    const prev = st.day.judged[key];

    // Same content as last time? Reuse Jev's answers and only re-apply the
    // (time-dependent) thresholds. Feeds change as you scroll, so they re-ask.
    // Same page content + same profile within a day? Reuse Jev's answers and only
    // re-apply the (time-dependent) thresholds. Feeds change as you scroll, so they re-ask.
    let answers = force ? null : await cacheGet(pageSig);
    if (!answers) {
      try {
        answers = await judgePage(settings, context);
        await cacheSet({ [pageSig]: answers });
        lastError.delete(key);
        if (cKey && !prev) recordCreatorItems([{ key: cKey, rel: answers.relevant.noul }]);
      } catch (e) {
        lastError.set(key, Date.now());
        return setTabState(tabId, { url, context, status: "error", error: String(e.message || e) });
      }
    }
    // Feeds whose items are filtered one by one are only blocked on time.
    const postFiltered =
      (settings.xFilter !== false && context.site === "X (Twitter)" && !/single post/.test(context.kind || "")) ||
      (settings.ytFilter !== false && context.site === "YouTube" && /feed|search|channel/.test(context.kind || ""));
    const verdict = decide(answers, context, bucket, pageSeconds, domainSeconds, { postFiltered, creatorTier: tier });
    if (creator) Object.assign(verdict, { creator: creator.handle || creator.name, creatorTierLabel: TIER_LABELS[tier] });

    await mutate((s) => {
      s.day.judged[key] = { bucket, atSeconds: pageSeconds, hash: h };
    });
    await setTabState(tabId, { url, context, status: verdict.block ? "blocked" : "ok", verdict, pageSeconds, domainSeconds });

    if (verdict.block) {
      // Don't yank a tab that has already moved on while Jev was thinking.
      const tab = await chrome.tabs.get(tabId).catch(() => null);
      if (tab && pageKey(tab.url) === key) {
        await redirectToBlock(tabId, { url, key, context, verdict, pageSeconds, domainSeconds });
      }
    }
  } finally {
    inFlight.delete(key);
  }
}

async function reevaluateTab(tabId, opts) {
  const res = await chrome.tabs.sendMessage(tabId, { type: "extract" }).catch(() => null);
  if (res) await evaluate(tabId, res.url, res.context, opts);
}

async function tick(tabId, url, seconds) {
  const settings = await getSettings();
  const key = pageKey(url);
  const { [`tab_${tabId}`]: tabState } = await chrome.storage.session.get(`tab_${tabId}`);
  const context = tabState && pageKey(tabState.url) === key ? tabState.context : null;
  // Listening to music doesn't use up the site's daily time.
  const music = !!context && tabState.verdict?.category === "music";
  const due = await mutate((st) => {
    st.day.pages[key] = (st.day.pages[key] || 0) + seconds;
    const host = hostOf(url);
    if (!music) st.day.domains[host] = (st.day.domains[host] || 0) + seconds;

    const now = Date.now();
    if (isX(url)) {
      // A post opened from a link elsewhere doesn't start a check-in; it only
      // counts if you're already in one.
      st.day.xSessions ||= [];
      let cur = currentXSession(st.day, settings, now);
      if (!cur && !isSinglePost(context)) {
        cur = { start: now, last: now, seconds: 0 };
        st.day.xSessions.push(cur);
      }
      if (cur) {
        cur.seconds += seconds;
        cur.last = now;
      }
    }
    if (isNewsletter(context)) st.day.readingSeconds = (st.day.readingSeconds || 0) + seconds;

    if (!settings.enabled || isAllowlisted(url, settings.allowlist)) return false;
    if (st.passes[key]) {
      if (st.passes[key] > now) return false;
      delete st.passes[key]; // pass just ran out: judge again
      return true;
    }
    if (context && budgetReasons(settings, st.day, url, context).length) return true;
    const sec = st.day.pages[key];
    const j = st.day.judged[key];
    if (!j) return now - (lastError.get(key) || 0) > RETRY_AFTER_ERROR_MS;
    const b = timeBucket(sec);
    return b > j.bucket || (b === 3 && sec - j.atSeconds >= REJUDGE_EVERY_MINUTES_AFTER * 60);
  });
  if (due) await reevaluateTab(tabId);
}

// Not an appeal: a deliberate edit of your own goals. Saving flushes the verdict
// cache and creator ratings (see storage.onChanged), lifts this page's lock, and
// the page is judged again under the new goals when you go back to it.
async function addGoalFromBlock(id, goal) {
  goal = (goal || "").trim();
  if (goal.length < 3) return { ok: false, why: "Write the goal out." };
  const settings = await getSettings();
  const { blocks } = await load();
  const record = blocks[id];
  if (!settings.goals.some((g) => g.toLowerCase() === goal.toLowerCase())) {
    await saveSettings({ goals: [...settings.goals, goal] });
  }
  if (record) {
    await mutate((st) => {
      delete st.locks[record.key];
      delete st.day.judged[record.key];
    });
  }
  return { ok: true, url: record?.url };
}

async function appeal(id, text) {
  const settings = await getSettings();
  const { blocks } = await load();
  const record = blocks[id];
  if (!record) return { ok: false, why: "Block record not found." };
  if (record.locked) return { ok: false, why: "Locked until midnight." };

  const result = await judgeAppeal(settings, record, text);
  await mutate((st) => {
    if (result.ok) {
      st.passes[record.key] = Date.now() + settings.passMinutes * 60_000;
    } else {
      st.locks[record.key] = { until: endOfToday(), context: record.context, verdict: record.verdict, rejectedReason: text };
      st.blocks[id] = { ...record, locked: true, rejectedReason: text };
    }
  });
  return { ...result, url: record.url, passMinutes: settings.passMinutes };
}

// Each post/video gets a signature: platform + id + its content. Jev's raw
// answers are cached under it for 1 day (cache.js); the hide decision is
// recomputed on every read so it tracks the creator's current tier.
const itemContent = (site, it) =>
  site === "x" ? [it.text, it.quoted, it.card, !!it.media, !!it.promoted] : [it.title, it.channel, !!it.short, !!it.promoted];

async function judgeFeed(site, items) {
  const settings = await getSettings();
  const setting = { x: "xFilter", yt: "ytFilter" }[site];
  if (!settings.enabled || !setting || settings[setting] === false) return { verdicts: {} };
  for (const it of items) {
    it.sig = signature(site, it.id, itemContent(site, it));
    it.creatorKey = creatorKey(it.creator);
  }
  const cached = await cacheGetMany(items.map((it) => it.sig));
  const tiers = await creatorTiers(settings, items.filter((it) => it.creator && !it.promoted).map((it) => it.creator));
  const fresh = items.filter((it) => !cached[it.sig]);
  if (fresh.length) {
    const judged = await judgeFeedItems(settings, site, fresh, tiers);
    const entries = {};
    for (const it of fresh) {
      const v = judged[it.id];
      if (v) entries[it.sig] = cached[it.sig] = { kind: v.kind, rel: v.rel, fun: v.fun || 0 };
    }
    await cacheSet(entries);
    recordCreatorItems(fresh.filter((it) => judged[it.id] && judged[it.id].kind !== "ad").map((it) => ({ key: it.creatorKey, rel: judged[it.id].rel })));
    const hidden = Object.values(judged).filter((v) => v.hide).length;
    if (hidden) await mutate((st) => { st.day.itemsHidden = (st.day.itemsHidden || 0) + hidden; });
  }
  const verdicts = {};
  for (const it of items) {
    const c = cached[it.sig];
    if (!c) continue;
    const tier = tiers[it.creatorKey] || "neutral";
    const hide = c.kind === "ad" || decideFeedItem(c.kind, c.rel, tier, c.fun || 0);
    verdicts[it.id] = {
      kind: c.kind, rel: c.rel, tier, hide,
      label: FEED_KIND_LABELS[tier === "muted" ? "muted" : c.kind] || c.kind,
      tierLabel: tier !== "neutral" ? TIER_LABELS[tier] : "",
    };
  }
  return { verdicts };
}

chrome.runtime.onMessage.addListener((msg, sender, reply) => {
  const tabId = msg.tabId ?? sender.tab?.id;
  const handlers = {
    page: () => evaluate(tabId, msg.url, msg.context),
    tick: () => tick(tabId, msg.url, msg.seconds),
    "popup:state": async () => {
      const tab = await chrome.tabs.get(tabId);
      const { [`tab_${tabId}`]: state } = await chrome.storage.session.get(`tab_${tabId}`);
      const { day, locks, passes } = await load();
      const key = pageKey(tab.url || "");
      return {
        tab: { url: tab.url, title: tab.title },
        state: state && pageKey(state.url) === key ? state : null,
        pageSeconds: day.pages[key] || 0,
        domainSeconds: day.domains[hostOf(tab.url || "")] || 0,
        topDomains: Object.entries(day.domains).sort((a, b) => b[1] - a[1]).slice(0, 8),
        locks: Object.keys(locks).length,
        itemsHidden: day.itemsHidden || 0,
        budgets: await (async () => {
          const settings = await getSettings();
          const cur = currentXSession(day, settings);
          return {
            xUsed: (day.xSessions || []).length, xLimit: settings.xCheckinsPerDay,
            xCurrentSeconds: cur ? cur.seconds : null, xMinutes: settings.xCheckinMinutes,
            readingSeconds: day.readingSeconds || 0, readingMinutes: settings.readingMinutesPerDay,
          };
        })(),
        passUntil: passes[key] > Date.now() ? passes[key] : null,
      };
    },
    "popup:analyze": () => reevaluateTab(tabId, { force: true }),
    "cache:stats": () => cacheStats(),
    "cache:clear": () => cacheClear(),
    "blocked:get": async () => {
      const { blocks, day, locks } = await load();
      const r = blocks[msg.id];
      // Allowlisting a domain after it got locked lifts the lock too.
      if (r?.locked && locks[r.key] && isAllowlisted(r.url, (await getSettings()).allowlist)) delete locks[r.key];
      // A lock can be lifted after the fact (new goal, extension update): say so,
      // and the block page sends you back to be judged again.
      return r && {
        ...r,
        locked: !!r.locked && !!locks[r.key],
        lockLifted: !!r.locked && !locks[r.key],
        pageSeconds: r.pageSeconds ?? (day.pages[r.key] || 0),
        domainSecondsNow: day.domains[hostOf(r.url)] || 0,
      };
    },
    "blocked:appeal": () => appeal(msg.id, msg.text),
    "blocked:addGoal": () => addGoalFromBlock(msg.id, msg.goal),
    "feed:judge": () => judgeFeed(msg.site, msg.items),
  };
  const h = handlers[msg.type];
  if (!h) return;
  Promise.resolve(h()).then(reply, (e) => reply({ error: String(e.message || e) }));
  return true;
});

// Catch locked pages as soon as navigation starts, before any content renders.
chrome.tabs.onUpdated.addListener(async (tabId, change) => {
  if (!change.url || !/^https?:/.test(change.url)) return;
  const { locks } = await load();
  const lock = locks[pageKey(change.url)];
  if (lock && isAllowlisted(change.url, (await getSettings()).allowlist)) return;
  if (lock) redirectToBlock(tabId, { ...lock, url: change.url, key: pageKey(change.url), locked: true });
});

// Verdicts and creator ratings are relative to who you are, so editing your
// profile, goals, avoid list or model flushes both.
chrome.storage.onChanged.addListener(async (changes, area) => {
  if (area !== "local" || !changes.settings) return;
  // Locks on newly allowlisted domains go away (they're never analyzed now).
  const allowlist = changes.settings.newValue?.allowlist || [];
  await locked(async () => {
    const { locks } = await chrome.storage.local.get("locks");
    if (!locks) return;
    const kept = Object.fromEntries(Object.entries(locks).filter(([k]) => !isAllowlisted(k.startsWith("http") ? k : `https://${k}`, allowlist)));
    if (Object.keys(kept).length !== Object.keys(locks).length) await chrome.storage.local.set({ locks: kept });
  });
  const fp = (v) => settingsFingerprint({ ...DEFAULT_SETTINGS, ...(v || {}) });
  if (fp(changes.settings.oldValue) === fp(changes.settings.newValue)) return;
  await cacheClear();
  await locked(() => chrome.storage.local.remove("creators"));
});

// Bump when the judging rules change. A lock earned under old rules shouldn't
// outlive them: on startup with a new version, all locks are released and
// cached verdicts dropped. That only means pages get judged again, not that
// they're allowed.
const RULES_VERSION = 5;
locked(async () => {
  const { rulesVersion } = await chrome.storage.local.get("rulesVersion");
  if (rulesVersion === RULES_VERSION) return;
  await chrome.storage.local.remove("locks");
  await cacheClear();
  await chrome.storage.local.set({ rulesVersion: RULES_VERSION });
});

chrome.tabs.onRemoved.addListener((tabId) => chrome.storage.session.remove(`tab_${tabId}`));
