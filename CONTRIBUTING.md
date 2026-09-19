# Contributing

Feedwall is plain JavaScript with no build step and no dependencies, so the loop is: edit a file, reload, look.

```bash
npm test                        # 31 unit tests, Node 20+
python3 -m http.server 8000     # then open http://localhost:8000/tests/harness/index.html?site=x
```

The test bench runs the real content script against a sample feed with a fake model, so you can work on the page script without a key and without touching a real site.

## The most useful fix: a site adapter

Sites change their markup and the adapter for that site stops finding posts. The popup then says "0 posts found on this page". Every adapter lives in [`src/content/adapters/sites.js`](src/content/adapters/sites.js) and is about ten lines:

```js
{
  site: "hackernews",                          // id used in settings
  hosts: ["news.ycombinator.com"],
  excludePaths: [/^\/submit/, /^\/login/],     // pages Feedwall must not read
  itemSelector: "tr.athing.submission",        // one element per post
  extract(el) {                                // plain text only
    return { kind: "post", text: "...", author: "..." };
  },
}
```

To fix one:

1. Open the site, open DevTools, and find the element that wraps exactly one post. Prefer `data-testid`, `role` and custom element names over class names, which are usually generated and change weekly.
2. Check it in the console: `document.querySelectorAll("<your selector>").length` should match the number of posts on screen.
3. Update `itemSelector` and `extract`. Read text with the `text()` helper (it uses `textContent`; `innerText` is empty for anything Feedwall has hidden).
4. Reload the extension on `chrome://extensions`, reload the tab, open the popup. "N posts found" is the check.
5. In the pull request, say which page you checked and on what date.

Two layout rules learned the hard way, both on X:

- Never insert a normal-flow element inside a post. Posts are flex rows; an extra flex item breaks the layout. Notes float (`position: absolute`), and the collapsed bar takes the full row.
- Keep state in `data-fw-*` attributes, never in class names. React re-renders wipe classes.

## Adding a site

Add an adapter as above, add the host to `content_scripts.matches` and `host_permissions` in `manifest.json`, and add its display name to `SITE_NAMES` in `src/ui/popup.js` and `SITES` in `src/ui/options.js`. Always list `excludePaths` for messages, settings, login and compose pages.

## Ground rules

- **Fail open.** Any failure path shows the post. A filter that hides things when it breaks is worse than no filter.
- **The key stays in the background worker.** Content scripts and pages never see it.
- **No new network destinations.** The only request Feedwall makes is to the model endpoint the reader configured. No analytics, no fonts, no CDNs.
- **No dependencies, no build step.** The whole extension should stay readable in one sitting.
- **No performance numbers for the model** in issues, docs or pull requests. TypeSafe's customer agreement does not allow publishing them. Use the test bench and sample posts for examples.
- Do not paste real people's posts into issues or tests. Write a sample that has the same shape.

## Starter topics and sets

New starter topics go in `LIBRARY` in [`src/core/topics.js`](src/core/topics.js). The model reads wording literally: describe what the post *is* (not what it is not), one idea per topic, and put near-misses in "what doesn't count". `lintTopic` in the same file flags the common mistakes.
