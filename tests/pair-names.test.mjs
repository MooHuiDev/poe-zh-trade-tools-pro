// Item-name pairing (lib/poe-zh-supplement/pair-names.ts). Every case below is
// a real bug we hit; the fixtures are minimal copies of the trade "items" API
// shape (international = English, Garena TW = Chinese).
import { test } from "node:test"
import assert from "node:assert/strict"

import { buildTwNameMap } from "../lib/poe-zh-supplement/pair-names.ts"

const run = (us, tw, extra = {}) =>
  buildTwNameMap({
    usCategories: us,
    twCategories: tw,
    TW_DICT: {},
    GEM_TW: {},
    beastTw: {},
    BASE_NAMES_TW: {},
    SCRYING_MAP_NAMES_TW: {},
    SCRYING_ORB_BASE_TW: "占卜寶珠",
    ...extra
  })

test("same-order base lists pair index by index", () => {
  const { map } = run(
    [{ id: "weapon", entries: [{ type: "Goat's Horn" }, { type: "Carved Wand" }] }],
    [{ id: "weapon", entries: [{ type: "羊角法杖" }, { type: "粗紋法杖" }] }]
  )
  assert.equal(map.goatshorn, "羊角法杖")
  assert.equal(map.carvedwand, "粗紋法杖")
})

test("categories are matched by id, not by position", () => {
  const { map } = run(
    [
      { id: "armour", entries: [{ type: "Sorcerer Boots" }] },
      { id: "weapon", entries: [{ type: "Goat's Horn" }] }
    ],
    [
      { id: "weapon", entries: [{ type: "羊角法杖" }] },
      { id: "armour", entries: [{ type: "術士長靴" }] }
    ]
  )
  assert.equal(map.sorcererboots, "術士長靴")
  assert.equal(map.goatshorn, "羊角法杖")
})

test("a unique on ONE base derives that base's Chinese name", () => {
  const { map } = run(
    [{ id: "armour", entries: [{ name: "Wanderlust", type: "Wool Shoes", flags: { unique: true } }] }],
    [{ id: "armour", entries: [{ name: "漂泊者", type: "羊毛之鞋", flags: { unique: true } }] }],
    { TW_DICT: { wanderlust: "漂泊者" } }
  )
  assert.equal(map.woolshoes, "羊毛之鞋")
})

test("a unique name on SEVERAL bases never derives a base (Sorcerer Boots → 絲絨長靴 bug)", () => {
  // Same unique name on two bases; the TW list is in a different order. The
  // old code took the first TW base for every US base.
  const { map } = run(
    [
      {
        id: "armour",
        entries: [
          { name: "Skyforth", type: "Sorcerer Boots", flags: { unique: true } },
          { name: "Skyforth", type: "Velvet Slippers", flags: { unique: true } }
        ]
      }
    ],
    [
      {
        id: "armour",
        entries: [
          { name: "天堂之途", type: "絲絨長靴", flags: { unique: true } },
          { name: "天堂之途", type: "術士長靴", flags: { unique: true } }
        ]
      }
    ],
    { TW_DICT: { skyforth: "天堂之途" } }
  )
  assert.notEqual(map.sorcererboots, "絲絨長靴")
  assert.notEqual(map.velvetslippers, "術士長靴")
})

test("unique maps sharing base 'Map' + disc are NOT collapsed onto one name", () => {
  const usMaps = ["Acton's Nightmare", "Cortex", "Whakawairua Tuahu"].map((name) => ({
    name,
    type: "Map",
    disc: "warfortheatlas",
    text: `${name} Map`,
    flags: { unique: true }
  }))
  const twMaps = ["輪迴的夢魘", "深沉記憶", "禁閉祭壇"].map((name) => ({
    name,
    type: "地圖",
    disc: "warfortheatlas",
    text: `${name} 地圖`,
    flags: { unique: true }
  }))
  const { map } = run([{ id: "map", entries: usMaps }], [{ id: "map", entries: twMaps }], {
    GEM_TW: {},
    TW_DICT: { map: "地圖" }
  })
  assert.notEqual(map.actonsnightmaremap, "禁閉祭壇 地圖")
  assert.notEqual(map.cortexmap, "禁閉祭壇 地圖")
})

test("transfigured gems pair by translated base + disc", () => {
  const { map } = run(
    [
      {
        id: "gem",
        entries: [
          { type: "Fireball" },
          { type: "Fireball", disc: "alt_x", text: "Fireball of Radiation" },
          { type: "Fireball", disc: "alt_y", text: "Fireball of Something" }
        ]
      }
    ],
    [
      {
        id: "gem",
        entries: [
          { type: "火球" },
          // TW lists the variants in a different order than US
          { type: "火球", disc: "alt_y", text: "火球．某物" },
          { type: "火球", disc: "alt_x", text: "火球．輻射" }
        ]
      }
    ]
  )
  assert.equal(map.fireballofradiation, "火球．輻射")
  assert.equal(map.fireballofsomething, "火球．某物")
})

