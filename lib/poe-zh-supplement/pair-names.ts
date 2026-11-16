/**
 * Pure English -> Traditional Chinese name pairing for the trade item list.
 * Extracted from build-item-map.ts so it can be unit-tested without fetch /
 * chrome.storage (see tests/pair-names.test.mjs). No imports on purpose: every
 * dictionary it needs is passed in.
 */

export type TradeEntry = {
  name?: string
  text?: string
  type?: string
  flags?: unknown
  disc?: string
}
export type TradeCategory = { id?: string; label?: string; entries?: TradeEntry[] }

export const hasChinese = (value: string) => /[一-鿿]/.test(value)
export const normalize = (value: string) => value.toLowerCase().replace(/[^a-z0-9]/g, "")

export type PairInput = {
  usCategories: TradeCategory[]
  twCategories: TradeCategory[]
  /** Curated dictionary: bundled dict.ts + remote data/unique-names.json. */
  TW_DICT: Record<string, string>
  /** Official gem names (data/gem-names.json). */
  GEM_TW: Record<string, string>
  /** Static-endpoint slug pairing (beasts, fragments, …). */
  beastTw: Record<string, string>
  BASE_NAMES_TW: Record<string, string>
  SCRYING_MAP_NAMES_TW: Record<string, string>
  SCRYING_ORB_BASE_TW: string
}

