// Verdict cache keyed by content signature, so a post, video or page is never
// sent to Jev twice within the TTL. Held in memory by the service worker and
// persisted to storage.local (debounced), so it survives browser restarts.

export const CACHE_TTL_MS = 24 * 3600 * 1000; // 1 day
const MAX_ENTRIES = 60_000;
const STORAGE_KEY = "verdictCache";

// 53-bit FNV-1a-style hash over a JSON encoding of the parts.
export function signature(...parts) {
  const s = JSON.stringify(parts);
  let h1 = 0x811c9dc5, h2 = 0x01000193;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 0x01000193);
    h2 = Math.imul(h2 ^ c, 0x5bd1e995);
  }
  return ((h2 >>> 0) & 0x1fffff).toString(36) + (h1 >>> 0).toString(36);
}

// Changes whenever something that shapes Jev's judgment changes.
export const settingsFingerprint = (s) => signature(s.model, s.profile, s.goals, s.avoid, s.fun);

let mem = null;
let loading = null;
let writeTimer = null;

async function load() {
  if (mem) return mem;
  loading ||= chrome.storage.local.get(STORAGE_KEY).then((r) => {
    mem = new Map(Object.entries(r[STORAGE_KEY] || {}));
    const before = mem.size;
    prune();
    if (mem.size !== before) persistSoon(); // write the pruned cache back
    return mem;
  });
  return loading;
}

function prune() {
  const cutoff = Date.now() - CACHE_TTL_MS;
  for (const [k, e] of mem) if (e.at < cutoff) mem.delete(k);
  if (mem.size > MAX_ENTRIES) {
    const oldest = [...mem.entries()].sort((a, b) => a[1].at - b[1].at).slice(0, mem.size - MAX_ENTRIES);
    for (const [k] of oldest) mem.delete(k);
  }
}

function persistSoon() {
  clearTimeout(writeTimer);
  writeTimer = setTimeout(() => {
    prune();
    chrome.storage.local.set({ [STORAGE_KEY]: Object.fromEntries(mem) });
  }, 1000);
}

export async function cacheGet(sig) {
  const m = await load();
  const e = m.get(sig);
  if (!e) return null;
  if (Date.now() - e.at > CACHE_TTL_MS) {
    m.delete(sig);
    persistSoon();
    return null;
  }
  return e.v;
}

export async function cacheGetMany(sigs) {
  const out = {};
  for (const s of sigs) {
    const v = await cacheGet(s);
    if (v) out[s] = v;
  }
  return out;
}

export async function cacheSet(entries) {
  const m = await load();
  const at = Date.now();
  for (const [sig, v] of Object.entries(entries)) m.set(sig, { at, v });
  persistSoon();
}

export async function cacheStats() {
  const m = await load();
  return { entries: m.size, oldest: Math.min(...[...m.values()].map((e) => e.at), Date.now()) };
}

export async function cacheClear() {
  const m = await load();
  m.clear();
  clearTimeout(writeTimer);
  await chrome.storage.local.remove(STORAGE_KEY);
}
