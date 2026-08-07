# Privacy Policy — Poe Zh Trade Tools Pro

_Last updated: 2026-08-07_

Poe Zh Trade Tools Pro ("the Extension") is a browser companion for the
official Path of Exile trade website. This policy explains what data the
Extension handles.

## Summary

**The Extension has no server of its own and never receives, collects, sells, or
shares your personal information.** By default everything you create with it stays
on your own device. An **optional, off-by-default** bookmark sync lets your
bookmarks travel between your own devices using your browser's built-in Sync — it
still never passes through us.

## Data stored locally on your device

The Extension stores the following in your browser's local storage
(`chrome.storage.local` / `localStorage`):

- Your bookmarks and folders (saved trade searches)
- Your search history
- Your settings (language, sidebar side, feature toggles, etc.)
- Cached trade metadata used for the Chinese localization feature

This data is not sent to us or to any third party. You can export or delete it at
any time from the Extension's settings.

## Optional cross-device bookmark sync

The Extension includes an **optional** "sync bookmarks across devices" setting that
is **turned off by default**. When you turn it on:

- Your **bookmarks and folders only** are written to your browser's built-in sync
  storage (`chrome.storage.sync`). Search history and other data remain local.
- The browser (Chrome or Firefox) then synchronizes that data across the devices
  where **you** are signed in to **your own** browser account (Google account for
  Chrome, Mozilla account for Firefox), governed by that browser vendor's privacy
  policy.
- **The Extension has no server and never receives this data.** We cannot see it;
  it moves only between your own devices through your own browser account.
- Turning the setting off stops syncing; your local data is unaffected.

## Network requests

To function, the Extension reads data directly from these official/public
sources, from within your browser:

- **pathofexile.com** (and its regional subdomains) — the trade pages the
  Extension enhances.
- **pathofexile.tw** — official Traditional-Chinese trade metadata used to
  translate the trade site.
- **poe.ninja** — public currency exchange rates, used for the optional
  "equivalent pricing" feature.
- **raw.githubusercontent.com** — the maintainer's own public GitHub, to fetch
  the latest Chinese item-name dictionary.

These requests fetch public game/market data only. No personal data,
identifiers, or analytics are sent.

## Third parties

The Extension uses no analytics, no advertising, and no tracking.

## Attribution

This project is based on the open-source **Poe Trade Plus** by KroxiLabs,
licensed under the MIT License.

## Disclaimer

This Extension is not affiliated with, authorized, or endorsed by Grinding
Gear Games. "Path of Exile" is a trademark of Grinding Gear Games.

## Contact

Maintainer: MooHui Dev — moohuidev@gmail.com
