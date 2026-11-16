/**
 * Decides how one result-card property label translates. Pure (no DOM) so it
 * can be unit-tested (tests/property-translate.test.mjs); zh-results applies
 * the result to the actual span. No imports on purpose.
 *
 * Input: `key` = the span's text with each child value element replaced by
 * "{}" (e.g. "Recovers {} Mana over {} Seconds"), and how many such values.
 *
 * Output:
 *   { kind: "template", zh }  — rebuild the span: "{i}" = the i-th value element
 *   { kind: "text", text }    — the span has no value elements; replace its text
 *   null                      — leave it alone
 */
export type PropertyResult =
  | { kind: "template"; zh: string }
  | { kind: "text"; text: string }
  | null

const hasChinese = (s: string) => /[一-鿿]/.test(s)

export const resolvePropertyText = (
  key: string,
  valueCount: number,
  PROPS: Record<string, string>,
  TAGS: Record<string, string>
): PropertyResult => {
  if (!/[A-Za-z]/.test(key) || hasChinese(key)) return null
  const norm = key.replace(/\s+/g, " ").trim()
  // Requirement line: "Requires {}, {}, {}" (each value is a "Level 12" /
  // "50 Str" span translated on its own) -> "需求 {0}, {1}, {2}".
  if (/^Requires \{\}(?:, \{\})*$/.test(norm)) {
    const parts = Array.from({ length: valueCount }, (_, i) => `{${i}}`)
    return { kind: "template", zh: `${PROPS["Requires"] || "需求"} ${parts.join(", ")}` }
  }
  const zh = PROPS[norm]
  if (zh) {
    if (!valueCount) return { kind: "text", text: key.replace(norm, zh) }
    return { kind: "template", zh }
  }
  if (valueCount) return null
  // Plain text spans: gem values with the numbers inline ("12 Mana",
  // "8.00 sec (3 uses)", "80% of base"), labels with a colon ("Experience:")
  // and gem tag lists ("Attack, AoE, Melee").
  const nums = norm.match(/\d+(?:\.\d+)?/g) || []
  const numTpl = nums.length ? PROPS[norm.replace(/\d+(?:\.\d+)?/g, "{}")] : undefined
  if (numTpl) {
    const text = numTpl.replace(/\{(\d+)\}/g, (_, i: string) => nums[+i] ?? "")
    return { kind: "text", text: key.replace(norm, text) }
  }
  if (norm.endsWith(":")) {
    const label = PROPS[norm.slice(0, -1).trim()]
    if (label) return { kind: "text", text: key.replace(norm, `${label}:`) }
  }
  const parts = norm.split(", ")
  if (parts.every((p) => TAGS[p]))
    return { kind: "text", text: key.replace(norm, parts.map((p) => TAGS[p]).join(", ")) }
  return null
}
