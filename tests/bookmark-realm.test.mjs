// Bookmark folders belong to a server (realm): Taiwan ("tw") or international
// ("intl"). A user exported a Taiwan folder, deleted it, imported it back on the
// Taiwan site — and it showed up on the international site (old exports carried
// no server, and a folder without one counts as "intl").
import { test } from "node:test"
import assert from "node:assert/strict"

import { inferRealmFromLeagues, resolveImportRealm } from "../lib/services/bookmark-realm.ts"
import { mergeItems, stampItems } from "../lib/services/sync-merge.ts"

test("old export with no league info goes to the server it is imported on", () => {
  assert.equal(resolveImportRealm(undefined, "tw"), "tw")
  assert.equal(resolveImportRealm(undefined, "intl"), "intl")
})

test("new export keeps its server when imported on the same server", () => {
  assert.equal(resolveImportRealm("tw", "tw"), "tw")
  assert.equal(resolveImportRealm("intl", "intl"), "intl")
})

test("new export imported on the other server is refused (urls don't work there)", () => {
  assert.equal(resolveImportRealm("tw", "intl"), null)
  assert.equal(resolveImportRealm("intl", "tw"), null)
})

test("cross-device sync keeps a folder's server", () => {
  const twFolder = { id: "F1", title: "台服資料夾", version: "1", realm: "tw", icon: null, archivedAt: null }
  const local = stampItems([twFolder], [], { c: 1, d: "deviceA" })
  const merged = mergeItems(local, [], {})
  assert.equal(merged.find((f) => f.id === "F1")?.realm, "tw")
  // the other device receives it unchanged
  const other = mergeItems([], local, {})
  assert.equal(other.find((f) => f.id === "F1")?.realm, "tw")
})

test("server guessed from leagues when the export doesn't say it", () => {
  assert.equal(inferRealmFromLeagues(["巫影密會", "巫影密會"]), "tw")
  assert.equal(inferRealmFromLeagues(["標準模式"]), "tw")
  assert.equal(inferRealmFromLeagues(["Covens", "Standard"]), "intl")
  assert.equal(inferRealmFromLeagues([null, "", undefined]), undefined)
  assert.equal(inferRealmFromLeagues([]), undefined)
})

test("old international export can't be imported on the Taiwan site (reported 4.1.12 test)", () => {
  assert.equal(resolveImportRealm(undefined, "tw", ["Covens", "Hardcore Covens"]), null)
  assert.equal(resolveImportRealm(undefined, "intl", ["Covens"]), "intl")
})

test("old Taiwan export goes back to Taiwan, and is refused on international", () => {
  assert.equal(resolveImportRealm(undefined, "tw", ["巫影密會"]), "tw")
  assert.equal(resolveImportRealm(undefined, "intl", ["巫影密會"]), null)
})

test("server written in the export wins over the league guess", () => {
  assert.equal(resolveImportRealm("tw", "tw", ["Covens"]), "tw")
})
