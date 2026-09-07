import { test } from "node:test"
import assert from "node:assert/strict"

import { isLongSlug, isSlugUpgrade } from "../lib/services/slug-upgrade.ts"

const short = "3q65wlB5c5"
const long =
  "H4sIAAAAAAAACqtWKi5JLCktVrKqVsovKMnMz1OyUipOTS4tSkzKSVWq1QHLFytZRVcrlVQWpCpZKSXmpSjpKKVl5pSkFoEkYmtjawH6Jta0RwAAAA"

test("isLongSlug: short id false, long slug true", () => {
  assert.equal(isLongSlug(short), false)
  assert.equal(isLongSlug(long), true)
  assert.equal(isLongSlug(""), false)
  assert.equal(isLongSlug(null), false)
})

const cand = (over = {}) => ({
  slug: short,
  league: "Standard",
  version: "1",
  at: 1000,
  ...over
})

test("upgrade accepted: same search, short→long, within window", () => {
  const c = cand()
  assert.equal(
    isSlugUpgrade(c, { slug: long, league: "Standard", version: "1" }, 1500),
    true
  )
})

test("rejected when the long slug appears after the window (likely a new search)", () => {
  const c = cand({ at: 1000 })
  assert.equal(
    isSlugUpgrade(c, { slug: long, league: "Standard", version: "1" }, 1000 + 7000),
    false
  )
})

test("rejected on a different league (not the same search)", () => {
  const c = cand({ league: "Standard" })
  assert.equal(
    isSlugUpgrade(c, { slug: long, league: "Mercenaries", version: "1" }, 1500),
    false
  )
})

test("rejected on a different version", () => {
  const c = cand({ version: "1" })
  assert.equal(
    isSlugUpgrade(c, { slug: long, league: "Standard", version: "2" }, 1500),
    false
  )
})

test("rejected when the new slug is still short (no conversion happened)", () => {
  const c = cand()
  assert.equal(
    isSlugUpgrade(c, { slug: "abcdef1234", league: "Standard", version: "1" }, 1500),
    false
  )
})

test("rejected with no candidate", () => {
  assert.equal(
    isSlugUpgrade(null, { slug: long, league: "Standard", version: "1" }, 1500),
    false
  )
})
