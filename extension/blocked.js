import { describe, fmtDuration, getSettings } from "./shared.js";

const $ = (id) => document.getElementById(id);
const id = location.hash.slice(1);

function li(parent, text) {
  const el = document.createElement("li");
  el.textContent = text;
  parent.appendChild(el);
}

function showFu(why, reason) {
  $("fu").classList.remove("hidden");
  // The goal panel stays: fixing your goals is always allowed, excuses aren't.
  $("fu").after($("goal-panel"));
  $("hero").classList.add("hidden");
  $("appeal").classList.add("hidden");
  $("fu-why").textContent = why || "";
  $("fu-reason").textContent = reason ? `“${reason}”` : "";
  document.title = "Fuck you.";
  window.scrollTo(0, 0);
}

async function render() {
  const [rec, settings] = await Promise.all([
    chrome.runtime.sendMessage({ type: "blocked:get", id }),
    getSettings(),
  ]);
  if (!rec) {
    $("subtitle").textContent = "Block record expired.";
    return;
  }

  if (rec.lockLifted) {
    $("subtitle").textContent = "The lock was lifted. Judging the page again…";
    location.replace(rec.url);
    return;
  }

  const d = describe(rec.context);
  $("what-head").textContent = d.head;
  $("what-main").textContent = d.main || rec.url;
  d.samples.slice(0, 5).forEach((s) => li($("what-samples"), s));

  const v = rec.verdict || {};
  $("s-page").textContent = fmtDuration(rec.pageSeconds);
  $("s-domain").textContent = fmtDuration(rec.domainSecondsNow ?? rec.domainSeconds);
  $("s-cat").textContent = v.categoryLabel || "–";
  if (v.categoryConfidence != null) $("s-cat-conf").textContent = `category · ${Math.round(v.categoryConfidence * 100)}% sure`;
  if (v.relevance != null) {
    $("s-rel").textContent = `${Math.round(v.relevance * 100)}%`;
    $("b-rel").style.width = `${v.relevance * 100}%`;
  }
  if (v.rotScore != null) {
    $("s-rot").textContent = v.rotScore.toFixed(1);
    $("b-rot").style.width = `${(v.rotScore / 4) * 100}%`;
  }
  (v.reasons || []).forEach((r) => li($("reasons"), r));
  if (v.creator) li($("reasons"), `Creator: ${v.creator}, rated ${v.creatorTierLabel}.`);
  settings.goals.forEach((g) => li($("goals"), g));

  if (rec.locked) showFu("You already tried.", rec.rejectedReason);
}

$("form").addEventListener("submit", async (e) => {
  e.preventDefault();
  $("submit").disabled = true;
  $("text").disabled = true;
  $("status").textContent = "Jev is judging your excuse…";
  const res = await chrome.runtime.sendMessage({ type: "blocked:appeal", id, text: $("text").value });
  if (res?.error) {
    $("status").textContent = `Jev call failed: ${res.error}`;
    $("submit").disabled = false;
    $("text").disabled = false;
    return;
  }
  if (res.ok) {
    $("status").textContent = `${res.why} You have ${res.passMinutes} minutes. Make them count.`;
    setTimeout(() => location.replace(res.url), 1500);
  } else {
    showFu(res.why, $("text").value);
  }
});

$("goal-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  $("goal-submit").disabled = true;
  const res = await chrome.runtime.sendMessage({ type: "blocked:addGoal", id, goal: $("goal").value });
  if (!res?.ok) {
    $("goal-status").textContent = res?.why || res?.error || "Couldn't save that.";
    $("goal-submit").disabled = false;
    return;
  }
  $("goal-status").textContent = "Added. Judging this page again against your new goals…";
  setTimeout(() => location.replace(res.url), 900);
});

$("back").addEventListener("click", async () => {
  const tab = await chrome.tabs.getCurrent();
  chrome.tabs.remove(tab.id);
});

render();
