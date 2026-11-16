import { isNativeChineseTradeSite, tradeHosts } from "~/lib/config/trade-hosts"
import {
  applyCatalogOverrides,
  CATALOG_URL_RE,
  UI_STRINGS_EVENT,
  UI_STRINGS_LS_KEY
} from "~/lib/poe-zh-core/site-ui-strings"

/**
 * Trade-site interface in Chinese (MAIN world, document_start).
 *
 * The site (same code as pathofexile.tw) shows its interface text through a
 * translator that
 *   1. picks its language from <html lang> (an observer follows later changes)
 *      and returns the English source text when that language is English, and
 *   2. looks strings up in the global `__` table (see
 *      lib/poe-zh-core/site-ui-strings.ts).
 * The international site has <html lang="en"> and no `__`, so everything stays
 * English. We set <html lang> to zh-TW / zh-CN and define `__` with the
 * official Taiwan table (Simplified-converted for zh-CN), so the site itself
 * renders "顯示 100 筆結果 (10000+ 筆符合)", "前往藏身處" … — no DOM patching,
 * nothing for the site to undo on re-render.
 *
 * Safety:
 *  - `__` is only defined when missing; an existing one is left alone.
 *  - The data is written by zh-core (isolated world) to localStorage and removed
 *    there when translation is off, so turning it off restores English (and
 *    <html lang="en">) on the next load.
 *  - Any problem → nothing changes → the site stays English.
 */
type Stored = { lang?: string; strings?: Record<string, string> }

export default defineContentScript({
  matches: tradeHosts,
  world: "MAIN",
  runAt: "document_start",

  main() {
    if (isNativeChineseTradeSite()) return
    const w = window as unknown as { __?: unknown }

    const read = (): Stored | null => {
      try {
        const raw = localStorage.getItem(UI_STRINGS_LS_KEY)
        if (!raw) return null
        const val = JSON.parse(raw)
        if (!val || typeof val !== "object" || Array.isArray(val)) return null
        // 4.1.10.7 test builds stored the bare table.
        return "strings" in val ? (val as Stored) : { lang: "zh-TW", strings: val }
      } catch {
        return null
      }
    }

    // The table object we defined (only ever update our own, never someone else's).
    let ours: Record<string, string> | null = null

    const apply = (data: Stored) => {
      const strings = data.strings
      if (!strings || typeof strings !== "object") return
      if (typeof w.__ === "undefined") {
        ours = { ...strings }
        w.__ = ours
      } else if (ours && w.__ === ours) {
        // Language switched while the page is open: swap the contents in place
        // (the site keeps reading the same object).
        for (const k of Object.keys(ours)) delete ours[k]
        Object.assign(ours, strings)
      }
      const lang = data.lang === "zh-CN" ? "zh-CN" : "zh-TW"
      try {
        if (document.documentElement && document.documentElement.lang !== lang)
          document.documentElement.lang = lang
      } catch {
        // ignore
      }
    }

    // GGG's own Chinese catalogs (used by the results list once <html lang> is
    // Chinese): apply our few wording fixes (see CATALOG_OVERRIDES). Any problem
    // → the untouched response.
    const realFetch = window.fetch
    window.fetch = async function (this: unknown, ...args: Parameters<typeof fetch>) {
      const res = await realFetch.apply(this, args)
      try {
        const req = args[0]
        const url = typeof req === "string" ? req : req instanceof URL ? req.href : (req as Request).url
        const m = url && url.match(CATALOG_URL_RE)
        if (!m || !res.ok) return res
        const json = await res.clone().json()
        if (!applyCatalogOverrides(json, m[1])) return res
        return new Response(JSON.stringify(json), {
          status: res.status,
          statusText: res.statusText,
          headers: res.headers
        })
      } catch {
        return res
      }
    } as typeof fetch

    // zh-core rewrote the table (first visit, or 简↔繁 switch) → apply it now.
    window.addEventListener(UI_STRINGS_EVENT, () => {
      const d = read()
      if (d) return void apply(d)
      // Translation turned off while the page is open: back to English.
      if (ours && w.__ === ours) for (const k of Object.keys(ours)) delete ours[k]
      try {
        if (ours && document.documentElement.lang !== "en") document.documentElement.lang = "en"
      } catch {
        // ignore
      }
    })

    const data = read()
    if (data) {
      apply(data)
      return
    }
    // First visit: zh-core writes the data asynchronously. Apply it as soon as
    // it lands (the site follows <html lang> changes); the next page load is
    // fully Chinese from the start.
    const deadline = Date.now() + 3000
    const poll = () => {
      const d = read()
      if (d) return void apply(d)
      if (Date.now() < deadline) setTimeout(poll, 100)
    }
    setTimeout(poll, 50)
  }
})
