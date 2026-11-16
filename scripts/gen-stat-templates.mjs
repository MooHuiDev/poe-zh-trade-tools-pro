#!/usr/bin/env node
/**
 * Generate data/stat-templates.json (mod-line dictionary: normalized English
 * template -> Traditional / Simplified Chinese template) straight from the game
 * files of the Garena (Taiwan) Path of Exile client.
 *
 * WHY
 *   The result page translates every mod line by matching the rendered English
 *   against this dictionary (entrypoints/zh-results.content.ts, translateByTemplate).
 *   Each league adds new mods, so the dictionary must be regenerated per patch.
 *   The Taiwan client's stat description files contain English AND Traditional
 *   Chinese AND Simplified Chinese (plus 8 other languages) in one file, so the
 *   Taiwan client alone is enough.
 *
 * REQUIREMENTS
 *   - Node >= 22
 *   - `pathofexile-dat` + `ooz-wasm` (MIT, SnosMe/poe-dat-viewer) resolvable from
 *     THIS file's location. Easiest: copy this script into a scratch folder and
 *     run `npm init -y && npm install pathofexile-dat ooz-wasm` there.
 *   - The Taiwan client's Content.ggpk (read-only; nothing is written to it).
 *
 * USAGE
 *   node gen-stat-templates.mjs <Content.ggpk> <existing stat-templates.json> \
 *        <stat-overrides.json> <out stat-templates.json> [--version 3.30] [--update]
 *
 *   Merge policy (safe by default):
 *     1. Start from the EXISTING dictionary.
 *     2. ADD every generated key that is missing.
 *     3. Keys present in both with a different value: kept as-is by default and
 *        only reported; pass --update to take the generated value instead.
 *     4. ALWAYS apply stat-overrides.json last — hand-curated fixes (e.g. official
 *        mistranslations, digit-order fixes, gem-name normalization) win.
 *
 * SAFETY RULE FOR NUMBERS
 *   The runtime fills the k-th "#" of a template with the k-th number found in the
 *   rendered English line. So a line is only emitted when the Chinese line's
 *   number tokens map, in order, onto the FIRST tokens of the English line
 *   (placeholders by index, literal numbers by value). Otherwise the line is
 *   skipped (left to the existing dictionary) instead of risking a wrong number.
 */
import fs from 'node:fs'
import {
  decompressedBundleSize,
  decompressSliceInBundle,
  readIndexBundle,
  getDirContent,
  getFileInfo
} from 'pathofexile-dat/bundles.js'
import { readDatFile, readColumn } from 'pathofexile-dat/dat.js'

const [ggpkPath, existingPath, overridesPath, outPath, ...flags] = process.argv.slice(2)
if (!ggpkPath || !existingPath || !overridesPath || !outPath) {
  console.error('usage: node gen-stat-templates.mjs <Content.ggpk> <existing.json> <overrides.json> <out.json> [--version X] [--update]')
  process.exit(1)
}
const UPDATE = flags.includes('--update')
const vIdx = flags.indexOf('--version')
const VERSION = vIdx >= 0 ? flags[vIdx + 1] : null
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a)

