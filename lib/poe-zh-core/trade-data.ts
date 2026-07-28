// Self-built translation core (independent of the third-party POE Trade zh).
//
// Fetches official trade metadata and prepares the Chinese `result` arrays that
// get injected into the trade site's lscache-* cache.
//
// - stats:  combined as "中文 (English)" so BOTH Chinese and English are
//           searchable in the Add Stat Filter box; the per-entry category badge
//           (pseudo/explicit/...) is switched to its Chinese label.
// - static/filters: pure Chinese (ids stay language-independent, so the site
//           keeps working).
//
// Items are intentionally NOT handled here (an item's `type` is the search value
// sent to the international API, so it must stay English).

import { convertDeep } from "~/lib/poe-zh-cn/convert"

const TW_API = "https://pathofexile.tw/api/trade/data/"
const US_API = "https://www.pathofexile.com/api/trade/data/"

// Complete mod/stat template dictionary sourced from the game files (covers
// stats the Taiwan trade API happens NOT to expose, e.g. option-based map-boss
// stats like "Map is occupied by The Purifier"). Used as a fallback so the Stat
// Filter shows Chinese for those too, matching the results-page translation.
const REMOTE_STAT_URL =
  "https://raw.githubusercontent.com/MooHuiDev/poe-zh-trade-tools-pro/main/data/stat-templates.json"

type StatTpl = Record<string, string>

