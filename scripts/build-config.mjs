// Copies JEV_API_KEY from .env into extension/config.local.json (gitignored),
// because a Chrome extension can't read .env at runtime.
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const env = Object.fromEntries(
  readFileSync(join(root, ".env"), "utf8")
    .split("\n")
    .map((l) => l.match(/^\s*([\w.]+)\s*=\s*(.*?)\s*$/))
    .filter(Boolean)
    .map(([, k, v]) => [k, v.replace(/^(['"])(.*)\1$/, "$2")])
);
if (!env.JEV_API_KEY) throw new Error("JEV_API_KEY missing from .env");
writeFileSync(join(root, "extension/config.local.json"), JSON.stringify({ JEV_API_KEY: env.JEV_API_KEY }) + "\n");
console.log("Wrote extension/config.local.json");
