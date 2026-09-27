# Rot Guard

A Chrome extension that blocks brain rot by reading what you're looking at and checking it against your own goals.

Most blockers work on sites: YouTube is either allowed or blocked. That doesn't fit how people actually use the web. A database internals talk and a MrBeast video are both on YouTube, and an X feed can hold one useful post among forty bad ones. Rot Guard works one level down. It figures out which video, which channel, which post and which article you're looking at, then asks [TypeSafe Jev](https://docs.typesafe.ai) whether that particular thing helps with the goals you wrote down. It also counts how long you've been there.

What that looks like in practice:

- **YouTube.** A useful video plays. The MrBeast video next to it is blocked. On the home feed, search results and the "Up next" sidebar, each tile is judged separately, and irrelevant ones collapse to a single line with a **Show** button. Shorts are always hidden.
- **X.** Each post in your feed is judged separately. Irrelevant posts collapse to one line like `Hidden · price talk / shilling · @handle: "…"  Show`, and ads are always hidden. X gets a check-in budget (2 visits a day of up to 15 minutes by default), so you can use it as a news feed without it turning into doomscrolling.
- **Everything else.** Reddit, LinkedIn, articles and any other page are read and judged too: category, relevance to your goals, and a waste-of-time score. Rules get stricter the longer you stay.
- **Appeals.** When something is blocked you can write one justification. Jev checks whether it's specific, honest and actually about this page. If it passes, you get 15 minutes. If it's an excuse, the page stays locked until midnight.
- **Fun and music are allowed.** You list your hobbies separately from your goals. They're never blocked on content (time limits still apply), and music is never blocked at all.

## Setup

You need Chrome (or another Chromium browser), Node 18+ and a TypeSafe Jev API key from [TypeSafe](https://docs.typesafe.ai).

```sh
git clone https://github.com/plusminushalf/rot-guard.git
cd rot-guard

# 1. API key
cp .env.example .env                                         # then put your JEV_API_KEY in .env
node scripts/build-config.mjs                                # writes extension/config.local.json

# 2. Your profile
cp extension/profile.example.json extension/profile.local.json   # then edit it
```

Then open `chrome://extensions`, turn on **Developer mode**, click **Load unpacked** and pick the `extension/` folder.

You can also skip both files. Paste the API key under the extension's **Settings**, and edit your profile there as well. If there's no `profile.local.json`, the extension starts from `profile.example.json`.

## Your profile

Everything Jev knows about you comes from `extension/profile.local.json`. It's gitignored, so your personal preferences never end up in the repo.

| Key | What it's for |
| --- | --- |
| `profile` | A few sentences about who you are and how you want to spend your attention. Write it the way you'd explain it to a friend. |
| `goals` | What counts as progress. Content that helps one of these is allowed. Be specific: "backend engineering, databases, Postgres internals" works much better than "work". |
| `fun` | Hobbies. They aren't progress, but they aren't rot either. They're never blocked on content, only on time. |
| `avoid` | What counts as brain rot for you. |
| `allowlist` | Domains that are never judged, such as email, docs and your work tools. Subdomains are included. |
| `trustedCreators` / `mutedCreators` | Handles or channel names that are always shown or always hidden. |

Any other setting (for example `passMinutes`, `xCheckinsPerDay`, `xCheckinMinutes` or `readingMinutesPerDay`, all listed in `DEFAULT_SETTINGS` in `extension/shared.js`) can go in the same file.

Anything you save in the extension's Settings page overrides the file. **Reset to defaults** in Settings goes back to what the file says. Changing your profile, goals, avoid list or fun list clears the verdict cache, so everything gets judged again against the new version.

## How it decides

- **Extraction** (`content.js`) has site-specific readers for YouTube (watch, Shorts, feed, search, channel), X (post, feed with tab, search, profile), Reddit and LinkedIn, with a generic reader (title, description, headings, text) for everything else.
- **Time** counts only engaged time: the tab is visible and either focused and not idle for 3 minutes, or playing media. It adds up per page and per site for the day, so reloading doesn't reset it.
- **Jev** answers four typed questions per page: category (choice), relevant to goals (yes/no), waste-of-time score (0–4), and whether it's a feed (yes/no). Page answers are cached, so a re-judge only calls Jev again if the content changed.
- **Rules** (`decide` in `jev.js`) stay in code because Jev is bad at numbers. They get stricter at 2, 10 and 20 minutes and every 20 minutes after that. Short-form video, entertainment and brain rot are blocked straight away. Low-relevance pages get blocked as time passes, feeds get blocked after 10 minutes, and 60+ minutes on a site that doesn't serve your goals is blocked.
- **X, post by post.** Every post in your feed, search results and profiles gets its own Jev call. On a post you opened, the replies are left alone: nothing is blurred or sent to Jev, and only the post itself is judged, with a post-type choice plus a relevant-to-goals yes/no, batched 10 posts per request. Posts are blurred until they're judged. Because X feeds are filtered this way, the page as a whole is only blocked on time: 10+ minutes scrolling a feed, or 60+ minutes on X. You can turn this off in Settings.
- **YouTube, video by video.** Each watch page is judged and locked on its own, so blocking one video never blocks YouTube. List pages (home, search, channels, "Up next") have each tile judged from its title, channel, duration and views. The list pages themselves are only blocked on time, the same as X.
- **Creator reputation, rated first.** Every X author and YouTube channel is rated before their content is judged, from two signals. The first is Jev's opinion of the creator, used only when it's confident: 0.6+ to count as high-signal, 0.85+ to count as low-signal, because below that it's guessing from the name. The second is their track record, the average relevance of their items you've been shown, which takes over after 3 items. The tier (trusted / high-signal / neutral / low-signal / muted) is sent to Jev with each item and shifts relevance by ±0.25 in code. So a sharp person's sarcasm gets the benefit of the doubt, and a noise account's good-looking take gets extra suspicion. From high-signal creators only outrage, drama, shilling, engagement bait and clickbait get the strict rule; memes don't.
- **Cache.** Every post, video and page gets a signature: a hash of the platform, its ID and its content (post text, or video title and channel). Jev's answers are cached under that signature for 1 day in persistent storage, so nothing is judged twice, even across Chrome restarts. Hide decisions are recomputed from the cached answers, so they follow the creator's current tier.
- **Articles** are read as beginning + middle + end of the post body (Substack, Ghost, Medium, WordPress), because essays often open with a hook and only reach their point later. If Jev is under 50% sure what a page even is, it isn't blocked on content in the first 10 minutes.
- **Add a goal from the block page.** If a page is blocked because your goal list is missing something, you can add the goal right there. It's saved to Settings, which clears the cache, lifts that page's lock and judges it again. This works even after a failed appeal: fixing your goals is always allowed, excuses aren't.
- **Music doesn't count.** Music (songs, mixes, playlists, live sets; not Shorts) is never blocked, and time spent listening doesn't count toward the site's daily total, so a long YouTube mix won't trip the 60-minute rule for the rest of YouTube.
- **Budgets** are enforced in code, since they're about counting. X gets 2 check-ins a day of up to 15 minutes each, and a visit after 45+ minutes away counts as a new check-in. Posts opened from links elsewhere don't use up a check-in. Newsletters (Substack including custom domains, Medium, beehiiv, Ghost) get 45 minutes a day in total.
- **Appeal.** The block page takes one justification, which Jev checks: is it specific and honest, is it an excuse, and does it match this page? If it passes, you get `passMinutes` (default 15), after which the page is judged again. If it fails, you get "Fuck you." and the page is locked until midnight.

## Privacy

Rot Guard has no server of its own. Everything stays in your browser's extension storage, except the content it judges: page titles, post text, video titles, channel names and article excerpts go to the TypeSafe Jev API, along with your profile, goals, fun and avoid lists. Pages on allowlisted domains are never sent. If you don't want some site's content going to Jev, add it to your allowlist.

## Project layout

```
extension/
  manifest.json          Manifest V3
  background.js          service worker: time tracking, budgets, locks, cache, message routing
  content.js             per-site extraction, post/tile blurring and collapsing
  jev.js                 Jev client, typed questions, and the rules that turn answers into verdicts
  cache.js               signature-keyed verdict cache
  shared.js              settings, defaults, helpers
  popup.*  options.*  blocked.*   the extension's pages
  profile.example.json   example profile (copy to profile.local.json)
scripts/build-config.mjs copies JEV_API_KEY from .env into extension/config.local.json
test/                    live tests against the real Jev API
```

## Tests

The tests call the real Jev API, using the example profile so results don't depend on yours. They need `JEV_API_KEY` in your environment or `extension/config.local.json`.

```sh
node test/jev-live.mjs        # 12 sample pages + 5 appeals
node test/x-posts-live.mjs    # 12 sample X posts
node test/yt-videos-live.mjs  # 12 sample YouTube videos
node test/creators-live.mjs   # creator reputation: sarcasm from experts, good-looking takes from noise accounts
node test/profile-live.mjs    # fun (chess, cooking), music and interesting ideas in; random watching out
```

Jev's answers are probabilistic, so a case near a threshold can flip between runs.
