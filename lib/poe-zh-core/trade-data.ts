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

const STORE_AT_KEY = "zhCoreAt"
const MAX_AGE_MS = 24 * 60 * 60 * 1000

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
const buildStats = (twStats: StatGroup[], usStats: StatGroup[] | null) => {
  const usById: Record<string, string> = {}
  if (usStats) {
    for (const group of usStats)
      for (const entry of group.entries ?? [])
        if (entry.id && entry.text) usById[entry.id] = entry.text
  }
  return twStats.map((group) => ({
    ...group,
    entries: (group.entries ?? []).map((entry) => {
      const en = entry.id ? usById[entry.id] : undefined
      return {
        ...entry,
        text: en && en !== entry.text ? `${entry.text} (${en})` : entry.text,
        type: group.label || entry.type
      }
    })
  }))
}

export const refreshTradeData = async (force = false): Promise<void> => {
  try {
    if (!force && Date.now() - (await readTimestamp()) < MAX_AGE_MS) return

    const out: Record<string, unknown> = {}

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
        out.zhCore_stats = buildStats(twStats, usStats)
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
      if (out.zhCore_stats) out.zhCore_cn_stats = convertDeep(out.zhCore_stats)
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
