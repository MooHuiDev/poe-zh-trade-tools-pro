# Reviewer / store submission notes — v4.1.3

Local cheat-sheet (not shipped). Copy the relevant block into each store.

---

## Firefox AMO — "Notes to reviewer" (paste this)

This is a WXT-based Manifest V3 extension written in Svelte/TypeScript. The
uploaded package is bundled/minified, so full source is provided separately.

Build from source (Node 20+, pnpm):

    pnpm install
    pnpm run build:firefox      # output in build/firefox-mv3

What changed in 4.1.3:
- New OPTIONAL setting "Sync bookmarks across devices" (Settings → Bookmarks),
  OFF by default. When the user turns it on, only their bookmarks and folders are
  written to `browser.storage.sync`, so their own devices stay in sync through
  their Mozilla account. Search history and other data stay local.
- No new permissions were added — this uses the existing "storage" permission.
- No remote code is loaded or executed. Data placed in storage.sync is
  gzip-compressed (CompressionStream) purely to fit the sync-storage quota.
- The extension has no backend/server and transmits nothing to the developer or
  any third party.
- Also included: corrections to some bundled Chinese translation strings (data).

Permissions (unchanged): `storage`, `tabs`, `unlimitedStorage`. Host permissions
are limited to the pathofexile.* trade domains, pathofexile.tw (official Taiwan
trade metadata), poe.ninja (public prices), and raw.githubusercontent.com (the
maintainer's public Chinese item-name dictionary).

How to test the new feature: open the sidebar on a Path of Exile trade page →
Settings → Bookmarks → toggle "Sync bookmarks across devices". Single-device
testing simply writes to storage.sync; cross-device propagation additionally
requires Firefox Sync signed in with "Add-ons" enabled.

---

## Chrome Web Store — Privacy practices tab (how to fill)

- Single purpose: a companion/localization tool for the official Path of Exile
  trade website.
- Permission justifications:
  - storage — save bookmarks, folders, history and settings locally; and
    (optional, user-enabled) sync bookmarks via chrome.storage.sync.
  - tabs — open saved searches in new tabs and manage trade tabs.
  - unlimitedStorage — hold the (large) Chinese-localization dictionaries/caches
    locally.
  - host permissions — enhance and translate the official trade pages; poe.ninja
    for optional price ratios; raw.githubusercontent.com for the public
    dictionary.
- Remote code: No.
- Data usage / disclosures:
  - We do NOT collect or transmit user data to the developer or third parties.
  - We do NOT sell or share user data; not used for creditworthiness/lending.
  - The optional bookmark sync uses Chrome's own chrome.storage.sync; that data
    moves only between the user's own devices via their Google account and is not
    received by the developer.

Note: no new permissions vs 4.1.2, so the update review should be light. Make
sure the privacy-policy URL points to the updated PRIVACY-POLICY (covers sync).
