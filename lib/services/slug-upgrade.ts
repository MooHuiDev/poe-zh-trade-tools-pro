// Pure helpers for "upgrade-on-open": when a user opens an old short-id
// bookmark, the trade site rewrites the URL from the short id to the new
// self-contained long (gzip+base64url) form. We capture that and store it back
// so the bookmark stops depending on the soon-to-expire short id.
//
// The tricky part is being SURE the long slug is the site's auto-conversion of
// the short one — not the user having navigated/edited into a different search
// right after opening. Guards: same search (version + league), short → long,
// and the long slug must appear within a short window of first seeing the short
// slug (the auto-conversion happens almost immediately on load). Kept pure so
// the decision is unit tested.

// Long slugs are base64url(gzip(query)) — hundreds of chars. Short ids are ~10.
export const isLongSlug = (slug: string | null | undefined): boolean =>
  !!slug && slug.length > 40

export interface UpgradeCandidate {
  slug: string
  league: string | null
  version: string
  at: number // ms timestamp when the short slug was first seen
}

/**
 * True when `loc` (a long slug) is the auto-conversion of the pending short-slug
 * candidate for the same search, seen within `windowMs`.
 */
export const isSlugUpgrade = (
  candidate: UpgradeCandidate | null,
  loc: { slug?: string | null; league?: string | null; version?: string },
  now: number,
  windowMs = 6000
): boolean =>
  !!candidate &&
  !isLongSlug(candidate.slug) &&
  isLongSlug(loc.slug) &&
  candidate.version === loc.version &&
  (candidate.league ?? null) === (loc.league ?? null) &&
  now - candidate.at <= windowMs
