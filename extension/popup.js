import { describe, fmtDuration, CATEGORY_LABELS as LABELS } from "./shared.js";

const $ = (id) => document.getElementById(id);

let tabId;

function setStatus(text, cls) {
  $("status").textContent = text;
  $("status").className = `pill ${cls || ""}`;
}

async function render() {
  const s = await chrome.runtime.sendMessage({ type: "popup:state", tabId });
  if (!s || s.error) return setStatus("error", "bad");

  const st = s.state;
  const d = describe(st?.context || { title: s.tab.title });
  $("head").textContent = d.head || new URL(s.tab.url).hostname;
  $("main").textContent = d.main || s.tab.title;
  $("samples").replaceChildren(...d.samples.slice(0, 4).map((t) => Object.assign(document.createElement("li"), { textContent: t })));

  $("page-t").textContent = fmtDuration(s.pageSeconds);
  $("domain-t").textContent = fmtDuration(s.domainSeconds);
  $("x-hidden").textContent = s.itemsHidden;
  const b = s.budgets;
  $("x-checkins").textContent = `${b.xUsed} / ${b.xLimit}`;
  $("x-checkins-label").textContent = b.xCurrentSeconds != null ? `X check-ins · this one ${fmtDuration(b.xCurrentSeconds)} / ${b.xMinutes}m` : "X check-ins today";
  $("reading").textContent = `${fmtDuration(b.readingSeconds)} / ${b.readingMinutes}m`;

  const status = st?.status;
  if (s.passUntil) setStatus(`pass · ${Math.ceil((s.passUntil - Date.now()) / 60000)}m left`, "warn");
  else if (status === "ok") setStatus("allowed", "ok");
  else if (status === "blocked") setStatus("blocked", "bad");
  else if (status === "allowlisted") setStatus("allowlisted", "ok");
  else if (status === "disabled") setStatus("disabled");
  else if (status === "error") setStatus("error", "bad");
  else setStatus(/^https?:/.test(s.tab.url) ? "not analyzed yet" : "not a web page");

  $("error").textContent = st?.error || "";

  const v = st?.verdict;
  $("verdict-panel").hidden = !v;
  if (v) {
    $("rel").textContent = `${Math.round(v.relevance * 100)}%`;
    $("rel-bar").style.width = `${v.relevance * 100}%`;
    $("rot").textContent = v.rotScore.toFixed(1);
    $("rot-bar").style.width = `${(v.rotScore / 4) * 100}%`;
    const top = Object.entries(v.categoryProbs).sort((a, b) => b[1] - a[1]).filter(([, p]) => p >= 0.02).slice(0, 4);
    $("probs").replaceChildren(...top.flatMap(([k, p]) => [
      Object.assign(document.createElement("span"), { textContent: LABELS[k] || k }),
      Object.assign(document.createElement("span"), { textContent: `${Math.round(p * 100)}%` }),
    ]));
    const notes = v.creator ? [`Creator: ${v.creator} · ${v.creatorTierLabel}`, ...v.reasons] : v.reasons;
    $("reasons").replaceChildren(...notes.map((r) => Object.assign(document.createElement("li"), { textContent: r })));
  }

  $("domains").replaceChildren(...s.topDomains.flatMap(([h, sec]) => [
    Object.assign(document.createElement("span"), { textContent: h }),
    Object.assign(document.createElement("span"), { textContent: fmtDuration(sec) }),
  ]));
}

$("analyze").addEventListener("click", async () => {
  $("analyze").disabled = true;
  $("analyze").textContent = "Asking Jev…";
  await chrome.runtime.sendMessage({ type: "popup:analyze", tabId });
  $("analyze").disabled = false;
  $("analyze").textContent = "Analyze now";
  render();
});
$("options").addEventListener("click", () => chrome.runtime.openOptionsPage());

const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
tabId = tab.id;
render();