// ---------------------------------------------------------------- GGPK (v3)
const fd = fs.openSync(ggpkPath, 'r')
const readAt = (pos, len) => { const b = Buffer.alloc(len); fs.readSync(fd, b, 0, len, pos); return b }
const rec = (off) => { const b = readAt(off, 8); return { len: b.readUInt32LE(0), tag: b.toString('latin1', 4, 8) } }
const pdir = (off) => {
  const h = readAt(off, 16); const nl = h.readUInt32LE(8), cnt = h.readUInt32LE(12)
  const name = readAt(off + 48, nl * 2).toString('utf16le').replace(/\0+$/, '')
  const eb = readAt(off + 48 + nl * 2, cnt * 12); const kids = []
  for (let i = 0; i < cnt; i++) kids.push(Number(eb.readBigUInt64LE(i * 12 + 4)))
  return { name, kids }
}
const finfo = (off) => {
  const h = readAt(off, 12); const len = h.readUInt32LE(0), nl = h.readUInt32LE(8)
  const name = readAt(off + 44, nl * 2).toString('utf16le').replace(/\0+$/, '')
  const hdr = 44 + nl * 2; return { name, data: off + hdr, size: len - hdr }
}
const nameOf = (off) => {
  const r = rec(off)
  if (r.tag === 'PDIR') return { n: pdir(off).name, d: true, off }
  if (r.tag === 'FILE') { const f = finfo(off); return { n: f.name, d: false, off, f } }
  return null
}
const hdr = readAt(0, 28)
if (hdr.toString('latin1', 4, 8) !== 'GGPK') throw new Error('not a GGPK file')
const rootOff = [Number(hdr.readBigUInt64LE(12)), Number(hdr.readBigUInt64LE(20))].find((o) => rec(o).tag === 'PDIR')
const dirCache = new Map()
const listDir = (off) => {
  if (dirCache.has(off)) return dirCache.get(off)
  const m = new Map(); for (const k of pdir(off).kids) { const x = nameOf(k); if (x) m.set(x.n.toLowerCase(), x) }
  dirCache.set(off, m); return m
}
const bundles2 = listDir(rootOff).get('bundles2')
if (!bundles2) throw new Error('Bundles2 not found in GGPK')
// Lazy: walk only the path components we need (walking all of Bundles2 is slow).
const readBundlesFile = (rel) => {
  let cur = bundles2.off; const parts = rel.split('/')
  for (let i = 0; i < parts.length; i++) {
    const e = listDir(cur).get(parts[i].toLowerCase())
    if (!e) throw new Error('not in GGPK: Bundles2/' + rel)
    if (i === parts.length - 1) return new Uint8Array(readAt(e.f.data, e.f.size))
    cur = e.off
  }
}
const unbundle = (bin) => { const out = new Uint8Array(decompressedBundleSize(bin)); decompressSliceInBundle(bin, 0, out); return out }

log('reading index…')
const index = readIndexBundle(unbundle(readBundlesFile('_.index.bin')))
const pathReps = unbundle(index.pathRepsBundle)
const csdFiles = getDirContent('metadata/statdescriptions', pathReps, index.dirsInfo)
  .files.filter((f) => f.endsWith('.csd'))
  .sort((a, b) => (a.endsWith('/stat_descriptions.csd') ? -1 : b.endsWith('/stat_descriptions.csd') ? 1 : a.localeCompare(b)))
log('stat description files:', csdFiles.length)

const bundleCache = new Map()
const readGameFile = (p) => {
  const loc = getFileInfo(p, index.bundlesInfo, index.filesInfo)
  if (!loc) throw new Error('not in index: ' + p)
  let bin = bundleCache.get(loc.bundle)
  if (!bin) { bin = readBundlesFile(loc.bundle); bundleCache.set(loc.bundle, bin) }
  const out = new Uint8Array(loc.size); decompressSliceInBundle(bin, loc.offset, out); return out
}

import { parseCsd, stripMarkup, normEn, PLACEHOLDER, mapLine, mapLineIdx } from './lib/stat-line.mjs'

const LANG = { tw: 'Traditional Chinese', cn: 'Simplified Chinese' }
const gen = { tw: {}, cn: {} }
const genIdx = { tw: {}, cn: {} }
// Combined multi-line key -> its single-line keys (see the merge step).
const combinedParts = { tw: {}, cn: {} }
const stat = { descriptions: 0, lines: 0, emitted: { tw: 0, cn: 0 }, skippedNumbers: { tw: 0, cn: 0 }, skippedLines: { tw: 0, cn: 0 }, conflicts: { tw: 0, cn: 0 } }

