/**
 * Builds a comprehensive English -> Traditional Chinese item-name map by pairing
 * the official trade "items" data from the international site (English) with the
 * Garena Taiwan site (Traditional Chinese).
 *
 * POE Trade zh already fetches pathofexile.tw trade data for stats/static/filters,
 * so fetching the `items` endpoint works the same way in the browser. It does NOT
 * translate item names by default (its dictionary is monster names), which is why
 * unique names show in English. This fills that gap with official names.
 *
 * Safety: we only pair entries category-by-category and index-by-index when the
 * entry counts match, and only record a mapping when the target text actually
 * contains Chinese. If anything is off (blocked, shape changed, TW server lagging
 * behind a patch), the affected entries are simply skipped and stay English.
 */

import { SUPPLEMENT_ZH_TW } from "./dict"
import { SUPPLEMENT_ZH_CN } from "./dict-cn"
import { toSimplified } from "~/lib/poe-zh-cn/convert"

const ITEMS_US = "https://www.pathofexile.com/api/trade/data/items"
const ITEMS_TW = "https://pathofexile.tw/api/trade/data/items"

const STORE_KEY = "zhSuppItemMap"
const STORE_AT_KEY = "zhSuppItemMapAt"
const ITEMS_STORE_KEY = "zhCore_items"
const MAX_AGE_MS = 24 * 60 * 60 * 1000

type TradeEntry = {
  name?: string
  text?: string
  type?: string
  flags?: unknown
  disc?: string
}
type TradeCategory = { id?: string; label?: string; entries?: TradeEntry[] }
type TradeItemsResponse = { result?: TradeCategory[] }

const hasChinese = (value: string) => /[一-鿿]/.test(value)
const normalize = (value: string) => value.toLowerCase().replace(/[^a-z0-9]/g, "")

const fetchItems = async (url: string): Promise<TradeItemsResponse> => {
  const response = await fetch(url, { credentials: "omit" })
  if (!response.ok) throw new Error(`${url} -> ${response.status}`)
  return response.json()
}

const readStorage = (keys: string[]): Promise<Record<string, unknown>> =>
  new Promise((resolve) =>
    chrome.storage.local.get(keys, (items) =>
      resolve(items as Record<string, unknown>)
    )
  )

const writeStorage = (data: Record<string, unknown>): Promise<void> =>
  new Promise((resolve) => chrome.storage.local.set(data, () => resolve()))

