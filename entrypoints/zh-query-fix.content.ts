import {
  tradeHosts,
  isNativeChineseTradeSite
} from "~/lib/config/trade-hosts"

/**
 * Outgoing trade-query normalizer (MAIN world).
 *
 * The international trade server accepts option-based stats in the BASE + option
 * form (`{ id: "implicit.stat_1792283443", value: { option: 1 } }`). The Taiwan
 * data and some stale international list entries expose the same stat in the
 * "flattened" form with the option baked into the id
 * (`implicit.stat_1792283443|1`). Sending that flattened id makes the server
 * reject the whole search with "Unknown stat provided" — but only for some
 * stats (verified live: `stat_1792283443|1` 400s while `stat_2563183002|4`
 * works). Since base+option is accepted for BOTH, we normalise every outgoing
 * flattened option-stat id to base+option right before the request leaves the
 * page. The visible stat list / dropdowns are untouched, so translation and the
 * per-boss lines stay exactly as they are.
 *
 * This runs in the MAIN world so it patches the same `window.fetch` the site's
 * Vue app uses. It is fully defensive: any parsing problem falls straight back
 * to the original request, so it can never break a search.
 */
export default defineContentScript({
  matches: tradeHosts,
  world: "MAIN",
  runAt: "document_start",

  main() {
    // The Garena Taiwan site's own data is authoritative there; no rewrite needed.
    if (isNativeChineseTradeSite()) return

    const FLAT = /^(.+)\|(\d+)$/ // "<stat id>|<option>"
    const isTradeQuery = (url: string) =>
      /\/api\/trade\d?\/(search|exchange)\b/.test(url)

    // Rewrite a single stat filter object in place. Returns true if it changed.
    const rewriteFilter = (filter: unknown): boolean => {
      if (!filter || typeof filter !== "object") return false
      const f = filter as {
        id?: unknown
        value?: { option?: unknown } & Record<string, unknown>
      }
      if (typeof f.id !== "string" || f.id.indexOf(".") < 0) return false
      const m = f.id.match(FLAT)
      if (!m) return false
      f.id = m[1]
      f.value =
        f.value && typeof f.value === "object"
          ? { ...f.value, option: Number(m[2]) }
          : { option: Number(m[2]) }
      return true
    }

    // Walk the query's stat groups and rewrite each contained filter.
    const normalizeBody = (bodyText: string): string | null => {
      let changed = false
      let payload: unknown
      try {
        payload = JSON.parse(bodyText)
      } catch {
        return null
      }
      const stats = (payload as { query?: { stats?: unknown } })?.query?.stats
      if (!Array.isArray(stats)) return null
      for (const group of stats) {
        const filters = (group as { filters?: unknown })?.filters
        if (!Array.isArray(filters)) continue
        for (const filter of filters) if (rewriteFilter(filter)) changed = true
      }
      if (!changed) return null
      try {
        return JSON.stringify(payload)
      } catch {
        return null
      }
    }

    const originalFetch = window.fetch
    window.fetch = function (
      this: unknown,
      ...args: Parameters<typeof fetch>
    ): Promise<Response> {
      try {
        const [input, init] = args
        const url =
          typeof input === "string"
            ? input
            : input instanceof URL
              ? input.href
              : input instanceof Request
                ? input.url
                : ""
        // Only touch trade search/exchange POSTs whose body is a JSON string.
        if (
          url &&
          isTradeQuery(url) &&
          init &&
          typeof init.body === "string"
        ) {
          const next = normalizeBody(init.body)
          if (next != null) {
            const newInit: RequestInit = { ...init, body: next }
            return originalFetch.call(this as typeof window, input, newInit)
          }
        }
      } catch {
        // fall through to the untouched request
      }
      return originalFetch.apply(this as typeof window, args)
    }
  }
})