for (const file of csdFiles) {
  const text = Buffer.from(readGameFile(file)).toString('utf16le')
  const descs = parseCsd(text)
  stat.descriptions += descs.length
  for (const d of descs) {
    for (const [L, langName] of Object.entries(LANG)) {
      const zhVars = d.langs[langName]; if (!zhVars) continue
      const byCond = new Map(zhVars.filter(Boolean).map((v) => [v.cond, v]))
      d.en.forEach((ev, k) => {
        if (!ev || !ev.text) return
        // "[DNT]" = GGG's "do not translate": internal / unused, never shown.
        if (ev.text.startsWith('[DNT]')) return
        const conds = (ev.cond || '').trim().split(/\s+/)
        const zv = zhVars.length === d.en.length ? zhVars[k] : byCond.get(ev.cond)
        if (!zv || !zv.text) return
        const enLines = stripMarkup(ev.text).split('\\n')
        const zhLines = stripMarkup(zv.text).split('\\n')
        if (enLines.length !== zhLines.length) { stat.skippedLines[L] += enLines.length; return }
        // Multi-line stats: also store the whole text as ONE template (key keeps
        // the line break as "n", value keeps "\\n"). The results page tries these
        // first, so lines that only make sense together (Chinese often reorders
        // the halves) still translate.
        if (enLines.length > 1) {
          const enFull = enLines.join('\\n'), zhFull = zhLines.join('\\n')
          const key = normEn(enFull.replace(PLACEHOLDER, '#'))
          const val = mapLine(enFull, zhFull)
          if (key && val === null && !(key in genIdx[L])) {
            const iv = mapLineIdx(enFull, zhFull, conds)
            if (iv) genIdx[L][key] = iv
          }
          if (key && val) {
            if (!(key in gen[L])) {
              gen[L][key] = val; stat.emitted[L]++
              combinedParts[L][key] = enLines.map((l) => normEn(l.replace(PLACEHOLDER, '#')))
            } else if (gen[L][key] !== val) stat.conflicts[L]++
          }
        }
        enLines.forEach((enLine, j) => {
          if (L === 'tw') stat.lines++
          const key = normEn(enLine.replace(PLACEHOLDER, '#'))
          if (!key || key === '#') return
          const val = mapLine(enLine, zhLines[j])
          if (val === null) {
            stat.skippedNumbers[L]++
            if (!(key in genIdx[L])) {
              const iv = mapLineIdx(enLine, zhLines[j], conds)
              if (iv) genIdx[L][key] = iv
            }
            return
          }
          if (!val) return
          if (key in gen[L]) { if (gen[L][key] !== val) stat.conflicts[L]++; return }
          gen[L][key] = val; stat.emitted[L]++
        })
      })
    }
  }
}
// Mod names shown as whole lines on itemised beasts ("Fertile Presence" ->
// 豐富光環). Mods table: Id @0, Domain @94 (3 = monster), Name @98. Only the
// Bestiary* monster mods (other monster mods are affix names like "of Flames"
// that never appear as a line), only names with one Chinese, never over a real
// stat key.
// Traditional only (no Simplified mod names in the game files).
{
  const read = (p) => readDatFile(p, readGameFile(p))
  const E = read('data/mods.datc64'), Z = read('data/traditional chinese/mods.datc64')
  const col = (dat, offset, type) => readColumn({ offset, type }, dat)
  const en = col(E, 98, { string: {} }), zh = col(Z, 98, { string: {} })
  const dom = col(E, 94, { integer: { unsigned: false, size: 4 } })
  const ids = col(E, 0, { string: {} })
  const names = {}, amb = new Set()
  en.forEach((e, i) => {
    if (dom[i] !== 3 || !/^Bestiary/.test(ids[i] || '') || !e || !zh[i] || e === zh[i] || !/[\u4e00-\u9fff]/.test(zh[i]) || /\d/.test(e)) return
    if (names[e] && names[e] !== zh[i]) amb.add(e)
    names[e] = zh[i]
  })
  for (const a of amb) delete names[a]
  let added = 0
  if (Object.keys(names).length >= 10) { // sanity: column layout still as expected
    for (const [e, z] of Object.entries(names)) {
      const key = normEn(e)
      if (!key || key in gen.tw) continue
      gen.tw[key] = z; added++
    }
  } else log('⚠ mods.datc64 layout changed? monster mod names skipped')
  log('monster mod names added:', added)
}
// Archnemesis modifiers on itemised beasts: some show their name ("Hasted" ->
// 急速), some their effect text ("Extra Fire Damage and Exposure" ->
// 額外火焰傷害和曝曬). ArchnemesisMods: name @16, effect text @48. Same rules
// as above; only plain English words/phrases.
{
  const read = (p) => readDatFile(p, readGameFile(p))
  const E = read('data/archnemesismods.datc64'), Z = read('data/traditional chinese/archnemesismods.datc64')
  const en = [], zh = []
  for (const offset of [16, 48]) {
    en.push(...readColumn({ offset, type: { string: {} } }, E))
    zh.push(...readColumn({ offset, type: { string: {} } }, Z))
  }
  const names = {}, amb = new Set()
  en.forEach((e, i) => {
    if (e && !/^[A-Za-z][A-Za-z ,'-]*$/.test(e)) return
    if (!e || !zh[i] || e === zh[i] || !/[\u4e00-\u9fff]/.test(zh[i]) || /\d/.test(e)) return
    if (names[e] && names[e] !== zh[i]) amb.add(e)
    names[e] = zh[i]
  })
  for (const a of amb) delete names[a]
  let added = 0
  if (Object.keys(names).length >= 20) {
    for (const [e, z] of Object.entries(names)) {
      const key = normEn(e)
      if (!key || key in gen.tw) continue
      gen.tw[key] = z; added++
    }
  } else log('⚠ archnemesismods.datc64 layout changed? skipped')
  log('archnemesis names / effect texts added:', added)
}
// Other game texts that show up on trade result cards outside the mod lines:
// affix names (Heavy / of Renown), gem descriptions, currency descriptions,
// corpse implicits, flavour text, NPC / area / faction names, interface
// labels … (English -> 繁中 by row, same column). Kept in a SEPARATE map
// `twText` — the results page uses it for text that isn't a mod line; older
// extension versions never read it. Traditional only (no Simplified tables).
const genText = {}
{
  const SOURCES = [
    ['data/mods.datc64', 98],            // affix / mod names
    ['data/itemisedcorpse.datc64', 32],  // corpse implicits
    ['data/currencyitems.datc64', 56],   // currency / divination descriptions
    ['data/activeskills.datc64', 8],     // skill names
    ['data/activeskills.datc64', 16],    // skill gem descriptions
    ['data/gemeffects.datc64', 8],       // gem names
    ['data/gemeffects.datc64', 80],      // support gem descriptions
    ['data/worldareas.datc64', 8],       // area names (logbooks …)
    ['data/expeditionfactions.datc64', 8],
    ['data/npcs.datc64', 8],
    ['data/npcs.datc64', 56],
    ['data/heistobjectives.datc64', 20],
    ['data/mercenarybuilds.datc64', 142],
    ['data/flavourtext.datc64', 12],     // divination card / unique flavour
    ['data/clientstrings.datc64', 8],    // interface labels
    ['data/clientstrings2.datc64', 8]
  ]
  const read = (p) => readDatFile(p, readGameFile(p))
  // key -> { zh -> count }: when the same English has different Chinese in
  // different tables, keep the most common one (a few tables reword slightly).
  const seen = {}
  let pairs = 0
  for (const [file, offset] of SOURCES) {
    let en, zh
    try {
      en = readColumn({ offset, type: { string: {} } }, read(file))
      zh = readColumn({ offset, type: { string: {} } }, read(file.replace('data/', 'data/traditional chinese/')))
    } catch (e) { log('⚠ text source skipped:', file, e.message); continue }
    en.forEach((e, i) => {
      const z = zh[i]
      if (!e || !z || e === z || !/[\u4e00-\u9fff]/.test(z) || !/[A-Za-z]{2}/.test(e)) return
      if (/^Metadata|[\\/_]/.test(e)) return // ids, paths
      // Flavour text is wrapped as "<size:27>{…}"; [Keyword|Text] markup is
      // resolved by stripMarkup (the site shows the plain text).
      const unwrap = (s) => stripMarkup(s.replace(/<[a-z_]+:\d+>\s*\{([^{}]*)\}/gi, '$1'))
      const el = unwrap(e).split(/\r?\n/), zl = unwrap(z).split(/\r?\n/)
      // Multi-line text (card flavour) is shown in ONE text node: also key the
      // whole text, so lines that break differently in Chinese still match.
      const whole = [[el.map((s) => s.trim()).join(' '), zl.map((s) => s.trim()).filter(Boolean).join(el.length > 1 ? '\n' : '')]]
      const pairsOf = el.length === zl.length
        ? [...el.map((l, j) => [l, zl[j]]), ...(el.length > 1 ? whole : [])]
        : whole
      pairsOf.forEach(([line, zl2]) => {
        const l = line.trim(), zline = zl2.trim()
        // {0} placeholders are fine (mapLine turns them into #); long skill
        // descriptions are fine too — only markup is rejected.
        if (!l || !zline || l.length > 1000 || !/[A-Za-z]{2}/.test(l)) return
        const noPh = (s) => s.replace(/\{\d+(?::[^{}]*)?\}/g, '')
        if (/[<>{}\[\]|]/.test(noPh(zline)) || /[\[\]|]/.test(l)) return
        const key = normEn(l.replace(PLACEHOLDER, '#'))
        if (!key || key.length < 3 || key === '#') return
        let v = mapLine(l, zline)
        if (!v) return
        // Chinese label with a colon the English doesn't have ("Build" ->
        // "流派：") would double up with the site's own ": ".
        if (!/[:：]\s*$/.test(l)) v = v.replace(/\s*[:：]\s*$/, '')
        if (!v || !/[一-鿿]/.test(v)) return // quotes / names left in English
        ;(seen[key] ??= {})[v] = (seen[key][v] || 0) + 1; pairs++
      })
    })
  }
  let multi = 0
  for (const [k, m] of Object.entries(seen)) {
    const best = Object.entries(m).sort((a, b) => b[1] - a[1])
    if (best.length > 1) multi++
    genText[k] = best[0][0]
  }
  log('other game texts:', Object.keys(genText).length, '(with several translations, most common kept:', multi + ')')
}

log('parsed descriptions:', stat.descriptions, '| english lines:', stat.lines)
log('generated keys tw/cn:', Object.keys(gen.tw).length, Object.keys(gen.cn).length)

// ---------------------------------------------------------------- merge
const existing = JSON.parse(fs.readFileSync(existingPath, 'utf8'))
const overrides = JSON.parse(fs.readFileSync(overridesPath, 'utf8'))
const report = {}
const result = { ...existing }
for (const L of ['tw', 'cn']) {
  const base = { ...(existing[L] || {}) }
  const r = { added: 0, same: 0, differs: 0, updated: 0, overridden: 0, sampleDiffs: [] }
  r.skippedCombined = 0
  for (const [k, v] of Object.entries(gen[L])) {
    // The results page tries a combined multi-line template BEFORE single lines,
    // so a new combined entry would hide a hand fix on one of its lines (e.g.
    // Putrid Seed "四個" vs the official "一個"). Leave those to the single lines.
    const parts = combinedParts[L][k]
    if (parts && !(k in base) && parts.some((p) => overrides[L] && p in overrides[L])) { r.skippedCombined++; continue }
    if (!(k in base)) { base[k] = v; r.added++ }
    else if (base[k] === v) r.same++
    else {
      r.differs++
      if (r.sampleDiffs.length < 12) r.sampleDiffs.push([k, base[k], v])
      // Never trade a value for one with fewer numbers (likely a partial line).
      const n = (s) => (s.match(/#/g) || []).length
      if (UPDATE && !(overrides[L] && k in overrides[L]) && n(v) >= n(base[k])) { base[k] = v; r.updated++ }
    }
  }
  for (const [k, v] of Object.entries(overrides[L] || {})) { if (base[k] !== v) r.overridden++; base[k] = v }
  // Keys a hand fix deliberately deleted (e.g. a multi-line template split into
  // single lines) must not be re-added by regeneration.
  r.removed = 0
  for (const k of (overrides.remove && overrides.remove[L]) || []) { if (k in base) { delete base[k]; r.removed++ } }
  result[L] = base
  // Indexed templates: regenerated from scratch each run, only for keys that
  // have no regular template (the regular map always wins at runtime too).
  const idx = {}
  // (skip keys with "##": two adjacent placeholders are names, not numbers)
  for (const [k, v] of Object.entries(genIdx[L])) if (!(k in base) && !k.includes('##')) idx[k] = v
  result[L + 'Idx'] = idx
  // Hand-added texts (no game source, or the game splits a line differently
  // than the site) — applied last, like the other overrides.
  if (L === 'tw') result.twText = { ...genText, ...(overrides.twText || {}) }
  r.indexed = Object.keys(idx).length
  // Reminder: lines we translated by hand because the official text had no
  // Chinese (overrides.manualOnly). Once the game ships an official translation
  // the generator now produces one — list it so the maintainer can decide.
  r.officialNowAvailable = ((overrides.manualOnly && overrides.manualOnly[L]) || [])
    .filter((k) => k in gen[L] || k in genIdx[L])
    .map((k) => ({ key: k, ours: (overrides[L] || {})[k], official: gen[L][k] ?? genIdx[L][k] }))
  report[L] = r
}
if (VERSION) result.version = VERSION
fs.writeFileSync(outPath, JSON.stringify(result))
log('wrote', outPath, '| tw', Object.keys(result.tw).length, 'cn', Object.keys(result.cn).length,
  '| indexed tw', Object.keys(result.twIdx).length, 'cn', Object.keys(result.cnIdx).length)
for (const L of ['tw', 'cn']) {
  for (const o of report[L].officialNowAvailable) {
    log(`⚠ [${L}] official translation now available for a hand-translated line:`, o.key)
    log('    ours    :', o.ours)
    log('    official:', o.official)
  }
}
console.log(JSON.stringify({ stat, report }, null, 1))
