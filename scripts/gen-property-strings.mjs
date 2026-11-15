#!/usr/bin/env node
/**
 * Generate lib/poe-zh-core/property-strings.ts — item property / requirement
 * labels shown in the results popup ("Lasts {0} Seconds", "Physical Damage",
 * "Level", "Str" …) — from the game's ClientStrings table (English + 繁中) in
 * the Taiwan client's Content.ggpk.
 *
 * Key: the English text with every {n} replaced by "{}" (the order the values
 *      appear on the page). Value: the Chinese text whose {i} refers to the i-th
 *      value on the page (the generator re-numbers, since Chinese often reorders:
 *      "Recovers {0} Mana over {1} Seconds" -> "{1} 秒內回復 {0} 魔力").
 *
 * Requires `pathofexile-dat` (MIT) resolvable from this file (see
 * gen-stat-templates.mjs for setup).
 *
 *   node gen-property-strings.mjs <Content.ggpk> <out property-strings.ts>
 */
import fs from 'node:fs'
import { decompressedBundleSize, decompressSliceInBundle, readIndexBundle, getFileInfo } from 'pathofexile-dat/bundles.js'
import { readDatFile, readColumn } from 'pathofexile-dat/dat.js'

const [ggpkPath, outPath] = process.argv.slice(2)
if (!ggpkPath || !outPath) { console.error('usage: node gen-property-strings.mjs <Content.ggpk> <out.ts>'); process.exit(1) }

// ------------------------------------------------------------- GGPK reader
const fd = fs.openSync(ggpkPath, 'r')
const readAt = (pos, len) => { const b = Buffer.alloc(len); fs.readSync(fd, b, 0, len, pos); return b }
const rec = (off) => { const b = readAt(off, 8); return { tag: b.toString('latin1', 4, 8) } }
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
  return { name, data: off + 44 + nl * 2, size: len - 44 - nl * 2 }
}
const listDir = (() => {
  const cache = new Map()
  return (off) => {
    if (cache.has(off)) return cache.get(off)
    const m = new Map()
    for (const k of pdir(off).kids) {
      const t = rec(k).tag
      if (t === 'PDIR') m.set(pdir(k).name.toLowerCase(), { off: k })
      else if (t === 'FILE') { const f = finfo(k); m.set(f.name.toLowerCase(), { off: k, f }) }
    }
    cache.set(off, m); return m
  }
})()
const hdr = readAt(0, 28)
const rootOff = [Number(hdr.readBigUInt64LE(12)), Number(hdr.readBigUInt64LE(20))].find((o) => rec(o).tag === 'PDIR')
const bundles2 = listDir(rootOff).get('bundles2')
const readBundlesFile = (rel) => {
  let cur = bundles2.off; const parts = rel.split('/')
  for (let i = 0; i < parts.length; i++) {
    const e = listDir(cur).get(parts[i].toLowerCase()); if (!e) throw new Error('not in GGPK: ' + rel)
    if (i === parts.length - 1) return new Uint8Array(readAt(e.f.data, e.f.size))
    cur = e.off
  }
}
const unbundle = (bin) => { const o = new Uint8Array(decompressedBundleSize(bin)); decompressSliceInBundle(bin, 0, o); return o }
const index = readIndexBundle(unbundle(readBundlesFile('_.index.bin')))
const readGameFile = (p) => {
  const loc = getFileInfo(p, index.bundlesInfo, index.filesInfo); if (!loc) throw new Error('not in index: ' + p)
  const bin = readBundlesFile(loc.bundle); const o = new Uint8Array(loc.size)
  decompressSliceInBundle(bin, loc.offset, o); return o
}
// ClientStrings: column 0 = Id, column 1 = Text (8-byte string refs).
const clientStrings = (p) => {
  const dat = readDatFile(p, readGameFile(p))
  const [ids, texts] = [0, 8].map((offset) => readColumn({ offset, type: { string: {} } }, dat))
  const m = {}; ids.forEach((id, i) => { m[id] = texts[i] }); return m
}

const en = clientStrings('data/clientstrings.datc64')
const zh = clientStrings('data/traditional chinese/clientstrings.datc64')

// ------------------------------------------------------------- selection
// Only the labels the trade results popup can show.
const PREFIX = /^(ItemDisplay|ItemPopup|WeaponClassDisplayName|ArmourClassDisplayName|SkillPopupCostValue)/
const EXTRA = new Set([
  'Level', 'StrengthShort', 'DexterityShort', 'IntelligenceShort', 'Quality',
  'JewelItemLimit', 'JewelRadiusLabel', 'Experience', 'SortMethodCurrentLevel',
  'PercentageOfBase'
])
const PH = /\{(\d+)\}/g
const out = {}
const ids = Object.keys(en).sort((a, b) => (b.startsWith('ItemDisplay') ? 1 : 0) - (a.startsWith('ItemDisplay') ? 1 : 0))
for (const id of ids) {
  if (!PREFIX.test(id) && !EXTRA.has(id)) continue
  const e = en[id], z = zh[id]
  if (!e || !z || e === z || /\n|</.test(e) || !/[A-Za-z]/.test(e) || /[一-鿿]/.test(e)) continue
  // Positions of {n} in the English = the order values appear on the page.
  const order = [...e.matchAll(PH)].map((m) => m[1])
  const zhNums = [...z.matchAll(PH)].map((m) => m[1]).sort()
  if (order.slice().sort().join() !== zhNums.join()) continue // placeholder sets must match
  const key = e.replace(PH, '{}').replace(/\s+/g, ' ').trim()
  if (key in out) continue
  out[key] = z.replace(PH, (_, n) => `{${order.indexOf(n)}}`)
}

// Skill-gem tags ("Attack, AoE, Melee") — GemTags table, column 1 = display text.
const tags = (p) => {
  const dat = readDatFile(p, readGameFile(p))
  const [ids, texts] = [0, 8].map((offset) => readColumn({ offset, type: { string: {} } }, dat))
  const m = {}; ids.forEach((id, i) => { m[id] = texts[i] }); return m
}
const tagEn = tags('data/gemtags.datc64'), tagZh = tags('data/traditional chinese/gemtags.datc64')
const gemTags = {}
for (const id of Object.keys(tagEn)) if (tagEn[id] && tagZh[id] && tagEn[id] !== tagZh[id]) gemTags[tagEn[id]] = tagZh[id]

const lines = (o) => Object.keys(o).sort().map((k) => `  ${JSON.stringify(k)}: ${JSON.stringify(o[k])}`).join(',\n')
fs.writeFileSync(outPath,
`// GENERATED by scripts/gen-property-strings.mjs from the game's ClientStrings
// and GemTags tables (Taiwan client). Do not edit by hand — re-run the script
// after a patch.
// Key: English label with values as "{}" (page order). Value: Chinese with {i}
// = the i-th value on the page.
export const PROPERTY_STRINGS_TW: Record<string, string> = {
${lines(out)}
}

// Skill-gem tag names (the comma list under a gem's name).
export const GEM_TAGS_TW: Record<string, string> = {
${lines(gemTags)}
}
`)
console.log('wrote', outPath, Object.keys(out).length, 'entries,', Object.keys(gemTags).length, 'gem tags')
