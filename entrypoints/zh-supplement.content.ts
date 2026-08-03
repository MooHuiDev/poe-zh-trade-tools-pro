import { SUPPLEMENT_ZH_TW } from "~/lib/poe-zh-supplement/dict"
import { SUPPLEMENT_ZH_CN } from "~/lib/poe-zh-supplement/dict-cn"
import {
  MERCENARY_SKILL_NAMES,
  MERCENARY_SUPPORT_TW
} from "~/lib/poe-zh-supplement/mercenary-names"
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
    const MODMAP_KEY = cn ? "zhCore_cn_modmap" : "zhCore_modmap"

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

    // Mercenary Warrant skill block (`.item-mod--mercenary`): each skill lists its
    // granted supports as bare "<Support> (Tier N)" spans, e.g. "Faster Casting"
    // + "Tier 2", with a "Greater " prefix for the stronger tier. These short
    // labels are the support-gem names minus "Support", so they don't hit the
    // item map directly. Resolve order: curated table -> item map (skills) ->
    // "<name> Support" in the item map with the 輔助 suffix stripped.
    const MERC_MAP: Record<string, string> = {}
    for (const [en, zh] of Object.entries(MERCENARY_SUPPORT_TW)) {
      MERC_MAP[normalize(en)] = s(zh)
    }
    // Authoritative mercenary SKILL names (poedb /Mercenaries), per language.
    // Mercenary skills use their own names, distinct from the regular gem names
    // and differing per language (Wrath: 繁 暴怒 / 简 雷霆), so this must win over
    // the gem/item map. Keys are already normalized English.
    const MERC_SKILL: Record<string, string> = {}
    for (const [k, v] of Object.entries(MERCENARY_SKILL_NAMES)) {
      MERC_SKILL[k] = cn ? v.cn : v.tw
    }
    // Complete, OFFICIAL Mercenary Warrant support/skill names, derived at runtime
    // from the background-built stat modmap (`zhCore_modmap` / cn variant). That
    // map pairs the pathofexile.tw "傭兵" stat group (534 entries) with the English
    // one by id, so every "<name> (Tier N)" carries both languages. We strip the
    // "(Tier N)" / "（階級 N）" suffix and key by normalized English base name; the
    // "Greater/Lesser/Gilded" qualifier stays part of the name (as the game does).
    let mercNameMap: Record<string, string> = {}
    const TIER_EN = /\s*\(Tier \d+\)\s*$/i
    const TIER_ZH = /\s*[（(]\s*(?:階級|阶级|Tier)\s*\d+\s*[)）]\s*$/i
    const buildMercNameMap = (
      modmap: Record<string, { us?: string; tw?: string }> | undefined
    ) => {
      const next: Record<string, string> = {}
      for (const [id, info] of Object.entries(modmap || {})) {
        if (!id.startsWith("mercenary.") || !info?.us || !info?.tw) continue
        const key = normalize(info.us.replace(TIER_EN, "").trim())
        const zh = info.tw.replace(TIER_ZH, "").trim()
        if (key && zh && !(key in next)) next[key] = zh
      }
      mercNameMap = next
    }
    const stripSupportSuffix = (zh: string | undefined) =>
      zh ? zh.replace(/(輔助|支援|辅助)$/, "").trim() : undefined
    const resolveMercName = (name: string): string | undefined => {
      const key = normalize(name)
      // Priority:
      // 1. MERC_SKILL — authoritative mercenary skill names (poedb /Mercenaries),
      //    correct per language and distinct from gem names (Wrath 繁 暴怒 / 简 雷霆).
      // 2. dynamicMap / DICT — the item & skill-gem name maps (国服 authentic etc.)
      //    for anything not in the mercenary skill list.
      // 3. mercNameMap / MERC_MAP — the tiered support labels from the 傭兵 stat
      //    group (and the small curated fallback).
      // 4. derive a support name from "<name> Support" in the item map.
      return (
        MERC_SKILL[key] ||
        dynamicMap[key] ||
        DICT[key] ||
        mercNameMap[key] ||
        MERC_MAP[key] ||
        stripSupportSuffix(dynamicMap[key + "support"])
      )
    }
    // Translate a single mercenary-skill span's text, or return undefined to keep
    // it in English (progressive coverage — unknown labels are left untouched).
    const translateMercSpan = (text: string): string | undefined => {
      const tier = text.match(/^Tier (\d+)$/)
      if (tier) return s(`階級 ${tier[1]}`)
      // The official map holds whole names ("Greater X", "Lesser X", "Gilded X").
      const direct = resolveMercName(text)
      if (direct) return direct
      // Fallback only when the official map hasn't loaded yet: peel a qualifier.
      const g = text.match(/^Greater (.+)$/)
      if (g) {
        const zh = resolveMercName(g[1])
        if (zh) return `${s("高階")}${zh}`
      }
      const l = text.match(/^Lesser (.+)$/)
      if (l) {
        const zh = resolveMercName(l[1])
        if (zh) return `${s("次級")}${zh}`
      }
      return undefined
    }

    const translateTextNode = (node: Text) => {
      const raw = node.nodeValue
      if (!raw) return
      const trimmed = raw.trim()
      // Allow 2-char values like "No"; still skip empty/1-char and anything
      // that already contains Chinese.
      if (!trimmed || trimmed.length < 2 || hasChinese(trimmed)) return
      // Mercenary Warrant skill spans get their own resolver (Tier / Greater /
      // support-name derivation). Handled here and returned so the generic
      // item-name lookup below doesn't mangle these compact labels.
      if (node.parentElement?.closest?.(".item-mod--mercenary")) {
        const mercZh = translateMercSpan(trimmed)
        if (mercZh && mercZh !== trimmed) node.nodeValue = raw.replace(trimmed, mercZh)
        return
      }
      const zh = lookup(normalize(trimmed))
      if (!zh || zh === trimmed) return
      // Inside filter dropdown options, keep the English in parentheses so it
      // matches the "中文 (English)" style of the stat filters and stays legible.
      const inOption = node.parentElement?.closest(
        ".multiselect__option, .multiselect__single"
      )
      // If the option is ALREADY bilingual (our injected item text contains
      // Chinese), vue-multiselect can split it into several fragments for search
      // highlighting; translating each English fragment on its own garbles the
      // text (e.g. "Vaal Lightning Strike (Lightning Strike of Arcing)" turning
      // into repeated, nested pieces). Skip when the whole option already has
      // Chinese — it is translated and just visually split.
      if (inOption && hasChinese(inOption.textContent || "")) return
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
        [ITEM_MAP_KEY, REVERSE_KEY, MODMAP_KEY],
        (result) => {
          const r = result as Record<string, unknown>
          const map = r?.[ITEM_MAP_KEY] as Record<string, string> | undefined
          const modmap = r?.[MODMAP_KEY] as
            | Record<string, { us?: string; tw?: string }>
            | undefined
          if (modmap && typeof modmap === "object") buildMercNameMap(modmap)
          if (map && typeof map === "object") {
            dynamicMap = map
            runFullPass()
          } else if (modmap && typeof modmap === "object") {
            runFullPass()
          }
          const rev = r?.[REVERSE_KEY] as Record<string, string> | undefined
          if (rev && typeof rev === "object") reverseMap = rev
        }
      )
      chrome.storage?.onChanged?.addListener((changes, area) => {
        if (area !== "local") return
        if (changes[MODMAP_KEY]) {
          const next = changes[MODMAP_KEY].newValue as
            | Record<string, { us?: string; tw?: string }>
            | undefined
          if (next && typeof next === "object") {
            buildMercNameMap(next)
            runFullPass()
          }
        }
        if (changes[ITEM_MAP_KEY]) {
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
        // The main item-search box already has bilingual "中文 (English)" options,
        // so typing Chinese matches directly — no reverse-translation needed. Only
        // the pure-English filter dropdowns need reverse. Detected by the
        // "Search Items"/"搜尋"/"搜索"/"物品" placeholder.
        const ph = (target.placeholder || "").toLowerCase()
        if (/search|搜尋|搜索|物品|道具/.test(ph)) return
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
        const widget = target.closest(".multiselect")
        // DEFER the decision: let vue-multiselect finish filtering its options for
        // what was typed, THEN decide. Our dropdowns are bilingual "中文 (English)",
        // so typing Chinese normally matches directly — in that case do NOTHING
        // (converting to English here is what made the box "force-switch" to
        // English, e.g. 雷霆 -> WRATH). Only when the Chinese matches NO option (a
        // pure-English option list, e.g. some reward dropdowns) do we reverse-
        // translate so the search can find it.
        window.setTimeout(() => {
          if (target.value !== raw) return // user kept typing; this run is stale
          const opts = widget?.querySelectorAll(".multiselect__option")
          const matched =
            !!opts &&
            Array.from(opts).some((o) => (o.textContent || "").includes(body))
          if (matched) return
          const next = prefix + english
          if (next === target.value) return
          nativeInputValueSetter?.call(target, next)
          target.dispatchEvent(new Event("input", { bubbles: true }))
        }, 60)
      },
      true
    )
  }
})
