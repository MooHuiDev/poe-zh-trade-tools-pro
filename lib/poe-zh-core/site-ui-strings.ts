/**
 * The official Taiwan trade site's own interface translations.
 *
 * The trade site (international and pathofexile.tw are the same code) shows
 * every interface string through `translate(key, params)`, which looks the
 * English key up in a global `__` object and falls back to the key:
 *
 *     translate: function (t, e) {
 *       var n = typeof __ !== "undefined" && typeof __[t] !== "undefined" ? __[t] : t
 *       if (e) for (var l in e) n = n.replace(l, e[l])
 *       return n
 *     }
 *
 * pathofexile.tw fills `__` from /js/translate.zh_TW.js (~1,850 strings:
 * "Showing {COUNT} results", "listed {TIME} ago", "Equivalent" …). The
 * international site never defines `__`, so if we define it with the Taiwan
 * table the site renders its own interface in Chinese — placeholders included —
 * with no DOM patching. The file is plain `__['English'] = '中文'` lines; we
 * PARSE it as text (never evaluate it).
 */

export const TW_SITE_TRANSLATE_URL = "https://pathofexile.tw/js/translate.zh_TW.js"

// Our own wording where the official Taiwan text reads badly. Applied after
// parsing, so everything else stays official.
//   "listed" (seller line: "<account> listed 2 days ago") — official 清單 is the
//   noun "list"; the line read "EdibleDog#7996 清單 前天".
export const UI_STRING_OVERRIDES: Record<string, string> = {
  listed: "上架於",
  "just now": "剛剛"
}

// The newer parts of the site (results list …) use GGG's own gettext catalogs
// (/dist/zh_TW.<hash>.json, /dist/zh_CN.<hash>.json) once <html lang> is
// Chinese; `__` only covers the older parts. Same wording fixes for those:
export const CATALOG_URL_RE = /\/dist\/(zh_TW|zh_CN)\.[0-9a-f]+\.json(?:$|\?)/
//   "just now": the official zh_TW catalog says 僅此一次 ("only once");
//   zh_CN has no entry at all (shows English).
export const CATALOG_OVERRIDES: Record<string, Record<string, string>> = {
  zh_TW: { listed: "上架於", "just now": "剛剛" },
  zh_CN: { "just now": "刚刚" }
}

type Catalog = {
  translations?: Record<string, Record<string, { msgid?: string; msgstr?: string[] }>>
}

/** Rewrites msgstr for overridden msgids in a gettext JSON catalog (in place). */
export const applyCatalogOverrides = (catalog: unknown, locale: string): number => {
  const over = CATALOG_OVERRIDES[locale]
  const tr = (catalog as Catalog | null)?.translations
  if (!over || !tr || typeof tr !== "object") return 0
  let n = 0
  const found = new Set<string>()
  for (const ctx of Object.values(tr)) {
    if (!ctx || typeof ctx !== "object") continue
    for (const [msgid, zh] of Object.entries(over)) {
      const entry = ctx[msgid]
      if (entry && Array.isArray(entry.msgstr)) {
        entry.msgstr = entry.msgstr.map(() => zh)
        found.add(msgid)
        n++
      }
    }
  }
  // Strings the catalog lacks: add them to the default ("") context.
  const def = tr[""]
  if (def && typeof def === "object") {
    for (const [msgid, zh] of Object.entries(over)) {
      if (found.has(msgid) || def[msgid]) continue
      def[msgid] = { msgid, msgstr: [zh] }
      n++
    }
  }
  return n
}

// Event zh-core fires after it (re)writes the table, so the MAIN-world script
// can switch language on the page that's already open.
export const UI_STRINGS_EVENT = "pztt-site-ui-strings-updated"

// localStorage key the isolated content script writes and the MAIN-world
// script reads (same hand-off pattern as the lscache-* trade data).
export const UI_STRINGS_LS_KEY = "pztt-site-ui-strings"

const unescapeJs = (s: string) =>
  s.replace(/\\(u[0-9a-fA-F]{4}|x[0-9a-fA-F]{2}|.)/g, (_, c: string) => {
    if (c[0] === "u" || c[0] === "x") return String.fromCharCode(parseInt(c.slice(1), 16))
    if (c === "n") return "\n"
    if (c === "t") return "\t"
    return c // \' \" \\ and anything else
  })

/** Parses `__['English'] = '中文';` lines. Never evaluates the file. */
export const parseSiteTranslations = (js: string): Record<string, string> => {
  const out: Record<string, string> = {}
  const re =
    /__\[\s*(['"])((?:\\.|(?!\1)[^\\])*)\1\s*\]\s*=\s*(['"])((?:\\.|(?!\3)[^\\])*)\3/g
  let m: RegExpExecArray | null
  while ((m = re.exec(js))) {
    const en = unescapeJs(m[2])
    const zh = unescapeJs(m[4])
    if (en && zh && en !== zh) out[en] = zh
  }
  return out
}
