// Project-specific namespace for anything that lives on the SHARED page origin
// rather than in per-extension chrome.storage.
//
// Content-script `window.localStorage` and page DOM CustomEvents are keyed by
// the page's ORIGIN, not by the extension, so they are shared with every other
// extension injected into the same trade page. This fork inherited the `bt-*`
// localStorage keys and `poe-trade-plus:*` event names from Poe Trade Plus, so
// with both extensions installed they collided (see GitHub issue #5). We move
// our own keys/events to a distinct namespace and keep the trade site's own
// keys (e.g. `lscache-*`) untouched.

/** localStorage key prefix for this extension's own state. */
export const LS_PREFIX = "pztt-"

/** Legacy prefix inherited from Poe Trade Plus (read-only fallback). */
export const LEGACY_LS_PREFIX = "bt-"

/** CustomEvent / postMessage namespace for this extension. */
export const EVENT_NS = "pztt"

const canUseLocalStorage = () =>
  typeof window !== "undefined" && !!window.localStorage

/**
 * Read one of our localStorage values. Falls back to the legacy `bt-` key when
 * the namespaced key is absent — a one-way, non-destructive migration for
 * existing users. The legacy key is never written or deleted here, so a
 * side-by-side Poe Trade Plus install is left undisturbed.
 */
export const readNsLocal = (suffix: string): string | null => {
  if (!canUseLocalStorage()) return null
  const value = window.localStorage.getItem(LS_PREFIX + suffix)
  if (value !== null) return value
  return window.localStorage.getItem(LEGACY_LS_PREFIX + suffix)
}

/** Write one of our localStorage values under the project namespace only. */
export const writeNsLocal = (suffix: string, value: string) => {
  if (!canUseLocalStorage()) return
  window.localStorage.setItem(LS_PREFIX + suffix, value)
}

/** Remove one of our namespaced localStorage values. */
export const removeNsLocal = (suffix: string) => {
  if (!canUseLocalStorage()) return
  window.localStorage.removeItem(LS_PREFIX + suffix)
}

/** Build a namespaced DOM event / postMessage name (e.g. `pztt:...`). */
export const nsEvent = (name: string) => `${EVENT_NS}:${name}`
