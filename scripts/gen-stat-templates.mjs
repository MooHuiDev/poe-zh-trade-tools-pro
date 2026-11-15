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

// ---------------------------------------------------------------- .csd parse
const parseVariant = (line) => {
  const m = line && line.match(/^\s*(.*?)\s*"((?:[^"\\]|\\.)*)"\s*(.*)$/)
  return m ? { cond: m[1].trim(), text: m[2] } : null
}
const parseCsd = (text) => {
  const lines = text.replace(/^﻿/, '').split(/\r?\n/)
  const out = []; let i = 0
  const readVariants = () => {
    const n = parseInt((lines[i] || '').trim(), 10)
    if (!Number.isFinite(n)) return null
    i++; const v = []
    for (let k = 0; k < n; k++) v.push(parseVariant(lines[i++]))
    return v
  }
  while (i < lines.length) {
    if (/^﻿?description\b/.test(lines[i])) {
      i++
      const ids = (lines[i++] || '').trim().split(/\s+/).slice(1)
      const en = readVariants(); if (!en) continue
      const langs = {}
      while (i < lines.length && /^\s+lang\s+"/.test(lines[i])) {
        const name = lines[i].match(/lang\s+"([^"]+)"/)[1]; i++
        const v = readVariants(); if (v) langs[name] = v
      }
      out.push({ ids, en, langs })
    } else i++
  }
  return out
}

// ---------------------------------------------------------------- key / value
// Display text of the game's inline keyword markup: [Id|Shown] -> Shown, [Id] -> Id.
// Also colour tags like <nemesismod>{{text}} / <unique>{text} -> text.
const stripMarkup = (s) => s
  .replace(/<[a-z_]+>\{\{(.*?)\}\}(?!\})/gi, '$1')
  .replace(/<[a-z_]+>\{([^{}]*)\}/gi, '$1')
  .replace(/\[([^\]|]*)\|([^\]]*)\]/g, '$2').replace(/\[([^\]]*)\]/g, '$1')
// Must match zh-results.content.ts normEn (applied to the rendered English).
const normEn = (s) => s
  .replace(/\[([^\]|]+)(?:\|[^\]]*)?\]/g, '$1')
  .replace(/[+\-]?\d+(?:\.\d+)?/g, '#')
  .toLowerCase()
  .replace(/[^a-z#]/g, '')
// Placeholders are {0}, {0:+d} … and also bare {} (auto-numbered, like a
// format string). A sign only counts when it isn't a range dash after a number.
const PLACEHOLDER = /\{(\d*)(?::[^}]*)?\}/g
const TOKEN = /\{(\d*)(?::[^}]*)?\}|(?:(?<![\d.}])[+\-])?\d+(?:\.\d+)?/g
const tokens = (s) => {
  const res = []; let m, auto = 0; TOKEN.lastIndex = 0
  while ((m = TOKEN.exec(s))) {
    if (m[1] !== undefined) res.push({ t: 'p', i: m[1] === '' ? auto++ : +m[1], s: m.index, e: m.index + m[0].length })
    else res.push({ t: 'l', v: m[0].replace(/^[+\-]/, ''), s: m.index, e: m.index + m[0].length })
  }
  return res
}
// Returns the Chinese line as a "#" template, or null when numbers can't be
// filled in the right order by the runtime.
const mapLine = (en, zh) => {
  // The runtime fills the template's "#"s, left to right, with the numbers of
  // the rendered English line in order. So the Chinese tokens turned into "#"
  // must point at English tokens 0,1,2… in order. A Chinese literal number that
  // isn't next in line (e.g. "每移除100生命…有{0}%") can simply stay literal.
  const E = tokens(en), C = tokens(zh), used = new Array(E.length).fill(false)
  let next = 0, out = '', last = 0
  for (const c of C) {
    const k = c.t === 'p'
      ? E.findIndex((e, j) => !used[j] && e.t === 'p' && e.i === c.i)
      : E.findIndex((e, j) => !used[j] && e.t === 'l' && e.v === c.v)
    let rep = zh.slice(c.s, c.e)
    if (k === next && k >= 0) { used[k] = true; next++; rep = '#' }
    else if (c.t === 'p') return null // placeholder missing or out of order
    out += zh.slice(last, c.s) + rep; last = c.e
  }
  // Every English placeholder must appear, otherwise the value belongs to a
  // different line (e.g. a sentence re-split across "\n" in Chinese).
  if (E.some((e, j) => e.t === 'p' && !used[j])) return null
  // The runtime treats "-#" as a signed placeholder, so a range written "#-#"
  // would swallow the dash ("5-6" -> "56"). Use an en dash for ranges.
  return (out + zh.slice(last)).trim().replace(/#-(?=#)/g, '#–')
}

const LANG = { tw: 'Traditional Chinese', cn: 'Simplified Chinese' }
const gen = { tw: {}, cn: {} }
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
          if (val === null) { stat.skippedNumbers[L]++; return }
          if (!val) return
          if (key in gen[L]) { if (gen[L][key] !== val) stat.conflicts[L]++; return }
          gen[L][key] = val; stat.emitted[L]++
        })
      })
    }
  }
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
  report[L] = r
}
if (VERSION) result.version = VERSION
fs.writeFileSync(outPath, JSON.stringify(result))
log('wrote', outPath, '| tw', Object.keys(result.tw).length, 'cn', Object.keys(result.cn).length)
console.log(JSON.stringify({ stat, report }, null, 1))
