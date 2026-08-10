// Unit tests for the pure bookmark-sync logic (no chrome APIs).
// Run: node --test tests/sync-merge.test.mjs   (Node >= 22.18 strips TS types)
import test from "node:test"
import assert from "node:assert/strict"
import {
  asStamp,
  cmpStamp,
  mergeItems,
  mergeTombstones,
  stampItems,
  localDeletions,
  splitPayload,
  reassembleChunks,
  parseSyncKey,
  manifestKey,
  chunkKey
} from "../lib/services/sync-merge.ts"

const S = (c, d) => ({ c, d })
const it = (id, extra = {}, u) => ({ id, ...extra, ...(u ? { _u: u } : {}) })

test("asStamp: legacy/missing treated as oldest", () => {
  assert.deepEqual(asStamp(undefined), { c: 0, d: "" })
  assert.deepEqual(asStamp("2026-01-01T00:00:00Z"), { c: 0, d: "" })
  assert.deepEqual(asStamp(S(3, "a")), S(3, "a"))
})

test("cmpStamp: counter first, deviceId tie-breaker", () => {
  assert.ok(cmpStamp(S(2, "a"), S(1, "z")) > 0)
  assert.ok(cmpStamp(S(1, "b"), S(1, "a")) > 0)
  assert.equal(cmpStamp(S(1, "a"), S(1, "a")), 0)
})

test("union never loses unrelated items (concurrent add on two devices)", () => {
  const m = mergeItems([it("A", {}, S(1, "L"))], [it("B", {}, S(1, "R"))], {})
  assert.deepEqual(new Set(m.map((x) => x.id)), new Set(["A", "B"]))
})

test("same id: newer stamp wins (concurrent edit)", () => {
  const m = mergeItems(
    [it("A", { t: "old" }, S(1, "L"))],
    [it("A", { t: "new" }, S(2, "R"))],
    {}
  )
  assert.equal(m[0].t, "new")
})

test("delete-then-edit: edit after delete resurrects", () => {
  assert.equal(mergeItems([it("A", { t: "e" }, S(3, "L"))], [], { A: S(2, "R") }).length, 1)
})

test("edit-then-delete: later delete removes", () => {
  assert.equal(mergeItems([it("A", {}, S(2, "L"))], [], { A: S(3, "R") }).length, 0)
})

test("recreate-with-new-id unaffected by old tombstone", () => {
  assert.equal(mergeItems([it("A2", {}, S(1, "L"))], [], { A: S(5, "R") }).length, 1)
})

test("device returning after retention: old item stays deleted (no resurrection)", () => {
  assert.equal(mergeItems([it("A", {}, S(1, "OLD"))], [], { A: S(5, "R") }).length, 0)
})

test("empty remote + no local deletion: local preserved (empty Sync never wipes)", () => {
  const local = [it("A", {}, S(1, "L")), it("B", {}, S(1, "L"))]
  assert.equal(mergeItems(local, [], {}).length, 2)
})

test("localDeletions: only ids present in shadow but missing locally", () => {
  assert.deepEqual(localDeletions([it("A")], [it("A"), it("B")]), ["B"])
})

test("mergeTombstones: newer stamp kept, union of ids", () => {
  const m = mergeTombstones({ A: S(1, "a") }, { A: S(3, "b"), B: S(1, "c") })
  assert.deepEqual(m.A, S(3, "b"))
  assert.deepEqual(m.B, S(1, "c"))
})

test("stampItems: changed gets batch, unchanged inherits shadow stamp", () => {
  const batch = S(9, "D")
  const out = stampItems(
    [it("A", { t: "x" }, S(1, "P")), it("B", { t: "new" })],
    [it("A", { t: "x" }, S(1, "P"))],
    batch
  )
  assert.deepEqual(out[0]._u, S(1, "P"))
  assert.deepEqual(out[1]._u, batch)
})

test("chunk split + reassemble round-trip (rebuild from complete manifest)", () => {
  const payload = "x".repeat(13000)
  const parts = splitPayload(payload, 6000)
  assert.equal(parts.length, 3)
  const chunkMap = Object.fromEntries(parts.map((p, i) => [i, p]))
  assert.equal(reassembleChunks({ v: 1, z: false, n: parts.length }, chunkMap), payload)
})

test("incomplete/missing chunk set reassembles to null (falls back to legacy)", () => {
  assert.equal(reassembleChunks({ v: 1, z: false, n: 3 }, { 0: "a", 1: "b" }), null)
  assert.equal(reassembleChunks(undefined, { 0: "a" }), null)
})

test("parseSyncKey and key builders", () => {
  assert.deepEqual(parseSyncKey("bookmark-folders@m"), {
    base: "bookmark-folders",
    kind: "manifest",
    index: -1
  })
  assert.deepEqual(parseSyncKey("bookmark-folders@c2"), {
    base: "bookmark-folders",
    kind: "chunk",
    index: 2
  })
  assert.deepEqual(parseSyncKey("bookmark-folders"), {
    base: "bookmark-folders",
    kind: "legacy",
    index: -1
  })
  assert.deepEqual(parseSyncKey("bookmark-trades--abc@c0"), {
    base: "bookmark-trades--abc",
    kind: "chunk",
    index: 0
  })
  assert.equal(manifestKey("x"), "x@m")
  assert.equal(chunkKey("x", 5), "x@c5")
})
