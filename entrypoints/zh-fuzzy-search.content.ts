import { tradeHosts } from "~/lib/config/trade-hosts"

/**
 * "Fuzzy search by default (~)" — setting reader + prefixer.
 *
 * There are two prefixing paths and this one isolated-world script drives both,
 * so the toggle behaves the same on Chrome and Firefox:
 *
 *  1. It mirrors the per-version `autoFuzzySearch` setting onto
 *     `<html data-zh-auto-fuzzy="on|off">`. The MAIN-world `filter-panel` script
 *     (which can't read chrome.storage) checks that attribute before it prefixes.
 *     On Firefox filter-panel is the effective prefixer, so this gates it.
 *  2. It ALSO prefixes the search boxes itself, gated by the same setting. On
 *     Chrome the MAIN-world prefixer doesn't fire, so this is the effective path.
 *
 * Running both is safe: each checks `value.startsWith("~")`, so there's never a
 * double "~". Semantics: absent / never-toggled -> on (default); only an explicit
 * `false` disables. Re-reads on any storage change so the sidebar toggle takes
 * effect without a reload.
 */
export default defineContentScript({
  matches: tradeHosts,
  runAt: "document_start",

  main() {
    let enabled = true // default on until the setting is read

    const settingsKey = location.pathname.startsWith("/trade2")
      ? "app-settings-poe2"
      : "app-settings-poe1"

    const apply = () => {
      try {
        chrome.storage?.local?.get(settingsKey, (result: Record<string, unknown>) => {
          const payload = result?.[settingsKey] as
            | { value?: { autoFuzzySearch?: boolean } }
            | undefined
          const value = payload?.value?.autoFuzzySearch
          enabled = value !== false // absent -> on; only explicit false disables
          document.documentElement.setAttribute(
            "data-zh-auto-fuzzy",
            enabled ? "on" : "off"
          )
        })
      } catch {
        // storage unavailable — keep the default (on), attribute unset (== on).
      }
    }

    apply()
    try {
      chrome.storage?.onChanged?.addListener((changes, area) => {
        if (area === "local" && changes[settingsKey]) apply()
      })
    } catch {
      /* no-op */
    }

    // Placeholders of the boxes we auto-fuzzy: the stat-filter search
    // (數值過濾 / stat filter) and the main item search (Search Items / 搜尋道具).
    const SEARCH_PLACEHOLDER =
      /數值過濾|数值过滤|stat filter|search item|搜尋道具|搜索道具/i

    const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
      window.HTMLInputElement.prototype,
      "value"
    )?.set

    document.addEventListener(
      "input",
      (event) => {
        if (!enabled) return
        const target = event.target
        if (
          !(target instanceof HTMLInputElement) ||
          !target.classList.contains("multiselect__input")
        ) {
          return
        }
        if (!SEARCH_PLACEHOLDER.test(target.placeholder || "")) return

        const value = target.value
        if (!value || value.startsWith("~")) return

        nativeInputValueSetter?.call(target, `~${value}`)
        target.dispatchEvent(new Event("input", { bubbles: true }))
      },
      true
    )
  }
})
