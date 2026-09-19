# Changelog

## Unreleased

- A trailer, built from code: `trailer/` renders every frame through headless Chrome and synthesizes its own score. It replaces the earlier slideshow demo. README screenshots now come from it.
- A test bench for the popup (`tests/harness/popup.html`).

## 0.2.2 (2026-09-19)

- The popup now says why nothing is happening on a page: switched off, no key, site switched off, no topics for this site, background worker not answering, or an error. The page script writes the same state to `data-fw-status` on `<html>`.
- The page script retries its first settings read, so a background worker that is still waking up no longer leaves a tab unfiltered.
- Unreadable saved topics fall back to the starter topics instead of leaving the extension silently dead.
- LinkedIn is off until you switch it on from the popup.
- Fixed: "Test it" printed the word "null" under the summary; hidden form fields could still show.
- Removed the unused optional host permission.

## 0.2.1 (2026-09-18)

- Fixed on X: the note above a dimmed or marked post was laid out as a flex item and stretched the post to several screens tall. Notes now float.
- Focus mode removes filtered posts completely instead of leaving slivers, and a Hide topic inside focus mode counts toward the one chip instead of adding a bar per post.

## 0.2.0 (2026-09-18)

- Topics: reader-written classifications with context, examples, an action each (Keep, Highlight, Dim, Hide), their own sites and confidence bar. Replaces the fixed presets; old settings migrate.
- "Test it on my recent posts", wording checks while you type, a starter library.
- Focus mode with Peek. Shareable sets with a previewed import. "About you" line.
- Per-topic accuracy report, teach-an-example menu, export in jevcal's format.

## 0.1.1 (2026-09-18)

- Fixes from the first run on live X: state survives React re-renders, the collapsed bar takes the full row, posts are judged before they reach the screen, hidden tabs still scan.

## 0.1.0 (2026-09-18)

- First version: fixed presets, collapse and dim, local cache, daily budget, fail-open.
