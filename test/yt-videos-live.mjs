// Live check of per-video YouTube filtering. Run: node test/yt-videos-live.mjs
import { judgeFeedItems } from "../extension/jev.js";
import { settings } from "./settings.mjs";

const videos = [
  ["show", { title: "Raft Consensus Deep Dive: Leader Election and Log Replication", channel: "CMU Database Group", duration: "42:10" }],
  ["show", { title: "Designing Data-Intensive Applications: Replication explained", channel: "Martin Kleppmann", duration: "1:02:33" }],
  ["show", { title: "How to Get Startup Ideas", channel: "Y Combinator", duration: "18:02" }],
  ["show", { title: "The Science of Sleep & How to Improve It", channel: "Huberman Lab Clips", duration: "14:55" }],
  ["show", { title: "Patrick Collison: Stripe, economic progress and building for decades", channel: "Dwarkesh Patel", duration: "1:31:20" }],
  ["hide", { title: "$456,000 Squid Game In Real Life!", channel: "MrBeast", duration: "25:41" }],
  ["hide", { title: "I Reacted To The Worst TikToks Of 2026 😂", channel: "Kwite", duration: "16:02" }],
  ["hide", { title: "Minecraft But Every Block Is TNT", channel: "Dream", duration: "31:12" }],
  ["hide", { title: "This Memecoin Will 100x Before Christmas (LAST CHANCE)", channel: "Crypto Banter", duration: "22:40" }],
  ["hide", { title: "The DRAMA Between These YouTubers Is INSANE", channel: "Drama Alert", duration: "12:03" }],
  ["hide", { title: "Real Madrid vs Barcelona | Highlights", channel: "LaLiga", duration: "9:58" }],
  ["hide", { title: "wait for it 😭", channel: "clipz", short: true }],
];

const res = await judgeFeedItems(settings, "yt", videos.map(([, v], i) => ({ id: String(i), ...v })));
let pass = 0;
videos.forEach(([want, v], i) => {
  const r = res[String(i)];
  const got = r.hide ? "hide" : "show";
  if (got === want) pass++;
  console.log(`${got === want ? "PASS" : "FAIL"} want=${want} got=${got} ${r.kind.padEnd(13)} rel=${r.rel.toFixed(2)} | ${v.channel}: ${v.title.slice(0, 60)}`);
});
console.log(`videos: ${pass}/${videos.length}`);