// Normalize an English stat string to the key form used in stat-templates.json:
// {N}/numbers -> "#", drop everything but [a-z#]. Kept in sync with the build
// script and the results content script.
const normEnKey = (value: string): string =>
  value
    .replace(/\{[^}]*\}/g, "#")
    .replace(/[+\-]?\d+(?:\.\d+)?/g, "#")
    .toLowerCase()
    .replace(/[^a-z#]/g, "")

// The Taiwan API returns some stats with the game's unresolved inline keyword
// syntax, e.g. "[ContainsAbyss|深淵]" (keyword before the pipe, display text
// after) or "[深淵]". Resolve it to the display text so the Stat Filter shows
// clean Chinese instead of raw brackets. Mirrors the results-page resolver.
const resolveKw = (value: string): string =>
  value
    .replace(/\[([^[\]|]*)\|([^[\]]*)\]/g, "$2")
    .replace(/\[([^[\]]*)\]/g, "$1")

const fetchStatTpl = async (): Promise<{ tw?: StatTpl; cn?: StatTpl } | null> => {
  try {
    const r = await fetch(REMOTE_STAT_URL, { credentials: "omit", cache: "no-cache" })
    if (!r.ok) return null
    return (await r.json()) as { tw?: StatTpl; cn?: StatTpl }
  } catch {
    return null
  }
}

const STORE_AT_KEY = "zhCoreAt"
const MAX_AGE_MS = 8 * 60 * 60 * 1000

type StatOption = { id?: number | string; text?: string }
type StatEntry = {
  id?: string
  text?: string
  type?: string
  option?: { options?: StatOption[] }
}
type StatGroup = { id?: string; label?: string; entries?: StatEntry[] }

// A results-page mod entry. `tw` = Chinese template (with # tokens); `us` = the
// English template (used to isolate the option fill); `opt` maps an English
// option text to its Chinese text (for "grants: <sub-stat>" style mods).
type ModInfo = { tw: string; us?: string; opt?: Record<string, string> }

const readTimestamp = (): Promise<number> =>
  new Promise((resolve) =>
    chrome.storage.local.get([STORE_AT_KEY], (v) =>
      resolve(Number(v[STORE_AT_KEY]) || 0)
    )
  )

const writeStorage = (data: Record<string, unknown>): Promise<void> =>
  new Promise((resolve) => chrome.storage.local.set(data, () => resolve()))

const fetchResult = async (url: string): Promise<unknown[] | null> => {
  const response = await fetch(url, { credentials: "omit" })
  if (!response.ok) throw new Error(`${url} -> ${response.status}`)
  const json = await response.json()
  return Array.isArray(json?.result) ? json.result : null
}

// Results-page mod dictionary keyed by stat id (item mods expose it via
// data-hash). Numeric mods substitute rendered numbers into the # tokens;
// option-based mods (e.g. cluster jewel "grants: <sub-stat>") carry an English
// -> Chinese option table so the sub-stat is translated rather than treated as
// a number.
const buildModMap = (twStats: StatGroup[], usStats: StatGroup[] | null) => {
  const usTextById: Record<string, string> = {}
  const usOptById: Record<string, StatOption[]> = {}
  if (usStats) {
    for (const group of usStats)
      for (const entry of group.entries ?? []) {
        if (!entry.id) continue
        if (entry.text) usTextById[entry.id] = entry.text
        if (entry.option?.options) usOptById[entry.id] = entry.option.options
      }
  }

  const map: Record<string, ModInfo> = {}
  for (const group of twStats) {
    if (group.id === "pseudo") continue // pseudo texts ("total ...") aren't item mods
    for (const entry of group.entries ?? []) {
      if (!entry.id || !entry.text || entry.id in map) continue
      const info: ModInfo = { tw: entry.text }
      if (usTextById[entry.id]) info.us = usTextById[entry.id]

      if (entry.option?.options && usOptById[entry.id]) {
        const usTextByOptId: Record<string, string> = {}
        for (const o of usOptById[entry.id])
          if (o.id != null && o.text) usTextByOptId[String(o.id)] = o.text
        const opt: Record<string, string> = {}
        for (const to of entry.option.options) {
          if (to.id == null || !to.text) continue
          const usOptText = usTextByOptId[String(to.id)]
          if (usOptText) opt[usOptText] = to.text
        }
        if (Object.keys(opt).length) info.opt = opt
      }

      map[entry.id] = info
    }
  }
  return map
}

// Build the stats result: "中文 (English)" text for bilingual search, and the
// category badge (entry.type) switched to the group's Chinese label.
//
// `statTpl` (optional) is the complete game-file dictionary; it fills the
// Chinese text for stats the Taiwan API lacks so the Stat Filter is fully
// translated, matching the results-page translation.
const buildStats = (
  twStats: StatGroup[],
  usStats: StatGroup[] | null,
  statTpl?: StatTpl
) => {
  // Fall back to pure-TW only if we have no international data at all.
  if (!usStats) return twStats

  // Index the TW data by stat id (Chinese text, options, and group label).
  const twById: Record<string, StatEntry> = {}
  const twLabelById: Record<string, string> = {}
  const twGroupLabelByGroupId: Record<string, string> = {}
  for (const group of twStats) {
    if (group.id && group.label) twGroupLabelByGroupId[group.id] = group.label
    for (const entry of group.entries ?? [])
      if (entry.id) {
        twById[entry.id] = entry
        if (group.label) twLabelById[entry.id] = group.label
      }
  }

  // Map over the INTERNATIONAL stats (the complete, authoritative list) so that
  // injecting our data never removes a stat or option the site relies on — it
  // only adds Chinese where the TW data has a matching id. This avoids
  // "Unknown stat provided" errors for stats/options that TW happens to lack.
  const result: StatGroup[] = usStats.map((group) => ({
    ...group,
    label: (group.id && twGroupLabelByGroupId[group.id]) || group.label,
    entries: (group.entries ?? []).map((entry) => {
      const tw = entry.id ? twById[entry.id] : undefined
      // Prefer the Taiwan API text; if it lacks this stat, fall back to the
      // complete game-file template dictionary (keyed by normalized English).
      // The dictionary is keyed PER LINE, and many stats are multi-line (e.g.
      // "Map contains Drox's Citadel\nItem Quantity increases..."), so translate
      // line by line and keep each line bilingual "中文 (English)" for search.
      let text = entry.text
      if (tw?.text) {
        const zh = resolveKw(tw.text)
        text = zh !== entry.text ? `${zh} (${entry.text})` : entry.text
      } else if (statTpl && entry.text) {
        let anyLine = false
        const outLines = entry.text.split("\n").map((line) => {
          const zhLine = statTpl[normEnKey(line)]
          if (zhLine && zhLine !== line) {
            anyLine = true
            return `${resolveKw(zhLine)} (${line})`
          }
          return line
        })
        if (anyLine) text = outLines.join("\n")
      }

      // Translate option display texts but keep the US option ids intact (that
      // is what the site sends to the API, e.g. "...|4").
      let option = entry.option
      if (entry.option?.options && tw?.option?.options) {
        const twOptById: Record<string, string> = {}
        for (const o of tw.option.options)
          if (o.id != null && o.text) twOptById[String(o.id)] = resolveKw(o.text)
        option = {
          options: entry.option.options.map((o) => {
            const t = o.id != null ? twOptById[String(o.id)] : undefined
            return t && t !== o.text ? { ...o, text: `${t} (${o.text})` } : o
          })
        }
      }

      return {
        ...entry,
        text,
        option,
        type: (entry.id && twLabelById[entry.id]) || group.label || entry.type
      }
    })
  }))

  // Re-add Taiwan-only OPTION stats that the international list omits (e.g. boss
  // "occupied by" / influence implicits that international keeps searchable but
  // no longer lists). The Taiwan API represents these in a FLATTENED form — one
  // entry per option with the option baked into the id ("stat_X|1", "stat_X|2",
  // ...) and no `option.options`. Sending that flattened id makes the
  // international server reject it ("Unknown stat provided"); it wants the BASE
  // id plus a separate option value. So collapse each flattened group back into
  // one base entry carrying an `option.options` array — the format the site then
  // sends as `{ id: base, value: { option: N } }`, which the server accepts
  // (verified live). Only stats absent from the international data are added, so
  // nothing the site natively knows is altered.
  const usIds = new Set<string>()
  for (const group of usStats)
    for (const entry of group.entries ?? []) if (entry.id) usIds.add(entry.id)

  type Collapsed = {
    groupId?: string
    type?: string
    options: StatOption[]
    texts: string[]
  }
  const byBase: Record<string, Collapsed> = {}
  for (const group of twStats) {
    for (const entry of group.entries ?? []) {
      if (!entry.id || usIds.has(entry.id)) continue
      const m = entry.id.match(/^(.*)\|(\d+)$/)
      if (!m) continue // only flattened option stats can be safely re-added
      const base = m[1]
      if (usIds.has(base)) continue // base already present in the international list
      const optId = Number(m[2])
      const c =
        byBase[base] ||
        (byBase[base] = {
          groupId: group.id,
          type: group.label,
          options: [],
          texts: []
        })
      const optText = resolveKw(entry.text ?? "")
      c.options.push({ id: optId, text: optText })
      if (optText) c.texts.push(optText)
    }
  }

  // Longest common prefix of the option texts → a readable base label; the
  // specific options remain selectable in the dropdown.
  const commonPrefix = (arr: string[]): string => {
    if (!arr.length) return ""
    let p = arr[0]
    for (const s of arr) {
      let i = 0
      while (i < p.length && i < s.length && p[i] === s[i]) i++
      p = p.slice(0, i)
      if (!p) break
    }
    return p.trim()
  }

  const groupById: Record<string, StatGroup> = {}
  for (const group of result) if (group.id) groupById[group.id] = group

  for (const [base, c] of Object.entries(byBase)) {
    const label = commonPrefix(c.texts)
    const entry: StatEntry = {
      id: base,
      text: label && label.length >= 2 ? label : c.texts[0] || base,
      type: c.type,
      option: { options: c.options }
    }
    const target = (c.groupId && groupById[c.groupId]) || result[0]
    if (target) (target.entries = target.entries ?? []).push(entry)
  }

  return result
}

export const refreshTradeData = async (force = false): Promise<void> => {
  try {
    if (!force && Date.now() - (await readTimestamp()) < MAX_AGE_MS) return

    const out: Record<string, unknown> = {}

    // Complete game-file template dictionary (remote) — fills stats the Taiwan
    // API doesn't expose. Best-effort; null just means we rely on the TW API.
    const statTpl = await fetchStatTpl()

    // Stats — needs both locales for the bilingual "中文 (English)" text.
    try {
      const twStats = (await fetchResult(`${TW_API}stats`)) as StatGroup[] | null
      let usStats: StatGroup[] | null = null
      try {
        usStats = (await fetchResult(`${US_API}stats`)) as StatGroup[] | null
      } catch {
        usStats = null // fall back to pure Chinese if the US API is unavailable
      }
      if (twStats) {
        out.zhCore_stats = buildStats(twStats, usStats, statTpl?.tw)
        // Simplified: build with the authentic 国服 templates, then run the
        // 台服->国服 term conversion over the whole structure.
        out.zhCore_cn_stats = convertDeep(
          buildStats(twStats, usStats, statTpl?.cn)
        )
        out.zhCore_modmap = buildModMap(twStats, usStats)
      }
    } catch (e) {
      console.error("[zh-core] stats fetch failed", e)
    }

    // Static (currency etc.) and filters — pure Chinese, injected as-is.
    try {
      const twStatic = await fetchResult(`${TW_API}static`)
      if (twStatic) out.zhCore_static = twStatic
    } catch (e) {
      console.error("[zh-core] static fetch failed", e)
    }
    try {
      const twFilters = await fetchResult(`${TW_API}filters`)
      if (twFilters) out.zhCore_filters = twFilters
    } catch (e) {
      console.error("[zh-core] filters fetch failed", e)
    }

    // Simplified-Chinese (国服) variants: OpenCC-convert the Traditional data we
    // just built (+ curated 台服->国服 term overrides). Same shapes, so the
    // content scripts only need to pick the "cn" storage key by language.
    try {
      // zhCore_cn_stats is built directly above (with authentic 国服 templates).
      if (out.zhCore_static) out.zhCore_cn_static = convertDeep(out.zhCore_static)
      if (out.zhCore_filters) out.zhCore_cn_filters = convertDeep(out.zhCore_filters)
      if (out.zhCore_modmap) out.zhCore_cn_modmap = convertDeep(out.zhCore_modmap)
    } catch (e) {
      console.error("[zh-core] simplified conversion failed", e)
    }

    if (Object.keys(out).length > 0) {
      out[STORE_AT_KEY] = Date.now()
      await writeStorage(out)
      console.log(
        "[zh-core] official trade data stored:",
        Object.keys(out)
          .filter((k) => k.startsWith("zhCore_"))
          .join(", ")
      )
    }
  } catch (error) {
    console.error("[zh-core] failed to refresh trade data", error)
  }
}
