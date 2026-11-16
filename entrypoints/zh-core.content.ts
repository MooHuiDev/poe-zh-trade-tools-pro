import { tradeHosts } from "~/lib/config/trade-hosts"
import { getTradeTranslationState } from "~/lib/services/trade-translation"
import { UI_STRINGS_EVENT, UI_STRINGS_LS_KEY } from "~/lib/poe-zh-core/site-ui-strings"

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

    // Live language switch (繁↔简, or translation on/off) on a page that's
    // already open: this script ran once at load with the OLD setting, so follow
    // setting changes and hand the matching interface table to the MAIN-world
    // script (zh-ui-strings), which swaps it in place / reverts to English.
    const syncUiStrings = async () => {
      try {
        const st = await getTradeTranslationState()
        if (!st.enabled) {
          if (localStorage.getItem(UI_STRINGS_LS_KEY) !== null) {
            localStorage.removeItem(UI_STRINGS_LS_KEY)
            window.dispatchEvent(new Event(UI_STRINGS_EVENT))
          }
          return
        }
        const isCn = st.language === "zh-cn"
        const key = isCn ? "zhCore_cn_ui" : "zhCore_ui"
        chrome.storage.local.get(key, (d) => {
          const ui = (d as Record<string, unknown>)?.[key]
          if (!ui || typeof ui !== "object") return
          const serialized = JSON.stringify({ lang: isCn ? "zh-CN" : "zh-TW", strings: ui })
          if (localStorage.getItem(UI_STRINGS_LS_KEY) === serialized) return
          localStorage.setItem(UI_STRINGS_LS_KEY, serialized)
          window.dispatchEvent(new Event(UI_STRINGS_EVENT))
        })
      } catch {
        // ignore — the next page load picks the setting up anyway
      }
    }
    try {
      chrome.storage.onChanged.addListener((changes, area) => {
        if (area === "local" && (changes["app-settings"] || changes.zhCore_ui || changes.zhCore_cn_ui))
          void syncUiStrings()
      })
    } catch {
      // chrome.storage unavailable
    }

    // Opt-in: only run when a Chinese UI language is selected AND the user has
    // turned on trade-site translation.
    const state = await getTradeTranslationState()
    if (!state.enabled) {
      // The site-interface table is ours alone (not a site cache key): always
      // remove it so the interface goes back to English immediately.
      try {
        localStorage.removeItem(UI_STRINGS_LS_KEY)
      } catch {
        // ignore storage errors
      }
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

    // Site interface strings (read by the MAIN-world zh-ui-strings script).
    const UI_STORE_KEY = cn ? "zhCore_cn_ui" : "zhCore_ui"

    let cache: Record<string, unknown> = {}

    const injectUi = () => {
      const ui = cache[UI_STORE_KEY]
      if (!ui || typeof ui !== "object") return
      try {
        // `lang` switches the site's own language manager (it reads <html lang>).
        const serialized = JSON.stringify({ lang: cn ? "zh-CN" : "zh-TW", strings: ui })
        if (localStorage.getItem(UI_STRINGS_LS_KEY) !== serialized) {
          localStorage.setItem(UI_STRINGS_LS_KEY, serialized)
          // The page may already be running with the previous language's table
          // (e.g. just switched 简→繁): tell the MAIN-world script to swap it.
          window.dispatchEvent(new Event(UI_STRINGS_EVENT))
        }
      } catch {
        // Storage full / blocked: the interface simply stays English.
      }
    }

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

    // Populate lscache-* from the background-fetched translated data. Since the
    // 2026 trade update, the site no longer reads these keys to render — the
    // MAIN-world API translator (zh-api-i18n) reads them and serves them for the
    // /api/trade/data/* requests instead — so no corrective reload is needed.
    try {
      chrome.storage.local.get([...Object.keys(STORE_TO_LS), UI_STORE_KEY], (data) => {
        cache = (data as Record<string, unknown>) || {}
        injectUi()
        inject()
        // Re-apply briefly: the API translator reads these lscache keys, and the
        // site may issue its data requests before this async read has landed.
        ;[0, 80, 200, 500, 1000].forEach((delay) => setTimeout(inject, delay))
      })
    } catch {
      // chrome.storage unavailable — nothing to inject.
    }
  }
})
