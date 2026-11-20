#!/usr/bin/env node
/**
 * One command after every game patch: regenerate all game-file data, check it,
 * and write a report. Read-only on the game clients.
 *
 *   pnpm run update-data -- --tw "D:\GGG\Content.ggpk" [--global "D:\PoE_Global\Content.ggpk"]
 *                           [--cn "D:\Poe_CN\流放之路(511)\Bundles2"]
 *   --cn: the Tencent 国服 client's Bundles2 folder (no Content.ggpk). All
 *         Simplified Chinese (cn, cnIdx, cnText, cn property lines, cn base
 *         names) then comes from it.
 *                           [--version 3.30.0b] [--write]
 *
 * Without --write it's a dry run: everything is generated into a temp folder
 * and only the report is written. With --write the results replace the repo
 * files, then the unit tests run; if any test fails every file is restored.
 *
 * Steps
 *   1. data/stat-templates.json   (scripts/gen-stat-templates.mjs)
 *   2. lib/poe-zh-core/property-strings.ts (scripts/gen-property-strings.mjs)
 *   3. data/unique-names.json     — unique + base-type names from the game
 *      files: missing names are added, differing ones only reported
 *   4. Taiwan vs international client: same game data?
 *   5. unit tests (with --write)
 * Report: GAME-DATA-UPDATE.local.md (gitignored).
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import crypto from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(HERE, '..')
const P = {
  stat: path.join(ROOT, 'data/stat-templates.json'),
  overrides: path.join(ROOT, 'scripts/stat-overrides.json'),
  props: path.join(ROOT, 'lib/poe-zh-core/property-strings.ts'),
  propsCn: path.join(ROOT, 'lib/poe-zh-core/property-strings-cn.ts'),
  names: path.join(ROOT, 'data/unique-names.json'),
  report: path.join(ROOT, 'GAME-DATA-UPDATE.local.md')
}
// Names where the dictionary deliberately differs from the game files
// (checked against the official Taiwan market).
const NAME_KEEP = new Set(['titucusspan', 'todust', 'wildfire'])

// ------------------------------------------------------------------ args
const args = process.argv.slice(2)
const opt = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined }
const TW = opt('--tw'), GLOBAL = opt('--global'), CN = opt('--cn'), VERSION = opt('--version'), WRITE = args.includes('--write')
if (!TW) {
  console.error('usage: pnpm run update-data -- --tw <TW Content.ggpk> [--global <intl Content.ggpk>] [--cn <国服 Bundles2 folder>] [--version X] [--write]')
  process.exit(1)
}
for (const f of [TW, GLOBAL].filter(Boolean)) if (!fs.existsSync(f)) { console.error('not found:', f); process.exit(1) }

let openGgpk
try {
  ;({ openGgpk } = await import('./lib/ggpk.mjs'))
} catch {
  console.error('Missing dev dependencies. Run `pnpm install` first (needs pathofexile-dat + ooz-wasm).')
  process.exit(1)
}

const t0 = Date.now()
const log = (...a) => console.log(`[${((Date.now() - t0) / 1000).toFixed(0).padStart(3)}s]`, ...a)
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'pztt-update-'))
const out = { stat: path.join(TMP, 'stat-templates.json'), props: path.join(TMP, 'property-strings.ts'), propsCn: path.join(TMP, 'property-strings-cn.ts'), names: path.join(TMP, 'unique-names.json') }
const R = [] // report lines
const fail = (msg) => { console.error('✖', msg); fs.writeFileSync(P.report, R.join('\n') + `\n\n**FAILED:** ${msg}\n`); process.exit(1) }

const runNode = (script, scriptArgs) => {
  const r = spawnSync(process.execPath, [path.join(HERE, script), ...scriptArgs], { encoding: 'utf8', maxBuffer: 64 << 20 })
  if (r.status !== 0) fail(`${script} failed:\n${r.stderr || r.stdout}`)
  return r.stdout
}
const sample = (arr, n = 15) => arr.slice(0, n).map((x) => `  - ${x}`).concat(arr.length > n ? [`  - … (+${arr.length - n})`] : [])

R.push(`# Game data update — ${new Date().toISOString().slice(0, 16).replace('T', ' ')}`, '',
  `- TW client: \`${TW}\``, GLOBAL ? `- International client: \`${GLOBAL}\`` : '- International client: (not given)',
  `- Mode: ${WRITE ? '**write**' : 'dry run (nothing written except this report)'}`, VERSION ? `- Data version: ${VERSION}` : '', '')

// ------------------------------------------------------------------ 1. mod lines
log('1/5 mod lines (stat-templates)…')
const statStdout = runNode('gen-stat-templates.mjs', [TW, P.stat, P.overrides, out.stat, '--update', ...(VERSION ? ['--version', VERSION] : []), ...(CN ? ['--cn', CN] : [])])
let statReport = {}
try { statReport = JSON.parse(statStdout.slice(statStdout.lastIndexOf('\n{') + 1)).report || {} } catch { /* keep going */ }
{
  const a = JSON.parse(fs.readFileSync(P.stat, 'utf8')), b = JSON.parse(fs.readFileSync(out.stat, 'utf8'))
  R.push('## 1. Mod lines — data/stat-templates.json', '')
  for (const L of ['tw', 'cn', 'twIdx', 'cnIdx', 'twText', 'cnText']) {
    const A = a[L] || {}, B = b[L] || {}
    const added = Object.keys(B).filter((k) => !(k in A)), removed = Object.keys(A).filter((k) => !(k in B))
    const changed = Object.keys(B).filter((k) => k in A && A[k] !== B[k])
    R.push(`- **${L}**: ${Object.keys(B).length} lines — added ${added.length}, changed ${changed.length}, removed ${removed.length}`)
    R.push(...sample(added.map((k) => `+ \`${k}\` → ${B[k]}`), 10))
    R.push(...sample(changed.map((k) => `~ \`${k}\`: ${A[k]} → ${B[k]}`), 10))
  }
  for (const L of ['tw', 'cn']) {
    const official = statReport[L]?.officialNowAvailable || []
    if (official.length) {
      R.push('', `### ⚠ ${L}: the game now has an official translation for a line we translated by hand`,
        'Decide which to keep, then remove the key from `manualOnly` (and `tw`/`cn`) in scripts/stat-overrides.json if you switch to the official one.')
      for (const o of official) R.push(`- \`${o.key}\`  ours: ${o.ours}  /  official: ${o.official}`)
    }
  }
  R.push('')
}

