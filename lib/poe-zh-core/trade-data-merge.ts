// Plan A for the trade-data API translation:
//
//   result = <Taiwan-translated array>  (full Chinese, correct structure)
//           + any GROUP the live international response has that Taiwan lacks
//             (appended as-is = English), matched by group `id`.
//
// This keeps the whole existing UI Chinese (we never touch Taiwan's entries, so
// option-type stats — which Taiwan flattens differently from international —
// stay correctly Chinese, no mixed output), while a brand-new filter/stat GROUP
// that GGG ships before the Taiwan data catches up stays VISIBLE and SEARCHABLE
// (in English) instead of disappearing. Once Taiwan adds the group, it comes
// from the Taiwan array (Chinese) and the append is skipped (id already present).
//
// Pure and dependency-free so it can be unit tested.

interface GroupLike {
  id?: unknown
  [key: string]: unknown
}

/**
 * Return the Taiwan array with any international groups Taiwan is missing
 * appended to the end. Non-destructive: Taiwan's groups/entries are untouched.
 */
export const appendMissingGroups = (
  translated: unknown[],
  live: unknown[]
): unknown[] => {
  if (!Array.isArray(translated)) return Array.isArray(live) ? live : []
  if (!Array.isArray(live)) return translated

  const groupId = (g: unknown): string | null =>
    g && typeof (g as GroupLike).id === "string"
      ? ((g as GroupLike).id as string)
      : null

  const haveIds = new Set(
    translated.map(groupId).filter((id): id is string => id !== null)
  )

  const result = translated.slice()
  for (const group of live) {
    const id = groupId(group)
    if (id !== null && !haveIds.has(id)) result.push(group)
  }
  return result
}
