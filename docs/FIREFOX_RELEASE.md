# Firefox release checklist

This document is for maintainers publishing Poe Zh Trade Tools Pro to Firefox
Add-ons (AMO).

## Files to build

Run:

```bat
pnpm run package:firefox
```

Expected outputs:

- `build/poe-zh-trade-tools-pro-<version>-firefox.zip`
- `build/poe-zh-trade-tools-pro-<version>-sources.zip`
- `build/firefox-mv3/manifest.json`

Upload the Firefox ZIP as the add-on package. If AMO asks for source code,
upload the sources ZIP.

## Firefox extension ID

The Firefox Manifest V3 build includes:

```json
{
  "browser_specific_settings": {
    "gecko": {
      "id": "poe-zh-trade-tools-pro@moohuidev"
    }
  }
}
```

Maintainer action before the first AMO submission:

- Confirm the final Firefox extension ID.
- If a different ID is preferred, build with:

```bat
set FIREFOX_EXTENSION_ID=your-final-id@example
pnpm run package:firefox
```

Important: after the first AMO release, keep the same Firefox extension ID for
future updates.

## Data collection declaration

The manifest declares:

```json
{
  "data_collection_permissions": {
    "required": ["none"]
  }
}
```

This matches the current privacy policy: the extension stores user data locally
and does not collect, transmit, sell, or share personal information.

## AMO listing fields

Suggested summary:

> Traditional/Simplified Chinese localization plus bookmarks, history, and
> result tools for the official Path of Exile trade site.

Suggested description:

> Poe Zh Trade Tools Pro adds a companion sidebar and quality-of-life tools to
> the official Path of Exile trade website. It supports saved trade-search
> bookmarks, search history, optional Traditional/Simplified Chinese
> localization, bilingual search, PoeDB links, and equivalent pricing helpers
> powered by public poe.ninja exchange-rate data. Bookmarks, history, settings,
> and cached metadata stay on the user's device.

Suggested privacy policy:

Use `store/PRIVACY-POLICY.md`.

Suggested support email:

Use the maintainer's preferred public support email.

Suggested permissions explanation:

- `storage`: stores bookmarks, history, settings, and cached trade metadata on
  the user's device.
- `tabs`: detects and works with supported Path of Exile trade tabs.
- `unlimitedStorage`: allows larger local bookmark/history/cache data without
  browser quota issues.
- Path of Exile trade host permissions: enhance supported official trade pages.
- `pathofexile.tw`: fetch official Traditional-Chinese trade metadata.
- `poe.ninja`: fetch public exchange-rate data for equivalent pricing.
- `raw.githubusercontent.com`: fetch the maintainer's public item-name
  dictionary updates.

## User documentation

Keep `docs/FIREFOX_INSTALL.md` updated after AMO approval by adding the final
Firefox Add-ons URL.
