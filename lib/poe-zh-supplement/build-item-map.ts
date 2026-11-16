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
import { loadRemoteStatTemplates } from "~/lib/poe-zh-core/remote-stat-templates"
import {
  SCRYING_ORB_BASE_TW,
  SCRYING_MAP_NAMES_TW,
  SCRYING_MAP_NAMES_CN
} from "~/lib/poe-zh-supplement/scrying-map-names"
import { BEAST_NAMES_CN } from "~/lib/poe-zh-supplement/beast-names-cn"
import { BASE_NAMES_TW, BASE_NAMES_CN } from "~/lib/poe-zh-supplement/base-names"
import {
  buildTwNameMap,
  hasChinese,
  normalize,
  type TradeCategory
} from "./pair-names"

const ITEMS_US = "https://www.pathofexile.com/api/trade/data/items"
const ITEMS_TW = "https://pathofexile.tw/api/trade/data/items"
const STATIC_US = "https://www.pathofexile.com/api/trade/data/static"
const STATIC_TW = "https://pathofexile.tw/api/trade/data/static"

const STORE_KEY = "zhSuppItemMap"
const STORE_AT_KEY = "zhSuppItemMapAt"
const ITEMS_STORE_KEY = "zhCore_items"
const MAX_AGE_MS = 8 * 60 * 60 * 1000

type TradeItemsResponse = { result?: TradeCategory[] }


const fetchItems = async (url: string): Promise<TradeItemsResponse> => {
  const response = await fetch(url, { credentials: "omit" })
  if (!response.ok) throw new Error(`${url} -> ${response.status}`)
  return response.json()
}

// Remote unique-name dictionary hosted on the maintainer's own GitHub. This lets
// new/updated unique names reach users WITHOUT a Chrome Web Store update — just
// edit the JSON and push it. The bundled dict.ts / dict-cn.ts remain the offline
// fallback, so translation still works if this fetch fails (offline / blocked).
// JSON shape: { "tw": { "<normalized-english-slug>": "中文名", ... }, "cn": { ... } }
const REMOTE_DICT_URL =
  "https://raw.githubusercontent.com/MooHuiDev/poe-zh-trade-tools-pro/main/data/unique-names.json"

// Complete mod-template dictionary (English template -> Chinese template), built
// from the game's stat_descriptions. Lets zh-results translate ANY mod line by
// matching the rendered English (covers non-filterable unique mods that have no
// trade stat id). Hosted remotely so it can update per league without a release.
// (data/stat-templates.json: downloaded once, shared with trade-data.ts —
// see lib/poe-zh-core/remote-stat-templates.ts)

// Skill-gem name dictionary (English -> Traditional / Simplified), sourced from
// PoeDB. Needed because the Simplified (国服) gem names are DIFFERENT words, not
// just simplified characters (e.g. Kinetic Bolt = 力量穿引 [TW] but 念动飞箭 [CN]),
// so OpenCC-converting the Taiwan name is wrong. Keyed by normalized English.
const REMOTE_GEM_URL =
  "https://raw.githubusercontent.com/MooHuiDev/poe-zh-trade-tools-pro/main/data/gem-names.json"

type RemoteDict = {
  version?: string
  tw?: Record<string, string>
  cn?: Record<string, string>
}

const fetchRemoteGems = async (): Promise<RemoteDict | null> => {
  try {
    const res = await fetch(REMOTE_GEM_URL, { credentials: "omit", cache: "no-cache" })
    if (!res.ok) return null
    const json = (await res.json()) as RemoteDict
    return json && typeof json === "object" ? json : null
  } catch {
    return null
  }
}

// Bundled fallback for the localization "data version" shown in the About page.
// The live value comes from the remote JSON so it can update without a release.
const BUNDLED_DATA_VERSION = "3.28"

