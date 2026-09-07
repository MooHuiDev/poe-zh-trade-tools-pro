import { tradeHosts, isNativeChineseTradeSite } from "~/lib/config/trade-hosts"
import { appendMissingGroups } from "~/lib/poe-zh-core/trade-data-merge"

/**
 * Trade-data API translator (MAIN world).
 *
 * As of the 2026 trade-site update, the site loads its Stat Filters / static /
 * filters / items data straight from `/api/trade/data/*` into the Vue app and
 * no longer reads the `lscache-*` localStorage that zh-core injects. This
 * patches `window.fetch` so those API responses are served with the Chinese
 * data zh-core already prepares (kept in `lscache-*` as the data source). The
 * ids / labels / group structure are identical to the API — only `text` / `type`
 * are Chinese — so search is unaffected.
 *
 * Self-gating: when translation is off (or a non-Chinese UI language), zh-core
 * removes the `lscache-*` keys, so there is nothing to swap and the site stays
 * English. Fully defensive: any problem falls back to the untouched response.
 */
export default defineContentScript({
  matches: tradeHosts,
  world: "MAIN",
  runAt: "document_start",

  main() {
    // The Garena Taiwan site is already Chinese; nothing to translate there.
    if (isNativeChineseTradeSite()) return

    const EP_TO_LS: Record<string, string> = {
      stats: "lscache-tradestats",
      static: "lscache-tradedata",
      filters: "lscache-tradefilters",
      items: "lscache-tradeitems"
    }
    const matchEndpoint = (url: string) =>
      url.match(/\/api\/trade\/data\/(stats|static|filters|items)(?:$|[/?])/)

    const readArray = (lsKey: string): unknown[] | null => {
      try {
        const raw = localStorage.getItem(lsKey)
        if (!raw) return null
        const val = JSON.parse(raw)
        return Array.isArray(val) && val.length > 0 ? val : null
      } catch {
        return null
      }
    }

    // zh-core (isolated world) fills lscache-* asynchronously at document_start;
    // give it a short window to land before falling back to the English data.
    const awaitArray = async (lsKey: string): Promise<unknown[] | null> => {
      let arr = readArray(lsKey)
      if (arr) return arr
      const deadline = Date.now() + 1500
      while (Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 60))
        arr = readArray(lsKey)
        if (arr) return arr
      }
      return null
    }

    const translate = async (
      real: Response,
      lsKey: string
    ): Promise<Response> => {
      try {
        const arr = await awaitArray(lsKey)
        if (!arr) return real
        const json = await real.clone().json()
        if (!json || !Array.isArray(json.result)) return real
        // Use the Taiwan-translated data (full Chinese, correct structure), then
        // append any GROUP the live response has that Taiwan lacks (kept as-is =
        // English) so a brand-new filter/stat section GGG ships before Taiwan
        // catches up stays visible/searchable instead of disappearing. We never
        // touch Taiwan's own entries, so option-type stats stay Chinese (no
        // mixed output — the reason the earlier per-entry "merge" was dropped).
        json.result = appendMissingGroups(arr, json.result)
        return new Response(JSON.stringify(json), {
          status: real.status,
          statusText: real.statusText,
          headers: { "content-type": "application/json" }
        })
      } catch {
        return real
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
        const method = (
          init?.method ||
          (input instanceof Request ? input.method : "GET") ||
          "GET"
        ).toUpperCase()
        const m = url ? matchEndpoint(url) : null
        if (m && method === "GET") {
          const lsKey = EP_TO_LS[m[1]]
          return originalFetch
            .apply(this as typeof window, args)
            .then((real) => (real && real.ok ? translate(real, lsKey) : real))
        }
      } catch {
        // fall through to the untouched request
      }
      return originalFetch.apply(this as typeof window, args)
    }
  }
})
