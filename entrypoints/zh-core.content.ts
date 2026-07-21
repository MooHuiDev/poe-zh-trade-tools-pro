import { tradeHosts } from "~/lib/config/trade-hosts"
import { getTradeTranslationState } from "~/lib/services/trade-translation"

/**
 * Self-built translation core — trade-site cache injection.
 *
 * Writes the official Traditional-Chinese stats / static / filters data (fetched
 * by the background from pathofexile.tw) into the trade site's own lscache-*
 * localStorage keys. The native site then renders Chinese for the Stat Filters,
 * currency selectors and filter dropdowns. Because these entries keep their
 * language-independent ids, searching still works normally.
 *
 * Runs at document_start and re-applies for a short while, because the site
 * populates its cache asynchronously on first load.
 */
export default defineContentScript({
  matches: tradeHosts,
  runAt: "document_start",

  async main() {
    // Marker that we have injected translated data into the site's cache, so we
    // know to clear it again once translation is turned off (or the language is
    // switched away from Chinese) — otherwise the stale Chinese cache would
    // linger and the market would stay translated while the UI is English.
    const INJECTED_MARKER = "zhcore-injected"
    const LS_KEYS = [
      "lscache-tradestats",
      "lscache-tradedata",
      "lscache-tradefilters",
      "lscache-tradeitems"
    ]

    // Opt-in: only run when a Chinese UI language is selected AND the user has
    // turned on trade-site translation.
    const state = await getTradeTranslationState()
    if (!state.enabled) {
      // Self-correct: if we previously injected translated data, remove it so
      // the site refetches its native (English) data on this load. Guarded by
      // the marker so pristine non-translating users are never touched.
      try {
        if (localStorage.getItem(INJECTED_MARKER)) {
          for (const lsKey of LS_KEYS) {
            localStorage.removeItem(lsKey)
            localStorage.removeItem(`${lsKey}-cacheexpiration`)
          }
          localStorage.removeItem(INJECTED_MARKER)
        }
      } catch {
        // ignore storage errors
      }
      return
    }
    const cn = state.language === "zh-cn"

    const STORE_TO_LS: Record<string, string> = {
      [cn ? "zhCore_cn_stats" : "zhCore_stats"]: "lscache-tradestats",
      [cn ? "zhCore_cn_static" : "zhCore_static"]: "lscache-tradedata",
      [cn ? "zhCore_cn_filters" : "zhCore_filters"]: "lscache-tradefilters",
      [cn ? "zhCore_cn_items" : "zhCore_items"]: "lscache-tradeitems"
    }

    let cache: Record<string, unknown> = {}

    const inject = () => {
      let injected = 0
      for (const [storeKey, lsKey] of Object.entries(STORE_TO_LS)) {
        const arr = cache[storeKey]
        if (!Array.isArray(arr)) continue
        try {
          const serialized = JSON.stringify(arr)
          if (localStorage.getItem(lsKey) !== serialized) {
            localStorage.setItem(lsKey, serialized)
          }
          // Remove lscache's expiry marker so the site treats our data as
          // fresh and does not re-fetch English data over it.
          localStorage.removeItem(`${lsKey}-cacheexpiration`)
          injected++
        } catch {
          // Storage may be full or blocked; ignore and keep the site working.
        }
      }
      if (injected > 0) {
        try {
          localStorage.setItem(INJECTED_MARKER, "1")
        } catch {
          // ignore
        }
      }
      return injected
    }

    try {
      chrome.storage.local.get(
        Object.keys(STORE_TO_LS),
        (data) => {
          cache = (data as Record<string, unknown>) || {}
          inject()
          // Re-apply a few times: the site may populate/overwrite its cache
          // asynchronously as the Vue app boots.
          ;[300, 900, 2000, 4000].forEach((delay) => setTimeout(inject, delay))
        }
      )
    } catch {
      // chrome.storage unavailable — nothing to inject.
    }
  }
})
