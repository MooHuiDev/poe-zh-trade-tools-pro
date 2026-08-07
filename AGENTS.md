<!-- codebase-memory-mcp:start -->
# Codebase Knowledge Graph (codebase-memory-mcp)

This project uses codebase-memory-mcp to maintain a knowledge graph of the codebase.
ALWAYS prefer MCP graph tools over grep/glob/file-search for code discovery.

## Priority Order
1. `search_graph` - find functions, classes, routes, variables by pattern
2. `trace_path` - trace who calls a function or what it calls
3. `get_code_snippet` - read specific function/class source code
4. `query_graph` - run Cypher queries for complex patterns
5. `get_architecture` - high-level project summary

## When to fall back to grep/glob
- Searching for string literals, error messages, config values
- Searching non-code files (Dockerfiles, shell scripts, configs)
- When MCP tools return insufficient results

## Examples
- Find a handler: `search_graph(name_pattern=".*OrderHandler.*")`
- Who calls it: `trace_path(function_name="OrderHandler", direction="inbound")`
- Read source: `get_code_snippet(qualified_name="pkg/orders.OrderHandler")`
<!-- codebase-memory-mcp:end -->

# Extension Rules

## Build / release — Chrome `key` flag
- The Chrome manifest `key` (which pins the extension ID for `chrome.storage.sync`) is **opt-in** via env `POE_UNPACKED_KEY=1`, and is **Chrome-only**.
- **Chrome Web Store build must NOT carry the key** — build without the flag: `pnpm exec wxt zip`. The store assigns its own key/ID; shipping a foreign `key` causes problems.
- **Local test / GitHub manual-install-with-sync build**: `POE_UNPACKED_KEY=1 pnpm exec wxt build` (or `zip`). Gives a stable ID (`ojmpcecpbncgeiaejbfdihhlbpgiamja`) so a user's own machines share one sync bucket.
- **GitHub Release artifacts stay store-safe (no key)** — `release.yml` does NOT set the flag. Firefox manual installs still sync (they use `gecko.id`, independent of this flag).
- The committed key is the PUBLIC key only (safe to commit; cannot sign or impersonate). The private `.pem` is never committed.

## Terminology / Casing (standard names)
- Always write these two product names in this exact casing in **any user-facing / display text** (README, RELEASE_NOTES, What's New, i18n strings, UI labels, docs, commit messages, GitHub):
  - **PoEDB** — never `PoeDB`, `Poedb`, `PoEDb`, `poedb`, `POEDB`.
  - **PoE Wiki** — never `PoeWiki`, `Poe wiki`, `Poe Wiki`, `PoEwiki`, `poe wiki`.
- If the user (or any source text) types one of these wrong, silently correct it to the standard form — no need to ask.
- **Do NOT rewrite** non-display occurrences: code identifiers/variables (e.g. `poedbLocale`, `POEDB_LOCALE`), CSS classes, and URLs such as `poedb.tw` stay exactly as written.

## Translations
- Every new user-facing text created for this extension must be added for every supported language by default.
- Do not add UI text only to English or Spanish and rely on fallback text.
- Update all locale files under `lib/services/i18n/`: `en.ts`, `es.ts`, `pt.ts`, `ru.ts`, `th.ts`, `de.ts`, `fr.ts`, `ja.ts`, and `ko.ts`.
- This applies to settings, buttons, tooltips, aria labels, flash messages, popup text, sidebar text, What's New copy, and release-facing text inside the app.

## Release Notes
- Experimental features and dev-only changes must not appear in changelogs or What's New.
- What's New must keep all changes for the active minor version line. For example, all `1.1.x` changes stay grouped together until the version moves to a new minor line such as `1.2.x`.
