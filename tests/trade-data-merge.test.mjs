import { test } from "node:test"
import assert from "node:assert/strict"

import { appendMissingGroups } from "../lib/poe-zh-core/trade-data-merge.ts"

const ids = (arr) => arr.map((g) => g.id)

test("all groups present in Taiwan → result is exactly the Taiwan array", () => {
  const tw = [
    { id: "pseudo", label: "偽屬性" },
    { id: "explicit", label: "詞綴" }
  ]
  const live = [
    { id: "pseudo", label: "Pseudo" },
    { id: "explicit", label: "Explicit" }
  ]
  const out = appendMissingGroups(tw, live)
  assert.deepEqual(ids(out), ["pseudo", "explicit"])
  assert.equal(out[0].label, "偽屬性") // Taiwan (Chinese) preserved, not overwritten
})

test("a NEW international group Taiwan lacks is appended in English", () => {
  const tw = [{ id: "pseudo", label: "偽屬性" }]
  const live = [
    { id: "pseudo", label: "Pseudo" },
    { id: "space_league", label: "Space League Filters", entries: [{ id: "space.tier", text: "Space Map Tier" }] }
  ]
  const out = appendMissingGroups(tw, live)
  assert.deepEqual(ids(out), ["pseudo", "space_league"])
  assert.equal(out[0].label, "偽屬性") // existing stays Chinese
  assert.equal(out[1].label, "Space League Filters") // new group visible (English)
  assert.equal(out[1].entries[0].text, "Space Map Tier")
})

test("no duplication once Taiwan also has the group", () => {
  const tw = [
    { id: "pseudo", label: "偽屬性" },
    { id: "space_league", label: "太空聯盟篩選" } // Taiwan caught up
  ]
  const live = [
    { id: "pseudo", label: "Pseudo" },
    { id: "space_league", label: "Space League Filters" }
  ]
  const out = appendMissingGroups(tw, live)
  assert.deepEqual(ids(out), ["pseudo", "space_league"]) // appears once
  assert.equal(out[1].label, "太空聯盟篩選") // and it's the Chinese one
})

test("a Taiwan-only group (international removed it) is kept, harmlessly", () => {
  const tw = [{ id: "pseudo", label: "偽屬性" }, { id: "legacy", label: "舊群組" }]
  const live = [{ id: "pseudo", label: "Pseudo" }]
  const out = appendMissingGroups(tw, live)
  assert.deepEqual(ids(out), ["pseudo", "legacy"])
})

test("defensive: non-array inputs don't throw", () => {
  assert.deepEqual(appendMissingGroups([{ id: "a" }], null), [{ id: "a" }])
  assert.deepEqual(appendMissingGroups(null, [{ id: "b" }]), [{ id: "b" }])
})
