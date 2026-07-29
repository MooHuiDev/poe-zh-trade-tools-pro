import { browser } from "wxt/browser"

/**
 * Cross-browser, promise-based extension API handle.
 *
 * Chrome (MV3) returns promises from `chrome.*`, but Firefox's promise-based API
 * lives on `browser.*` (its `chrome.*` is callback-only, so `await chrome...`
 * yields `undefined`). WXT's `browser` resolves to the correct promise-based
 * namespace on each engine, so use `ext` for any awaited call (storage / tabs /
 * runtime.sendMessage). Callback-style listeners may keep using `chrome.*`.
 */
export const ext = browser as unknown as typeof chrome
