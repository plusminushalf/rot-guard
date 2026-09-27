// Shared by the service worker and the extension pages (popup, options, blocked).

// Your profile, goals, fun, avoid list and allowlist aren't in code: they come
// from profile.local.json (gitignored), or profile.example.json if you haven't
// made one. Any key of DEFAULT_SETTINGS can be set there. Settings you save in
// Options override both.
const PROFILE_FILES = ["profile.local.json", "profile.example.json"];

export const DEFAULT_SETTINGS = {
  apiKey: "",            // overrides config.local.json when set
  model: "jev-latest",
  profile: "",
  goals: [],
  avoid: [],
  fun: [],
  allowlist: [],
  trustedCreators: [],   // handles or channel names: never hidden
  mutedCreators: [],     // handles or channel names: always hidden
  passMinutes: 15,       // how long an accepted justification unlocks the page
  xCheckinsPerDay: 2,    // X is a news feed: this many visits a day
  xCheckinMinutes: 15,   // ...of at most this long each
  xCheckinGapMinutes: 45,// away from X this long = the next visit is a new check-in
  readingMinutesPerDay: 45, // Substack & other newsletters, total per day
  xFilter: true,         // judge each post on X and collapse irrelevant ones
  ytFilter: true,        // judge each video tile on YouTube and collapse irrelevant ones
  enabled: true,
};

// Cumulative minutes on a page (today) at which Jev re-judges it.
export const JUDGE_AT_MINUTES = [0, 2, 10, 20];
export const REJUDGE_EVERY_MINUTES_AFTER = 20;

export function timeBucket(seconds) {
  const m = seconds / 60;
  if (m < 2) return 0;
  if (m < 10) return 1;
  if (m < 20) return 2;
  return 3;
}

export const CATEGORY_LABELS = {
  goal_topic: "your goals", deep_tech: "deep tech", founder_business: "founder / business",
  health_fitness: "health & fitness", utility: "utility", news: "news",
  entertainment: "entertainment", brain_rot: "brain rot", music: "music",
};

export const BUCKET_LABELS = [
  "just opened it",
  "a few minutes",
  "over 10 minutes",
  "over 20 minutes",
];

let profileDefaults;
// DEFAULT_SETTINGS with the profile file on top: what "Reset to defaults" gives you.
export async function getDefaults() {
  if (!profileDefaults) {
    profileDefaults = {};
    for (const file of PROFILE_FILES) {
      try {
        const res = await fetch(chrome.runtime.getURL(file));
        if (res.ok) { profileDefaults = await res.json(); break; }
      } catch {}
    }
  }
  return { ...DEFAULT_SETTINGS, ...profileDefaults };
}

export async function getSettings() {
  const { settings } = await chrome.storage.local.get("settings");
  return { ...(await getDefaults()), ...(settings || {}) };
}

export async function saveSettings(patch) {
  const current = await getSettings();
  await chrome.storage.local.set({ settings: { ...current, ...patch } });
}

export function todayKey(d = new Date()) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function endOfToday() {
  const d = new Date();
  d.setHours(23, 59, 59, 999);
  return d.getTime();
}

export function fmtDuration(seconds) {
  seconds = Math.round(seconds || 0);
  if (seconds < 60) return `${seconds}s`;
  const m = Math.floor(seconds / 60);
  if (m < 60) return `${m}m`;
  return `${Math.floor(m / 60)}h ${m % 60}m`;
}

const TRACKING_PARAMS = /^(utm_|fbclid|gclid|si$|feature$|pp$|ref$|ref_src$|t$|igsh$|mc_)/;

// A stable key for "the same page": drops hashes and tracking params, and for
// YouTube keeps only the video id so timestamps and playlists don't split it.
export function pageKey(rawUrl) {
  let u;
  try { u = new URL(rawUrl); } catch { return rawUrl; }
  const host = u.hostname.replace(/^www\.|^m\./, "");
  if (host === "youtube.com" && u.pathname === "/watch") {
    return `youtube.com/watch?v=${u.searchParams.get("v")}`;
  }
  const params = [...u.searchParams.entries()]
    .filter(([k]) => !TRACKING_PARAMS.test(k))
    .sort(([a], [b]) => a.localeCompare(b));
  const qs = params.length ? "?" + new URLSearchParams(params).toString() : "";
  return `${host}${u.pathname.replace(/\/$/, "") || "/"}${qs}`;
}

export function hostOf(rawUrl) {
  try { return new URL(rawUrl).hostname.replace(/^www\.|^m\./, ""); } catch { return ""; }
}

export function isAllowlisted(rawUrl, allowlist) {
  const host = hostOf(rawUrl);
  return allowlist.some((d) => {
    d = d.trim().toLowerCase();
    return d && (host === d || host.endsWith("." + d));
  });
}

// One-line human description of an extracted page context (for popup + block screen).
export function describe(ctx = {}) {
  const head = [ctx.site, ctx.kind].filter(Boolean).join(" · ");
  const main =
    ctx.title ||
    ctx.post ||
    (ctx.search_query && `search: "${ctx.search_query}"`) ||
    ctx.profile ||
    ctx.subreddit ||
    ctx.channel ||
    "";
  const by = ctx.channel && ctx.title ? ` by ${ctx.channel}` : "";
  return { head, main: main + by, samples: ctx.posts || ctx.videos_shown || ctx.videos || ctx.results || ctx.replies || [] };
}