const fetchRemoteDict = async (): Promise<RemoteDict | null> => {
  try {
    const res = await fetch(REMOTE_DICT_URL, {
      credentials: "omit",
      cache: "no-cache"
    })
    if (!res.ok) return null
    const json = (await res.json()) as RemoteDict
    return json && typeof json === "object" ? json : null
  } catch {
    return null
  }
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

    // Static-data slug pairing. The static endpoint (currency, fragments,
    // breachstones, embers, keys, essences, oils, catalysts, beasts, …) is keyed
    // by a language-neutral slug. Pair US(slug->English) with TW(slug->中) to
    // translate every item-search entry that shares that English name — covers
    // the itemised beasts AND the "map"-category fragments/breachstones/etc. that
    // the positional US<->TW pairing can't reach.
    const beastTw: Record<string, string> = {}
    try {
      const [usS, twS] = await Promise.all([
        fetchItems(STATIC_US),
        fetchItems(STATIC_TW)
      ])
      const enBySlug: Record<string, string> = {}
      const zhBySlug: Record<string, string> = {}
      for (const c of usS.result ?? []) {
        for (const e of c.entries ?? []) {
          const it = e as { id?: string; text?: string }
          if (it.id && it.text) enBySlug[it.id] = it.text
        }
      }
      for (const c of twS.result ?? []) {
        for (const e of c.entries ?? []) {
          const it = e as { id?: string; text?: string }
          if (it.id && it.text) zhBySlug[it.id] = it.text
        }
      }
      for (const slug in enBySlug) {
        const en = enBySlug[slug]
        const zh = zhBySlug[slug]
        if (en && zh && hasChinese(zh)) beastTw[normalize(en)] = zh
      }
    } catch (e) {
      console.error("[zh-supplement] beast static fetch failed", e)
    }

    // Merge the remote (GitHub-hosted) unique dictionary over the bundled one.
    // Remote entries win; if the fetch fails we fall back to bundled only.
    const remoteDict = await fetchRemoteDict()
    const TW_DICT: Record<string, string> = remoteDict?.tw
      ? { ...SUPPLEMENT_ZH_TW, ...remoteDict.tw }
      : SUPPLEMENT_ZH_TW
    const CN_DICT: Record<string, string> = remoteDict?.cn
      ? { ...SUPPLEMENT_ZH_CN, ...remoteDict.cn }
      : SUPPLEMENT_ZH_CN

    // Skill-gem name dictionary (PoeDB): authoritative TW / 国服 gem names.
    const remoteGems = await fetchRemoteGems()
    const GEM_TW = remoteGems?.tw ?? {}
    const GEM_CN = remoteGems?.cn ?? {}

    const { map, derivedUnique, keysBeforeDict, stats } = buildTwNameMap({
      usCategories,
      twCategories,
      TW_DICT,
      GEM_TW,
      beastTw,
      BASE_NAMES_TW,
      SCRYING_MAP_NAMES_TW,
      SCRYING_ORB_BASE_TW
    })
    const { matchedSubsets, derivedBases, discPaired } = stats
    console.log(
      `[zh-supp] runtime item map (non-unique): ${Object.keys(map).length} entries; ` +
        `subsets matched ${matchedSubsets} ` +
        `(us cats ${usCategories.length}, tw cats ${twCategories.length}); ` +
        `derived ${derivedBases} base types + ` +
        `${Object.keys(derivedUnique).length} unique names from TW alignment; ` +
        `disc-paired ${discPaired} gem variants`
    )

    // Build a bilingual "中文 (English)" tradeitems result for injection so the
    // item search box and item-based filter dropdowns (map/legacy reward, etc.)
    // are searchable in BOTH languages. The English `type`/`name` are kept
    // intact (that is what the site sends to the API), only the display/search
    // `text` becomes bilingual.
    const zhOf = (english: string) => {
      const key = normalize(english)
      return TW_DICT[key] || derivedUnique[key] || map[key]
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
        // Base entries (gems, base types) carry only a `type`, no `text`, so the
        // original text-only path skipped them and they stayed English. Give them
        // a bilingual display `text` from the paired map (the site still sends the
        // English `type` to the API).
        if (!en) {
          if (e.name) return e
          const baseEn = (e.type || "").trim()
          if (!baseEn || hasChinese(baseEn)) return e
          const zhBase = map[normalize(baseEn)]
          if (!zhBase) return e
          addReverse(zhBase, baseEn)
          return { ...e, text: `${zhBase} (${baseEn})` }
        }
        if (hasChinese(en)) return e
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
    // Unique names merged in from the TW dictionary are Taiwan wording — don't
    // seed them into 国服 as OpenCC guesses (国服 unique names come from CN_DICT
    // below). Base types are fine to convert.
    const uniqueKeys = new Set<string>()
    for (const cat of usCategories)
      for (const e of cat.entries ?? []) if (e.name) uniqueKeys.add(normalize(e.name))
    for (const [k, v] of Object.entries(map)) {
      if (!keysBeforeDict.has(k) && uniqueKeys.has(k)) continue
      cnMap[k] = toSimplified(v)
    }
    // Override with authentic 国服 gem names (PoeDB): these are DIFFERENT words,
    // not just simplified characters, so they must replace the OpenCC guess.
    for (const [k, v] of Object.entries(GEM_CN)) if (v) cnMap[k] = v
    // Authentic 国服 beast names (PoeDB): OpenCC of the TW name is wrong for
    // many (e.g. 黑羽之莫丽根, not 黑色莫里根). Unmatched beasts keep OpenCC.
    for (const k in BEAST_NAMES_CN) cnMap[k] = BEAST_NAMES_CN[k]
    // 国服 base-item names (PoeDB) for bases the TW API lacks.
    for (const k in BASE_NAMES_CN) cnMap[k] = BASE_NAMES_CN[k]
    // Fix the "(<Map>)" suffix on CN item names for maps the TW Atlas lacks —
    // covers Scrying Orb, Blighted Map, Blight-ravaged Map and any other
    // `disc`-tagged map-suffixed item that shares the map id. cnMap was seeded
    // by OpenCC of the TW name, which is WRONG for these maps (e.g. 远古街区,
    // not 血腥阵地). Only entries with a `disc` are touched, so a plain item
    // ending in "(Core)" etc. is left alone.
    for (const cat of usCategories) {
      for (const e of cat.entries ?? []) {
        if (!e.disc || !e.text) continue
        const mm = e.text.match(/\(([^)]+)\)\s*$/)
        if (!mm) continue
        const cn = SCRYING_MAP_NAMES_CN[normalize(mm[1])]
        const key = normalize(e.text)
        if (cn && cnMap[key]) {
          cnMap[key] = cnMap[key].replace(/\s*\([^)]*\)\s*$/, "") + ` (${cn})`
        }
      }
    }
    const zhOfCn = (english: string) => {
      const key = normalize(english)
      return (
        CN_DICT[key] ||
        (derivedUnique[key] ? toSimplified(derivedUnique[key]) : undefined) ||
        cnMap[key]
      )
    }
    const cnReverse: Record<string, string> = {}
    const addCnReverse = (zh: string | undefined, en: string) => {
      if (zh && en && !(zh in cnReverse)) cnReverse[zh] = en
    }
    const cnItems = usCategories.map((cat) => ({
      ...cat,
      entries: (cat.entries ?? []).map((e) => {
        const en = (e.text || "").trim()
        if (!en) {
          if (e.name) return e
          const baseEn = (e.type || "").trim()
          if (!baseEn || hasChinese(baseEn)) return e
          const zhBase = cnMap[normalize(baseEn)]
          if (!zhBase) return e
          addCnReverse(zhBase, baseEn)
          return { ...e, text: `${zhBase} (${baseEn})` }
        }
        if (hasChinese(en)) return e
        let zh: string | undefined
        if (e.name) {
          const zhName = zhOfCn(e.name)
          const zhType = e.type ? cnMap[normalize(e.type)] : undefined
          if (zhName) {
            zh = zhType ? `${zhName} ${zhType}` : zhName
            addCnReverse(zhName, e.name)
            addCnReverse(zh, en)
            // OVERRIDE (not gap-fill): cnMap was seeded from OpenCC(TW) at the top,
            // so a unique's key already exists there as the simplified TW name. The
            // authentic 国服 name (CN_DICT / unique-names.cn, resolved via zhOfCn)
            // must replace it, otherwise result-card translation shows the OpenCC-TW
            // name (e.g. 特索塔之珠) while the dropdown shows the real 国服 name
            // (深水遗迹之珠). zhName is always >= the seed in quality, so overriding
            // is safe (falls back to the same seed value when no 国服 name exists).
            cnMap[normalize(e.name)] = zhName
            cnMap[normalize(en)] = zh
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
    payload.zhDataVersion = remoteDict?.version || BUNDLED_DATA_VERSION
    // Optional short note shown alongside the "localization data updated" toast.
    payload.zhDataVersionNote =
      (remoteDict as { versionNote?: string })?.versionNote || ""

    await writeStorage(payload)
    console.log(
      `[zh-supp] bilingual tradeitems prepared (${items.length} groups, ` +
        `${Object.keys(reverse).length} reverse entries)`
    )

    // Complete mod-template dictionary (English -> Chinese templates). Fetched
    // and stored SEPARATELY (it is large, ~3MB) so it does not bloat the main
    // write and so we can log success/failure clearly.
    try {
      // Shared with trade-data.ts: one download for both (they run together).
      const st = await loadRemoteStatTemplates()
      if (!st) {
        console.warn("[zh-supp] stat templates unavailable")
      } else {
        const twTpl = st?.tw || {}
        const cnTpl = st?.cn || {}
        // Indexed templates ("#{k}" = k-th number of the English line) for lines
        // whose Chinese reorders the numbers. Separate keys so older versions,
        // which don't understand "#{k}", never read them.
        await writeStorage({
          zhStatTpl_tw: twTpl,
          zhStatTpl_cn: cnTpl,
          zhStatTplIdx_tw: st?.twIdx || {},
          zhStatTplIdx_cn: st?.cnIdx || {},
          // Other game texts (affix names, descriptions, names …), Traditional only.
          zhStatText_tw: st?.twText || {}
        })
        console.log(
          `[zh-supp] stat templates stored: tw ${Object.keys(twTpl).length}, ` +
            `cn ${Object.keys(cnTpl).length}`
        )
      }
    } catch (e) {
      console.error("[zh-supp] stat templates fetch failed", e)
    }
  } catch (error) {
    console.error("[zh-supp] failed to build item map", error)
  }
}
