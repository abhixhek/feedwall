# Feedwall

**Tell your browser, in plain English, what you don't want to see.** Feedwall hides those posts on X, YouTube, Reddit, LinkedIn and Hacker News, keeps every hidden post one click away, and shows you when it got it wrong.

![A feed with three posts collapsed and one dimmed](docs/feed.png)

*Screenshot from the test bench in `tests/harness`, which runs the real content script against a fake feed.*

## How it works

Every post that scrolls toward your screen is sent, as plain text, to [Jev](https://typesafe.ai), a model that answers yes/no questions with a probability instead of writing text. Each of your rules is one question. All rules are answered in a single request, so ten rules cost about the same as one.

- A rule clears its threshold: the post collapses into a bar. `Hidden · Engagement bait · 97% · Show · Wrong?`
- It comes close: the post is dimmed (optional).
- Anything fails (network, key, budget): the post is shown. Feedwall never hides something because it broke.

A language model would be too slow and too expensive to run on every post you scroll past. This kind of model answers in a few hundred milliseconds and a heavy day of scrolling costs a few cents.

## Rules

Seven presets you can switch on (engagement bait, rage bait, politics, generic filler, crypto promotion, hard sell, distressing news), plus your own:

> posts hyping a product launch countdown

The model reads rules literally, so Feedwall checks what you type and warns about wording that works badly: negations ("not about code"), two rules in one ("crypto and politics"), and words that mean different things to different people ("annoying").

## It shows its own mistakes

![Settings: rules, behaviour, and the per-rule accuracy report](docs/settings.png)

- **Wrong?** on any hidden post puts it back and records the mistake.
- **Hide like this** on any visible post records a miss.
- **How is it doing?** turns your marks into a per-rule report. If a rule is wrong too often at low confidence, Feedwall suggests a higher threshold for that rule. If it is wrong at every confidence level, it tells you the wording is the problem.
- **Export** your marks in [jevcal](https://github.com/abhixhek/jevcal)'s format to compute an exact threshold for a target accuracy.

## Privacy

- No server, no account, no analytics. There is nothing of ours to send data to.
- Post text goes from your browser directly to TypeSafe, under **your own API key**. TypeSafe says it does not train on API requests; read [their terms](https://typesafe.ai/legal/privacy-policy).
- The key is stored in this browser only and is read only by the extension's background worker. Pages and content scripts never see it.
- Feedwall reads feed posts and comments. It skips direct messages, settings, login and compose pages on every supported site.
- Details: [PRIVACY.md](PRIVACY.md).

## Install (from source)

1. Get a TypeSafe API key at [typesafe.ai](https://typesafe.ai).
2. Download or clone this repository.
3. Open `chrome://extensions`, switch on **Developer mode**, click **Load unpacked**, and pick the repository folder.
4. The settings page opens. Paste your key and press **Save and test**.
5. Open a feed and scroll.

Works in Chrome, Edge, Brave and Arc. There is no build step.

## Cost

Input is billed at $0.042 per million tokens and output is free. A post with the three default rules is about 450 tokens, so 1,000 posts is roughly $0.02. Repeated posts are answered from a local cache for free. A daily request limit (default 3,000) makes the ceiling a guarantee, and the popup shows today's spend.

## Status

v0.1. What has been verified and what has not:

| Piece | Status |
|---|---|
| Decision logic, cache, budget, fail-open, counters under load | 20 automated tests (`npm test`) |
| Preset rules | Checked against the live TypeSafe API on sample posts (2026-09-18) |
| Content script: collapse, dim, show, wrong, hide-like-this | Verified in the test bench for the X and Hacker News layouts |
| Page selectors | Checked against the live pages of X, Hacker News, YouTube and LinkedIn on 2026-09-18. Reddit is written from its documented structure and not yet checked live |
| Full extension on the live sites | Needs a human with a key: not yet confirmed end to end |

Sites change their markup. When the popup says "0 posts found on this page" on a feed, the adapter for that site needs a fix; each one is a few lines in [`src/content/adapters/sites.js`](src/content/adapters/sites.js).

## Layout

```
manifest.json
src/core/        rules, decisions, accuracy report (plain functions, tested in Node)
src/background.js  holds the key, calls the model, cache, budget, counters
src/content/     the page script, styles, and one adapter per site
src/ui/          popup and settings page
tests/           unit tests and the visual test bench
docs/PRODUCT.md  the product design and the reasoning behind each decision
```

Plain JavaScript, Manifest V3, no dependencies. A privacy tool should be readable in one sitting.

## Development

```bash
npm test                                  # unit tests
python3 -m http.server 8000               # then open:
# http://localhost:8000/tests/harness/index.html?site=x
# http://localhost:8000/tests/harness/index.html?site=hackernews&blur=1
# http://localhost:8000/tests/harness/options.html
```

Not affiliated with TypeSafe AI, X, Google, Reddit, LinkedIn or Y Combinator. MIT licensed.
