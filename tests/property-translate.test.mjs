// Result-card property lines (lib/poe-zh-core/property-translate.ts) against
// the real generated table (lib/poe-zh-core/property-strings.ts).
import { test } from "node:test"
import assert from "node:assert/strict"

import { resolvePropertyText } from "../lib/poe-zh-core/property-translate.ts"
import { PROPERTY_STRINGS_TW as P, GEM_TAGS_TW as T } from "../lib/poe-zh-core/property-strings.ts"

const r = (key, n = 0) => resolvePropertyText(key, n, P, T)

test("flask lines rebuild in Chinese order", () => {
  assert.deepEqual(r("Recovers {} Mana over {} Seconds", 2), { kind: "template", zh: "{1} 秒內回復 {0} 魔力" })
  assert.deepEqual(r("Lasts {} Seconds", 1), { kind: "template", zh: "持續 {0} 秒" })
  assert.equal(r("Consumes {} of {} Charges on use", 2).zh, "每次使用會從 {1} 充能次數中消耗 {0} 次")
})

test("requirement line: 需求 + the values in order", () => {
  assert.deepEqual(r("Requires {}, {}, {}", 3), { kind: "template", zh: "需求 {0}, {1}, {2}" })
  assert.deepEqual(r("Requires {}", 1), { kind: "template", zh: "需求 {0}" })
})

test("single labels", () => {
  assert.deepEqual(r("Level"), { kind: "text", text: "等級" })
  assert.deepEqual(r("Physical Damage"), { kind: "text", text: "物理傷害" })
  assert.deepEqual(r("Str"), { kind: "text", text: "力量" })
})

test("gem values with numbers inline", () => {
  assert.deepEqual(r("12 Mana"), { kind: "text", text: "12 魔力" })
  assert.deepEqual(r("8.00 sec (3 uses)"), { kind: "text", text: "8.00 秒（3 次）" })
  assert.deepEqual(r("80% of base"), { kind: "text", text: "基礎的 80%" })
})

test("label with a trailing colon", () => {
  assert.deepEqual(r("Experience:"), { kind: "text", text: "經驗值:" })
})

test("gem tag list", () => {
  assert.deepEqual(r("Spell, AoE"), { kind: "text", text: "法術, 範圍效果" })
})

test("surrounding spaces are kept", () => {
  assert.deepEqual(r(" Level "), { kind: "text", text: " 等級 " })
})

test("left alone: already Chinese, numbers only, unknown text", () => {
  assert.equal(r("等級"), null)
  assert.equal(r("{}: {}", 2), null)
  assert.equal(r("Something Unknown"), null)
  assert.equal(r("Unknown {} thing", 1), null)
})

test("itemised beast genus / group / family values", () => {
  assert.deepEqual(r("Goliaths"), { kind: "text", text: "巨獸" })
  assert.deepEqual(r("Unnaturals"), { kind: "text", text: "非自然" })
  assert.deepEqual(r("The Wilds"), { kind: "text", text: "荒野" })
})
