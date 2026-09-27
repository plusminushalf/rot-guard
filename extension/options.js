import { getSettings, saveSettings, getDefaults } from "./shared.js";

const $ = (id) => document.getElementById(id);
const lines = (s) => s.split("\n").map((l) => l.trim()).filter(Boolean);

function fill(s) {
  $("profile").value = s.profile;
  $("goals").value = s.goals.join("\n");
  $("avoid").value = s.avoid.join("\n");
  $("fun").value = (s.fun || []).join("\n");
  $("allowlist").value = s.allowlist.join("\n");
  $("trustedCreators").value = s.trustedCreators.join("\n");
  $("mutedCreators").value = s.mutedCreators.join("\n");
  $("enabled").checked = s.enabled;
  $("xFilter").checked = s.xFilter;
  $("ytFilter").checked = s.ytFilter;
  $("passMinutes").value = s.passMinutes;
  for (const k of ["xCheckinsPerDay", "xCheckinMinutes", "xCheckinGapMinutes", "readingMinutesPerDay"]) $(k).value = s[k];
  $("apiKey").value = s.apiKey;
  $("model").value = s.model;
}

$("save").addEventListener("click", async () => {
  await saveSettings({
    profile: $("profile").value.trim(),
    goals: lines($("goals").value),
    avoid: lines($("avoid").value),
    fun: lines($("fun").value),
    allowlist: lines($("allowlist").value).map((d) => d.toLowerCase()),
    trustedCreators: lines($("trustedCreators").value),
    mutedCreators: lines($("mutedCreators").value),
    enabled: $("enabled").checked,
    xFilter: $("xFilter").checked,
    ytFilter: $("ytFilter").checked,
    passMinutes: Math.max(1, Number($("passMinutes").value) || 15),
    xCheckinsPerDay: Math.max(0, Number($("xCheckinsPerDay").value) || 0),
    xCheckinMinutes: Math.max(1, Number($("xCheckinMinutes").value) || 15),
    xCheckinGapMinutes: Math.max(5, Number($("xCheckinGapMinutes").value) || 45),
    readingMinutesPerDay: Math.max(0, Number($("readingMinutesPerDay").value) || 0),
    apiKey: $("apiKey").value.trim(),
    model: $("model").value.trim() || "jev-latest",
  });
  $("saved").textContent = "Saved.";
  setTimeout(() => ($("saved").textContent = ""), 1500);
});

$("reset").addEventListener("click", async () => fill({ ...(await getDefaults()), apiKey: $("apiKey").value }));

async function showCache() {
  const st = await chrome.runtime.sendMessage({ type: "cache:stats" });
  const days = (Date.now() - st.oldest) / 86400000;
  $("cacheInfo").textContent = `${st.entries.toLocaleString()} cached verdicts${st.entries ? `, oldest ${days < 1 ? `${Math.round(days * 24)}h` : `${days.toFixed(1)}d`} old` : ""}`;
}
$("clearCache").addEventListener("click", async () => {
  await chrome.runtime.sendMessage({ type: "cache:clear" });
  showCache();
});

fill(await getSettings());
showCache();
