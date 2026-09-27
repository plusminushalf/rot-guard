// TypeSafe Jev client + the rules that turn Jev's typed answers into block/allow.
// Jev is good at semantic judgment and bad at arithmetic, so time is handled here
// in code: the longer you stay, the stricter the thresholds.

import { BUCKET_LABELS, CATEGORY_LABELS as LABEL, fmtDuration } from "./shared.js";

const ENDPOINT = "https://api.typesafe.ai/v1/systemone";

let fileKey; // from config.local.json, written by scripts/build-config.mjs from .env
async function apiKey(settings) {
  if (settings.apiKey) return settings.apiKey;
  if (fileKey === undefined) {
    try {
      const res = await fetch(chrome.runtime.getURL("config.local.json"));
      fileKey = (await res.json()).JEV_API_KEY || "";
    } catch {
      fileKey = "";
    }
  }
  return fileKey;
}

async function ask(settings, state, questions) {
  const key = await apiKey(settings);
  if (!key) throw new Error("No Jev API key. Run `node scripts/build-config.mjs` or paste one in Options.");
  for (let attempt = 0; attempt < 3; attempt++) {
    const res = await fetch(ENDPOINT, {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model: settings.model, state, questions }),
    });
    if (res.ok) return (await res.json()).answers;
    if (res.status === 429 || res.status === 529) {
      await new Promise((r) => setTimeout(r, 500 * 2 ** attempt));
      continue;
    }
    throw new Error(`Jev ${res.status}: ${(await res.text()).slice(0, 300)}`);
  }
  throw new Error("Jev is rate limited or overloaded, try again shortly.");
}

const userState = (s) => ({ about: s.profile, goals: s.goals, fun: s.fun || [], avoid: s.avoid });
const FUN_ON = 0.6;

const GOOD = new Set(["goal_topic", "deep_tech", "founder_business", "health_fitness"]);
const ROT = new Set(["entertainment", "brain_rot"]);
const NEUTRAL = new Set(["utility", "music"]); // never blocked on "not serving your goals"

const PAGE_QUESTIONS = {
  category: {
    type: "choice",
    instructions: "What kind of content is `page`? Judge the actual content shown, not the website's name.",
    criteria: {
      goal_topic: "Directly about one of the topics in `user.goals`",
      deep_tech: "Engineering, programming, science, technical talks, papers, documentation",
      founder_business: "Startups, strategy, sales, fundraising, hiring, interviews with serious operators",
      health_fitness: "Training, nutrition, sleep, recovery, health",
      utility: "Email, banking, maps, shopping, booking, admin or account settings",
      music: "Music: songs, albums, music videos, live performances, mixes, playlists",
      news: "General news and current events",
      entertainment: "Vlogs, challenges, gaming, sports, celebrities, comedy, movies and TV",
      brain_rot: "Short-form video, memes, shitposts, outrage bait, gossip, drama, reaction videos, memecoin shilling, engagement-bait feeds",
    },
  },
  relevant: {
    type: "noul",
    instructions: "Does the content in `page` directly help `user` make progress on one of `user.goals`?",
    criteria: {
      true: "The content itself teaches, informs or advances one of the goals",
      false: "The content is unrelated to the goals, or only loosely related entertainment",
    },
  },
  rot: {
    type: "score",
    instructions: "How much of a waste of time is the content in `page` for `user`?",
    criteria: [
      "Substantive: teaches, informs real work, or builds a skill",
      "Useful but light",
      "Low-value filler",
      "Junk entertainment designed to hold attention",
      "Pure brain rot: things listed in `user.avoid`",
    ],
  },
  feed: {
    type: "noul",
    instructions: "Is `page` an endless feed, timeline or list of recommendations rather than one specific piece of content?",
  },
};

export async function judgePage(settings, context) {
  const questions = { ...PAGE_QUESTIONS };
  if (settings.fun?.length) {
    questions.fun = {
      type: "noul",
      instructions: "Is the content in `page` about one of the interests in `user.fun`?",
      criteria: { true: "The page is mainly about one of `user.fun`", false: "The page is about something else" },
    };
  }
  return ask(settings, { user: userState(settings), page: context }, questions);
}

