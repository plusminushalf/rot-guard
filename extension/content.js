// Runs on every page. Two jobs:
//  1. Extract *what* you're actually looking at (which video, which posts, which
//     thread) so Jev judges content, not just a domain.
//  2. Count engaged time (tab visible + focused or media playing, and not idle).

(() => {
  if (window.top !== window) return; // top frame only

  const TICK_SECONDS = 5;
  const IDLE_AFTER_MS = 3 * 60 * 1000;
  const MAX = { title: 300, desc: 700, text: 1800, item: 280, items: 12 };

  const clean = (s, n) => (s || "").replace(/\s+/g, " ").trim().slice(0, n);
  const q = (sel, root = document) => root.querySelector(sel);
  const qa = (sel, root = document) => [...root.querySelectorAll(sel)];
  const txt = (sel, n = MAX.title, root) => clean(q(sel, root)?.innerText, n);
  const meta = (name) =>
    clean(q(`meta[name="${name}"], meta[property="${name}"]`)?.content, MAX.desc);
  const uniq = (arr) => [...new Set(arr.filter(Boolean))];
  const visible = (el) => {
    const r = el.getBoundingClientRect();
    return r.bottom > 0 && r.top < innerHeight * 2.5 && r.height > 0;
  };

  function youtube() {
    const p = location.pathname;
    if (p === "/watch") {
      return {
        site: "YouTube",
        kind: "video",
        title: txt("ytd-watch-metadata h1") || document.title.replace(/ - YouTube$/, ""),
        channel: txt("ytd-watch-metadata ytd-channel-name a") || txt("#owner #channel-name"),
        description: txt("ytd-watch-metadata #description-inline-expander", MAX.desc) || txt("#description", MAX.desc),
        is_live: !!q(".ytp-live") || undefined,
      };
    }
    if (p.startsWith("/shorts/")) {
      const active = q("ytd-reel-video-renderer[is-active]") || document;
      return {
        site: "YouTube",
        kind: "short-form video (YouTube Shorts)",
        title: txt("h2, yt-shorts-video-title-view-model", MAX.title, active) || document.title,
        channel: txt("ytd-channel-name, yt-reel-channel-bar-view-model", MAX.title, active),
      };
    }
    const titles = uniq(
      qa("a#video-title, #video-title-link, yt-lockup-metadata-view-model h3, h3 a#video-title-link")
        .filter((el) => visible(el) && !el.closest('[data-rg="hidden"]'))
        .map((el) => clean(el.innerText || el.title, MAX.item))
    ).slice(0, MAX.items);
    if (p === "/results") {
      return { site: "YouTube", kind: "search results", search_query: new URLSearchParams(location.search).get("search_query"), results: titles };
    }
    if (p.startsWith("/@") || p.startsWith("/channel/") || p.startsWith("/c/")) {
      return { site: "YouTube", kind: "channel page", channel: txt("#channel-name, yt-dynamic-text-view-model h1") || document.title, videos: titles };
    }
    return { site: "YouTube", kind: "feed (home / recommendations)", section: p, videos_shown: titles };
  }

  function tweetsOnPage(limit = MAX.items) {
    return qa('article[data-testid="tweet"]')
      .filter((a) => visible(a) && a.dataset.rg !== "hidden") // judge the feed you actually see
      .slice(0, limit)
      .map((a) => {
        const author = clean(q('[data-testid="User-Name"]', a)?.innerText, 80).split(" @")[0];
        const body = clean(q('[data-testid="tweetText"]', a)?.innerText, MAX.item);
        const media = q('[data-testid="tweetPhoto"], video', a) ? " [has media]" : "";
        return body || media ? `${author}: ${body}${media}` : null;
      })
      .filter(Boolean);
  }

  function twitter() {
    const p = location.pathname;
    if (/\/status\/\d+/.test(p)) {
      // Judge only the post you opened, not the replies under it.
      return { site: "X (Twitter)", kind: "single post", post: tweetsOnPage(1)[0] };
    }
    if (p.startsWith("/search")) {
      return { site: "X (Twitter)", kind: "search results", search_query: new URLSearchParams(location.search).get("q"), posts: tweetsOnPage() };
    }
    if (p === "/home" || p.startsWith("/explore") || p.startsWith("/i/")) {
      const tab = txt('[role="tab"][aria-selected="true"]', 40);
      return { site: "X (Twitter)", kind: `feed${tab ? ` (${tab} tab)` : ""}`, section: p, posts: tweetsOnPage() };
    }
    if (p === "/notifications" || p.startsWith("/messages")) {
      return { site: "X (Twitter)", kind: p.slice(1), posts: tweetsOnPage(6) };
    }
    return {
      site: "X (Twitter)",
      kind: "profile",
      profile: document.title.replace(/ \/ X$/, ""),
      bio: txt('[data-testid="UserDescription"]', MAX.desc),
      posts: tweetsOnPage(),
    };
  }

  function reddit() {
    const sub = (location.pathname.match(/^\/r\/([^/]+)/) || [])[1];
    const post = q("shreddit-post");
    if (location.pathname.includes("/comments/")) {
      return {
        site: "Reddit",
        kind: "post with comments",
        subreddit: sub && `r/${sub}`,
        title: clean(post?.getAttribute("post-title"), MAX.title) || txt("h1"),
        body: txt('[slot="text-body"], shreddit-post [property="schema:articleBody"]', MAX.desc),
        top_comments: qa("shreddit-comment [slot='comment']").slice(0, 6).map((c) => clean(c.innerText, MAX.item)),
      };
    }
    const titles = uniq(
      qa("shreddit-post").filter(visible).map((el) => {
        const t = el.getAttribute("post-title");
        const s = el.getAttribute("subreddit-prefixed-name");
        return t && `${s ? s + ": " : ""}${clean(t, MAX.item)}`;
      })
    ).slice(0, MAX.items);
    return { site: "Reddit", kind: sub ? "subreddit feed" : "feed (home / popular)", subreddit: sub && `r/${sub}`, posts: titles };
  }

  function linkedin() {
    if (location.pathname.startsWith("/feed")) {
      return {
        site: "LinkedIn",
        kind: "feed",
        posts: qa(".feed-shared-update-v2, [data-urn*='activity']")
          .filter(visible)
          .slice(0, MAX.items)
          .map((p) => clean(q(".update-components-text, .feed-shared-text", p)?.innerText, MAX.item))
          .filter(Boolean),
      };
    }
    return null;
  }

  function shortFormHints(host) {
    const p = location.pathname;
    if (host.endsWith("tiktok.com")) return "short-form video (TikTok)";
    if (host.endsWith("instagram.com") && (p.startsWith("/reel") || p === "/")) return p === "/" ? "feed (Instagram)" : "short-form video (Instagram Reels)";
    if (host.endsWith("facebook.com") && (p.startsWith("/reel") || p.startsWith("/watch"))) return "short-form video (Facebook)";
    return null;
  }

  // Beginning, middle and end of the body: essays often open with a hook
  // (anecdotes, a story) and only reach their point later.
  function excerpt(text, n) {
    // Drop a trailing promo (P.S. book list, "Subscribe", "Share") so the end
    // slice lands on the conclusion instead.
    const promo = text.slice(Math.floor(text.length * 0.7)).search(/\bP\.\s?S\.|\bSubscribe (now|to)\b|\bThanks for reading\b|\bShare this post\b/i);
    if (promo >= 0) text = text.slice(0, Math.floor(text.length * 0.7) + promo).trim();
    if (text.length <= n) return text;
    const head = Math.round(n * 0.45), mid = Math.round(n * 0.25), tail = n - head - mid;
    const m = Math.floor(text.length / 2 - mid / 2);
    return `${text.slice(0, head)} … ${text.slice(m, m + mid)} … ${text.slice(-tail)}`;
  }

  // Newsletters count against the daily reading budget, including Substack
  // publications on their own domains (e.g. newsletter.example.com).
  function newsletterPlatform(host) {
    if (host.endsWith("substack.com") || q('script[src*="substackcdn.com"], link[href*="substackcdn.com"], meta[content*="substackcdn.com"]')) return "Substack";
    if (host.endsWith("beehiiv.com") || q('meta[name="generator"][content*="beehiiv" i]')) return "beehiiv";
    if (host === "medium.com" || host.endsWith(".medium.com") || q('meta[property="al:android:package"][content="com.medium.reader"]')) return "Medium";
    if (q('meta[name="generator"][content^="Ghost"]') && q("article")) return "Ghost";
    return null;
  }

  function generic() {
    // Prefer the post body itself (Substack, Ghost, Medium, WordPress) over page chrome.
    const main =
      q(".available-content, .body.markup, .post-content, .gh-content, .entry-content, article .markup") ||
      q("article") || q("main") || q('[role="main"]') || document.body;
    return {
      site: location.hostname.replace(/^www\./, ""),
      kind: meta("og:type") || "web page",
      title: clean(document.title, MAX.title),
      description: meta("description") || meta("og:description"),
      headings: uniq(qa("h1, h2").slice(0, 6).map((h) => clean(h.innerText, 120))),
      subtitle: txt("h3.subtitle, .post-subtitle, .subtitle", 300) || undefined,
      text_excerpt: excerpt(clean(main?.innerText, 60000), MAX.text),
    };
  }

  function extract() {
    const host = location.hostname.replace(/^www\.|^m\./, "");
    let ctx = null;
    try {
      if (host === "youtube.com") ctx = youtube();
      else if (host === "x.com" || host === "twitter.com") ctx = twitter();
      else if (host.endsWith("reddit.com")) ctx = reddit();
      else if (host.endsWith("linkedin.com")) ctx = linkedin();
    } catch (e) {
      ctx = null;
    }
    if (!ctx) {
      ctx = generic();
      const hint = shortFormHints(host);
      if (hint) ctx.kind = hint;
      const nl = newsletterPlatform(host);
      if (nl) ctx.kind = `newsletter article (${nl})`;
    }
    // Drop empty fields so Jev only sees signal.
    for (const k of Object.keys(ctx)) {
      const v = ctx[k];
      if (v == null || v === "" || (Array.isArray(v) && !v.length)) delete ctx[k];
    }
    return ctx;
  }

  // SPA-heavy sites (YouTube, X) render content late; wait until the page has substance.
  async function extractWhenReady() {
    for (let i = 0; i < 8; i++) {
      const ctx = extract();
      const substance = ctx.title || ctx.post || ctx.posts?.length || ctx.videos_shown?.length || ctx.results?.length || ctx.text_excerpt?.length > 200;
      if (substance && i >= 1) return ctx;
      await new Promise((r) => setTimeout(r, 1000));
    }
    return extract();
  }

  const send = (msg) => chrome.runtime.sendMessage(msg).catch(() => {});

  async function announce() {
    const url = location.href;
    const context = await extractWhenReady();
    if (url === location.href) send({ type: "page", url, context });
  }

  // --- engaged-time tracking ---
  let lastInput = Date.now();
  for (const ev of ["mousemove", "keydown", "scroll", "wheel", "touchstart", "click"]) {
    addEventListener(ev, () => (lastInput = Date.now()), { passive: true, capture: true });
  }
  const mediaPlaying = () => qa("video, audio").some((m) => !m.paused && !m.ended && m.readyState > 2);

  setInterval(() => {
    const visibleTab = document.visibilityState === "visible";
    const playing = mediaPlaying();
    const engaged = visibleTab && (playing || (document.hasFocus() && Date.now() - lastInput < IDLE_AFTER_MS));
    if (engaged) send({ type: "tick", url: location.href, seconds: TICK_SECONDS });
  }, TICK_SECONDS * 1000);

  // --- SPA navigation ---
  let lastUrl = location.href;
  setInterval(() => {
    if (location.href !== lastUrl) {
      lastUrl = location.href;
      announce();
    }
  }, 1000);

  chrome.runtime.onMessage.addListener((msg, _sender, reply) => {
    if (msg.type === "extract") {
      reply({ url: location.href, context: extract() });
    }
  });

  // --- Feed filtering: judge each item (X post, YouTube video tile) on its own
  // and collapse the irrelevant ones to one line with a "Show" button. ---

  const X_ADAPTER = {
    name: "x",
    setting: "xFilter",
    itemSelector: 'article[data-testid="tweet"]',
    // Not on a post you opened (its replies are left alone), DMs, notifications or settings.
    active: () => !/\/status\/\d+|^\/(messages|notifications|settings|compose|i\/flow)/.test(location.pathname),
    skipId: () => null,
    itemOf(a) {
      const link = q('a[href*="/status/"] time', a)?.closest("a");
      const id = link?.href.match(/\/status\/(\d+)/)?.[1];
      if (!id) return null;
      const names = clean(q('[data-testid="User-Name"]', a)?.innerText, 120);
      const texts = qa('[data-testid="tweetText"]', a);
      const text = clean(texts[0]?.innerText, 600);
      const media = !!q('[data-testid="tweetPhoto"], video, [data-testid="videoPlayer"]', a);
      const handle = (names.match(/@\w+/) || [""])[0];
      const displayName = names.split(/\s*@/)[0].trim();
      return {
        id,
        creator: handle || displayName ? { platform: "X", handle: handle || undefined, name: displayName || undefined } : undefined,
        author: handle || displayName,
        text,
        quoted: texts[1] ? clean(texts[1].innerText, 280) : undefined,
        card: clean(q('[data-testid="card.wrapper"]', a)?.innerText, 160) || undefined,
        media,
        promoted: qa("span", a).some((s) => s.textContent === "Ad" || s.textContent === "Promoted"),
        summary: text ? `“${text.slice(0, 90)}${text.length > 90 ? "…" : ""}”` : media ? "[image / video]" : "",
      };
    },
  };

  const YT_TILES = [
    "ytd-rich-item-renderer", "ytd-video-renderer", "ytd-compact-video-renderer",
    "ytd-grid-video-renderer", "ytd-playlist-video-renderer", "yt-lockup-view-model",
  ].join(", ");
  const YT_ALWAYS_HIDE = [
    "ytd-reel-shelf-renderer", "ytd-rich-shelf-renderer[is-shorts]", "ytd-rich-section-renderer:has(ytd-rich-shelf-renderer[is-shorts])",
    "grid-shelf-view-model", "ytm-shorts-lockup-view-model", "ytd-ad-slot-renderer", "ytd-in-feed-ad-layout-renderer",
    "ytd-promoted-sparkles-web-renderer", "ytd-banner-promo-renderer", "ytd-statement-banner-renderer",
    'ytd-guide-entry-renderer:has(a[title="Shorts"])', 'ytd-mini-guide-entry-renderer[aria-label="Shorts"]',
  ].join(", ");

  const YT_ADAPTER = {
    name: "yt",
    setting: "ytFilter",
    itemSelector: YT_TILES,
    alwaysHide: YT_ALWAYS_HIDE, // Shorts shelves and ads: no judgment needed
    active: () => location.pathname !== "/shorts" && !location.pathname.startsWith("/shorts/"),
    skipId: () => (location.pathname === "/watch" ? new URLSearchParams(location.search).get("v") : null),
    itemOf(el) {
      if (el.parentElement?.closest(YT_TILES)) return null; // nested tile: the outer one is judged
      const href = q('a[href*="/watch?v="], a[href^="/shorts/"]', el)?.getAttribute("href");
      if (!href) return null;
      const u = new URL(href, location.origin);
      const id = u.pathname.startsWith("/shorts/") ? u.pathname.split("/")[2] : u.searchParams.get("v");
      if (!id) return null;
      const title = clean(
        q("#video-title", el)?.textContent || q("h3 a, h3", el)?.textContent || q("a[title]", el)?.getAttribute("title"),
        200
      );
      if (!title) return null; // not rendered yet; the next scan picks it up
      // Classic renderers link the channel; new lockups put it as plain text in the
      // first metadata row, with views and age in the rows after it.
      const rows = qa(".ytContentMetadataViewModelMetadataRow, .yt-content-metadata-view-model-wiz__metadata-row", el);
      const firstPiece = rows[0] && (q("a, .ytContentMetadataViewModelMetadataText, [role='text']", rows[0]) || rows[0]);
      const channel = clean(q("ytd-channel-name #text, ytd-channel-name a", el)?.textContent || firstPiece?.textContent, 80)
        .replace(/\s*[•·].*$/, ""); // never let "· 1.4 lakh views · 13 hr ago" leak into the name
      const meta = clean(q("#metadata-line", el)?.innerText || rows.slice(1).map((r) => r.textContent).join(" · "), 120);
      const duration = qa("ytd-thumbnail-overlay-time-status-renderer, badge-shape, [class*='Badge'], [class*='badge']", el)
        .map((b) => clean(b.textContent, 12))
        .find((t) => /^\d{1,2}(:\d{2}){1,2}$/.test(t));
      return {
        id,
        title,
        channel,
        duration: duration || undefined,
        meta: meta || undefined,
        short: u.pathname.startsWith("/shorts/"),
        promoted: !!el.closest("ytd-ad-slot-renderer, ytd-in-feed-ad-layout-renderer"),
        author: channel,
        creator: channel ? { platform: "YouTube", name: channel } : undefined,
        summary: `“${title}”`,
      };
    },
  };

  const host0 = location.hostname.replace(/^www\.|^m\./, "");
  const adapter = /^(x|twitter)\.com$/.test(host0) ? X_ADAPTER : host0 === "youtube.com" ? YT_ADAPTER : null;
  if (adapter) chrome.storage.local.get("settings").then(({ settings }) => {
    if (settings?.enabled !== false && settings?.[adapter.setting] !== false) initFeedFilter(adapter);
  });

  function initFeedFilter(ad) {
    const verdicts = new Map(); // item id -> verdict, or "pending"
    const revealed = new Set();
    let queue = [];
    let flushTimer = null;
    let scanTimer = null;

    // Hidden items keep their size and position (collapsing them makes the page
    // jump while scrolling). The content stays in place, blurred past reading and
    // dimmed to black & white, with a solid message card in the page's own
    // colors on top. Items still being classified are only dimmed, so allowed
    // ones don't flash from blurred to sharp.
    const style = document.createElement("style");
    style.textContent = `
      [data-rg="pending"] { filter: grayscale(1); opacity: .32; transition: opacity .2s; }
      [data-rg="hidden"] { position: relative !important; }
      [data-rg="hidden"] > :not(.rg-veil) { filter: grayscale(1) blur(14px); opacity: .32; pointer-events: none; user-select: none; }
      ${ad.alwaysHide ? `${ad.alwaysHide} { display: none !important; }` : ""}

      .rg-veil {
        --rg-fg: #f1f1f1; --rg-muted: #a1a1aa; --rg-line: rgba(255,255,255,.12); --rg-panel: rgba(22,22,24,.94);
        --rg-btn: rgba(255,255,255,.09); --rg-btn-hover: rgba(255,255,255,.16); --rg-shadow: 0 8px 28px rgba(0,0,0,.55);
        position: absolute; inset: 0; z-index: 5; display: flex; align-items: center; justify-content: center;
        padding: 12px; box-sizing: border-box; cursor: default;
        font: 13px/1.4 "Roboto", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; color: var(--rg-fg);
      }
      .rg-veil.rg-light {
        --rg-fg: #18181b; --rg-muted: #63636b; --rg-line: rgba(0,0,0,.10); --rg-panel: rgba(255,255,255,.95);
        --rg-btn: rgba(0,0,0,.06); --rg-btn-hover: rgba(0,0,0,.11); --rg-shadow: 0 8px 28px rgba(0,0,0,.14);
      }
      .rg-card { position: relative; display: flex; flex-direction: column; gap: 6px; width: min(100%, 440px); min-width: 0; box-sizing: border-box;
        padding: 16px 40px 16px 18px; border-radius: 14px; background: var(--rg-panel); border: 1px solid var(--rg-line);
        box-shadow: var(--rg-shadow); backdrop-filter: blur(6px); }
      .rg-eyebrow { display: flex; align-items: center; gap: 6px; font-size: 11px; font-weight: 500; letter-spacing: .07em; text-transform: uppercase; color: var(--rg-muted); }
      .rg-eyebrow svg { width: 14px; height: 14px; flex: none; }
      .rg-title { font-size: 14px; font-weight: 500; color: var(--rg-fg);
        display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
      .rg-meta { font-size: 12px; color: var(--rg-muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
      /* Deliberately small and faint: revealing should take intent, not a reflex click. */
      .rg-show { all: unset; position: absolute; top: 8px; right: 8px; display: grid; place-items: center;
        width: 18px; height: 18px; border-radius: 999px; cursor: pointer; color: var(--rg-muted); opacity: .45; }
      .rg-show svg { width: 10px; height: 10px; }
      .rg-show:hover { opacity: 1; background: var(--rg-btn-hover); }

      /* short items (most X posts): one line, full width */
      .rg-veil.rg-compact { padding: 6px 12px; }
      .rg-veil.rg-compact .rg-card { flex-direction: row; align-items: center; gap: 12px; width: 100%; max-width: none; padding: 7px 34px 7px 14px; border-radius: 12px; }
      .rg-veil.rg-compact .rg-eyebrow { flex: none; }
      .rg-veil.rg-compact .rg-title { flex: 1; font-size: 13px; font-weight: 400; -webkit-line-clamp: 1; }
      .rg-veil.rg-compact .rg-meta { display: none; }
      .rg-veil.rg-compact .rg-show { top: 50%; transform: translateY(-50%); }
    `;
    document.documentElement.appendChild(style);

    // Light or dark page? Read the actual background rather than trusting a theme flag.
    function pageIsLight() {
      for (const el of [document.body, document.documentElement]) {
        const m = getComputedStyle(el).backgroundColor.match(/[\d.]+/g);
        if (m && (m.length < 4 || Number(m[3]) > 0)) return 0.299 * m[0] + 0.587 * m[1] + 0.114 * m[2] > 150;
      }
      return !document.documentElement.hasAttribute("dark");
    }

    const EYE_OFF = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 3l18 18"/><path d="M10.6 5.1A10.9 10.9 0 0 1 12 5c5 0 9 4.5 10 7-.4 1-1.2 2.3-2.4 3.5M6.6 6.6C4.4 8 2.8 10.1 2 12c1 2.5 5 7 10 7 1.6 0 3.1-.4 4.4-1.1"/><path d="M9.9 9.9a3 3 0 0 0 4.2 4.2"/></svg>`;
    const CROSS = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>`;
    const cap = (t) => (t ? t[0].toUpperCase() + t.slice(1) : t);

    function makeVeil(el, item, v) {
      const veil = document.createElement("div");
      veil.className = "rg-veil";
      if (pageIsLight()) veil.classList.add("rg-light");
      if (el.getBoundingClientRect().height < 150) veil.classList.add("rg-compact");
      veil.dataset.for = item.id;
      // Swallow clicks so the hidden post/video isn't opened by accident.
      for (const ev of ["click", "mousedown", "mouseup", "pointerdown", "pointerup"]) {
        veil.addEventListener(ev, (e) => {
          if (e.target.closest(".rg-show")) return;
          e.preventDefault();
          e.stopPropagation();
        });
      }
      const card = document.createElement("div");
      card.className = "rg-card";

      const eyebrow = document.createElement("div");
      eyebrow.className = "rg-eyebrow";
      eyebrow.innerHTML = EYE_OFF; // static markup, no page data
      eyebrow.append(`Filtered · ${cap(v.label)}`);

      const title = document.createElement("div");
      title.className = "rg-title";
      title.textContent = item.summary.replace(/^“|”$/g, "") || "Post";

      const meta = document.createElement("div");
      meta.className = "rg-meta";
      meta.textContent = [item.author, v.tierLabel && `${v.tierLabel} creator`].filter(Boolean).join(" · ");

      const show = document.createElement("button");
      show.className = "rg-show";
      show.innerHTML = CROSS; // static markup, no page data
      show.title = "Show anyway";
      show.setAttribute("aria-label", "Show anyway");
      show.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        revealed.add(item.id);
        scan();
      });

      veil.title = `${cap(v.label)} · ${Math.round((v.rel || 0) * 100)}% relevant to your goals${v.tierLabel ? ` · ${v.tierLabel} creator` : ""}${item.author ? ` · ${item.author}` : ""}`;
      card.append(eyebrow, title, meta, show);
      veil.append(card);
      return veil;
    }

    function apply(el, item) {
      const v = verdicts.get(item.id);
      const state = !v || v === "pending" ? "pending" : v.hide && !revealed.has(item.id) ? "hidden" : "shown";
      el.dataset.rg = state;
      const existing = el.querySelector(`:scope > .rg-veil[data-for="${item.id}"]`);
      if (state === "hidden" && !existing) el.append(makeVeil(el, item, v));
      if (state !== "hidden" && existing) existing.remove();
    }

    function scan() {
      scanTimer = null;
      if (!ad.active()) {
        // SPA navigation from a feed into e.g. a post: undo anything already applied.
        for (const v of qa(".rg-veil")) v.remove();
        for (const el of qa("[data-rg]")) delete el.dataset.rg;
        return;
      }
      const skip = ad.skipId();
      for (const el of qa(ad.itemSelector)) {
        const item = ad.itemOf(el);
        if (!item) {
          if (el.dataset.rg && !el.parentElement?.closest(ad.itemSelector)) delete el.dataset.rg;
          continue;
        }
        el.dataset.rgId = item.id;
        if (item.id === skip) { el.dataset.rg = "shown"; continue; }
        if (!verdicts.has(item.id)) {
          verdicts.set(item.id, "pending");
          queue.push(item);
        }
        apply(el, item);
      }
      // Both sites recycle elements as you scroll; drop veils whose item moved on.
      for (const veil of qa(".rg-veil")) {
        const el = veil.parentElement;
        if (!el || el.dataset.rgId !== veil.dataset.for || el.dataset.rg !== "hidden") veil.remove();
      }
      if (queue.length && !flushTimer) flushTimer = setTimeout(flush, 200);
    }

    function flush() {
      flushTimer = null;
      while (queue.length) {
        const batch = queue.splice(0, 10);
        const settle = (res) => {
          for (const it of batch) verdicts.set(it.id, res?.verdicts?.[it.id] || { hide: false }); // fail open
          scan();
        };
        chrome.runtime.sendMessage({ type: "feed:judge", site: ad.name, items: batch }).then(settle, () => settle(null));
      }
    }

    new MutationObserver(() => {
      if (!scanTimer) scanTimer = setTimeout(scan, 120);
    }).observe(document.body, { childList: true, subtree: true });
    scan();
  }

  announce();
})();