export const buildAndStoreZhItemMap = async (force = false): Promise<void> => {
  try {
    if (!force) {
      const meta = await readStorage([STORE_AT_KEY])
      const at = Number(meta[STORE_AT_KEY]) || 0
      if (at && Date.now() - at < MAX_AGE_MS) return
    }

    const [us, tw] = await Promise.all([fetchItems(ITEMS_US), fetchItems(ITEMS_TW)])
    const usCategories = us.result ?? []
    const twCategories = tw.result ?? []

    const map: Record<string, string> = {}

    // Match categories by their language-independent id/label so ordering
    // differences between the international and Garena TW APIs don't cause
    // whole categories to be mis-compared. Fall back to positional match.
    const categoryKey = (cat: TradeCategory, index: number) =>
      String(cat.id || cat.label || `#${index}`)
    const twByKey = new Map<string, TradeCategory>()
    twCategories.forEach((cat, index) => twByKey.set(categoryKey(cat, index), cat))

    const fieldOf = (entry: TradeEntry) =>
      (entry.name || entry.text || entry.type || "").trim()

    // Pair two equal-length, same-order lists index by index.
    const pairArrays = (usArr: TradeEntry[], twArr: TradeEntry[]) => {
      if (usArr.length === 0 || usArr.length !== twArr.length) return false
      for (let i = 0; i < usArr.length; i++) {
        const english = fieldOf(usArr[i])
        const chinese = fieldOf(twArr[i])
        if (!english || !chinese) continue
        if (hasChinese(english) || !hasChinese(chinese)) continue
        const key = normalize(english)
        if (key && !map[key]) map[key] = chinese
      }
      return true
    }

    let matchedSubsets = 0

    usCategories.forEach((usCat, index) => {
      const twCat =
        twByKey.get(categoryKey(usCat, index)) ?? twCategories[index]
      if (!twCat) return
      const usEntries = usCat.entries ?? []
      const twEntries = twCat.entries ?? []

      // Unique items (entries with a name) are covered by the bundled
      // authoritative dictionary (dict.ts), so we deliberately DO NOT pair them
      // here — positional pairing across two different game versions garbles
      // names. This runtime map only covers the non-unique searchable entries
      // (base types, gems, currency, maps, divination cards), paired only when
      // counts line up exactly, so it stays safe.
      const usRest = usEntries.filter((entry) => !entry.name)
      const twRest = twEntries.filter((entry) => !entry.name)
      if (pairArrays(usRest, twRest)) matchedSubsets++
    })

    console.log(
      `[zh-supp] runtime item map (non-unique): ${Object.keys(map).length} entries; ` +
        `subsets matched ${matchedSubsets} ` +
        `(us cats ${usCategories.length}, tw cats ${twCategories.length}); ` +
        `unique names come from the bundled dictionary`
    )

    // Build a bilingual "中文 (English)" tradeitems result for injection so the
    // item search box and item-based filter dropdowns (map/legacy reward, etc.)
    // are searchable in BOTH languages. The English `type`/`name` are kept
    // intact (that is what the site sends to the API), only the display/search
    // `text` becomes bilingual.
    const zhOf = (english: string) => {
      const key = normalize(english)
      return SUPPLEMENT_ZH_TW[key] || map[key]
    }
    // reverse: Chinese display -> English text, so typing a Chinese item name in
    // a vue-multiselect search box (whose internal options are English) can be
    // reverse-translated to English on the fly.
    const reverse: Record<string, string> = {}
    const addReverse = (zh: string | undefined, en: string) => {
      if (zh && en && !(zh in reverse)) reverse[zh] = en
    }

    const items = usCategories.map((cat) => ({
      ...cat,
      entries: (cat.entries ?? []).map((e) => {
        const en = (e.text || "").trim()
        if (!en || hasChinese(en)) return e
        let zh: string | undefined
        if (e.name) {
          const zhName = zhOf(e.name)
          const zhType = e.type ? map[normalize(e.type)] : undefined
          if (zhName) {
            zh = zhType ? `${zhName} ${zhType}` : zhName
            addReverse(zhName, e.name) // "魔血" -> "Mageblood"
            addReverse(zh, en) // "魔血 重革腰帶" -> "Mageblood Heavy Belt"
            // Enrich the DOM map so a dropdown option showing just the name OR
            // the full "name base" text can both be translated.
            const nameKey = normalize(e.name)
            if (!(nameKey in map)) map[nameKey] = zhName
            const textKey = normalize(en)
            if (!(textKey in map)) map[textKey] = zh
          }
        } else {
          zh = zhOf(e.text || "") || (e.type ? map[normalize(e.type)] : undefined)
          if (zh) {
            addReverse(zh, en)
            const textKey = normalize(en)
            if (!(textKey in map)) map[textKey] = zh
          }
        }
        return zh ? { ...e, text: `${zh} (${en})` } : e
      })
    }))

    // Simplified-Chinese (国服) variants. Unique names come from the authentic
    // bundled 国服 dictionary; base types are OpenCC-converted from the paired
    // Traditional names (bases rarely differ beyond characters).
    const cnMap: Record<string, string> = {}
    for (const [k, v] of Object.entries(map)) cnMap[k] = toSimplified(v)
    const zhOfCn = (english: string) => {
      const key = normalize(english)
      return SUPPLEMENT_ZH_CN[key] || cnMap[key]
    }
    const cnReverse: Record<string, string> = {}
    const addCnReverse = (zh: string | undefined, en: string) => {
      if (zh && en && !(zh in cnReverse)) cnReverse[zh] = en
    }
    const cnItems = usCategories.map((cat) => ({
      ...cat,
      entries: (cat.entries ?? []).map((e) => {
        const en = (e.text || "").trim()
        if (!en || hasChinese(en)) return e
        let zh: string | undefined
        if (e.name) {
          const zhName = zhOfCn(e.name)
          const zhType = e.type ? cnMap[normalize(e.type)] : undefined
          if (zhName) {
            zh = zhType ? `${zhName} ${zhType}` : zhName
            addCnReverse(zhName, e.name)
            addCnReverse(zh, en)
            const nameKey = normalize(e.name)
            if (!(nameKey in cnMap)) cnMap[nameKey] = zhName
            const textKey = normalize(en)
            if (!(textKey in cnMap)) cnMap[textKey] = zh
          }
        } else {
          zh = zhOfCn(e.text || "") || (e.type ? cnMap[normalize(e.type)] : undefined)
          if (zh) {
            addCnReverse(zh, en)
            const textKey = normalize(en)
            if (!(textKey in cnMap)) cnMap[textKey] = zh
          }
        }
        return zh ? { ...e, text: `${zh} (${en})` } : e
      })
    }))

    const payload: Record<string, unknown> = { [STORE_AT_KEY]: Date.now() }
    if (Object.keys(map).length > 0) payload[STORE_KEY] = map
    payload[ITEMS_STORE_KEY] = items
    payload.zhCore_reverse = reverse
    if (Object.keys(cnMap).length > 0) payload.zhSuppItemMapCn = cnMap
    payload.zhCore_cn_items = cnItems
    payload.zhCn_reverse = cnReverse
    await writeStorage(payload)
    console.log(
      `[zh-supp] bilingual tradeitems prepared (${items.length} groups, ` +
        `${Object.keys(reverse).length} reverse entries)`
    )
  } catch (error) {
    console.error("[zh-supp] failed to build item map", error)
  }
}