test("GEM_TW fills a base gem the positional pairing missed, so its variant still pairs", () => {
  const { map } = run(
    // counts differ (TW lacks one gem) → positional pairing is skipped
    [
      {
        id: "gem",
        entries: [
          { type: "Arcane Link" },
          { type: "Fireball" },
          { type: "Fireball", disc: "alt_x", text: "Fireball of Radiation" }
        ]
      }
    ],
    [{ id: "gem", entries: [{ type: "火球", disc: "alt_x", text: "火球．輻射" }] }],
    { GEM_TW: { fireball: "火球" } }
  )
  assert.equal(map.fireballofradiation, "火球．輻射")
})

test("scrying orbs pair by their numeric type + disc (unique per map)", () => {
  const { map } = run(
    [
      {
        id: "currency",
        entries: [
          { type: "1001", disc: "scrying_orb", text: "Scrying Orb (Strand)" },
          { type: "1002", disc: "scrying_orb", text: "Scrying Orb (Academy)" }
        ]
      }
    ],
    [
      {
        id: "currency",
        entries: [
          { type: "1002", disc: "scrying_orb", text: "占卜寶珠 (惡靈學院)" },
          { type: "1001", disc: "scrying_orb", text: "占卜寶珠 (海岸)" }
        ]
      }
    ]
  )
  assert.equal(map.scryingorbstrand, "占卜寶珠 (海岸)")
  assert.equal(map.scryingorbacademy, "占卜寶珠 (惡靈學院)")
})

test("the curated dictionary overrides a wrong pairing and fills missing names", () => {
  const { map } = run(
    [{ id: "weapon", entries: [{ type: "Quartz Wand" }, { type: "Goat's Horn" }] }],
    // TW order swapped → positional pairing gets it wrong
    [{ id: "weapon", entries: [{ type: "羊角法杖" }, { type: "石英法杖" }] }],
    { TW_DICT: { quartzwand: "石英法杖", goatshorn: "羊角法杖", bonebow: "骨製弓" } }
  )
  assert.equal(map.quartzwand, "石英法杖")
  assert.equal(map.goatshorn, "羊角法杖")
  assert.equal(map.bonebow, "骨製弓")
})

test("unique-name alignment: a duplicate known name doesn't shift the rest (To Dust)", () => {
  // Two US "To Dust" (current + legacy); known anchors around an unknown name.
  const us = [
    { name: "Abberath's Horn", type: "Goat's Horn" },
    { name: "To Dust", type: "Cobalt Jewel" },
    { name: "To Dust", type: "Cobalt Jewel" },
    { name: "Brand New Unique", type: "Cobalt Jewel" },
    { name: "Watcher's Eye", type: "Prismatic Jewel" }
  ].map((e) => ({ ...e, flags: { unique: true } }))
  const tw = [
    { name: "艾貝拉斯之角", type: "羊角法杖" },
    { name: "塵埃落定", type: "鈷藍珠寶" },
    { name: "化為塵土", type: "鈷藍珠寶" },
    { name: "全新傳奇", type: "鈷藍珠寶" },
    { name: "守望之眼", type: "稜光珠寶" }
  ].map((e) => ({ ...e, flags: { unique: true } }))
  const { derivedUnique } = run([{ id: "jewel", entries: us }], [{ id: "jewel", entries: tw }], {
    TW_DICT: { abberathshorn: "艾貝拉斯之角", todust: "塵埃落定", watcherseye: "守望之眼" }
  })
  // The unknown unique must never be paired with a neighbour's name.
  assert.notEqual(derivedUnique.brandnewunique, "化為塵土")
  assert.notEqual(derivedUnique.brandnewunique, "守望之眼")
})

test("keysBeforeDict marks names that only came from the dictionary", () => {
  const { keysBeforeDict, map } = run(
    [{ id: "weapon", entries: [{ type: "Goat's Horn" }] }],
    [{ id: "weapon", entries: [{ type: "羊角法杖" }] }],
    { TW_DICT: { mantleofdreams: "夢縈之袍" } }
  )
  assert.ok(keysBeforeDict.has("goatshorn"))
  assert.ok(!keysBeforeDict.has("mantleofdreams"))
  assert.equal(map.mantleofdreams, "夢縈之袍")
})
