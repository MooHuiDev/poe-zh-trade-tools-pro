// Mod-line translation: the generator (scripts/lib/stat-line.mjs) turns an
// English + Chinese game line into a template; the extension
// (lib/poe-zh-core/stat-translate.ts) fills it with the numbers of the rendered
// English line. These tests run both ends together, plus spot checks on the
// shipped data/stat-templates.json.
import { test } from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs"

import { mapLine, mapLineIdx, normEn, PLACEHOLDER } from "../scripts/lib/stat-line.mjs"
import { fillTemplate, normEnRendered } from "../lib/poe-zh-core/stat-translate.ts"

// Generate a template from game text, then translate a rendered English line.
const roundTrip = (enGame, zhGame, rendered, conds = []) => {
  const key = normEn(enGame.replace(PLACEHOLDER, "#"))
  const tpl = mapLine(enGame, zhGame)
  const idx = tpl === null ? mapLineIdx(enGame, zhGame, conds) : null
  const out = fillTemplate(tpl ? { [key]: tpl } : {}, idx ? { [key]: idx } : {}, rendered)
  return { key, tpl, idx, out }
}

test("generator key == runtime key for the same line", () => {
  const game = "{0}% increased Cast Speed"
  assert.equal(normEn(game.replace(PLACEHOLDER, "#")), normEnRendered("12% increased Cast Speed"))
  assert.equal(normEnRendered("+46% to [ColdResistance|Cold Resistance]"), "#tocoldresistance")
})

test("plain line: numbers filled in order", () => {
  const r = roundTrip("{0}% increased Cast Speed", "增加 {0}% 施放速度", "10% increased Cast Speed")
  assert.equal(r.out, "增加 10% 施放速度")
})

test("signed values keep their sign", () => {
  const r = roundTrip("{0:+d} to maximum Mana", "{0:+d} 最大魔力", "+70 to maximum Mana")
  assert.equal(r.out, "+70 最大魔力")
})

test("ranges use an en dash so the second number isn't read as negative", () => {
  const r = roundTrip("Adds {0} to {1} Fire Damage", "附加 {0}-{1} 火焰傷害", "Adds 5 to 6 Fire Damage")
  assert.equal(r.tpl, "附加 #–# 火焰傷害")
  assert.equal(r.out, "附加 5–6 火焰傷害")
})

test("a constant Chinese number that isn't next in order stays literal", () => {
  const r = roundTrip(
    "{0}% chance for a damaging Retaliation skill to\\nbecome usable for every 100 life removed this way",
    "你每以此方式移除100生命，\\n反擊技能即有{0}%機率變為可用",
    "5% chance for a damaging Retaliation skill to\\nbecome usable for every 100 life removed this way"
  )
  assert.equal(r.out, "你每以此方式移除100生命，\\n反擊技能即有5%機率變為可用")
})

test("reordered numbers use the indexed form (#{k})", () => {
  const r = roundTrip(
    "Trigger Level 20 Goreblossom after spending {0}% of your Maximum Life on Spells",
    "於法術消耗{0}%最大生命後，觸發等級20的湛血盛放",
    "Trigger Level 20 Goreblossom after spending 30% of your Maximum Life on Spells",
    ["#"]
  )
  assert.equal(r.tpl, null) // the sequential form can't express this
  assert.ok(r.idx.includes("#{1}"))
  assert.equal(r.out, "於法術消耗30%最大生命後，觸發等級20的湛血盛放")
})

test("English hard-codes a value the Chinese writes as a placeholder (cond fixed)", () => {
  const r = roundTrip("Contains an additional Unique Item", "內含 {0} 個額外傳奇物品", "Contains an additional Unique Item", ["1"])
  assert.equal(r.out, "內含 1 個額外傳奇物品")
})

test("a Chinese line missing one of the English values is rejected (not a guess)", () => {
  assert.equal(mapLine("{0}% chance to gain {1} Rage", "有 {0}% 機率獲得盛怒"), null)
  assert.equal(mapLineIdx("{0}% chance to gain {1} Rage", "有 {0}% 機率獲得盛怒", ["#", "#"]), null)
})

test("unknown line → null (left in English)", () => {
  assert.equal(fillTemplate({}, {}, "Something brand new"), null)
})

test("regular template wins over an indexed one for the same key", () => {
  const key = normEnRendered("10% increased Cast Speed")
  assert.equal(
    fillTemplate({ [key]: "增加 #% 施放速度" }, { [key]: "錯 #{0}" }, "10% increased Cast Speed"),
    "增加 10% 施放速度"
  )
})

// ---- the shipped data -------------------------------------------------------
const data = JSON.parse(fs.readFileSync(new URL("../data/stat-templates.json", import.meta.url), "utf8"))
const tw = (line) => fillTemplate(data.tw, data.twIdx || {}, line)

