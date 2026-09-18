# Privacy

Feedwall has no server and collects nothing. This page says exactly what leaves your browser and what stays in it.

## What leaves your browser

For each post Feedwall judges, one HTTPS request goes to the model endpoint you configured (by default `https://api.typesafe.ai`), authenticated with your own API key. It contains:

- the post's text (clipped to 1,500 characters), the author's display name, the text of a quoted post and a link title if present, and the name of the site;
- the text of your active rules.

Nothing else is sent, and nothing is sent anywhere else. There are no analytics, no error reporting, and no update pings beyond the browser's normal extension updates.

TypeSafe's handling of that data is governed by your agreement with them: https://typesafe.ai/legal/privacy-policy

## What stays in your browser

Stored in `chrome.storage.local`, readable only by this extension:

- your settings and API key;
- a cache of decisions (a hash of the post and the probabilities returned, not the post text);
- the last 300 hidden posts (text clipped to 280 characters) so you can review them;
- your "right / wrong / missed" marks, including the text of the posts you marked;
- today's counters (posts judged, hidden, tokens used).

Removing the extension deletes all of it. "Clear list" on the settings page deletes the hidden-post history.

## What Feedwall does not read

Direct messages, compose boxes, settings, login and checkout pages. Each site adapter lists the paths it refuses to run on. Feedwall only runs on the sites listed in `manifest.json`.

## Exports

The export buttons create files on your computer containing the posts you marked. They are not uploaded anywhere.
