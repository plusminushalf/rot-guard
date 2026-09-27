// Live check of the "who I am" profile: fun, music and interesting ideas are in, random watching is out.
// Run: node test/profile-live.mjs
import { judgeFeedItems } from "../extension/jev.js";
import { settings } from "./settings.mjs";

const videos = [
  ["show", { title: "Magnus Carlsen's Most Brilliant Endgame | World Rapid 2025", channel: "agadmator's Chess Channel", duration: "14:20" }],
  ["show", { title: "The Sicilian Najdorf: ideas every club player should know", channel: "GothamChess", duration: "22:05" }],
  ["show", { title: "The Food Lab: Perfect Pan-Seared Steak", channel: "J. Kenji López-Alt", duration: "13:05" }],
  ["show", { title: "How to make fresh pasta by hand", channel: "Pasta Grannies", duration: "8:07" }],
  ["show", { title: "Radiohead - Weird Fishes/Arpeggi (Live From The Basement)", channel: "Radiohead", duration: "5:21" }],
  ["show", { title: "Tiny Desk Concert: Anderson .Paak & The Free Nationals", channel: "NPR Music", duration: "15:48" }],
  ["show", { title: "The Psychology of Human Misjudgment", channel: "Charlie Munger Archive", duration: "1:15:02" }],
  ["show", { title: "The Fall of Constantinople, 1453", channel: "Kings and Generals", duration: "38:10" }],
  ["show", { title: "How I built a $5k/month micro-SaaS as a solo developer", channel: "Indie Hackers", duration: "21:33" }],
  ["hide", { title: "I Survived 50 Hours In Antarctica", channel: "MrBeast", duration: "25:41" }],
  ["hide", { title: "Minecraft But Every Block Is TNT", channel: "Dream", duration: "31:12" }],
  ["hide", { title: "Real Madrid vs Barcelona | Highlights", channel: "LaLiga", duration: "9:58" }],
  ["hide", { title: "I Reacted To The Worst TikToks Of 2026 😂", channel: "Kwite", duration: "16:02" }],
];
const posts = [
  ["show", { author: "@Reuters", text: "BREAKING: The Federal Reserve cut interest rates by 25 basis points on Wednesday, citing slowing job growth." }],
  ["show", { author: "@chesscom", text: "Gukesh beats Nakamura with a stunning rook sacrifice in round 7 of the Candidates ♟️" }],
  ["hide", { author: "@politicsguy", text: "The other side is DESTROYING this country and nobody is talking about it" }],
  ["hide", { author: "@shitposter", text: "me when the coffee kicks in lmao", media: true }],
];

let pass = 0, total = 0;
const report = (label, list, res, fmt) => list.forEach(([want, it], i) => {
  const v = res[String(i)];
  const got = v.hide ? "hide" : "show";
  total++; if (got === want) pass++;
  console.log(`${got === want ? "PASS" : "FAIL"} ${label} want=${want} got=${got} ${v.kind.padEnd(14)} rel=${v.rel.toFixed(2)} | ${fmt(it)}`);
});
report("yt", videos, await judgeFeedItems(settings, "yt", videos.map(([, v], i) => ({ id: String(i), ...v }))), (v) => `${v.channel}: ${v.title.slice(0, 55)}`);
report("x ", posts, await judgeFeedItems(settings, "x", posts.map(([, p], i) => ({ id: String(i), ...p }))), (p) => `${p.author}: ${p.text.slice(0, 55)}`);
console.log(`profile: ${pass}/${total}`);
