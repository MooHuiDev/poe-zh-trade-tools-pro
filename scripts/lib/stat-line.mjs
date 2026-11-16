// Pure helpers shared by gen-stat-templates.mjs and its tests
// (tests/stat-templates.test.mjs): .csd parsing, the normalized English key,
// and English line + Chinese line -> runtime template.

// ---------------------------------------------------------------- .csd parse
export const parseVariant = (line) => {
  const m = line && line.match(/^\s*(.*?)\s*"((?:[^"\\]|\\.)*)"\s*(.*)$/)
  return m ? { cond: m[1].trim(), text: m[2] } : null
}
export const parseCsd = (text) => {
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
export const stripMarkup = (s) => s
  .replace(/<[a-z_]+>\{\{(.*?)\}\}(?!\})/gi, '$1')
  .replace(/<[a-z_]+>\{([^{}]*)\}/gi, '$1')
  .replace(/\[([^\]|]*)\|([^\]]*)\]/g, '$2').replace(/\[([^\]]*)\]/g, '$1')
// Must match zh-results.content.ts normEn (applied to the rendered English).
export const normEn = (s) => s
  .replace(/\[([^\]|]+)(?:\|[^\]]*)?\]/g, '$1')
  .replace(/[+\-]?\d+(?:\.\d+)?/g, '#')
  .toLowerCase()
  .replace(/[^a-z#]/g, '')
// Placeholders are {0}, {0:+d} … and also bare {} (auto-numbered, like a
// format string). A sign only counts when it isn't a range dash after a number.
export const PLACEHOLDER = /\{(\d*)(?::[^}]*)?\}/g
export const TOKEN = /\{(\d*)(?::[^}]*)?\}|(?:(?<![\d.}])[+\-])?\d+(?:\.\d+)?/g
export const tokens = (s) => {
  const res = []; let m, auto = 0; TOKEN.lastIndex = 0
  while ((m = TOKEN.exec(s))) {
    if (m[1] !== undefined) res.push({ t: 'p', i: m[1] === '' ? auto++ : +m[1], s: m.index, e: m.index + m[0].length })
    else res.push({ t: 'l', v: m[0].replace(/^[+\-]/, ''), s: m.index, e: m.index + m[0].length })
  }
  return res
}
// Returns the Chinese line as a "#" template, or null when numbers can't be
// filled in the right order by the runtime.
export const mapLine = (en, zh) => {
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

// Fallback for lines mapLine rejects because Chinese puts the numbers in a
// different order ("Trigger Level 20 X after spending {0}%" -> "消耗{0}%…等級20")
// or the English hard-codes a value the Chinese writes as a placeholder
// ("Contains an additional Unique Item" -> "內含 {0} 個…", cond "1").
// Output uses INDEXED placeholders "#{k}" = the k-th number of the rendered
// English line (every number counts, literals included — same as the runtime's
// number list). These go to separate `twIdx` / `cnIdx` maps that only newer
// extension versions read, so older versions never see the new syntax.
export const mapLineIdx = (en, zh, conds) => {
  const fixed = (i) => (/^-?\d+$/.test(conds[i] || '') ? conds[i] : null)
  const E = tokens(en), C = tokens(zh), used = new Array(E.length).fill(false)
  let out = '', last = 0, any = false
  for (const c of C) {
    let rep = zh.slice(c.s, c.e)
    if (c.t === 'p') {
      const k = E.findIndex((e, j) => !used[j] && e.t === 'p' && e.i === c.i)
      if (k >= 0) { used[k] = true; rep = `#{${k}}`; any = true }
      else {
        const f = fixed(c.i)
        if (f === null) return null // a Chinese value the English line doesn't have
        rep = /:\+/.test(rep) && !f.startsWith('-') ? `+${f}` : f
      }
    }
    // Chinese literal numbers stay literal (the value is constant).
    out += zh.slice(last, c.s) + rep; last = c.e
  }
  // English placeholders missing in Chinese are only fine when their value is fixed.
  if (E.some((e, j) => e.t === 'p' && !used[j] && fixed(e.i) === null)) return null
  if (!any && !C.some((c) => c.t === 'p')) return null // nothing gained over mapLine
  return (out + zh.slice(last)).trim()
}