// ------------------------------------------------------------------ 2. property lines
log('2/5 property lines…')
runNode('gen-property-strings.mjs', [TW, out.props, ...(CN ? ['--cn', CN, out.propsCn] : [])])
{
  const keys = (f) => new Map([...fs.readFileSync(f, 'utf8').matchAll(/^\s+("(?:[^"\\]|\\.)*"): ("(?:[^"\\]|\\.)*")/gm)].map((m) => [JSON.parse(m[1]), JSON.parse(m[2])]))
  const A = keys(P.props), B = keys(out.props)
  const added = [...B.keys()].filter((k) => !A.has(k)), removed = [...A.keys()].filter((k) => !B.has(k))
  const changed = [...B.keys()].filter((k) => A.has(k) && A.get(k) !== B.get(k))
  R.push('## 2. Property lines — lib/poe-zh-core/property-strings.ts', '',
    `- ${B.size} entries — added ${added.length}, changed ${changed.length}, removed ${removed.length}`,
    ...sample(added.map((k) => `+ ${k} → ${B.get(k)}`), 10), ...sample(changed.map((k) => `~ ${k}: ${A.get(k)} → ${B.get(k)}`), 10),
    added.length || changed.length || removed.length ? '- ⚠ This file is bundled: changes need an extension release.' : '', '')
}

