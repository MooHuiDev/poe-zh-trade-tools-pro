/**
 * Chinese typing search for the flat "knownItem" filter dropdowns (完成地圖獎勵,
 * Ultimatum rewards …). Pure so it can be unit-tested
 * (tests/filter-search-augment.test.mjs); zh-filter-search.content.ts calls it
 * from inside the dropdown component's `filteredOptions`. No imports on purpose.
 *
 * MUST NEVER BREAK THE SITE: it runs inside the site's own render. v4.1.9 also
 * ran on the grouped "Add Stat Filter" dropdown, a group object ended up in the
 * flat list, the render threw and the whole filter box disappeared (fixed in
 * 4.1.10). So: grouped dropdowns are skipped, and any error returns `native`.
 */
export type AugmentInput = {
  /** The component's own filtered options (returned unchanged when we add nothing). */
  native: unknown
  /** All options of the dropdown. */
  options: unknown
  /** What the user typed (may carry the extension's "~" fuzzy prefix). */
  search: unknown
  /** Component props; grouped dropdowns set groupValues / groupLabel. */
  props?: { groupValues?: unknown; groupLabel?: unknown } | null
  /** The component's label for an option (English). */
  getLabel: (o: unknown) => unknown
  /** English label -> "中文 (English)". */
  translateLabel: (s: unknown) => unknown
  /** Cap on how many options are appended. */
  limit?: number
}

const hasZh = (s: string) => /[一-鿿]/.test(s)

export const augmentFilteredOptions = (input: AugmentInput): unknown => {
  const { native, options, search, props, getLabel, translateLabel } = input
  const limit = input.limit ?? 50
  if (!Array.isArray(native)) return native
  if (props && (props.groupValues || props.groupLabel)) return native
  const q = String(search || "")
    .replace(/^~+/, "")
    .trim()
  if (q.length < 2 || !hasZh(q)) return native
  try {
    const seen = new Set(native)
    const add: unknown[] = []
    const opts = Array.isArray(options) ? options : []
    for (const o of opts) {
      if (seen.has(o) || !o || typeof o !== "object" || "entries" in (o as object)) continue
      const lab = translateLabel(getLabel(o))
      if (typeof lab === "string" && lab.includes(q)) {
        add.push(o)
        if (add.length >= limit) break
      }
    }
    return add.length ? [...native, ...add] : native
  } catch {
    return native
  }
}
