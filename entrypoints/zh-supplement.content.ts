import { SUPPLEMENT_ZH_TW } from "~/lib/poe-zh-supplement/dict"
import { SUPPLEMENT_ZH_CN } from "~/lib/poe-zh-supplement/dict-cn"
import { UI_STRINGS } from "~/lib/poe-zh-core/ui-strings"
import { tradeHosts } from "~/lib/config/trade-hosts"
import { getTradeTranslationState } from "~/lib/services/trade-translation"
import { toSimplified } from "~/lib/poe-zh-cn/convert"

/**
 * Supplementary Traditional-Chinese pass.
 *
 * POE Trade zh does not translate every unique item name (its dictionaries are
 * incomplete, especially for names that only appear as filter dropdown options
 * such as the Ultimatum "Legacy Reward" list). This script runs a final DOM
 * pass and replaces any leftover English string that exactly matches an entry
 * in our supplement dictionary (sourced from poedb.tw).
 *
 * Matching is normalized (lowercase, punctuation/whitespace stripped) so it is
 * tolerant of apostrophes and spacing differences.
 */
export default defineContentScript({
  matches: tradeHosts,
  runAt: "document_idle",

  async main() {
    const state = await getTradeTranslationState()
    if (!state.enabled) return
    const cn = state.language === "zh-cn"
    const DICT = cn ? SUPPLEMENT_ZH_CN : SUPPLEMENT_ZH_TW
    const s = (value: string) => (cn ? toSimplified(value) : value)
    const ITEM_MAP_KEY = cn ? "zhSuppItemMapCn" : "zhSuppItemMap"
    const REVERSE_KEY = cn ? "zhCn_reverse" : "zhCore_reverse"

    const SKIP_TAGS = new Set([
      "SCRIPT",
      "STYLE",
      "INPUT",
      "TEXTAREA",
      "SELECT",
      "NOSCRIPT"
    ])

    const normalize = (value: string) =>
      value.toLowerCase().replace(/[^a-z0-9]/g, "")

    const hasChinese = (value: string) => /[一-鿿]/.test(value)

    // Runtime map built from the official pathofexile.tw item data (comprehensive).
    // Merged on top of the bundled poedb.tw starter dictionary.
    let dynamicMap: Record<string, string> = {}

    // Chinese -> English item names, so a Chinese query typed into a filter
    // dropdown (whose internal options are English) can be reverse-translated.
    let reverseMap: Record<string, string> = {}

    // Trade-filter UI strings (dropdown values, placeholders) to match the
    // official Traditional-Chinese trade site.
    const UI_PHRASES: Record<string, string> = {
      any: "任何",
      no: "否",
      yes: "是",
      anytime: "任何時間",
      buyoutorfixedprice: "直購價或定價",
      chaosorbequivalent: "與混沌石等值",
      exaltedorbequivalent: "與崇高石等值",
      enteraccountname: "輸入帳號名稱..."
    }
    // For Simplified, convert the bundled Traditional UI phrases on the fly.
    for (const k of Object.keys(UI_PHRASES)) UI_PHRASES[k] = s(UI_PHRASES[k])

    // Curated trade-site UI strings, keyed by the same normalized form.
    const UI_MAP: Record<string, string> = {}
    for (const [en, zh] of Object.entries(UI_STRINGS)) UI_MAP[normalize(en)] = s(zh)

    const lookup = (key: string) =>
      DICT[key] || dynamicMap[key] || UI_PHRASES[key] || UI_MAP[key]

    const translateTextNode = (node: Text) => {
      const raw = node.nodeValue
      if (!raw) return
      const trimmed = raw.trim()
      // Allow 2-char values like "No"; still skip empty/1-char and anything
      // that already contains Chinese.
      if (!trimmed || trimmed.length < 2 || hasChinese(trimmed)) return
      const zh = lookup(normalize(trimmed))
      if (!zh || zh === trimmed) return
      // Inside filter dropdown options, keep the English in parentheses so it
      // matches the "中文 (English)" style of the stat filters and stays legible.
      const inOption = node.parentElement?.closest(
        ".multiselect__option, .multiselect__single"
      )
      const replacement = inOption ? `${zh} (${trimmed})` : zh
      node.nodeValue = raw.replace(trimmed, replacement)
    }

    // Input placeholders (e.g. "Enter account name...", or the selected value of
    // a multiselect) can't be reached by the text-node walker, so translate them
    // separately. For an item name inside a multiselect, keep it bilingual
    // "中文 (English)" like the options; for plain UI strings, translate outright.
    const translateOnePlaceholder = (input: HTMLInputElement) => {
      const ph = input.placeholder?.trim()
      if (!ph || hasChinese(ph)) return
      const key = normalize(ph)
      const zh = lookup(key)
      if (!zh || zh === ph) return
      const isItemName =
        input.classList.contains("multiselect__input") &&
        (DICT[key] !== undefined || dynamicMap[key] !== undefined)
      input.placeholder = isItemName ? `${zh} (${ph})` : zh
    }

    const translatePlaceholders = (root: ParentNode) => {
      root
        .querySelectorAll<HTMLInputElement>(
          "input[placeholder], textarea[placeholder]"
        )
        .forEach(translateOnePlaceholder)
    }

    const walk = (root: Node) => {
      if (
        root.nodeType === Node.ELEMENT_NODE &&
        SKIP_TAGS.has((root as Element).tagName)
      ) {
        return
      }
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
        acceptNode(textNode) {
          const parent = textNode.parentElement
          if (!parent || SKIP_TAGS.has(parent.tagName)) {
            return NodeFilter.FILTER_REJECT
          }
          return NodeFilter.FILTER_ACCEPT
        }
      })
      const pending: Text[] = []
      let current = walker.nextNode()
      while (current) {
        pending.push(current as Text)
        current = walker.nextNode()
      }
      pending.forEach(translateTextNode)
    }

    const runFullPass = () => {
      if (document.body) {
        walk(document.body)
        translatePlaceholders(document.body)
      }
    }

    // Load the comprehensive runtime map (if the background has built it) and
    // re-scan when it becomes available or updates.
    try {
      chrome.storage?.local?.get(
        [ITEM_MAP_KEY, REVERSE_KEY],
        (result) => {
          const r = result as Record<string, unknown>
          const map = r?.[ITEM_MAP_KEY] as Record<string, string> | undefined
          if (map && typeof map === "object") {
            dynamicMap = map
            runFullPass()
          }
          const rev = r?.[REVERSE_KEY] as Record<string, string> | undefined
          if (rev && typeof rev === "object") reverseMap = rev
        }
      )
      chrome.storage?.onChanged?.addListener((changes, area) => {
        if (area === "local" && changes[ITEM_MAP_KEY]) {
          const next = changes[ITEM_MAP_KEY].newValue as
            | Record<string, string>
            | undefined
          if (next && typeof next === "object") {
            dynamicMap = next
            runFullPass()
          }
        }
      })
    } catch {
      // chrome.storage may be unavailable in some contexts; static dict still works.
    }

    runFullPass()

    let queued: Node[] = []
    let scheduled = false
    const flush = () => {
      scheduled = false
      const batch = queued
      queued = []
      for (const node of batch) {
        if (node.nodeType === Node.TEXT_NODE) {
          translateTextNode(node as Text)
        } else if (node.nodeType === Node.ELEMENT_NODE) {
          walk(node)
          translatePlaceholders(node as Element)
        }
      }
    }

    const observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        if (mutation.type === "characterData") {
          // Vue often inserts an empty node and fills its text afterwards, which
          // is a characterData change rather than an added node. Catch those.
          queued.push(mutation.target)
        } else if (mutation.type === "attributes") {
          // vue-multiselect resets the input placeholder (e.g. back to English)
          // on re-render; re-translate it whenever it changes.
          const target = mutation.target as HTMLElement
          if (target instanceof HTMLInputElement) translateOnePlaceholder(target)
        } else {
          mutation.addedNodes.forEach((node) => queued.push(node))
        }
      }
      if (!scheduled && queued.length > 0) {
        scheduled = true
        requestAnimationFrame(flush)
      }
    })

    observer.observe(document.body, {
      childList: true,
      subtree: true,
      characterData: true,
      attributes: true,
      attributeFilter: ["placeholder"]
    })

    // The trade filter panel is rendered asynchronously by the site's Vue app;
    // run a few delayed passes as insurance in case anything is missed.
    ;[400, 1200, 2500].forEach((delay) =>
      setTimeout(() => {
        runFullPass()
      }, delay)
    )

    // vue-multiselect re-derives the collapsed display value ("Any", "Buyout or
    // Fixed Price"...) from its own English data model on every re-render, so it
    // keeps overwriting our translation. A light periodic re-pass over just the
    // .multiselect widgets reliably keeps them translated without touching the
    // rest of the page.
    setInterval(() => {
      document.querySelectorAll<HTMLElement>(".multiselect").forEach((widget) => {
        walk(widget)
        translatePlaceholders(widget)
      })
    }, 800)

    // Some filter dropdowns (e.g. Ultimatum reward) populate their options from
    // English item data, so vue-multiselect searches English internally while we
    // only translate the visible text. When a Chinese item name is typed into
    // such a box, reverse-translate it to English so the search finds it.
    const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
      window.HTMLInputElement.prototype,
      "value"
    )?.set
    document.addEventListener(
      "input",
      (event) => {
        const target = event.target as HTMLElement
        if (
          !(target instanceof HTMLInputElement) ||
          !target.classList.contains("multiselect__input")
        ) {
          return
        }
        // Poe Zh Trade Tools Pro may auto-prepend a regex prefix (~) to search inputs, so
        // strip a leading ~/-/space before looking up the Chinese name, then put
        // that prefix back in front of the English so search still works.
        const raw = target.value
        const match = raw.match(/^([\s~+-]*)(.+)$/)
        if (!match) return
        const prefix = match[1]
        const body = match[2].trim()
        if (!hasChinese(body)) return
        const english = reverseMap[body]
        if (!english) return
        const next = prefix + english
        if (next === raw) return
        nativeInputValueSetter?.call(target, next)
        target.dispatchEvent(new Event("input", { bubbles: true }))
      },
      true
    )
  }
})
