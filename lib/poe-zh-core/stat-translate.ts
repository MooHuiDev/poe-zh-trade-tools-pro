/**
 * Results-page mod translation from data/stat-templates.json. Pure so it can be
 * unit-tested (tests/stat-templates.test.mjs); zh-results.content.ts calls it.
 * No imports on purpose.
 */

// A signed number, used both to read rendered values and to fill templates.
const NUM = /[+\-]?\d+(?:\.\d+)?/g
// Regular template placeholder: optional sign + "#", filled left to right.
const PLACEHOLDER = /[+\-]?#/g
// Indexed placeholder "#{k}": the k-th number of the rendered English line.
const INDEXED = /[+\-]?#\{(\d+)\}/g

// Must match scripts/lib/stat-line.mjs normEn (the generator's key).
export const normEnRendered = (s: string) =>
  s
    .replace(/\[([^\]|]+)(?:\|[^\]]*)?\]/g, "$1") // [English|中文] -> English
    .replace(/[+\-]?\d+(?:\.\d+)?/g, "#") // numbers -> #
    .toLowerCase()
    .replace(/[^a-z#]/g, "")

/**
 * Chinese for one rendered English mod line (or several lines joined with a
 * literal "\n"), or null when the dictionaries don't know it. The regular map
 * always wins; the indexed map only covers lines whose Chinese reorders numbers.
 */
export const fillTemplate = (
  statTpl: Record<string, string>,
  statTplIdx: Record<string, string>,
  rendered: string
): string | null => {
  const key = normEnRendered(rendered)
  const values = rendered.match(NUM) || []
  const tpl = statTpl[key]
  if (tpl) {
    let i = 0
    return tpl.replace(PLACEHOLDER, () => (i < values.length ? values[i++] : "#"))
  }
  const idx = statTplIdx[key]
  if (!idx) return null
  return idx.replace(INDEXED, (_, k: string) => values[+k] ?? "#")
}

// A rendered range "(10-19)" / "(2.1-8)" counts as ONE value: essence-style
// lines ("Quiver: (10-19)% increased Damage with Bow Skills").
const RANGE_OR_NUM = /\(-?\d+(?:\.\d+)?-\d+(?:\.\d+)?\)|[+\-]?\d+(?:\.\d+)?/g

/**
 * Like fillTemplate, but each "(a-b)" range is matched as a single number and
 * written back as "(a–b)". Returns null when nothing matches.
 */
export const fillTemplateRanges = (
  maps: Array<Record<string, string>>,
  rendered: string
): string | null => {
  if (!/\(\d/.test(rendered)) return null
  const values = rendered.match(RANGE_OR_NUM) || []
  const simplified = rendered.replace(/\((-?\d+(?:\.\d+)?)-\d+(?:\.\d+)?\)/g, "$1")
  const key = normEnRendered(simplified)
  const show = (v: string) => v.replace(/^\((.+)-(.+)\)$/, "($1–$2)")
  for (const m of maps) {
    const tpl = m[key]
    if (!tpl) continue
    if (INDEXED.test(tpl)) {
      INDEXED.lastIndex = 0
      return tpl.replace(INDEXED, (_, k: string) => (values[+k] !== undefined ? show(values[+k]) : "#"))
    }
    let i = 0
    return tpl.replace(PLACEHOLDER, () => {
      const v = values[i++]
      if (v === undefined) return "#"
      // keep the template's sign only for plain numbers ("+#" with "(10-19)" -> "(10–19)")
      return v.startsWith("(") ? show(v) : v
    })
  }
  return null
}

/**
 * Any rendered English line: mod templates first, then the other game texts
 * (affix names, descriptions, names, labels — data/stat-templates.json twText).
 */
export const translateLine = (
  statTpl: Record<string, string>,
  statTplIdx: Record<string, string>,
  texts: Record<string, string>,
  rendered: string
): string | null => {
  const direct =
    fillTemplate(statTpl, statTplIdx, rendered) ??
    fillTemplate(texts, {}, rendered) ??
    fillTemplateRanges([statTpl, statTplIdx, texts], rendered)
  if (direct) return direct
  // "<Item slot>: <effect>" (essences / fossils / catalysts …):
  // "Quiver: (10-19)% increased Damage with Bow Skills"
  const m = rendered.match(/^([A-Z][A-Za-z ]{1,30}): (.+)$/)
  if (!m) return null
  const effect =
    fillTemplate(statTpl, statTplIdx, m[2]) ??
    fillTemplateRanges([statTpl, statTplIdx, texts], m[2]) ??
    fillTemplate(texts, {}, m[2])
  if (!effect) return null
  const slotOf = (en: string): string | null => {
    const zh = texts[normEnRendered(en)]
    if (zh) return zh
    const other = en.match(/^Other (.+)$/)
    if (other) {
      const rest = texts[normEnRendered(other[1])]
      return rest ? `其他${rest}` : null
    }
    return null
  }
  const slot = slotOf(m[1])
  return `${slot ?? m[1]}：${effect}`
}
