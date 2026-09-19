# Feedwall

**Your feed, your rules, in plain English.** Tell your browser what you want more of and what you want gone. Feedwall applies it on X, YouTube, Reddit, LinkedIn and Hacker News, keeps everything one click away, and shows you when it got it wrong.

[![Feedwall demo: a feed before and after, focus mode, topics, and the test button](docs/demo.gif)](docs/demo.mp4)

*30-second tour. [Full-quality video](docs/demo.mp4). The demo and the screenshots come from the test bench in `tests/harness`, which runs the real content script against a sample feed, so no real posts or accounts appear in them.*

**Jump to:** [Set it up in five minutes](#set-it-up-in-five-minutes) · [Nothing is happening?](#nothing-is-happening) · [Privacy](#privacy) · [Cost](#cost) · [Status](#status)

![A feed with wanted posts marked, bait collapsed, and a borderline post dimmed](docs/feed.png)

## Topics: you decide the classifications

A topic is a question asked of every post, written by you, with as much context as you care to give:

| | |
|---|---|
| **What are these posts?** | Posts sharing the result of a pricing change on a software product |
| **What counts** | Before-and-after numbers, what was tested |
| **What doesn't count** | General pricing advice with no result |
| **When a post fits** | Keep · Highlight · Dim · Hide |
| **Where, and how sure** | All sites or some; its own confidence bar |

Add as many as you like. An optional "about you" line gives every topic the same background. There is a starter library (engagement bait, rage bait, politics, generic filler, crypto promotion, hard sell, distressing news, indie building, technical depth, hiring) so you are never starting from a blank page.

When several topics fit the same post, the order is fixed so you can predict it: **Keep** always wins, then **Hide**, then **Dim**, then **Highlight**. A launch post that smells like a sales pitch stays visible if it fits a topic you chose to keep.

## Try a topic before you save it

**Test it on my recent posts** runs a draft topic over the last posts you actually scrolled past and shows what would fit at each confidence level, for a fraction of a cent. Vague wording shows up immediately: if nothing scores above 90%, the model does not know what you mean yet. Feedwall also checks your wording as you type, because the model reads it literally (negations, two topics in one, words like "interesting").

## Focus mode

![Focus mode: only the posts that fit a wanted topic, with a counter for the rest](docs/focus.png)

Switch it on per site and only posts that fit a Keep or Highlight topic remain. The rest are counted in one chip, and **Peek** shows them dimmed. It can only filter what the site already loaded, so a focused feed is shorter and you will scroll more. If the model fails or you have no wanted topics, focus mode does nothing: it never blanks a feed.

## Sets you can share

A set is your "about you" line plus your topics. Start from a built-in one (Indie builder, Deep work, Job hunt, Research) or copy yours as a code that anyone can paste. Importing always shows a preview first, and everything in a set is treated as plain text.

## It shows its own mistakes

![Settings: topics with actions, cost estimate, and the editor](docs/settings.png)

- **Wrong?** on a hidden post puts it back and records the mistake. The **Feedwall** button on any visible post lets you say "this fits one of my topics", and optionally teach it as an example.
- **How is it doing?** turns your marks into a per-topic report. Wrong too often at low confidence: it suggests a higher bar for that topic. Wrong at every confidence level: it tells you the wording is the problem.
- Marks export in [jevcal](https://github.com/abhixhek/jevcal)'s format to compute an exact threshold for a target accuracy.

## How it works

Every post heading toward your screen is sent, as plain text, to [Jev](https://typesafe.ai), a model that answers yes/no questions with a probability instead of writing text. Each topic is one question and all of them are answered in a single request. A language model would be too slow and too expensive to run on every post you scroll past; this kind of model answers in a few hundred milliseconds.

If anything fails (network, key, budget), the post is shown. Feedwall never hides something because it broke, and the popup tells you when requests are failing.

## Privacy

- No server, no account, no analytics. There is nothing of ours to send data to.
- Post text, your topics and your "about you" line go from your browser directly to TypeSafe, under **your own API key**. TypeSafe says it does not train on API requests; read [their terms](https://typesafe.ai/legal/privacy-policy).
- The key is stored in this browser only and is read only by the extension's background worker. Pages and content scripts never see it.
- Feedwall reads feed posts and comments. It skips direct messages, settings, login and compose pages.
- Details: [PRIVACY.md](PRIVACY.md).

## Set it up in five minutes

You need Chrome (or Edge, Brave, Arc) and your own TypeSafe API key. There is no build step and nothing to install besides the folder.

1. **Get a key.** Sign in at [typesafe.ai](https://typesafe.ai) and create an API key. Feedwall uses your key directly; there is no Feedwall account.
2. **Get the code.** Download the zip from the [latest release](https://github.com/abhixhek/feedwall/releases/latest) and unzip it, or:
   ```bash
   git clone https://github.com/abhixhek/feedwall.git
   ```
3. **Load it.** Open `chrome://extensions`, switch on **Developer mode** (top right), click **Load unpacked**, and pick the `feedwall` folder (the one that contains `manifest.json`).
4. **Add your key.** The settings page opens by itself. Paste the key and press **Save and test**. A green line means the key works.
5. **Say what you want.** Pick a built-in set (Indie builder, Deep work, Job hunt, Research) or press **New topic** and describe one in your own words. Press **Test it on my recent posts** once you have scrolled a feed for a minute.
6. **Open a feed.** Go to X, YouTube, Reddit or Hacker News. **Reload any tab that was already open**, then scroll. Pin the Feedwall icon; the popup shows what it found on the page and what today has cost.

LinkedIn is supported but switched off until you turn it on from the popup while on linkedin.com. LinkedIn is the site least tolerant of extensions, so that one is your call.

To update: `git pull` (or unzip the new release over the old folder), press the reload arrow on the Feedwall card in `chrome://extensions`, then reload your open feed tabs.

## Nothing is happening?

Open the popup on the feed. It always says why:

| The popup says | What to do |
|---|---|
| Reload this page to start filtering | The tab was open before Feedwall was installed or updated. Reload the tab. |
| Feedwall is switched off | Use the switch at the top right of the popup. |
| Add your API key in settings to start | Settings, paste the key, **Save and test**. |
| Filtering is switched off for this site | Tick the site checkbox in the popup. LinkedIn starts this way. |
| No topics apply to this site | Add a topic or pick a set in settings, or check the topic's **Where** boxes. |
| Feedwall's background worker did not answer | Press the reload arrow on the Feedwall card in `chrome://extensions`, then reload the tab. |
| N requests failed, so those posts were shown. Last error: ... | The error names the cause: `401` is a wrong or revoked key, `429` is TypeSafe's rate limit, a timeout is the network. Posts stay visible while requests fail. |
| daily budget reached | Your own request limit for the day was hit. Raise it in settings, or wait until tomorrow. |
| 0 posts found on this page | The site changed its layout. [Open a "site broke" issue](https://github.com/abhixhek/feedwall/issues/new?template=site-broke.yml); the fix is usually a few lines, see [CONTRIBUTING.md](CONTRIBUTING.md). |

For the curious, the page script also writes its state to `data-fw-status` on the page's `<html>` element.

## Cost

Input is billed at $0.042 per million tokens and output is free. Every topic's wording travels with every post, so cost grows with how much you write: five topics with context and an "about you" line measured about 700 tokens per post, roughly $0.03 per 1,000 posts. The settings page shows a live estimate for your own topics. Repeated posts are answered from a local cache for free, changing an action or a confidence bar never re-asks the model, and a daily request limit (default 3,000) makes the ceiling a guarantee.

## Status

v0.2.2 ([changelog](CHANGELOG.md)). What has been verified and what has not:

| Piece | Status |
|---|---|
| Topics, decision order, sets, migration, cache, budget, fail-open, "Test it", counters under load | 31 automated tests (`npm test`) |
| Starter topics and user-written topics (with and without context) | Checked against the live TypeSafe API on sample posts (2026-09-18) |
| Content script: collapse, dim, keep/highlight, focus mode and Peek, teach menu, surviving React re-renders | Verified in the test bench for the X and Hacker News layouts |
| Extension on live X | v0.1 and v0.2.0 ran end to end on a real feed (2026-09-18). Those runs exposed X re-render and layout bugs, fixed in v0.1.1 and v0.2.1 |
| Known issue on X | After a collapse, X's virtualized list can keep stale spacing for posts further down until its next layout pass |
| Page selectors | Checked on the live pages of X, Hacker News, YouTube and LinkedIn (2026-09-18). Reddit is written from its documented structure and not yet checked live |

Sites change their markup. When the popup says "0 posts found on this page" on a feed, the adapter for that site needs a fix; each one is a few lines in [`src/content/adapters/sites.js`](src/content/adapters/sites.js).

## Layout

```
manifest.json
src/core/          topics, decisions, accuracy report (plain functions, tested in Node)
src/background.js  holds the key, calls the model, cache, budget, recent-posts buffer
src/content/       the page script, styles, and one adapter per site
src/ui/            popup and settings page
tests/             unit tests and the visual test bench
scripts/           rebuilds the demo video from the test bench
docs/PRODUCT.md    the product design and the reasoning behind each decision
```

Plain JavaScript, Manifest V3, no dependencies. A privacy tool should be readable in one sitting.

## Development

```bash
npm test                                  # unit tests
python3 -m http.server 8000               # then open:
# http://localhost:8000/tests/harness/index.html?site=x
# http://localhost:8000/tests/harness/index.html?site=x&focus=1
# http://localhost:8000/tests/harness/index.html?site=hackernews&eager=1
# http://localhost:8000/tests/harness/options.html
sh scripts/make_demo.sh                   # rebuilds docs/demo.mp4 and docs/demo.gif (needs Chrome and ffmpeg)
```

Fixing a site adapter or adding a new site: [CONTRIBUTING.md](CONTRIBUTING.md).

Not affiliated with TypeSafe AI, X, Google, Reddit, LinkedIn or Y Combinator. MIT licensed.
