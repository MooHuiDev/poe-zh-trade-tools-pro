import { NOTABLES_ZH_TW } from "~/lib/poe-zh-core/notables"
import { GEM_TAGS_TW, PROPERTY_STRINGS_TW } from "~/lib/poe-zh-core/property-strings"
import { GEM_TAGS_CN, PROPERTY_STRINGS_CN } from "~/lib/poe-zh-core/property-strings-cn"
import { toSimplified } from "~/lib/poe-zh-cn/convert"
import { translateLine } from "~/lib/poe-zh-core/stat-translate"
import { resolvePropertyText } from "~/lib/poe-zh-core/property-translate"
import { tradeHosts } from "~/lib/config/trade-hosts"
import { getTradeTranslationState } from "~/lib/services/trade-translation"

/**
 * Self-built translation core — results-page mod translation.
 *
 * Each mod line on the results list is `.item-mod[data-hash="<stat id>"]`, with
 * the mod text inside a `[data-field] > span`. We look the stat id up in the
 * Chinese template map (built by the background from official data) and
 * substitute the rendered numbers into the template. The roll-range span
 * ([15—25]) and the Add-to-Filters buttons are left untouched, and the mod's
 * colour is kept because we only change the text span's content.
 */
export default defineContentScript({
  matches: tradeHosts,
  runAt: "document_end",

  async main() {
    const state = await getTradeTranslationState()
    if (!state.enabled) return
    const modmapKey =
      state.language === "zh-cn" ? "zhCore_cn_modmap" : "zhCore_modmap"
    const statTplKey =
      state.language === "zh-cn" ? "zhStatTpl_cn" : "zhStatTpl_tw"
    // Other game texts (affix names, descriptions, names …). Simplified comes
    // from the 国服 client (cnText); empty until that data is available.
    const statTextKey = state.language === "zh-cn" ? "zhStatText_cn" : "zhStatText_tw"
    const statTplIdxKey =
      state.language === "zh-cn" ? "zhStatTplIdx_cn" : "zhStatTplIdx_tw"

    const hasChinese = (value: string) => /[一-鿿]/.test(value)
    // A signed number, used both to read rendered values and to fill templates.
    const NUM = /[+\-]?\d+(?:\.\d+)?/g
    // A template placeholder: optional sign + "#".
    const PLACEHOLDER = /[+\-]?#/g

    type ModInfo = { tw: string; us?: string; opt?: Record<string, string> }
    let modMap: Record<string, ModInfo> = {}

    // Complete mod-template dictionary keyed by normalized English. Lets us
    // translate ANY mod line (including non-filterable unique mods with no trade
    // stat id) by matching the rendered English and filling in the numbers.
    let statTpl: Record<string, string> = {}
    let statTplIdx: Record<string, string> = {}
    let statText: Record<string, string> = {}
    const translateByTemplate = (rendered: string): string | null =>
      translateLine(statTpl, statTplIdx, statText, rendered)
    // Resolve the game's "[English|中文]" inline keyword syntax that some trade
    // templates carry, so no raw brackets leak into the result.
    const resolveKw = (s: string) =>
      s
        .replace(/\[[^\]|]+\|([^\]]*)\]/g, "$1")
        .replace(/\[([^\]]*)\]/g, "$1")

    const translateMod = (el: HTMLElement) => {
      // Normal item mods render inside `[data-field]`; skill-gem quality/alt
      // stat lines instead render as `.lc > span` (no data-field / data-hash).
      // Fall back to `.lc` (or the element itself) so gem mods translate too.
      const field =
        el.querySelector<HTMLElement>("[data-field]") ||
        el.querySelector<HTMLElement>(".lc") ||
        el
      if (!field) return

      // Each mod line renders as its own <span> inside [data-field] (multi-line
      // mods have several). Translate each line-span independently.
      const spans = Array.from(
        field.querySelectorAll<HTMLElement>(":scope > span")
      )
      const lineSpans = spans.length ? spans : [field]

      // Pass 0: multi-line templates FIRST. A single stat can render across
      // several line-spans but is stored as ONE combined template (its key keeps
      // the line break: the source "\n" normalizes to an "n" between halves; the
      // value keeps a "\n"/"\" separator). This must run BEFORE the per-line pass,
      // otherwise a half whose text also has a standalone entry gets translated on
      // its own and the pair can no longer be reconstructed. We join consecutive
      // still-English spans, match the combined template (longest window first so
      // a 3-line stat isn't half-matched), fill the numbers across the whole
      // thing, then split the translation back onto each span.
      const doneSpans = new Set<HTMLElement>()
      {
        let i = 0
        while (i < lineSpans.length) {
          const first = lineSpans[i].textContent?.trim()
          if (!first || hasChinese(first)) {
            i++
            continue
          }
          let j = i
          while (j < lineSpans.length) {
            const t = lineSpans[j].textContent?.trim()
            if (!t || hasChinese(t)) break
            j++
          }
          const run = lineSpans.slice(i, j)
          if (run.length >= 2) {
            matchRun: for (let len = run.length; len >= 2; len--) {
              for (let start = 0; start + len <= run.length; start++) {
                const window = run.slice(start, start + len)
                if (window.some((s) => doneSpans.has(s))) continue
                const joined = window
                  .map((s) => (s.textContent || "").trim())
                  .join("\\n")
                const t = translateByTemplate(joined)
                if (!t || t === joined) continue
                const parts = t.split(/\\n?/)
                // Chinese sometimes says in ONE line what English needs two for
                // (Phantasm support): first span gets it all, the rest go empty.
                if (parts.length !== window.length && parts.length !== 1) continue
                window.forEach((s, k) => {
                  s.textContent = parts.length === 1 ? (k === 0 ? resolveKw(parts[0]) : "") : resolveKw(parts[k])
                  doneSpans.add(s)
                })
                break matchRun
              }
            }
          }
          i = j
        }
      }

      // Pass 1: per-line template dictionary for spans not handled above.
      const remaining: HTMLElement[] = []
      for (const span of lineSpans) {
        if (doneSpans.has(span)) continue
        const rendered = span.textContent?.trim()
        if (!rendered || hasChinese(rendered)) continue
        const t = translateByTemplate(rendered)
        if (t && t !== rendered) span.textContent = t
        else remaining.push(span)
      }
      if (!remaining.length) return

      // Pass 2: trade-stat fallback (from pathofexile.tw) for lines the
      // dictionary missed. Resolve any "[English|中文]" syntax it carries.
      // Option stats carry the chosen option in the hash ("enchant.stat_…|23",
      // cluster jewel enchants) — look the base stat id up then.
      const id = el.getAttribute("data-hash")
      const info = id ? (modMap[id] ?? modMap[id.split("|")[0]]) : undefined
      if (!info || !info.tw) return

      // Option-based mods (cluster jewel "grants: <sub-stat>"): only when nothing
      // was translated yet, so we don't mix into a partially-translated line.
      if (
        info.opt &&
        info.us &&
        info.us.includes("#") &&
        remaining.length === lineSpans.length
      ) {
        // Each line on its own: a cluster jewel can list SEVERAL options in one
        // enchant ("…grant: 12% increased Damage with Bows" + "…with Bow Skills").
        const hashPos = info.us.indexOf("#")
        const prefix = info.us.slice(0, hashPos)
        const suffix = info.us.slice(hashPos + 1)
        for (const span of remaining) {
          const rendered = span.textContent?.trim()
          if (!rendered || hasChinese(rendered)) continue
          if (
            !rendered.startsWith(prefix) ||
            !rendered.endsWith(suffix) ||
            rendered.length < prefix.length + suffix.length
          )
            continue
          const fill = rendered.slice(prefix.length, rendered.length - suffix.length).trim()
          // Option text as listed by the API, else translate the rendered option
          // like any mod line (cluster jewel enchants carry real numbers).
          const twFill = info.opt[fill] ?? translateByTemplate(fill) ?? undefined
          if (twFill) span.textContent = resolveKw(info.tw.replace("#", twFill))
        }
        return
      }

      // Multi-line fallback: the Taiwan text has one line per untranslated
      // line (e.g. a cluster jewel enchant whose option grants two stats —
      // Taiwan lists it as its own "…|38" stat). Fill each line's numbers.
      const twLines = info.tw.split("\n")
      if (twLines.length > 1 && twLines.length === remaining.length && remaining.length === lineSpans.length) {
        remaining.forEach((span, k) => {
          const values = (span.textContent || "").match(NUM) || []
          let i = 0
          span.textContent = resolveKw(
            twLines[k].replace(PLACEHOLDER, () => (i < values.length ? values[i++] : "#"))
          )
        })
        return
      }

      // Single-line numeric fallback.
      if (remaining.length === 1 && !info.tw.includes("\n")) {
        const span = remaining[0]
        const rendered = span.textContent?.trim()
        if (!rendered || hasChinese(rendered)) return
        const values = rendered.match(NUM) || []
        let i = 0
        const translated = resolveKw(
          info.tw.replace(PLACEHOLDER, () =>
            i < values.length ? values[i++] : "#"
          )
        )
        if (translated && translated !== rendered) span.textContent = translated
      }
    }

    // Cluster-jewel / anointed notable blocks render as:
    //   <div><span style="color: var(--colour-augmented)">Sadist</span>
    //        <br>granted stat 1<br>granted stat 2 ...</div>
    // The notable name is an augmented-coloured span; the granted stats are the
    // <br>-separated text nodes that follow it. These are passive-tree
    // descriptions (not in the trade stats API), so use the bundled dictionary.
    const NOTABLE_SPAN = 'span[style*="colour-augmented"]'
    const translateNotable = (span: HTMLElement) => {
      if (span.dataset.zhDone === "1") return
      const name = span.textContent?.trim()
      if (!name) return
      const data = NOTABLES_ZH_TW[name]
      if (!data) return

      span.textContent = data.name
      span.dataset.zhDone = "1"

      // Replace the following text-node siblings (granted stats) in order.
      let node: ChildNode | null = span.nextSibling
      let i = 0
      while (node && i < data.desc.length) {
        if (node.nodeType === Node.TEXT_NODE) {
          const trimmed = node.nodeValue?.trim()
          if (trimmed) {
            node.nodeValue = data.desc[i]
            i++
          }
        }
        node = node.nextSibling
      }
    }

    // Item property / requirement lines ("Lasts 8 Seconds", "Physical Damage:
    // 10-20", "Requires Level 12, 50 Str"). Each label span holds text nodes with
    // the values as child spans, e.g. `Recovers <span>120</span> Mana over
    // <span>4</span> Seconds`. Build the English key with the values as "{}",
    // look up the official ClientStrings text and rebuild the span in Chinese
    // order, moving the original value spans so their colours are kept.
    const PROPS: Record<string, string> = {}
    const TAGS: Record<string, string> = {}
    const toLang = (zh: string) => (state.language === "zh-cn" ? toSimplified(zh) : zh)
    for (const [en, zh] of Object.entries(PROPERTY_STRINGS_TW)) PROPS[en] = toLang(zh)
    for (const [en, zh] of Object.entries(GEM_TAGS_TW)) TAGS[en] = toLang(zh)
    // 简中: the 国服 client's own wording wins; 繁->简 above only fills gaps.
    if (state.language === "zh-cn") {
      Object.assign(PROPS, PROPERTY_STRINGS_CN)
      Object.assign(TAGS, GEM_TAGS_CN)
    }
    const translatePropertySpan = (span: HTMLElement) => {
      const nodes = Array.from(span.childNodes)
      let key = ""
      let hasLetters = false
      const values: ChildNode[] = []
      for (const n of nodes) {
        if (n.nodeType === Node.TEXT_NODE) {
          const t = n.nodeValue || ""
          if (/[A-Za-z]/.test(t)) hasLetters = true
          key += t
        } else if (n.nodeType === Node.ELEMENT_NODE) {
          key += "{}"
          values.push(n)
        }
      }
      if (!hasLetters) return
      const res = resolvePropertyText(key, values.length, PROPS, TAGS)
      if (!res) return
      if (res.kind === "text") {
        span.textContent = res.text
        return
      }
      const zh = res.zh
      const lead = /^\s/.test(key) ? " " : ""
      const trail = /\s$/.test(key) ? " " : ""
      const frag = document.createDocumentFragment()
      if (lead) frag.appendChild(document.createTextNode(lead))
      for (const part of zh.split(/(\{\d+\})/)) {
        const m = part.match(/^\{(\d+)\}$/)
        if (m) {
          const v = values[+m[1]]
          if (v) frag.appendChild(v)
        } else if (part) frag.appendChild(document.createTextNode(part))
      }
      if (trail) frag.appendChild(document.createTextNode(trail))
      span.replaceChildren(frag)
    }
    const translateProperty = (el: HTMLElement) => {
      el.querySelectorAll<HTMLElement>("span").forEach(translatePropertySpan)
    }

    // Affix names the site shows next to each mod ("Heavy (≥11)",
    // "Serrated + Journeyman's (≥11)", "of Renown") — span.d in .item-mod.
    const translateAffixNames = (mod: HTMLElement) => {
      mod.querySelectorAll<HTMLElement>("span.d").forEach((d) => {
        const w = document.createTreeWalker(d, NodeFilter.SHOW_TEXT)
        let n: Node | null
        while ((n = w.nextNode())) {
          const raw = n.nodeValue || ""
          const t = raw.trim()
          if (!/[A-Za-z]{2}/.test(t) || hasChinese(t)) continue
          const m = t.match(/^(.*?)(\s*\(≥\d+\))?$/)
          if (!m) continue
          const parts = m[1].split(" + ")
          const zh = parts.map((p) => statText[p.toLowerCase().replace(/[^a-z#]/g, "")])
          if (zh.every(Boolean) && hasChinese(zh.join(""))) n.nodeValue = raw.replace(t, zh.join(" + ") + (m[2] || ""))
        }
      })
    }

    // Leftover English inside a result card outside the mod lines: gem
    // descriptions, currency descriptions, corpse implicits, logbook areas /
    // factions, heist / mercenary names, card flavour, odd labels
    // ("Unidentified", "Atlas Drops" …). Whole-text matches only.
    const LEFTOVER_SKIP =
      ".item-mod, .item-popup__header-line, .profile-link, .character-name, button, script, style, [class^='bt-'], [class*=' bt-']"
    const LEFTOVER_BOX = ".item-popup__content, [class*='divination-card']"
    const translateLeftovers = (box: HTMLElement) => {
      const w = document.createTreeWalker(box, NodeFilter.SHOW_TEXT)
      const todo: Text[] = []
      let n: Node | null
      while ((n = w.nextNode())) {
        const t = (n.nodeValue || "").trim()
        if (!/[A-Za-z]{2}/.test(t) || hasChinese(t) || t.startsWith("~")) continue
        // Only look at ancestors INSIDE the card: <body> itself carries our
        // "bt-…" classes, which would otherwise make every node look skipped.
        const skip = (n.parentElement as HTMLElement | null)?.closest(LEFTOVER_SKIP)
        if (skip && box.contains(skip)) continue
        todo.push(n as Text)
      }
      for (const node of todo) {
        const raw = node.nodeValue || ""
        const t = raw.trim()
        let zh = PROPS[t] ?? translateByTemplate(t)
        // Multi-line text in one node (card flavour text): line by line.
        if (!zh && /\n/.test(t)) {
          const lines = t.split(/\r?\n/).map((l) => {
            const x = l.trim()
            return x ? (PROPS[x] ?? translateByTemplate(x)) : ""
          })
          if (lines.every((l) => l !== null)) zh = lines.join("\n")
        }
        // A Chinese label may carry a colon the English doesn't ("Build" ->
        // "流派：") — the site prints its own ": " after it.
        if (zh && !/[:：]\s*$/.test(t)) zh = zh.replace(/\s*[:：]\s*$/, "")
        // Only write real Chinese: a result that is still English would be
        // picked up again by the observer and could loop forever
        // ("Meh" -> "\"Meh\"" -> "\"\"Meh\"\"" …).
        if (zh && zh !== t && hasChinese(zh)) node.nodeValue = raw.replace(t, resolveKw(zh))
      }
    }

    const translateWithin = (root: ParentNode) => {
      root.querySelectorAll<HTMLElement>(".item-property").forEach(translateProperty)
      root.querySelectorAll<HTMLElement>(".item-mod").forEach(translateMod)
      root.querySelectorAll<HTMLElement>(".item-mod").forEach(translateAffixNames)
      root.querySelectorAll<HTMLElement>(LEFTOVER_BOX).forEach(translateLeftovers)
      root.querySelectorAll<HTMLElement>(NOTABLE_SPAN).forEach(translateNotable)
    }

    const runFullPass = () => {
      if (document.body) translateWithin(document.body)
    }

    const applyMap = (map: unknown) => {
      if (map && typeof map === "object") {
        modMap = map as Record<string, ModInfo>
        runFullPass()
      }
    }

    const applyStatText = (v: unknown) => {
      if (v && typeof v === "object") {
        statText = v as Record<string, string>
        runFullPass()
      }
    }
    const applyStatTplIdx = (v: unknown) => {
      if (v && typeof v === "object") statTplIdx = v as Record<string, string>
    }
    const applyStatTpl = (v: unknown) => {
      if (v && typeof v === "object") {
        statTpl = v as Record<string, string>
        runFullPass()
      }
    }

    try {
      chrome.storage.local.get([modmapKey, statTplKey, statTplIdxKey, ...(statTextKey ? [statTextKey] : [])], (data) => {
        const d = data as Record<string, unknown>
        applyStatTplIdx(d?.[statTplIdxKey])
        if (statTextKey) applyStatText(d?.[statTextKey])
        applyStatTpl(d?.[statTplKey])
        applyMap(d?.[modmapKey])
      })
      chrome.storage.onChanged?.addListener((changes, area) => {
        if (area !== "local") return
        if (changes[statTplIdxKey]) applyStatTplIdx(changes[statTplIdxKey].newValue)
        if (statTextKey && changes[statTextKey]) applyStatText(changes[statTextKey].newValue)
        if (changes[statTplKey]) applyStatTpl(changes[statTplKey].newValue)
        if (changes[modmapKey]) applyMap(changes[modmapKey].newValue)
      })
    } catch {
      // chrome.storage unavailable — nothing to translate.
    }

    runFullPass()

    let queued: HTMLElement[] = []
    let scheduled = false
    const flush = () => {
      scheduled = false
      const batch = queued
      queued = []
      for (const node of batch) {
        if (node.matches?.(".item-mod")) translateMod(node)
        if (node.matches?.(".item-property")) translateProperty(node)
        if (node.matches?.(NOTABLE_SPAN)) translateNotable(node)
        translateWithin(node)
        // The site often fills a card in pieces (text / spans added into an
        // existing popup), so also re-check the card the node belongs to.
        const mod = node.closest?.(".item-mod") as HTMLElement | null
        if (mod) translateAffixNames(mod)
        const box = node.closest?.(LEFTOVER_BOX) as HTMLElement | null
        if (box) translateLeftovers(box)
      }
      // Everything recorded during this flush is our own writing (the site's
      // changes were already delivered before the frame). Drop it so a
      // translation can never feed itself back in a loop.
      observer.takeRecords()
    }

    const observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        // Vue reuses result rows and rewrites their text in place (a
        // characterData change, no new nodes) — re-check those too.
        if (mutation.type === "characterData") {
          const p = mutation.target.parentElement
          if (p && !hasChinese(mutation.target.nodeValue || "")) queued.push(p)
          continue
        }
        mutation.addedNodes.forEach((node) => {
          if (node.nodeType === Node.ELEMENT_NODE) queued.push(node as HTMLElement)
          else if (node.nodeType === Node.TEXT_NODE && node.parentElement) queued.push(node.parentElement)
        })
      }
      if (!scheduled && queued.length > 0) {
        scheduled = true
        requestAnimationFrame(flush)
      }
    })

    if (document.body) {
      observer.observe(document.body, { childList: true, subtree: true, characterData: true })
    }

    ;[400, 1200, 2500].forEach((delay) => setTimeout(runFullPass, delay))
  }
})
