import { test } from "node:test"
import assert from "node:assert/strict"

import {
  isSubfolder,
  canHoldSubfolders,
  folderIdSet,
  effectiveParentId,
  collectFolderAndDescendantIds,
  buildFolderTree,
  dedupeTradeIdsAcrossFolders
} from "../lib/services/folder-tree.ts"

test("isSubfolder / canHoldSubfolders reflect parentId", () => {
  assert.equal(isSubfolder({ id: "a" }), false)
  assert.equal(isSubfolder({ id: "b", parentId: "a" }), true)
  assert.equal(canHoldSubfolders({ id: "a" }), true)
  assert.equal(canHoldSubfolders({ id: "b", parentId: "a" }), false)
})

test("collectFolderAndDescendantIds sweeps the parent plus its children", () => {
  const folders = [
    { id: "p" },
    { id: "c1", parentId: "p" },
    { id: "c2", parentId: "p" },
    { id: "other" }
  ]
  const ids = collectFolderAndDescendantIds(folders, "p").sort()
  assert.deepEqual(ids, ["c1", "c2", "p"])
})

test("collectFolderAndDescendantIds on a leaf returns just itself", () => {
  const folders = [{ id: "p" }, { id: "c1", parentId: "p" }]
  assert.deepEqual(collectFolderAndDescendantIds(folders, "c1"), ["c1"])
})

test("effectiveParentId promotes orphans (missing parent) to top-level", () => {
  const ids = folderIdSet([{ id: "a" }, { id: "b", parentId: "a" }])
  assert.equal(effectiveParentId({ id: "b", parentId: "a" }, ids), "a")
  // parent "zzz" does not exist -> orphan -> null (top-level)
  assert.equal(effectiveParentId({ id: "c", parentId: "zzz" }, ids), null)
  assert.equal(effectiveParentId({ id: "a" }, ids), null)
})

test("buildFolderTree groups children under parents, keeps order", () => {
  const folders = [
    { id: "p1" },
    { id: "c1", parentId: "p1" },
    { id: "c2", parentId: "p1" },
    { id: "p2" }
  ]
  const { topLevel, childrenByParent } = buildFolderTree(folders)
  assert.deepEqual(
    topLevel.map((f) => f.id),
    ["p1", "p2"]
  )
  assert.deepEqual(
    (childrenByParent.get("p1") || []).map((f) => f.id),
    ["c1", "c2"]
  )
})

test("buildFolderTree surfaces an orphan as top-level", () => {
  const folders = [{ id: "p1" }, { id: "lost", parentId: "gone" }]
  const { topLevel, childrenByParent } = buildFolderTree(folders)
  assert.deepEqual(
    topLevel.map((f) => f.id),
    ["p1", "lost"]
  )
  assert.equal(childrenByParent.size, 0)
})

test("dedupeTradeIdsAcrossFolders keeps the first occurrence, drops later ones", () => {
  const corrections = dedupeTradeIdsAcrossFolders([
    { folderId: "A", tradeIds: ["t1", "t2"] },
    { folderId: "B", tradeIds: ["t2", "t3"] }
  ])
  // t2 already seen in A, so B drops it; A keeps its copy.
  assert.deepEqual(corrections, [{ folderId: "B", removeIds: ["t2"] }])
})

test("dedupeTradeIdsAcrossFolders returns nothing when there is no overlap", () => {
  const corrections = dedupeTradeIdsAcrossFolders([
    { folderId: "A", tradeIds: ["t1"] },
    { folderId: "B", tradeIds: ["t2"] }
  ])
  assert.deepEqual(corrections, [])
})
