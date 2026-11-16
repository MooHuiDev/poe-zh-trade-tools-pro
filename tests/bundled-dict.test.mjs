// The bundled unique-name dictionaries (offline fallback) must agree with the
// remote data/unique-names.json. They drifted once: Malachai's Loop stayed 輪迴
// in dict.ts while the data said 馬拉凱的輪迴, and the page showed the stale name
// (fixed in 4.1.12 by also letting the remote-built map win on the page).
import { test } from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs"

import { SUPPLEMENT_ZH_TW } from "../lib/poe-zh-supplement/dict.ts"
import { SUPPLEMENT_ZH_CN } from "../lib/poe-zh-supplement/dict-cn.ts"

const remote = JSON.parse(fs.readFileSync(new URL("../data/unique-names.json", import.meta.url), "utf8"))

for (const [lang, bundled] of [["tw", SUPPLEMENT_ZH_TW], ["cn", SUPPLEMENT_ZH_CN]]) {
  test(`bundled ${lang} dictionary matches data/unique-names.json`, () => {
    const diff = Object.keys(bundled)
      .filter((k) => k in remote[lang] && remote[lang][k] !== bundled[k])
      .map((k) => `${k}: bundled ${bundled[k]} / data ${remote[lang][k]}`)
    assert.deepEqual(diff, [])
  })
}

test("Malachai's Loop uses the official Taiwan name", () => {
  assert.equal(remote.tw.malachaisloop, "馬拉凱的輪迴")
  assert.equal(SUPPLEMENT_ZH_TW.malachaisloop, "馬拉凱的輪迴")
})