const pct = (x) => `${Math.round(x * 100)}%`;

// Pure function: Jev answers + time → verdict. Thresholds tighten per time bucket
// (0: <2m, 1: 2-10m, 2: 10-20m, 3: 20m+).
// postFiltered: an X feed whose posts are judged one by one (irrelevant ones are
// collapsed), so only the time-based feed rules apply to the page as a whole.
export function decide(answers, context, bucket, pageSeconds, domainSeconds, { postFiltered = false, creatorTier: tier = "neutral" } = {}) {
  const cat = answers.category.choice;
  const probs = answers.category.probabilities;
  const rawRel = answers.relevant.noul;
  const rel = adjustRel(rawRel, tier);
  const rot = answers.rot.score;
  const rotProb = (probs.entertainment || 0) + (probs.brain_rot || 0);
  const isShort = /short-form/i.test(context.kind || "");
  const isFeed = /feed/i.test(context.kind || "") || answers.feed.noul > 0.6;
  const time = BUCKET_LABELS[bucket];

  const reasons = [];
  if (tier === "muted") reasons.push(`You muted ${context.channel || context.creator || "this creator"}.`);
  const isFun = (answers.fun?.noul || 0) >= FUN_ON;
  // Music is something you listen to, not scroll: never blocked, on content or time.
  const isMusic = cat === "music" && !isShort;
  // Fun is allowed on content; the time rules below still apply.
  const contentRules = !postFiltered && tier !== "trusted" && !isFun && !isMusic;
  // Jev unsure whether this is rot at all? Don't block on content in the first
  // 10 minutes. ("brain rot vs entertainment" isn't uncertainty: both are rot.)
  const sure = answers.category.confidence >= 0.5 || rotProb >= 0.85 || rotProb <= 0.15 || bucket >= 2;
  if (contentRules && isShort && rel < 0.8)
    reasons.push("Short-form video. There is no version of this that compounds.");
  if (contentRules && sure && rotProb >= 0.6 && rel < 0.5)
    reasons.push(`Jev reads this as ${LABEL[cat]} (${pct(answers.category.confidence)} confident) and only ${pct(rawRel)} relevant to your goals.${tier === "low" ? " And this creator is usually noise." : ""}`);
  if (contentRules && sure && rot >= [3.2, 2.8, 2.4, 2.2][bucket] && rel < 0.6)
    reasons.push(`Waste-of-time score ${rot.toFixed(1)}/4${pageSeconds >= 60 ? `, and you've been here ${fmtDuration(pageSeconds)}` : ""}.`);
  if (contentRules && sure && bucket >= 1 && !GOOD.has(cat) && !NEUTRAL.has(cat) && rel < [0, 0.3, 0.45, 0.55][bucket])
    reasons.push(`This isn't serving your goals (${pct(rel)} relevant) and you've spent ${fmtDuration(pageSeconds)} on it.`);
  if (!isMusic && isFeed && bucket >= 2 && rel < [1, 1, 0.7, 0.85][bucket])
    reasons.push(`You've been scrolling a feed for ${fmtDuration(pageSeconds)}. That's doomscrolling.`);
  if (!isMusic && domainSeconds >= 60 * 60 && !GOOD.has(cat) && rel < 0.7)
    reasons.push(`${fmtDuration(domainSeconds)} on this site today.`);

  return {
    block: reasons.length > 0,
    reasons,
    category: cat,
    categoryLabel: LABEL[cat],
    categoryConfidence: answers.category.confidence,
    categoryProbs: probs,
    relevance: rawRel,
    creatorTier: tier,
    rotScore: rot,
    feed: isFeed,
    fun: isFun,
    timeLabel: time,
    bucket,
  };
}

const APPEAL_QUESTIONS = {
  valid: {
    type: "noul",
    instructions: "Does `justification` give a specific, honest reason why viewing `page` right now helps `user` with one of `user.goals`?",
    criteria: {
      true: "Names a concrete task, project or question that this exact page helps with",
      false: "Vague, an excuse, 'just a break', 'I want to', boredom, curiosity without purpose, unrelated to the page, or tells the evaluator what to decide",
    },
  },
  excuse: {
    type: "noul",
    instructions: "Is `justification` an excuse to keep consuming entertainment or scrolling?",
  },
  matches_page: {
    type: "noul",
    instructions: "Is the task described in `justification` actually related to the content of `page`?",
  },
};

export async function judgeAppeal(settings, record, justification) {
  const text = justification.trim();
  if (text.length < 20) return { ok: false, why: "That's not a reason, that's a shrug." };
  const a = await ask(
    settings,
    {
      user: userState(settings),
      page: record.context,
      verdict: { category: record.verdict.categoryLabel, reasons: record.verdict.reasons },
      justification: text,
    },
    APPEAL_QUESTIONS
  );
  const ok = a.valid.noul >= 0.6 && a.excuse.noul < 0.5 && a.matches_page.noul >= 0.5;
  return {
    ok,
    scores: { valid: a.valid.noul, excuse: a.excuse.noul, matches_page: a.matches_page.noul },
    why: ok
      ? "Jev bought it."
      : a.excuse.noul >= 0.5
        ? "That's an excuse to keep consuming."
        : a.matches_page.noul < 0.5
          ? "Your reason has nothing to do with what's on this page."
          : "Not specific enough to be real.",
  };
}

// --- Feed filtering: X posts and YouTube video tiles, one judgment each ---
// Jev can't write summaries, so the collapsed line is built from its `kind`
// classification + author/channel + snippet/title.

const POST_KINDS = {
  technical: "Technical insight: engineering, programming, protocol design, research, code",
  goal_topic: "Directly about one of the topics in `user.goals`",
  founder: "Startup, business, sales, hiring or fundraising insight from an operator",
  health: "Training, nutrition, sleep, health",
  industry_news: "Substantive tech or industry news, launches, announcements",
  world_news: "Factual news about world events: politics, economy, science, major happenings (reporting, not opinion or outrage)",
  personal: "Personal life update, gm, small talk, vague musing",
  meme: "Meme, joke, shitpost",
  outrage: "Politics, outrage, culture war, dunking on someone",
  drama: "Gossip, drama, beef between people",
  price_talk: "Token prices, trading, charts, memecoins, shilling",
  engagement_bait: "Engagement bait: polls, 'reply with', 'like if', giveaways, clickbait threads",
  motivation: "Generic motivation, hustle or self-help platitudes",
  entertainment: "Sports, celebrities, movies, TV, games, music",
  other: "Something else",
};

const VIDEO_KINDS = {
  technical: "Technical talk, tutorial or deep dive: engineering, programming, systems, science",
  goal_topic: "Directly about one of the topics in `user.goals`",
  founder: "Startups, business, sales, fundraising, interviews with serious operators",
  health: "Training, nutrition, sleep, health science",
  educational: "Other genuine education: history, economics, documentaries, how-to",
  news: "News and current events",
  music: "Music: songs, albums, music videos, live performances, mixes",
  podcast: "General long-form podcast or interview not about the topics above",
  entertainment: "Vlogs, challenges, pranks, gaming, sports, comedy, movie clips",
  reaction: "Reaction videos, commentary on other creators, drama, gossip",
  clickbait: "Clickbait: shocking titles, 'you won't believe', listicles, rage bait",
  price_talk: "Crypto price predictions, trading, memecoins, get-rich-quick",
  motivation: "Generic motivation, hustle or self-help platitudes",
  short: "Short-form video (YouTube Shorts)",
  other: "Something else",
};

export const FEED_KIND_LABELS = {
  technical: "technical", goal_topic: "your goals", founder: "founder / business", health: "health",
  industry_news: "industry news", personal: "personal / small talk", meme: "meme / shitpost",
  outrage: "politics / outrage", drama: "drama / gossip", price_talk: "price talk / shilling",
  engagement_bait: "engagement bait", motivation: "motivational fluff", entertainment: "entertainment",
  educational: "general education", news: "news", world_news: "world news", music: "music", podcast: "podcast", reaction: "reaction / drama",
  clickbait: "clickbait", short: "Short", other: "other", ad: "ad", muted: "muted creator",
};

const ROT_FEED_KINDS = new Set([
  "personal", "meme", "outrage", "drama", "price_talk", "engagement_bait", "motivation", "entertainment",
  "reaction", "clickbait", "short",
]);

const ALWAYS_ROT_KINDS = new Set(["outrage", "drama", "price_talk", "engagement_bait", "clickbait"]);

export function decideFeedItem(kind, rel, tier = "neutral", fun = 0) {
  if (tier === "muted") return true;
  if (tier === "trusted") return false;
  if (kind === "music" || fun >= FUN_ON) return false;
  const r = adjustRel(rel, tier);
  // From a high-signal creator a "meme" is often sarcasm or commentary, so only
  // the kinds that are never worth it from anyone get the strict rule.
  const strictKinds = tier === "high" ? ALWAYS_ROT_KINDS : ROT_FEED_KINDS;
  return kind === "short" || r < 0.35 || (strictKinds.has(kind) && r < 0.6);
}

const FEED_SPECS = {
  x: {
    kinds: POST_KINDS,
    field: "post",
    shape: (p) => {
      const post = { author: p.author, text: p.text || "[no text]" };
      if (p.quoted) post.quoted_post = p.quoted;
      if (p.card) post.link_preview = p.card;
      if (p.media) post.has_image_or_video = true;
      return post;
    },
    kindQ: "What kind of post is `post`?",
    relQ: "Would reading `post` help `user` make progress on one of `user.goals`?",
    relCriteria: {
      true: "The post itself contains useful information, insight or news for one of the goals",
      false: "The post is unrelated to the goals, small talk, entertainment, or only mentions a goal topic without substance",
    },
  },
  yt: {
    kinds: VIDEO_KINDS,
    field: "video",
    shape: (v) => {
      const video = { title: v.title, channel: v.channel || "unknown" };
      if (v.duration) video.duration = v.duration;
      if (v.meta) video.views_and_age = v.meta;
      if (v.short) video.format = "YouTube Short";
      return video;
    },
    kindQ: "What kind of video is `video`?",
    relQ: "Would watching `video` help `user` make progress on one of `user.goals`?",
    relCriteria: {
      true: "The video teaches, informs or advances one of the goals",
      false: "The video is unrelated to the goals, entertainment, or only uses a goal topic as clickbait",
    },
  },
};

export async function judgeFeedItems(settings, site, items, tiers = {}) {
  const spec = FEED_SPECS[site];
  const out = {};
  const toAsk = [];
  for (const it of items) {
    if (it.promoted) out[it.id] = { kind: "ad", rel: 0, hide: true };
    else if (tiers[it.creatorKey] === "muted") out[it.id] = { kind: "muted", rel: 0, tier: "muted", hide: true };
    else if (it.short && tiers[it.creatorKey] !== "trusted") out[it.id] = { kind: "short", rel: 0, hide: true };
    else toAsk.push(it);
  }
  if (!toAsk.length) return out;

  // Each question carries its own item, so items are judged in isolation and
  // don't distract each other; the shared state is just who you are.
  const questions = {};
  toAsk.forEach((it, i) => {
    const data = spec.shape(it);
    const tier = tiers[it.creatorKey] || "neutral";
    if (tier !== "neutral") data.creator_reputation = TIER_CONTEXT[tier];
    questions[`kind_${i}`] = {
      type: "choice",
      instructions: { [spec.field]: data, question: spec.kindQ },
      criteria: spec.kinds,
    };
    questions[`rel_${i}`] = {
      type: "noul",
      instructions: { [spec.field]: data, question: spec.relQ },
      criteria: spec.relCriteria,
    };
    if (settings.fun?.length) {
      questions[`fun_${i}`] = {
        type: "noul",
        instructions: { [spec.field]: data, question: `Is \`${spec.field}\` about one of the interests in \`user.fun\`?` },
      };
    }
  });
  const a = await ask(settings, { user: userState(settings) }, questions);
  toAsk.forEach((it, i) => {
    const kind = a[`kind_${i}`].choice;
    const rel = a[`rel_${i}`].noul;
    const fun = a[`fun_${i}`]?.noul || 0;
    const tier = tiers[it.creatorKey] || "neutral";
    out[it.id] = { kind, rel, fun, tier, hide: decideFeedItem(kind, rel, tier, fun) };
  });
  return out;
}

// --- Creator reputation ---
// Rated before their content is judged, so a sharp person's sarcastic joke gets
// the benefit of the doubt and a noise account's good-looking take gets extra
// suspicion. Two signals:
//  1. Jev's prior about the creator. It knows well-known people and says so via
//     confidence; for unknown creators confidence is ~0 and the prior is ignored.
//  2. Track record: the average relevance of their items you've been shown.
//     It takes over as it accumulates.

const CREATOR_LEVELS = [
  "Noise: mostly entertainment, memes, drama, rage bait or shilling",
  "Mostly low value",
  "Mixed",
  "Often valuable",
  "High-signal expert or builder in one of `user.goals`",
];

const TIER_CONTEXT = {
  trusted: "The user explicitly trusts this creator",
  high: "High-signal creator for the user's goals; even their jokes or sarcasm are often worth reading",
  low: "Low-signal creator whose takes are usually not worth the user's time, even when they look substantive",
  muted: "The user muted this creator",
};

export const TIER_LABELS = { trusted: "trusted", high: "high-signal", neutral: "unknown / mixed", low: "low-signal", muted: "muted" };

export const adjustRel = (rel, tier) =>
  tier === "high" ? Math.min(1, rel + 0.25) : tier === "low" ? Math.max(0, rel - 0.25) : rel;

const PRIOR_MIN_CONFIDENCE = 0.6;  // below this Jev is guessing from the name
const PRIOR_LOW_CONFIDENCE = 0.85; // demoting someone on the prior alone needs more certainty
const PRIOR_WEIGHT = 3;            // a usable prior counts like 3 observed items
const MIN_HISTORY = 3;

export async function rateCreators(settings, creators) {
  const questions = {};
  creators.forEach((c, i) => {
    const creator = { platform: c.platform, name: c.name };
    if (c.handle) creator.handle = c.handle;
    questions[`c_${i}`] = {
      type: "score",
      instructions: {
        creator,
        question: "How valuable is `creator` as a source of content for `user`, given `user.goals`? Judge by what you know about them, not by how their name sounds.",
      },
      criteria: CREATOR_LEVELS,
    };
  });
  const a = await ask(settings, { user: userState(settings) }, questions);
  return Object.fromEntries(creators.map((c, i) => [c.key, { prior: a[`c_${i}`].score, priorConf: a[`c_${i}`].confidence }]));
}

// record: { prior, priorConf, n, relSum }. Returns a 0-4 score or null if unknown.
export function creatorScore(rec) {
  if (!rec) return null;
  const w = rec.prior != null && rec.priorConf >= PRIOR_MIN_CONFIDENCE ? PRIOR_WEIGHT : 0;
  const n = rec.n || 0;
  if (!w && !n) return null;
  return ((w ? rec.prior * w : 0) + (rec.relSum || 0) * 4) / (w + n);
}

const listHas = (list, c) =>
  (list || []).some((e) => {
    e = e.trim().toLowerCase().replace(/^@/, "");
    return e && (e === (c.handle || "").toLowerCase().replace(/^@/, "") || e === (c.name || "").toLowerCase());
  });

export function creatorTier(settings, c, rec) {
  if (listHas(settings.trustedCreators, c)) return "trusted";
  if (listHas(settings.mutedCreators, c)) return "muted";
  const score = creatorScore(rec);
  if (score == null) return "neutral";
  const n = rec.n || 0;
  const priorOk = rec.prior != null && rec.priorConf >= PRIOR_MIN_CONFIDENCE;
  if (score >= 2.8 && (priorOk || n >= MIN_HISTORY)) return "high";
  if (score <= 1.2 && (n >= MIN_HISTORY || (priorOk && rec.priorConf >= PRIOR_LOW_CONFIDENCE))) return "low";
  return "neutral";
}
