// Pure (no imports besides a type) so it can be unit-tested:
// tests/bookmark-realm.test.mjs
import type { TradeRealm } from "../config/trade-hosts"

const CJK = /[㐀-鿿]/

/**
 * Guess a folder's server from the leagues of its saved searches. Taiwan league
 * ids are always Chinese (巫影密會, 標準模式 …) and international ones are
 * always English (Covens, Standard …), so one league is enough to tell.
 * Undefined when no search has a league (very old exports, empty folders).
 */
export const inferRealmFromLeagues = (
  leagues: Array<string | null | undefined>
): TradeRealm | undefined => {
  let sawEnglish = false
  for (const league of leagues) {
    const l = (league || "").trim()
    if (!l) continue
    if (CJK.test(l)) return "tw"
    sawEnglish = true
  }
  return sawEnglish ? "intl" : undefined
}

/**
 * Which server an imported folder goes to.
 * - The folder's server = the one written in the export (4.1.12+), otherwise
 *   guessed from its searches' leagues (older exports, and folders made before
 *   servers were recorded).
 * - Known server: import only on that server — a Taiwan search url doesn't work
 *   on the international site and vice versa, so a mismatch returns null.
 * - Unknown (no league anywhere): use the server the user is importing on.
 * (Before 4.1.12 imports got no server and counted as "intl", so a Taiwan
 * folder re-imported on the Taiwan site ended up on the international site.)
 */
export const resolveImportRealm = (
  exported: TradeRealm | undefined,
  current: TradeRealm,
  leagues: Array<string | null | undefined> = []
): TradeRealm | null => {
  const known = exported ?? inferRealmFromLeagues(leagues)
  if (!known) return current
  return known === current ? known : null
}
