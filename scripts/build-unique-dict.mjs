// Regenerates lib/poe-zh-supplement/dict.ts — the bundled English -> Traditional
// Chinese unique-item name dictionary.
//
// This is the ONE piece of Chinese data that does not auto-update at runtime
// (unique names are a static snapshot), so re-run this after a major game patch
// or new league that adds/renames unique items.
//
// Usage:
//   1) Open https://poedb.tw/tw/Unique_item in a browser, save it as
//      "Webpage, HTML Only" into the project root as unique.html
//   2) (optional, recovers jewels/relics/etc. that poedb lists elsewhere)
//      Save https://www.pathofexile.com/api/trade/data/items  -> items-us.json
//      Save https://pathofexile.tw/api/trade/data/items        -> items-tw.json
//   3) node scripts/build-unique-dict.mjs
//
// Optional custom paths:
//   node scripts/build-unique-dict.mjs unique.html items-us.json items-tw.json

import fs from "node:fs"

const HTML = process.argv[2] || "unique.html"
const US = process.argv[3] || "items-us.json"
const TW = process.argv[4] || "items-tw.json"
const OUT = "lib/poe-zh-supplement/dict.ts"

const norm = (s) => s.toLowerCase().replace(/[^a-z0-9]/g, "")
const cjk = /[一-鿿]/

// Hand-verified overrides for uniques that poedb's Unique_item page and the
// official trade data don't pair automatically (e.g. items poedb lists on a
// different page). Merged last, so they always win. Add new confirmed pairs
// here (key = normalized English name).
const OVERRIDES = {
  deidbellow: "喪吼",
  demigodsauthority: "半神權威"
}

if (!fs.existsSync(HTML)) {
  console.error(`Missing ${HTML}. Save poedb.tw/tw/Unique_item as HTML first.`)
  process.exit(1)
}

const map = {}

// 1) Authoritative slug -> Chinese name from the saved poedb page.
const html = fs.readFileSync(HTML, "utf8")
const re =
  /href="\/tw\/([^"#]+)"[^>]*>(?:\s*<[^>]+>\s*)*?<span class="uniqueName">([^<]+)<\/span>/g
let m
let fromHtml = 0
while ((m = re.exec(html))) {
  const slug = decodeURIComponent(m[1])
  const name = m[2].trim()
  if (!cjk.test(name)) continue
  const key = norm(slug)
  if (key && !map[key]) {
    map[key] = name
    fromHtml++
  }
}

// 2) Optional anchor-alignment to recover uniques poedb lists on other pages
//    (jewels, relics, flasks...) using the official trade item data.
let recovered = 0
if (fs.existsSync(US) && fs.existsSync(TW)) {
  const us = JSON.parse(fs.readFileSync(US, "utf8")).result || []
  const tw = JSON.parse(fs.readFileSync(TW, "utf8")).result || []
  const twByCat = {}
  tw.forEach((c) => (twByCat[c.id || c.label] = c))
  const uniquesOf = (cat) =>
    (cat.entries || []).filter((e) => e.name && e.flags && e.flags.unique)

  for (const cu of us) {
    const ct = twByCat[cu.id || cu.label]
    if (!ct) continue
    const U = uniquesOf(cu)
    const T = uniquesOf(ct)
    const usedT = new Array(T.length).fill(false)
    const anchors = []
    let start = 0
    for (let i = 0; i < U.length; i++) {
      const zh = map[norm(U[i].name)]
      if (!zh) continue
      let j = -1
      for (let k = start; k < T.length; k++) {
        if (!usedT[k] && T[k].name === zh) {
          j = k
          break
        }
      }
      if (j >= 0) {
        anchors.push({ i, j })
        usedT[j] = true
        start = j + 1
      }
    }
    const segs = []
    let prev = { i: -1, j: -1 }
    for (const a of anchors) {
      segs.push([prev.i + 1, a.i - 1, prev.j + 1, a.j - 1])
      prev = a
    }
    segs.push([prev.i + 1, U.length - 1, prev.j + 1, T.length - 1])
    for (const [ui0, ui1, tj0, tj1] of segs) {
      const uc = ui1 - ui0 + 1
      const tc = tj1 - tj0 + 1
      if (uc <= 0 || uc !== tc) continue // only pair gap-free segments (safe)
      for (let d = 0; d < uc; d++) {
        const eng = U[ui0 + d].name
        const zh = T[tj0 + d].name
        if (!eng || !zh || cjk.test(eng) || !cjk.test(zh)) continue
        const key = norm(eng)
        if (!map[key]) {
          map[key] = zh
          recovered++
        }
      }
    }
  }
}

Object.assign(map, OVERRIDES)

const keys = Object.keys(map).sort()
let body =
  "// Auto-generated authoritative unique-item dictionary.\n" +
  "// Regenerate: node scripts/build-unique-dict.mjs <unique.html> [items-us.json] [items-tw.json]\n" +
  `// Keys: normalized English slug (lowercase, punctuation/space stripped). ${keys.length} entries.\n` +
  "export const SUPPLEMENT_ZH_TW: Record<string, string> = {\n"
for (const k of keys) body += `  ${JSON.stringify(k)}: ${JSON.stringify(map[k])},\n`
body += "}\n"
fs.writeFileSync(OUT, body)

console.log(
  `Wrote ${OUT}: ${keys.length} entries (poedb ${fromHtml}, anchor-recovered ${recovered})`
)
