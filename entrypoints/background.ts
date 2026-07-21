import { registerBackgroundHandlers } from "~/lib/background"
import { buildAndStoreZhItemMap } from "~/lib/poe-zh-supplement/build-item-map"
import { refreshTradeData } from "~/lib/poe-zh-core/trade-data"

export default defineBackground({
  type: "module",
  main() {
    registerBackgroundHandlers()
    // Self-built translation core: fetch official TW stats/static/filters.
    refreshTradeData()
    // Item-name map (bases via official APIs; unique names from bundled dict).
    buildAndStoreZhItemMap()
    // On install/reload/update, force fresh fetches.
    chrome.runtime.onInstalled.addListener(() => {
      refreshTradeData(true)
      buildAndStoreZhItemMap(true)
    })
    // Manual "clear cache & reload" button asks the background to re-fetch the
    // latest translation data (e.g. right after a game patch) before the page
    // reloads and re-injects it.
    chrome.runtime.onMessage.addListener((request, _sender, sendResponse) => {
      if (
        request &&
        typeof request === "object" &&
        (request as { type?: string }).type === "zhCore:forceRebuild"
      ) {
        Promise.all([refreshTradeData(true), buildAndStoreZhItemMap(true)])
          .then(() => sendResponse({ ok: true }))
          .catch(() => sendResponse({ ok: false }))
        return true
      }
      return false
    })
  }
})