export function buildTwNameMap(input: PairInput) {
  const {
    usCategories,
    twCategories,
    TW_DICT,
    GEM_TW,
    beastTw,
    BASE_NAMES_TW,
    SCRYING_MAP_NAMES_TW,
    SCRYING_ORB_BASE_TW
  } = input
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

  // Anchors = entries whose Chinese we already know, matched to the same
  // Chinese in the TW list. Every (US index, TW index) candidate is collected
  // (a Chinese name can occur more than once) and the LONGEST chain that
  // increases in both lists is kept (LIS). The old greedy "first match after
  // the previous anchor" could lock onto a wrong duplicate early (e.g. two
  // "To Dust" entries) and then shift every later pairing in the category.
  const alignAnchors = (
    U: TradeEntry[],
    T: TradeEntry[],
    enOf: (e: TradeEntry) => string,
    zhOf: (e: TradeEntry) => string,
    knownZh: (en: string) => string | undefined
  ): Array<{ i: number; j: number }> => {
    const tByZh = new Map<string, number[]>()
    T.forEach((e, j) => {
      const zh = zhOf(e)
      if (!zh) return
      const list = tByZh.get(zh)
      if (list) list.push(j)
      else tByZh.set(zh, [j])
    })
    // Candidates ordered by i ascending, j DESCENDING within the same i, so a
    // strictly increasing subsequence on j uses each i at most once.
    const cands: Array<{ i: number; j: number }> = []
    U.forEach((e, i) => {
      const en = enOf(e)
      const zh = en ? knownZh(en) : undefined
      const js = zh ? tByZh.get(zh) : undefined
      if (js) for (let k = js.length - 1; k >= 0; k--) cands.push({ i, j: js[k] })
    })
    if (!cands.length) return []
    // Patience-sort LIS on j with predecessor links.
    const tails: number[] = [] // index into cands
    const prev = new Array<number>(cands.length).fill(-1)
    for (let c = 0; c < cands.length; c++) {
      let lo = 0
      let hi = tails.length
      while (lo < hi) {
        const mid = (lo + hi) >> 1
        if (cands[tails[mid]].j < cands[c].j) lo = mid + 1
        else hi = mid
      }
      if (lo > 0) prev[c] = tails[lo - 1]
      tails[lo] = c
    }
    const chain: Array<{ i: number; j: number }> = []
    for (let c = tails[tails.length - 1]; c >= 0; c = prev[c]) chain.push(cands[c])
    return chain.reverse()
  }
  // The gaps before, between and after anchors: [usFrom, usTo, twFrom, twTo].
  const segmentsBetween = (
    anchors: Array<{ i: number; j: number }>,
    uLen: number,
    tLen: number
  ) => {
    const segs: Array<[number, number, number, number]> = []
    let p = { i: -1, j: -1 }
    for (const a of anchors) {
      segs.push([p.i + 1, a.i - 1, p.j + 1, a.j - 1])
      p = a
    }
    segs.push([p.i + 1, uLen - 1, p.j + 1, tLen - 1])
    return segs
  }

  // Anchor-aligned pairing (robust to count mismatch). Uses entries whose
  // English we already know a Chinese for (bundled dict or a value already in
  // `map`) as anchors, matches them to the same Chinese in the TW list, then
  // pairs the gap-free EQUAL-length segments between consecutive anchors by
  // index. A segment whose lengths differ (an inserted/removed entry) is just
  // skipped, so one discrepancy never poisons the rest of the category.
  const anchorPairEntries = (U: TradeEntry[], T: TradeEntry[]) => {
    if (!U.length || !T.length) return
    // GEM_TW (official gem names) also anchors, so the gem category aligns
    // even when few gems are already in `map` (e.g. right after a new league).
    const knownZh = (en: string) =>
      TW_DICT[normalize(en)] || map[normalize(en)] || GEM_TW[normalize(en)]
    const anchors = alignAnchors(U, T, fieldOf, fieldOf, (en) =>
      en && !hasChinese(en) ? knownZh(en) : undefined
    )
    if (!anchors.length) return
    for (const [ui0, ui1, tj0, tj1] of segmentsBetween(anchors, U.length, T.length)) {
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
    const nameOf = (e: TradeEntry) => (e.name || "").trim()
    const anchors = alignAnchors(U, T, nameOf, nameOf, (en) => TW_DICT[normalize(en)])
    for (const [ui0, ui1, tj0, tj1] of segmentsBetween(anchors, U.length, T.length)) {
      const uc = ui1 - ui0 + 1
      const tc = tj1 - tj0 + 1
      if (uc <= 0 || uc !== tc) continue // only pair gap-free equal segments
      for (let d = 0; d < uc; d++) {
        const eng = (U[ui0 + d].name || "").trim()
        const zh = (T[tj0 + d].name || "").trim()
        if (!eng || !zh || hasChinese(eng) || !hasChinese(zh)) continue
        // Base-type sanity check: when we already know the base type's Chinese
        // and it doesn't match the TW entry's base, the two aren't the same
        // item (the segment is shifted) — skip rather than guess.
        const usBaseZh = map[normalize(U[ui0 + d].type || "")]
        const twBase = (T[tj0 + d].type || "").trim()
        if (usBaseZh && twBase && usBaseZh !== twBase) continue
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
  // A unique name that exists on SEVERAL bases (e.g. replica / legacy
  // variants, or the same name on different base types) can't tell us which
  // base is which — the first one found was used for all of them, mapping
  // e.g. "Sorcerer Boots" to 絲絨長靴. Only use names with exactly one base
  // in BOTH lists.
  const typesOf = (cats: TradeCategory[]) => {
    const m = new Map<string, Set<string>>()
    for (const cat of cats)
      for (const e of cat.entries ?? []) {
        const nm = (e.name || "").trim()
        const tp = (e.type || "").trim()
        if (!nm || !tp) continue
        if (!m.has(nm)) m.set(nm, new Set())
        m.get(nm)!.add(tp)
      }
    return m
  }
  const twTypes = typesOf(twCategories)
  const usTypes = typesOf(usCategories)
  const twUniqueTypeByName = new Map<string, string>()
  for (const [nm, set] of twTypes) if (set.size === 1) twUniqueTypeByName.set(nm, [...set][0])
  let derivedBases = 0
  for (const cat of usCategories) {
    for (const e of cat.entries ?? []) {
      if (!e.name || !e.type) continue
      if ((usTypes.get(e.name.trim())?.size ?? 0) !== 1) continue
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
  // Fill missing base gem names from GEM_TW BEFORE the disc pairing below, so
  // a transfigured gem can still be paired when its base gem wasn't paired by
  // position (the pairing looks the base up in `map`).
  for (const [k, v] of Object.entries(GEM_TW)) if (v && !map[k]) map[k] = v

  // Unique items (with a `name`) are skipped on both sides: unique maps all
  // share base "Map" + the same disc, so this pairing collapsed every unique
  // map onto one Chinese name ("禁閉祭壇 地圖"). Ambiguous keys are skipped too.
  const twTextByTypeDisc = new Map<string, string>()
  const twTextCount = new Map<string, number>()
  for (const cat of twCategories) {
    for (const e of cat.entries ?? []) {
      if (e.disc && e.type && e.text && !e.name) {
        const k = `${e.type.trim()} ${e.disc}`
        twTextByTypeDisc.set(k, e.text.trim())
        twTextCount.set(k, (twTextCount.get(k) ?? 0) + 1)
      }
    }
  }
  for (const [k, n] of twTextCount) if (n > 1) twTextByTypeDisc.delete(k)
  let discPaired = 0
  for (const cat of usCategories) {
    for (const e of cat.entries ?? []) {
      if (!e.disc || !e.type || !e.text || e.name) continue
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


  // Fill any missing TW gem names from the PoeDB gem dictionary (the Taiwan
  // trade API is authoritative and already wins; this only covers gaps).
  for (const [k, v] of Object.entries(GEM_TW)) if (v && !map[k]) map[k] = v

  // Language-independent `type`+`disc` pairing. Some items carry a NUMERIC
  // `type` that is identical across locales (e.g. the map-specific "Scrying
  // Orb (Strand)" currency, whose type is a numeric map id and disc is
  // "scrying_orb"). Pair US text -> TW text directly by (type|disc) so the map
  // name in the parentheses gets translated. Gems don't collide here because
  // their `type` is the localized base name (differs between US and TW).
  // Only pair when (type|disc) identifies ONE entry on each side. Unique maps
  // share type "Map" + the same disc, so they all collapsed onto one Chinese
  // name (every unique map showed "禁閉祭壇 地圖"). Those are left to the
  // unique-name dictionary instead.
  const countTypeDisc = (cats: TradeCategory[]) => {
    const c = new Map<string, number>()
    for (const cat of cats)
      for (const e of cat.entries ?? [])
        if (e.type && e.disc && e.text) {
          const k = `${e.type} ${e.disc}`
          c.set(k, (c.get(k) ?? 0) + 1)
        }
    return c
  }
  const usTypeDiscCount = countTypeDisc(usCategories)
  const twTypeDiscCount = countTypeDisc(twCategories)
  const twByTypeDisc = new Map<string, string>()
  for (const cat of twCategories) {
    for (const e of cat.entries ?? []) {
      if (e.type && e.disc && e.text) {
        const k = `${e.type} ${e.disc}`
        if (twTypeDiscCount.get(k) === 1) twByTypeDisc.set(k, e.text.trim())
      }
    }
  }
  for (const cat of usCategories) {
    for (const e of cat.entries ?? []) {
      if (!e.type || !e.disc || !e.text) continue
      if (usTypeDiscCount.get(`${e.type} ${e.disc}`) !== 1) continue
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

  // Beast names (static slug pairing) win over any positional guess.
  for (const k in beastTw) map[k] = beastTw[k]
  // Base-item names the TW trade API lacks (talismans / newer bases),
  // sourced from PoeDB — fill only gaps so real pairings still win.
  for (const k in BASE_NAMES_TW) if (!map[k]) map[k] = BASE_NAMES_TW[k]
  // The curated dictionary (bundled + remote data/unique-names.json, which
  // also carries every base-type name read from the game files) is the final
  // word: it fills names the pairing missed and overrides anything a
  // positional / derived pairing produced differently. This also lets a wrong
  // automatic pairing be corrected by a data push alone (no release).
  const keysBeforeDict = new Set(Object.keys(map))
  for (const k in TW_DICT) if (TW_DICT[k]) map[k] = TW_DICT[k]

  return {
    map,
    derivedUnique,
    keysBeforeDict,
    stats: { matchedSubsets, derivedBases, discPaired }
  }
}