test("data: Putrid Seed keeps the hand fix (四個, official text says 一個)", () => {
  assert.match(data.tw.growsfourrandompassiveskillswhenanointed, /四個/)
  // the combined two-line template must not exist, or it would hide the fix
  assert.ok(
    !Object.keys(data.tw).some((k) => k.startsWith("growsfourrandompassiveskillswhenanointedn"))
  )
})

test("data: Mantle of Dreams mod uses the official Chinese (added in 3.30.0c)", () => {
  assert.equal(
    tw("Socketed Gems deal 20% more damage per Socketed Skill Gem"),
    "每鑲嵌一顆技能寶石，插槽中的寶石即造成20%更多傷害"
  )
})

test("data: official direction errors stay fixed", () => {
  assert.match(tw("Minions have 30% less maximum Life"), /更少/)
  assert.match(tw("15% reduced Melee Cold Damage"), /減少/)
  assert.match(tw("Trigger Level 10 Summon Raging Spirit on Kill"), /等級 10/)
})

test("data: no template leaks raw markup or format braces", () => {
  for (const L of ["tw", "cn"]) {
    for (const [k, v] of Object.entries(data[L])) {
      assert.ok(!/[{}<>]/.test(v), `${L} ${k}: ${v}`)
    }
  }
})

test("data: indexed maps only use #{k} placeholders (never a bare #)", () => {
  for (const L of ["twIdx", "cnIdx"]) {
    for (const [k, v] of Object.entries(data[L] || {})) {
      assert.ok(!/#(?!\{\d+\})/.test(v), `${L} ${k}: ${v}`)
      assert.ok(!(k in data[L.slice(0, 2)]), `${L} ${k} duplicates a regular key`)
    }
  }
})

test("data: itemised beast mod names (whole-line) are translated", () => {
  assert.equal(tw("Fertile Presence"), "豐富光環")
  assert.equal(tw("Spectral Swipe"), "靈體擺動")
})

test("data: archnemesis effect lines on itemised beasts are translated", () => {
  assert.equal(tw("Extra Fire Damage and Exposure"), "額外火焰傷害和曝曬")
  assert.equal(tw("Cold, Chill and Freeze Resistant"), "冰冷、冰緩和冰凍抵抗")
  assert.equal(tw("Hasted"), "急速") // some show the modifier NAME instead
})

// ---- other game texts (twText) + essence-style lines -------------------------
import { fillTemplateRanges, translateLine } from "../lib/poe-zh-core/stat-translate.ts"

test("ranges count as one value and come back as (a–b)", () => {
  const key = normEnRendered("10% increased Damage with Bow Skills")
  assert.equal(
    fillTemplateRanges([{ [key]: "增加 #% 弓類技能傷害" }], "(10-19)% increased Damage with Bow Skills"),
    "增加 (10–19)% 弓類技能傷害"
  )
})

test("'<slot>: <effect>' lines translate both parts", () => {
  const key = normEnRendered("10% increased Damage with Bow Skills")
  const out = translateLine({ [key]: "增加 #% 弓類技能傷害" }, {}, { quiver: "箭袋" }, "Quiver: (10-19)% increased Damage with Bow Skills")
  assert.equal(out, "箭袋：增加 (10–19)% 弓類技能傷害")
})

test("data twText: affix names, descriptions, names, labels", () => {
  const T = data.twText
  const line = (s) => translateLine(data.tw, data.twIdx, T, s)
  assert.equal(line("Heavy"), "重量的")
  assert.equal(line("of Renown"), "聲望之")
  assert.equal(line("Supports any skill that hits enemies."), "輔助任何可擊中敵人的技能。")
  assert.equal(line("Releases a caustic cloud when hit"), "被擊中時，釋放腐蝕雲團")
  assert.equal(line("Unidentified"), "未鑑定")
  assert.equal(line("Shipwreck Reef"), "沉船岩礁")
  assert.equal(line("Will be Consumed when you reach 25% of Life"), "當你到達 25% 生命時會被消耗")
})

test("data twText: no markup, braces or bare format strings leak", () => {
  for (const [k, v] of Object.entries(data.twText)) assert.ok(!/[{}<>\[\]|]/.test(v), `${k}: ${v}`)
})

test("data twText: long skill descriptions, placeholders, card flavour, hand-added", () => {
  const line = (s) => translateLine(data.tw, data.twIdx, data.twText, s)
  assert.match(line("Channel to create an expanding circle area around you that blinds enemies within it. When you stop channelling, deals damage in a smaller area around each enemy in the circle. Requires a Dagger, Claw or One-Handed Sword.") ?? "", /^引導施放/)
  assert.equal(line("Properties restricted to level 35 and below"), "屬性限制等級需求35與以下物品")
  // flavour text: one text node with line breaks
  assert.match(line("God had forsaken the land \nAnd Victario wept.\nCorruption consumed the land \nAnd Victario's tears turned to blood.") ?? "", /^神已遺棄此地\n/)
  assert.equal(line("Replaces one"), "取代一個")
  assert.equal(line("Small Dexterity"), "小型敏捷")
})
