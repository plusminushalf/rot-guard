// Live check of creator reputation. Run: node test/creators-live.mjs
import { judgeFeedItems, rateCreators, creatorTier } from "../extension/jev.js";
import { settings } from "./settings.mjs";

const creators = [
  { key: "x:@karpathy", platform: "X", handle: "@karpathy", name: "Andrej Karpathy" },
  { key: "x:@paulg", platform: "X", handle: "@paulg", name: "Paul Graham" },
  { key: "x:@dril", platform: "X", handle: "@dril", name: "wint" },
  { key: "x:@cryptokol99", platform: "X", handle: "@cryptokol99", name: "CRYPTO KING 👑" },
  { key: "x:@jonhoo", platform: "X", handle: "@jonhoo", name: "Jon Gjengset" },
  { key: "x:@threadguy", platform: "X", handle: "@threadguy", name: "Thread Guy" },
];
const priors = await rateCreators(settings, creators);
// Track records as if you'd already seen their posts: jonhoo consistently relevant, threadguy consistently noise.
const history = { "x:@jonhoo": { n: 12, relSum: 10.4 }, "x:@threadguy": { n: 15, relSum: 1.2 } };
const tiers = {};
for (const c of creators) {
  tiers[c.key] = creatorTier(settings, c, { ...priors[c.key], ...history[c.key] });
  console.log(`${c.handle.padEnd(16)} prior=${priors[c.key].prior.toFixed(2)} conf=${priors[c.key].priorConf.toFixed(2)} history=${history[c.key] ? (history[c.key].relSum / history[c.key].n).toFixed(2) : "-"} -> ${tiers[c.key]}`);
}

const cases = [
  ["show", "x:@karpathy", "lol just put the entire company in one 4000-line prompt with no tests, what could go wrong"],
  ["show", "x:@paulg", "Startups are like cats: they ignore you until you stop feeding them."],
  ["show", "x:@jonhoo", "hot take: most 'microservices' are just a monolith with extra network hops 🙃"],
  ["hide", "x:@cryptokol99", "Distributed systems explained: consensus lets nodes agree, replication keeps copies in sync, sharding splits the data. This is why $NODE is my top pick 🚀"],
  ["hide", "x:@threadguy", "Most founders fail because they don't understand distribution. Here's the framework I used to reach 10M people 🧵👇"],
  ["hide", "x:@dril", "just learned about zero knowledge proofs. i now know zero things"],
];
const items = cases.map(([, ck, text], i) => ({ id: String(i), creatorKey: ck, author: creators.find((c) => c.key === ck).handle, text }));
const neutral = await judgeFeedItems(settings, "x", items, {});
const withRep = await judgeFeedItems(settings, "x", items, tiers);
let pass = 0;
cases.forEach(([want, ck, text], i) => {
  const n = neutral[String(i)], r = withRep[String(i)];
  const got = r.hide ? "hide" : "show";
  if (got === want) pass++;
  console.log(`${got === want ? "PASS" : "FAIL"} want=${want} | no-rep: ${n.hide ? "hide" : "show"} ${n.kind} rel=${n.rel.toFixed(2)} | with-rep(${r.tier}): ${got} ${r.kind} rel=${r.rel.toFixed(2)} | ${items[i].author}: ${text.slice(0, 50)}`);
});
console.log(`creator cases: ${pass}/${cases.length}`);
