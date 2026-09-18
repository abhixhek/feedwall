# Feedwall: product design

One sentence: **tell your browser, in plain English, what you want more of and what you want gone; it applies that on every feed you use, and shows you when it got it wrong.**

> v0.2 replaced fixed "rules" with reader-defined **topics**. The sections below describe v0.1's loop, which still holds; the v0.2 additions are at the end.

## Who it is for

People who live in feeds for work (builders, researchers, writers) and want the signal without the bait. They are comfortable pasting an API key. They do not trust black-box filters, so everything Feedwall hides stays one click away.

## The core loop

1. A post scrolls toward the viewport.
2. The site adapter extracts plain text: author, body, quoted text, link title.
3. One request goes to Jev: the post is the `state`; every active rule is one yes/no question. All rules are answered in parallel, so ten rules cost about the same as one.
4. Each rule comes back as a probability. If any rule clears its threshold, the post collapses into a one-line bar: `Hidden · engagement bait · 92% · Show · Wrong?`
5. The decision is cached by content hash. Scrolling back costs nothing.

## Decisions and why

| Decision | Choice | Why |
|---|---|---|
| Rules | Presets with carefully written criteria + free-text custom rules | Jev answers questions literally. Well-written presets work out of the box; custom rules get a local lint (negations, compound "and/or", vague words) before they are saved. |
| Hide style | Collapse to a bar, never delete | Trust. The reader can always see what was hidden and why. |
| Uncertain zone | Optional "dim" between `threshold - 0.15` and `threshold` | Uses the probability instead of throwing it away. |
| Strictness | One slider (Relaxed 0.90 / Balanced 0.75 / Strict 0.60), overridable per rule | One control for most people; per-rule thresholds for the ones a user cares about. |
| Timing | Judge posts ~1,500 px before they enter the viewport | Decisions land before the post is visible, so there is no flash. Optional "blur until judged". |
| Failure | Fail open. Error, timeout, or budget exhausted means the post is shown | A filter that hides things when it breaks is worse than no filter. |
| Key | Bring your own TypeSafe key, stored in `chrome.storage.local`, used only by the background worker | No server of ours, nothing to breach, inside TypeSafe's terms (the user is their customer). |
| Privacy | Only feed and comment content is read. Never DMs, compose boxes, settings, or logged-out pages of other sites | Stated in the README and enforced by URL exclusions in each adapter. |
| Budget | Daily request cap (default 3,000) and a live cost meter | Measured: ~450 input tokens per post with three rules, so 1,000 posts is about $0.02; the cap makes the ceiling a guarantee. |
| Code | Manifest V3, plain JavaScript, no build step, no dependencies | A privacy tool should be readable in one sitting. |

## The part nobody else has: showing its own mistakes

- **Review panel**: everything hidden today, with the rule and probability. Two buttons per item: "Right" and "Wrong".
- **Missed one**: a small hover button on any visible post, "hide things like this", records a miss for a rule.
- **Per-rule report**: from the user's marks, how often each rule was wrong, and a suggested threshold. A rule that is wrong too often is flagged, and the user can loosen or rewrite it.
- **Export**: marks export as JSONL in jevcal's format, so an exact threshold for a target accuracy is one `jevcal compile` away.

## Sites in v0

X, Hacker News, Reddit, YouTube, LinkedIn. One small adapter per site: a selector for items, an `extract()` function, and URL exclusions. Adapters are the only part expected to break when sites change, so each is a single short file, and the popup shows "0 posts found on this page" when one needs fixing.

## Surfaces

- **In-page**: the collapsed bar, the dim state, the hover "hide things like this".
- **Popup**: on/off for this site, strictness, today's counts (judged, hidden, cost), adapter health.
- **Options page**: API key, rules (presets + custom with lint), per-rule thresholds, review panel, export, budget.

## Not in v0

Hosted keys or accounts, mobile, Firefox (the code is portable; the store listing is not), rewriting rules with an LLM, image or video understanding (Jev is text-only), automatic threshold changes without the user agreeing.

## Risks

1. Site DOM changes break adapters. Mitigation: tiny adapters, health indicator, fixtures in tests.
2. Latency from far regions (~1 s observed from India) can beat the prefetch margin on fast scrolls. Mitigation: larger margin, optional blur-until-judged.
3. Users need a TypeSafe key (waitlist). Gateways that serve Jev without a waitlist use a different request shape; add as providers after v0.
4. No moat. The accuracy loop and cross-site coverage are the reasons to choose it; being open source is the reason to trust it.

## v0.2: the reader defines the classifications

**Why.** The first live run hid generic filler well, and the obvious next question was the inverse: "I care about indie builders; can I say what I *want*?" A want and a don't-want are the same mechanism (a yes/no question with a probability) with a different action attached. So the product became: the reader writes any number of classifications, with context, and chooses what each one does.

| Decision | Choice | Why |
|---|---|---|
| Unit | A **topic**: name, description, what counts, what doesn't, up to 3 taught examples per side, an action, sites, its own confidence bar | Maps one-to-one onto a `noul` question: the context goes into `criteria`, which is where the model expects domain rules. |
| Actions | Keep, Highlight, Dim, Hide | Four verbs cover "protect", "draw my eye", "push down", "remove". |
| Precedence | Keep > Hide > (focus filter) > Dim > Highlight > near-miss dim | Fixed and documented, so the reader can predict what happens when topics overlap. Keep must beat Hide or a launch post that reads like a pitch disappears. |
| About you | One optional line, sent once per post in the state | Gives every topic the same background for almost no tokens. |
| Control | "Test it on my recent posts": run a draft over the last ~60 posts actually seen | The model reads wording literally; seeing real matches before saving is what makes free-text topics usable. Costs a fraction of a cent. |
| Focus mode | Per-site switch; only posts fitting a wanted topic remain; one chip counts the rest, Peek reveals them | The bold version of "what I want". A counter instead of a wall of bars. It never blanks a feed: no model answer or no wanted topic means it does nothing. |
| Sets | "About you" + topics, exported as a pasteable code; four built-ins | Sharing a set is how this spreads: "here is my filter for X". No server needed. Imports are sanitized and previewed. |
| Cache | Keyed on the wording sent to the model, not on actions or confidence bars | Changing what a topic *does* is free; only changing what it *asks* costs a new request. |
| No LLM helper | The reader writes topics; lint + Test it guide them | A second API key would double the setup. Revisit if people struggle to write topics. |

**Cost reality.** Every topic's wording travels with every post. Measured: five topics with context plus "about you" is about 700 input tokens per post, roughly $0.03 per 1,000 posts. The editor shows a live estimate so nobody is surprised.

**Open issues.** X's virtualized list can keep stale spacing after a collapse; focus mode removes most posts, so it stresses exactly that. Reddit selectors are unverified. Both need a human on the live sites.
