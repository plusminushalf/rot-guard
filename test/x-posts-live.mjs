// Live check of per-post X filtering. Run: node test/x-posts-live.mjs
import { judgeFeedItems } from "../extension/jev.js";
import { settings } from "./settings.mjs";

const posts = [
  ["show", { author: "@jonhoo", text: "Postgres 17 changes how VACUUM handles large tables: dead tuples are now tracked in a radix tree. Here's what it means for your write-heavy workloads 🧵" }],
  ["show", { author: "@paulg", text: "The best founders I know talk to users every week, even at 500 employees. The ones who stop are the ones who drift." }],
  ["show", { author: "@cloudflaredev", text: "Durable Objects now support SQLite storage with point-in-time recovery. Docs: ", card: "SQLite in Durable Objects | Cloudflare Docs" }],
  ["show", { author: "@hubermanlab", text: "Viewing morning sunlight within 30-60 min of waking anchors your circadian rhythm and improves sleep onset at night." }],
  ["hide", { author: "@shitposter", text: "me when the coffee kicks in", media: true }],
  ["hide", { author: "@cryptokol", text: "$PEPE2 is the one. 100x from here. Not financial advice 🚀🚀🚀" }],
  ["hide", { author: "@politicsguy", text: "The other side is DESTROYING this country and nobody is talking about it" }],
  ["hide", { author: "@growthguru", text: "Reply 'AI' and I'll DM you my 47 prompts that made me $1M 👇" }],
  ["hide", { author: "@randomdev", text: "gm" }],
  ["hide", { author: "@dramaalert", text: "BREAKING: two big streamers are fighting on Twitter right now 😳" }],
  ["hide", { author: "@brand", text: "Shop the new collection", promoted: true }],
  ["show", { author: "@martinkl", text: "New post: local-first software, three years on. What we got right about CRDTs, what we got wrong, and what's still unsolved." }],
];

const res = await judgeFeedItems(settings, "x", posts.map(([, p], i) => ({ id: String(i), ...p })));
let pass = 0;
posts.forEach(([want, p], i) => {
  const v = res[String(i)];
  const got = v.hide ? "hide" : "show";
  if (got === want) pass++;
  console.log(`${got === want ? "PASS" : "FAIL"} want=${want} got=${got} ${v.kind.padEnd(15)} rel=${v.rel.toFixed(2)} | ${p.author}: ${p.text.slice(0, 60)}`);
});
console.log(`posts: ${pass}/${posts.length}`);
