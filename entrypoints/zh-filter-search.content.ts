import { tradeHosts } from "~/lib/config/trade-hosts"

/**
 * Fuzzy Chinese search for English-only filter dropdowns.
 *
 * Some trade filter dropdowns — "完成地圖獎勵" (map completion reward), the Maven
 * "傳奇獎勵" (unique reward), the Ultimatum legacy reward list, … — build their
 * vue-multiselect option list from the item data's ENGLISH `name` field, so each
 * option is { id, text } with BOTH set to the English name. vue-multiselect
 * searches its options by the `text` label, so typing a Chinese fragment finds
 * nothing ("No elements found") — unlike the main item search, whose options
 * already carry bilingual "中文 (English)" text and so filter fine on Chinese.
 *
 * This MAIN-world pass rewrites each such option's `text` to bilingual
 * "中文 (English)" (leaving `id` — the value sent to the trade API — untouched),
 * so the native substring search matches Chinese, exactly like the item search.
 * (The previous reverse-map handler in zh-supplement only mapped a *complete*
 * Chinese name back to English; a partial fragment like "魔" had no equivalent,
 * which is why fuzzy search failed.)
 *
 * The Chinese names are derived from the already-injected bilingual
 * lscache-tradeitems, so this self-gates: when the site data isn't translated
 * (native pathofexile.tw, POE2, or translation disabled) there are no Chinese
 * names to apply and every option is left untouched.
 *
 * Must run in the MAIN world because it reads the page's own vue-multiselect
 * component instances (el.__vue__) to mutate the reactive option objects.
 */
export default defineContentScript({
  matches: tradeHosts,
  world: "MAIN",
  runAt: "document_idle",

  main() {
    const norm = (s: string) =>
      String(s).toLowerCase().replace(/[^a-z0-9]/g, "")
    const hasZh = (s: string) => /[一-鿿]/.test(s)

    // Normalized English item name -> Chinese name (unique name only, base type
    // stripped) built from the injected bilingual item data.
    let nameZh: Record<string, string> = {}

    // The localized "Any" string ("任何"). These English-item dropdowns keep the
    // no-selection option as { id: null, text: "Any" }, so the collapsed value
    // renders as an untranslated "ANY" while every other dropdown shows "任何".
    // We copy the string from any sibling dropdown that already has a localized
    // null-id option, so it stays correct for both Traditional and Simplified.
    let localizedAny = ""

    const findLocalizedAny = () => {
      if (localizedAny) return
      for (const el of document.querySelectorAll<HTMLElement>(".multiselect")) {
        const v = (el as unknown as { __vue__?: { options?: unknown[] } }).__vue__
        if (!v || !Array.isArray(v.options)) continue
        for (const raw of v.options) {
          const o = raw as { id?: string | null; text?: string }
          if (o && typeof o === "object" && (o.id == null || o.id === "") && o.text && hasZh(o.text)) {
            localizedAny = o.text
            return
          }
        }
      }
    }

    const buildNameMap = () => {
      let ti: unknown
      try {
        ti = JSON.parse(localStorage.getItem("lscache-tradeitems") || "[]")
      } catch {
        return
      }
      if (!Array.isArray(ti)) return

      const baseZh: Record<string, string> = {}
      const next: Record<string, string> = {}

      // Pass 1 — base-type Chinese, taken from non-unique entries whose text is
      // "中文 (English)" (e.g. "羊角法杖 (Goat's Horn)").
      for (const cat of ti) {
        for (const e of (cat as { entries?: unknown[] })?.entries || []) {
          const it = e as {
            flags?: { unique?: boolean }
            type?: string
            text?: string
            name?: string
          }
          if (!it?.flags?.unique && it?.type && it?.text) {
            const m = String(it.text).match(/^(.+?)\s*\((.+)\)\s*$/)
            if (m && hasZh(m[1])) baseZh[it.type] = m[1].trim()
          }
        }
      }

      // Pass 2 — unique names. The unique's text is
      // "中文名 中文base (EnglishName EnglishBase)"; strip the trailing Chinese
      // base type so the option shows just "艾貝拉斯之角 (Abberath's Horn)".
      for (const cat of ti) {
        for (const e of (cat as { entries?: unknown[] })?.entries || []) {
          const it = e as {
            flags?: { unique?: boolean }
            type?: string
            text?: string
            name?: string
          }
          if (it?.flags?.unique && it?.name && it?.text) {
            const zhPortion = String(it.text).split(" (")[0]
            const zhBase = it.type ? baseZh[it.type] : undefined
            let zhName = zhPortion
            if (zhBase && zhPortion.endsWith(zhBase)) {
              zhName = zhPortion
                .slice(0, zhPortion.length - zhBase.length)
                .trim()
            }
            if (hasZh(zhName)) next[norm(it.name)] = zhName
          }
        }
      }

      if (Object.keys(next).length) nameZh = next
    }

    // Unify a no-selection "Any" option/value with the localized "任何" the rest
    // of the UI uses. Returns true if it changed the object.
    const fixAny = (o: unknown): boolean => {
      const opt = o as { id?: string | null; text?: string }
      if (
        opt &&
        typeof opt === "object" &&
        (opt.id == null || opt.id === "") &&
        opt.text === "Any" &&
        localizedAny
      ) {
        opt.text = localizedAny
        return true
      }
      return false
    }

    const patch = () => {
      if (!Object.keys(nameZh).length) return
      const widgets = document.querySelectorAll<HTMLElement>(".multiselect")
      for (const el of widgets) {
        const v = (el as unknown as {
          __vue__?: {
            options?: unknown[]
            internalValue?: unknown
            value?: unknown
            $forceUpdate?: () => void
          }
        }).__vue__
        if (!v || !Array.isArray(v.options)) continue
        let changed = false
        for (const raw of v.options) {
          const o = raw as { id?: string | null; text?: string }
          if (!o || typeof o !== "object" || !o.text) continue
          // No-selection option in the list.
          if (fixAny(o)) {
            changed = true
            continue
          }
          // English-item option ({ id, text } both the English name): make the
          // text bilingual so the native substring search matches Chinese.
          if (o.id && o.id === o.text && !hasZh(o.text)) {
            const zh = nameZh[norm(o.id)]
            if (zh) {
              o.text = `${zh} (${o.id})`
              changed = true
            }
          }
        }
        // The collapsed value is rendered from the SELECTED object, which is a
        // separate object from options[0]; fix it too so the widget shows "任何"
        // instead of an untranslated "Any".
        for (const sel of [v.internalValue, v.value]) {
          if (Array.isArray(sel)) {
            for (const o of sel) if (fixAny(o)) changed = true
          } else if (fixAny(sel)) {
            changed = true
          }
        }
        if (changed && typeof v.$forceUpdate === "function") v.$forceUpdate()
      }
    }

    const tick = () => {
      if (!Object.keys(nameZh).length) buildNameMap()
      findLocalizedAny()
      patch()
    }

    // Initial + retries (the filter panel and its item data load async).
    tick()
    ;[400, 1200, 2500, 5000].forEach((d) => setTimeout(tick, d))
    // Light periodic re-pass: catches dropdowns rendered on demand and options
    // Vue re-creates on re-render. Idempotent — already-bilingual options skip.
    setInterval(tick, 1000)
  }
})
