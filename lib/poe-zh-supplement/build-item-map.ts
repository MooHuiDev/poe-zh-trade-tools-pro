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
import {
  SCRYING_ORB_BASE_TW,
  SCRYING_MAP_NAMES_TW,
  SCRYING_MAP_NAMES_CN
} from "~/lib/poe-zh-supplement/scrying-map-names"
import { BEAST_NAMES_CN } from "~/lib/poe-zh-supplement/beast-names-cn"
import { BASE_NAMES_TW, BASE_NAMES_CN } from "~/lib/poe-zh-supplement/base-names"

const ITEMS_US = "https://www.pathofexile.com/api/trade/data/items"
const ITEMS_TW = "https://pathofexile.tw/api/trade/data/items"
const STATIC_US = "https://www.pathofexile.com/api/trade/data/static"
const STATIC_TW = "https://pathofexile.tw/api/trade/data/static"

const STORE_KEY = "zhSuppItemMap"
const STORE_AT_KEY = "zhSuppItemMapAt"
const ITEMS_STORE_KEY = "zhCore_items"
const MAX_AGE_MS = 8 * 60 * 60 * 1000

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
const REMOTE_STAT_URL =
  "https://raw.githubusercontent.com/MooHuiDev/poe-zh-trade-tools-pro/main/data/stat-templates.json"

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

    // Anchor-aligned pairing (robust to count mismatch). Uses entries whose
    // English we already know a Chinese for (bundled dict or a value already in
    // `map`) as anchors, matches them to the same Chinese in the TW list, then
    // pairs the gap-free EQUAL-length segments between consecutive anchors by
    // index. A segment whose lengths differ (an inserted/removed entry) is just
    // skipped, so one discrepancy never poisons the rest of the category.
    const anchorPairEntries = (U: TradeEntry[], T: TradeEntry[]) => {
      if (!U.length || !T.length) return
      const knownZh = (en: string) => TW_DICT[normalize(en)] || map[normalize(en)]
      const usedT = new Array(T.length).fill(false)
      const anchors: Array<{ i: number; j: number }> = []
      let start = 0
      for (let i = 0; i < U.length; i++) {
        const en = fieldOf(U[i])
        if (!en || hasChinese(en)) continue
        const zh = knownZh(en)
        if (!zh) continue
        for (let k = start; k < T.length; k++) {
          if (!usedT[k] && fieldOf(T[k]) === zh) {
            anchors.push({ i, j: k })
            usedT[k] = true
            start = k + 1
            break
          }
        }
      }
      if (!anchors.length) return
      const segs: Array<[number, number, number, number]> = []
      let prev = { i: -1, j: -1 }
      for (const a of anchors) {
        segs.push([prev.i + 1, a.i - 1, prev.j + 1, a.j - 1])
        prev = a
      }
      segs.push([prev.i + 1, U.length - 1, prev.j + 1, T.length - 1])
      for (const [ui0, ui1, tj0, tj1] of segs) {
        const uc = ui1 - ui0 + 1
        const tc = tj1 - tj0 + 1
        if (uc <= 0 || uc !== tc) continue
        for (let d = 0; d < uc; d++) {
          const en = fieldOf(U[ui0 + d])
          const zh = fieldOf(T[tj0 + d])
          if (!en || !zh || hasChinese(en) || !hasChinese(zh)) continue
          const key = normalize(en)
          if (key && !map[key]) map[key] = zh
        }
      }
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
      // Robust fallback: the items API returns slightly inconsistent snapshots,
      // so a transient count diff makes the strict pairArrays above skip a whole
      // category (e.g. gems), leaving base gems like "Anger"/"Winter Orb"
      // untranslated. The US and TW lists ARE in the same language-independent
      // order, so anchor-align them on entries we already know (bundled dict /
      // already-paired) and pair the gap-free equal segments between anchors.
      anchorPairEntries(usRest, twRest)
    })

    // Auto-derive unique names missing from the dictionary by anchor-aligning the
    // international (English) and Garena TW (Chinese) unique lists per category.
    // Known names (from the dict) are anchors; the gap-free segments between them
    // are paired index-by-index. This fills new-league uniques straight from the
    // (complete) TW trade data, so we don't depend on poedb list-page completeness.
    const derivedUnique: Record<string, string> = {}
    usCategories.forEach((usCat, index) => {
      const twCat = twByKey.get(categoryKey(usCat, index)) ?? twCategories[index]
      if (!twCat) return
      const U = (usCat.entries ?? []).filter((e) => e.name)
      const T = (twCat.entries ?? []).filter(
        (e) => e.name && hasChinese(e.name)
      )
      if (!U.length || !T.length) return
      const usedT = new Array(T.length).fill(false)
      const anchors: Array<{ i: number; j: number }> = []
      let start = 0
      for (let i = 0; i < U.length; i++) {
        const zh = TW_DICT[normalize(U[i].name || "")]
        if (!zh) continue
        for (let k = start; k < T.length; k++) {
          if (!usedT[k] && (T[k].name || "").trim() === zh) {
            anchors.push({ i, j: k })
            usedT[k] = true
            start = k + 1
            break
          }
        }
      }
      const segs: Array<[number, number, number, number]> = []
      let prev = { i: -1, j: -1 }
      for (const a of anchors) {
        segs.push([prev.i + 1, a.i - 1, prev.j + 1, a.j - 1])
        prev = a
      }
      segs.push([prev.i + 1, U.length - 1, prev.j + 1, T.length - 1])
      for (const [ui0, ui1, tj0, tj1] of segs) {
        const uc = ui1 - ui0 + 1
        const tc = tj1 - tj0 + 1
        if (uc <= 0 || uc !== tc) continue // only pair gap-free equal segments
        for (let d = 0; d < uc; d++) {
          const eng = (U[ui0 + d].name || "").trim()
          const zh = (T[tj0 + d].name || "").trim()
          if (!eng || !zh || hasChinese(eng) || !hasChinese(zh)) continue
          const key = normalize(eng)
          if (key && !TW_DICT[key] && !derivedUnique[key]) derivedUnique[key] = zh
        }
      }
    })

    // Derive base-type names from unique items, anchored on the unique dictionary.
    // Every unique carries its base type in both locales (e.g. "Dread Captain's
    // Cutlass" → "Ghostflame Blade"; "滅亡海盜彎刀" → "青焰利刃"). Since we already
    // know the two uniques are the same (via TW_DICT), we can map the base
    // English→Chinese from their `type` fields. This is robust to the positional
    // category pairing being skipped on a new league (which leaves new base
    // types like "Ghostflame Blade" untranslated).
    const twUniqueTypeByName = new Map<string, string>()
    for (const cat of twCategories) {
      for (const e of cat.entries ?? []) {
        const nm = (e.name || "").trim()
        const tp = (e.type || "").trim()
        if (nm && tp && !twUniqueTypeByName.has(nm)) twUniqueTypeByName.set(nm, tp)
      }
    }
    let derivedBases = 0
    for (const cat of usCategories) {
      for (const e of cat.entries ?? []) {
        if (!e.name || !e.type) continue
        const zhName =
          TW_DICT[normalize(e.name)] || derivedUnique[normalize(e.name)]
        if (!zhName) continue
        const twType = twUniqueTypeByName.get(zhName)
        if (!twType || !hasChinese(twType)) continue
        const key = normalize(e.type)
        if (key && !map[key]) {
          map[key] = twType
          derivedBases++
        }
      }
    }

    // Transfigured / alternate gems (and any other `disc`-keyed variants) share
    // the same base `type` and differ only by `disc` (alt_x, alt_y, ...), which
    // is LANGUAGE-INDEPENDENT; `text` is the display name (e.g. "Eye of Winter of
    // Transience"). Plain index-pairing garbles these because the international
    // and Garena TW lists order the variants differently — "Eye of Winter of
    // Transience" ends up mapped to an unrelated gem. Pair them precisely by
    // (translated base type + disc) instead, and OVERWRITE any wrong value.
    const twTextByTypeDisc = new Map<string, string>()
    for (const cat of twCategories) {
      for (const e of cat.entries ?? []) {
        if (e.disc && e.type && e.text) {
          twTextByTypeDisc.set(`${e.type.trim()} ${e.disc}`, e.text.trim())
        }
      }
    }
    let discPaired = 0
    for (const cat of usCategories) {
      for (const e of cat.entries ?? []) {
        if (!e.disc || !e.type || !e.text) continue
        const zhBase = map[normalize(e.type)] // translated base gem name
        if (!zhBase) continue
        const zhText = twTextByTypeDisc.get(`${zhBase} ${e.disc}`)
        if (!zhText || !hasChinese(zhText)) continue
        const key = normalize(e.text)
        if (key) {
          map[key] = zhText // overwrite any mis-aligned index pairing
          discPaired++
        }
      }
    }

    console.log(
      `[zh-supp] runtime item map (non-unique): ${Object.keys(map).length} entries; ` +
        `subsets matched ${matchedSubsets} ` +
        `(us cats ${usCategories.length}, tw cats ${twCategories.length}); ` +
        `derived ${derivedBases} base types + ` +
        `${Object.keys(derivedUnique).length} unique names from TW alignment; ` +
        `disc-paired ${discPaired} gem variants`
    )

    // Fill any missing TW gem names from the PoeDB gem dictionary (the Taiwan
    // trade API is authoritative and already wins; this only covers gaps).
    for (const [k, v] of Object.entries(GEM_TW)) if (v && !map[k]) map[k] = v

    // Language-independent `type`+`disc` pairing. Some items carry a NUMERIC
    // `type` that is identical across locales (e.g. the map-specific "Scrying
    // Orb (Strand)" currency, whose type is a numeric map id and disc is
    // "scrying_orb"). Pair US text -> TW text directly by (type|disc) so the map
    // name in the parentheses gets translated. Gems don't collide here because
    // their `type` is the localized base name (differs between US and TW).
    const twByTypeDisc = new Map<string, string>()
    for (const cat of twCategories) {
      for (const e of cat.entries ?? []) {
        if (e.type && e.disc && e.text) {
          twByTypeDisc.set(`${e.type} ${e.disc}`, e.text.trim())
        }
      }
    }
    for (const cat of usCategories) {
      for (const e of cat.entries ?? []) {
        if (!e.type || !e.disc || !e.text) continue
        let zh = twByTypeDisc.get(`${e.type} ${e.disc}`)
        // Gap-fill: "Scrying Orb (<Map>)" for maps the TW Atlas doesn't
        // carry yet — compose 占卜寶珠 (中文地圖名) from bundled PoeDB names.
        if ((!zh || !hasChinese(zh)) && e.disc === "scrying_orb") {
          const mm = e.text.match(/\(([^)]+)\)\s*$/)
          const mapZh = mm ? SCRYING_MAP_NAMES_TW[normalize(mm[1])] : undefined
          if (mapZh) zh = `${SCRYING_ORB_BASE_TW} (${mapZh})`
        }
        if (zh && hasChinese(zh)) map[normalize(e.text)] = zh
      }
    }

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

    // Beast names (static slug pairing) win over any positional guess.
    for (const k in beastTw) map[k] = beastTw[k]
    // Base-item names the TW trade API lacks (talismans / newer bases),
    // sourced from PoeDB — fill only gaps so real pairings still win.
    for (const k in BASE_NAMES_TW) if (!map[k]) map[k] = BASE_NAMES_TW[k]

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
    for (const [k, v] of Object.entries(map)) cnMap[k] = toSimplified(v)
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
    payload.zhDataVersion = remoteDict?.version || BUNDLED_DATA_VERSION

    await writeStorage(payload)
    console.log(
      `[zh-supp] bilingual tradeitems prepared (${items.length} groups, ` +
        `${Object.keys(reverse).length} reverse entries)`
    )

    // Complete mod-template dictionary (English -> Chinese templates). Fetched
    // and stored SEPARATELY (it is large, ~3MB) so it does not bloat the main
    // write and so we can log success/failure clearly.
    try {
      const res = await fetch(REMOTE_STAT_URL, {
        credentials: "omit",
        cache: "no-cache"
      })
      if (!res.ok) {
        console.warn("[zh-supp] stat templates HTTP", res.status)
      } else {
        const st = (await res.json()) as {
          tw?: Record<string, string>
          cn?: Record<string, string>
        }
        const twTpl = st?.tw || {}
        const cnTpl = st?.cn || {}
        await writeStorage({ zhStatTpl_tw: twTpl, zhStatTpl_cn: cnTpl })
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
