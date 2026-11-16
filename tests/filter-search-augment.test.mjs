// Chinese search in the flat item dropdowns (lib/poe-zh-core/filter-search-augment.ts).
// The important cases are the "must not break the site" ones: v4.1.9 made the
// whole stat-filter box disappear when Chinese was typed into it.
import { test } from "node:test"
import assert from "node:assert/strict"

import { augmentFilteredOptions } from "../lib/poe-zh-core/filter-search-augment.ts"

const ZH = { Mageblood: "魔血", Headhunter: "獵首" }
const translateLabel = (s) => (typeof s === "string" && ZH[s] ? `${ZH[s]} (${s})` : s)
const getLabel = (o) => o.text
const options = [{ id: "Mageblood", text: "Mageblood" }, { id: "Headhunter", text: "Headhunter" }]

const run = (over) =>
  augmentFilteredOptions({ native: [], options, search: "", props: {}, getLabel, translateLabel, ...over })

test("Chinese query finds the English option", () => {
  assert.deepEqual(run({ search: "魔血" }), [options[0]])
})

test("the extension's '~' fuzzy prefix is ignored", () => {
  assert.deepEqual(run({ search: "~魔血" }), [options[0]])
})

test("1 character or English → native list untouched", () => {
  const native = [options[1]]
  assert.equal(run({ native, search: "魔" }), native)
  assert.equal(run({ native, search: "Mage" }), native)
})

test("already-matched options aren't duplicated", () => {
  const native = [options[0]]
  assert.equal(run({ native, search: "魔血" }), native)
})

test("GROUPED dropdown (stat filter) is never touched — 4.1.10 regression", () => {
  const groups = [{ label: "偽屬性", entries: [{ id: "pseudo.x", text: "+#% 冰冷抗性" }] }]
  const native = []
  // getLabel throws on a group object, exactly like the site's addStatFilterLabel
  const throwingLabel = (o) => o.text.replace("#", "1")
  const out = augmentFilteredOptions({
    native,
    options: groups,
    search: "冰冷抗性",
    props: { groupValues: "entries", groupLabel: "label" },
    getLabel: throwingLabel,
    translateLabel
  })
  assert.equal(out, native)
})

test("even without group props, group objects and label errors can't break it", () => {
  const native = []
  const out = augmentFilteredOptions({
    native,
    options: [{ label: "x", entries: [] }, { id: 1 }],
    search: "冰冷抗性",
    props: null,
    getLabel: () => {
      throw new Error("boom")
    },
    translateLabel
  })
  assert.equal(out, native)
})

test("non-array native passes through", () => {
  assert.equal(run({ native: undefined, search: "魔血" }), undefined)
})
