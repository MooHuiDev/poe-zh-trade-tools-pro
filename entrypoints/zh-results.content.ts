import { NOTABLES_ZH_TW } from "~/lib/poe-zh-core/notables"
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

    const hasChinese = (value: string) => /[一-鿿]/.test(value)
    // A signed number, used both to read rendered values and to fill templates.
    const NUM = /[+\-]?\d+(?:\.\d+)?/g
    // A template placeholder: optional sign + "#".
    const PLACEHOLDER = /[+\-]?#/g

    type ModInfo = { tw: string; us?: string; opt?: Record<string, string> }
    let modMap: Record<string, ModInfo> = {}

    const translateMod = (el: HTMLElement) => {
      const id = el.getAttribute("data-hash")
      if (!id) return
      const info = modMap[id]
      if (!info || !info.tw) return

      const field = el.querySelector<HTMLElement>("[data-field]")
      if (!field) return
      const rendered = field.textContent?.trim()
      if (!rendered || hasChinese(rendered)) return

      let translated = ""

      if (info.opt && info.us && info.us.includes("#")) {
        // Option-based mod (e.g. "Added Small Passive Skills grant: <sub-stat>").
        // Isolate the sub-stat that fills # and translate it via the option table.
        const hashPos = info.us.indexOf("#")
        const prefix = info.us.slice(0, hashPos)
        const suffix = info.us.slice(hashPos + 1)
        if (
          rendered.startsWith(prefix) &&
          rendered.endsWith(suffix) &&
          rendered.length >= prefix.length + suffix.length
        ) {
          const fill = rendered
            .slice(prefix.length, rendered.length - suffix.length)
            .trim()
          const twFill = info.opt[fill]
          if (twFill) translated = info.tw.replace("#", twFill)
        }
        // If we couldn't resolve the option, leave it English rather than
        // wrongly stuffing a number into the placeholder.
        if (!translated) return
      } else {
        const values = rendered.match(NUM) || []
        let i = 0
        translated = info.tw.replace(PLACEHOLDER, () =>
          i < values.length ? values[i++] : "#"
        )
      }

      if (!translated || translated === rendered) return
      const textSpan = field.querySelector<HTMLElement>("span") || field
      textSpan.textContent = translated
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

    const translateWithin = (root: ParentNode) => {
      root.querySelectorAll<HTMLElement>(".item-mod[data-hash]").forEach(translateMod)
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

    try {
      chrome.storage.local.get([modmapKey], (data) =>
        applyMap((data as Record<string, unknown>)?.[modmapKey])
      )
      chrome.storage.onChanged?.addListener((changes, area) => {
        if (area === "local" && changes[modmapKey]) {
          applyMap(changes[modmapKey].newValue)
        }
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
        if (node.matches?.(".item-mod[data-hash]")) translateMod(node)
        if (node.matches?.(NOTABLE_SPAN)) translateNotable(node)
        translateWithin(node)
      }
    }

    const observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        mutation.addedNodes.forEach((node) => {
          if (node.nodeType === Node.ELEMENT_NODE) queued.push(node as HTMLElement)
        })
      }
      if (!scheduled && queued.length > 0) {
        scheduled = true
        requestAnimationFrame(flush)
      }
    })

    if (document.body) {
      observer.observe(document.body, { childList: true, subtree: true })
    }

    ;[400, 1200, 2500].forEach((delay) => setTimeout(runFullPass, delay))
  }
})
