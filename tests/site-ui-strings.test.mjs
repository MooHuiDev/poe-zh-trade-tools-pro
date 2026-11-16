// Parser for the Taiwan trade site's interface table (/js/translate.zh_TW.js).
// The file is JavaScript; we only ever PARSE it as text.
import { test } from "node:test"
import assert from "node:assert/strict"

import { parseSiteTranslations } from "../lib/poe-zh-core/site-ui-strings.ts"

const SAMPLE = `
var __ = {};

__['Ladder'] = '天梯';
__['Showing {COUNT} results'] = '顯示 {COUNT} 個結果';
__["Asking Price:"] = "開價:";
__['Can\\'t find it'] = '找不到';
__['Line\\nBreak'] = '換\\n行';
__['Unicode \\u0041'] = '統一碼';
__['Same'] = 'Same';
__['Empty'] = '';
`

test("parses single- and double-quoted entries", () => {
  const t = parseSiteTranslations(SAMPLE)
  assert.equal(t["Ladder"], "天梯")
  assert.equal(t["Asking Price:"], "開價:")
})

test("keeps the site's own {PLACEHOLDER} tokens untouched", () => {
  assert.equal(parseSiteTranslations(SAMPLE)["Showing {COUNT} results"], "顯示 {COUNT} 個結果")
})

test("unescapes \\' \\n and \\uXXXX", () => {
  const t = parseSiteTranslations(SAMPLE)
  assert.equal(t["Can't find it"], "找不到")
  assert.equal(t["Line\nBreak"], "換\n行")
  assert.equal(t["Unicode A"], "統一碼")
})

test("skips identical and empty translations", () => {
  const t = parseSiteTranslations(SAMPLE)
  assert.ok(!("Same" in t))
  assert.ok(!("Empty" in t))
})

test("never evaluates code: a malicious line is just ignored text", () => {
  const evil = `__['A'] = 'ok'; globalThis.__pwned = true; __['B'] = (function(){ globalThis.__pwned = true; return 'x' })();`
  const t = parseSiteTranslations(evil)
  assert.deepEqual(t, { A: "ok" })
  assert.equal(globalThis.__pwned, undefined)
})

test("garbage / an HTML error page gives an empty table", () => {
  assert.deepEqual(parseSiteTranslations("<!DOCTYPE html><title>404</title>"), {})
})

import { applyCatalogOverrides, CATALOG_URL_RE } from "../lib/poe-zh-core/site-ui-strings.ts"

test("catalog override: 'listed' → 上架於 in GGG's zh_TW gettext catalog", () => {
  const cat = {
    charset: "utf-8",
    translations: { "": { listed: { msgid: "listed", msgstr: ["清單"] }, Search: { msgid: "Search", msgstr: ["搜尋"] } } }
  }
  assert.ok(applyCatalogOverrides(cat, "zh_TW") >= 1)
  assert.deepEqual(cat.translations[""].listed.msgstr, ["上架於"])
  assert.deepEqual(cat.translations[""].Search.msgstr, ["搜尋"]) // untouched
})

test("catalog override: other locales / odd shapes are left alone", () => {
  const cn = { translations: { "": { listed: { msgid: "listed", msgstr: ["上架"] } } } }
  applyCatalogOverrides(cn, "zh_CN")
  assert.deepEqual(cn.translations[""].listed.msgstr, ["上架"]) // zh_CN wording kept
  assert.equal(applyCatalogOverrides({ translations: { "": {} } }, "ja_JP"), 0)
  assert.equal(applyCatalogOverrides(null, "zh_TW"), 0)
  assert.equal(applyCatalogOverrides({ translations: "x" }, "zh_TW"), 0)
})

test("catalog URL pattern", () => {
  assert.equal("https://www.pathofexile.com/dist/zh_TW.3faebea54a1a.json".match(CATALOG_URL_RE)[1], "zh_TW")
  assert.equal("/dist/zh_CN.c6d4e34b5053.json".match(CATALOG_URL_RE)[1], "zh_CN")
  assert.equal("/api/trade/data/stats".match(CATALOG_URL_RE), null)
})

test("catalog override: 'just now' fixed in zh_TW (僅此一次) and added to zh_CN", () => {
  const tw = { translations: { "": { "just now": { msgid: "just now", msgstr: ["僅此一次"] } } } }
  applyCatalogOverrides(tw, "zh_TW")
  assert.deepEqual(tw.translations[""]["just now"].msgstr, ["剛剛"])
  const cn = { translations: { "": {} } }
  applyCatalogOverrides(cn, "zh_CN")
  assert.deepEqual(cn.translations[""]["just now"], { msgid: "just now", msgstr: ["刚刚"] })
})