// ------------------------------------------------------------------ 3. names
log('3/5 unique + base names…')
{
  const g = openGgpk(TW)
  const norm = (s) => s.toLowerCase().replace(/[^a-z0-9]/g, '')
  const zh = (s) => /[\u4e00-\u9fff]/.test(s || '')
  const collect = (pairs) => {
    const m = new Map()
    for (const [en, z] of pairs) {
      if (!en || !zh(z) || /^\[|^Unused|^\[DNT/.test(en)) continue
      const k = norm(en); if (!k) continue
      if (!m.has(k)) m.set(k, new Set()); m.get(k).add(z)
    }
    return m
  }
  const wl = g.column('data/words.datc64', 0, { integer: { unsigned: false, size: 4 } })
  const wEn = g.column('data/words.datc64', 4), wZh = g.column('data/traditional chinese/words.datc64', 48)
  const uniques = collect(wEn.map((e, i) => (wl[i] === 6 ? [e, wZh[i]] : [])))
  const bEn = g.column('data/baseitemtypes.datc64', 32), bZh = g.column('data/traditional chinese/baseitemtypes.datc64', 32)
  const bases = collect(bEn.map((e, i) => [e, bZh[i]]))
  if (uniques.size < 1000 || bases.size < 3000) fail(`name tables look wrong (uniques ${uniques.size}, bases ${bases.size}) — game file layout changed?`)

  const dict = JSON.parse(fs.readFileSync(P.names, 'utf8'))
  const tw = { ...dict.tw }
  const added = [], differs = [], kept = []
  const consider = (k, set, kind) => {
    if (set.size !== 1) return
    const z = [...set][0]
    if (!(k in tw)) { tw[k] = z; added.push(`${kind} \`${k}\` → ${z}`) }
    else if (tw[k] !== z) (NAME_KEEP.has(k) ? kept : differs).push(`${kind} \`${k}\`: ours ${tw[k]} / game ${z}`)
  }
  for (const [k, s] of uniques) consider(k, s, 'unique')
  for (const [k, s] of bases) if (!uniques.has(k)) consider(k, s, 'base')
  const next = { ...dict, tw: Object.fromEntries(Object.entries(tw).sort(([a], [b]) => a.localeCompare(b))) }
  if (VERSION) next.version = VERSION
  fs.writeFileSync(out.names, JSON.stringify(next, null, 1))
  R.push('## 3. Names — data/unique-names.json', '',
    `- game: ${uniques.size} uniques, ${bases.size} base types · dictionary: ${Object.keys(dict.tw).length} → ${Object.keys(tw).length}`,
    `- added (new in the game): ${added.length}`, ...sample(added, 20),
    `- **differs from the game, NOT changed (check the Taiwan market):** ${differs.length}`, ...sample(differs, 30),
    `- intentionally different (NAME_KEEP): ${kept.length}`, '')
}

// ------------------------------------------------------------------ 4. TW vs international
log('4/5 Taiwan vs international client…')
R.push('## 4. Taiwan vs international client', '')
if (!GLOBAL) R.push('- skipped (no --global)', '')
else {
  const a = openGgpk(TW), b = openGgpk(GLOBAL)
  const hash = (g, f) => { try { return crypto.createHash('md5').update(g.read(f)).digest('hex') } catch { return null } }
  const files = [
    ...a.dir('metadata/statdescriptions').files.filter((f) => f.endsWith('.csd')),
    'data/clientstrings.datc64', 'data/words.datc64', 'data/baseitemtypes.datc64', 'data/mods.datc64',
    'data/traditional chinese/words.datc64', 'data/traditional chinese/baseitemtypes.datc64',
    'data/traditional chinese/clientstrings.datc64', 'data/traditional chinese/mods.datc64'
  ]
  const diff = files.filter((f) => hash(a, f) !== hash(b, f))
  R.push(diff.length
    ? `- ⚠ **${diff.length} of ${files.length} files differ** — the two clients are on different patches. Update the older one before trusting this run.`
    : `- ✅ all ${files.length} compared files identical`, ...sample(diff, 20), '')
  if (diff.length) log(`⚠ ${diff.length} files differ between the clients`)
}

// ------------------------------------------------------------------ 5. write + tests
if (!WRITE) {
  R.push('## 5. Nothing written (dry run)', '', `Generated files are in \`${TMP}\`. Re-run with \`--write\` to apply.`)
  fs.writeFileSync(P.report, R.join('\n') + '\n')
  log('done (dry run) → ' + path.relative(ROOT, P.report))
  process.exit(0)
}
log('5/5 writing + unit tests…')
const targets = [[out.stat, P.stat], [out.props, P.props], [out.names, P.names], ...(CN ? [[out.propsCn, P.propsCn]] : [])]
const backups = targets.map(([, dst]) => [dst, fs.readFileSync(dst)])
for (const [src, dst] of targets) fs.copyFileSync(src, dst)
const t = spawnSync(process.execPath, ['--no-warnings', '--experimental-strip-types', '--test', 'tests/*.test.mjs'],
  { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 << 20 })
const summary = (t.stdout || '').split('\n').filter((l) => /^# (pass|fail)/.test(l)).join(' · ')
if (t.status !== 0) {
  for (const [dst, buf] of backups) fs.writeFileSync(dst, buf)
  const failed = (t.stdout || '').split('\n').filter((l) => /^not ok/.test(l))
  R.push('## 5. ✖ Unit tests FAILED — all files restored', '', summary, ...failed.map((l) => `- ${l}`))
  fs.writeFileSync(P.report, R.join('\n') + '\n')
  console.error('✖ unit tests failed — files restored. See ' + path.relative(ROOT, P.report))
  process.exit(1)
}
R.push('## 5. Written + unit tests passed', '', summary, '',
  'Next: review this report, then `git add data/stat-templates.json data/unique-names.json` and push (live without a release).',
  'If section 2 changed, property-strings.ts needs an extension release.')
fs.writeFileSync(P.report, R.join('\n') + '\n')
log('done → ' + path.relative(ROOT, P.report))
