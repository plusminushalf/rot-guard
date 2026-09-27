// Settings for the live tests: the example profile (so results don't depend on
// your own profile.local.json) plus a Jev key from JEV_API_KEY or config.local.json.
import { readFileSync } from "node:fs";
import { DEFAULT_SETTINGS } from "../extension/shared.js";

const read = (f) => JSON.parse(readFileSync(new URL(`../extension/${f}`, import.meta.url)));
function key() {
  if (process.env.JEV_API_KEY) return process.env.JEV_API_KEY;
  try { return read("config.local.json").JEV_API_KEY; } catch {}
  throw new Error("Set JEV_API_KEY or run `node scripts/build-config.mjs` first.");
}

export const settings = { ...DEFAULT_SETTINGS, ...read("profile.example.json"), apiKey: key() };
