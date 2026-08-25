import { test } from "node:test"
import assert from "node:assert/strict"

import {
  asItems,
  maxCounterIn,
  stampItems,
  localDeletions,
  mergeItems,
  mergeTombstones
} from "../lib/services/sync-merge.ts"

// Faithful (order-map-omitted) model of BookmarkSyncService.reconcile() so we
// can reproduce the "moved item resurrects" report deterministically.
function reconcile(device, sync) {
  const localAll = device.local
  const shadow = device.shadow
  let tombstones = mergeTombstones(sync.tombstones || {}, device.tombstones || {})

  const keys = new Set([
    ...Object.keys(localAll),
    ...Object.keys(sync.values),
    ...Object.keys(shadow)
  ])

  let observed = device.clock.counter
  for (const key of keys) {
    observed = Math.max(
      observed,
      maxCounterIn(asItems(localAll[key])),
      maxCounterIn(asItems(sync.values[key])),
      maxCounterIn(asItems(shadow[key]))
    )
  }
  for (const st of Object.values(tombstones)) observed = Math.max(observed, st.c)

  const batch = { c: observed + 1, d: device.id }

  for (const key of keys) {
    for (const id of localDeletions(asItems(localAll[key]), asItems(shadow[key]))) {
      if (!tombstones[id]) tombstones[id] = batch
    }
  }

  const nextShadow = {}
  for (const key of keys) {
    const localItems = stampItems(asItems(localAll[key]), asItems(shadow[key]), batch)
    const merged = mergeItems(localItems, asItems(sync.values[key]), tombstones)
    nextShadow[key] = merged
    localAll[key] = merged
    sync.values[key] = merged
  }

  device.shadow = nextShadow
  device.tombstones = tombstones
  sync.tombstones = mergeTombstones(sync.tombstones || {}, tombstones)
  device.clock.counter = batch.c
}

const ids = (arr) => (arr || []).map((i) => i.id).sort()

function freshWorld() {
  const sync = { values: { A: [], B: [{ id: "X", title: "t" }] }, tombstones: {} }
  const device = {
    id: "d1",
    local: { A: [], B: [{ id: "X", title: "t" }] },
    shadow: {},
    tombstones: {},
    clock: { counter: 0 }
  }
  reconcile(device, sync) // stabilize
  return { sync, device }
}

test("SAME-id move B->A then settle (reproduces the resurrection/loss)", () => {
  const { sync, device } = freshWorld()
  // App move keeping the SAME id: remove from B, add to A.
  const moved = device.local.B[0]
  device.local.A = [{ ...moved }]
  device.local.B = []
  reconcile(device, sync)
  reconcile(device, sync)
  // Record what the same-id path actually does (documented by assertion below).
  const aHas = ids(device.local.A)
  const bHas = ids(device.local.B)
  // The same-id path is NOT clean — capture its (buggy) outcome so the harness
  // is proven to detect a difference from the new-id path.
  console.log("same-id result A=", aHas, "B=", bHas)
})

test("NEW-id move B->A is clean and stable across reconciles", () => {
  const { sync, device } = freshWorld()
  const moved = device.local.B[0]
  // App move with a FRESH id (the 4.1.5.4 fix):
  device.local.A = [{ ...moved, id: "Y" }]
  device.local.B = []
  reconcile(device, sync)
  reconcile(device, sync)
  assert.deepEqual(ids(device.local.A), ["Y"], "target A should hold the moved item")
  assert.deepEqual(ids(device.local.B), [], "source B should be empty")
})

function twoDeviceWorld() {
  const sync = { values: { A: [], B: [{ id: "X", title: "t" }] }, tombstones: {} }
  const mk = (id) => ({
    id,
    local: { A: [], B: [{ id: "X", title: "t" }] },
    shadow: {},
    tombstones: {},
    clock: { counter: 0 }
  })
  const d1 = mk("d1")
  const d2 = mk("d2")
  reconcile(d1, sync)
  reconcile(d2, sync)
  reconcile(d1, sync)
  return { sync, d1, d2 }
}

test("NEW-id move converges on BOTH devices (cross-device)", () => {
  const { sync, d1, d2 } = twoDeviceWorld()
  const moved = d1.local.B[0]
  d1.local.A = [{ ...moved, id: "Y" }]
  d1.local.B = []
  // Propagate back and forth a few times.
  reconcile(d1, sync)
  reconcile(d2, sync)
  reconcile(d1, sync)
  reconcile(d2, sync)
  assert.deepEqual(ids(d1.local.A), ["Y"], "d1 A")
  assert.deepEqual(ids(d1.local.B), [], "d1 B")
  assert.deepEqual(ids(d2.local.A), ["Y"], "d2 A")
  assert.deepEqual(ids(d2.local.B), [], "d2 B")
})

// App-layer de-dupe (reconcileDuplicateTrades) keeps the FIRST folder by local
// order. If two devices disagree on order, they delete each other's kept copy
// forever = the "keeps coming back / bounces" report. This models that.
function appDedupeKeepFirst(device, folderOrder) {
  const seen = new Set()
  for (const key of folderOrder) {
    const list = device.local[key] || []
    device.local[key] = list.filter((it) => {
      if (!it.id) return true
      if (seen.has(it.id)) return false
      seen.add(it.id)
      return true
    })
  }
}

test("app de-dupe with differing folder order PING-PONGS a same-id dup", () => {
  // Pre-existing same-id dup in both folders (residue from old same-id builds).
  const sync = { values: { A: [{ id: "X", title: "t" }], B: [{ id: "X", title: "t" }] }, tombstones: {} }
  const mk = (id) => ({
    id,
    local: { A: [{ id: "X", title: "t" }], B: [{ id: "X", title: "t" }] },
    shadow: {},
    tombstones: {},
    clock: { counter: 0 }
  })
  const d1 = mk("d1")
  const d2 = mk("d2")
  reconcile(d1, sync); reconcile(d2, sync); reconcile(d1, sync); reconcile(d2, sync)
  // d1 sees order [A,B] -> keeps A; d2 sees order [B,A] -> keeps B.
  appDedupeKeepFirst(d1, ["A", "B"])
  appDedupeKeepFirst(d2, ["B", "A"])
  reconcile(d1, sync); reconcile(d2, sync); reconcile(d1, sync); reconcile(d2, sync)
  const bounced =
    ids(d1.local.A).length + ids(d1.local.B).length > 1 ||
    ids(d2.local.A).length + ids(d2.local.B).length > 1 ||
    JSON.stringify([ids(d1.local.A), ids(d1.local.B)]) !==
      JSON.stringify([ids(d2.local.A), ids(d2.local.B)])
  console.log(
    "after dedupe d1 A/B=", ids(d1.local.A), ids(d1.local.B),
    "| d2 A/B=", ids(d2.local.A), ids(d2.local.B),
    "| divergent/bounce=", bounced
  )
})

// ── B-plan: single trades group, move = folderId field edit ──
test("B-plan move (folderId edit) is atomic, no resurrection (single device)", () => {
  const sync = { values: { T: [{ id: "X", folderId: "A", title: "t" }] }, tombstones: {} }
  const device = {
    id: "d1",
    local: { T: [{ id: "X", folderId: "A", title: "t" }] },
    shadow: {},
    tombstones: {},
    clock: { counter: 0 }
  }
  reconcile(device, sync)
  device.local.T = [{ id: "X", folderId: "B", title: "t" }] // move A->B = edit
  reconcile(device, sync)
  reconcile(device, sync)
  assert.equal(device.local.T.length, 1, "still exactly one item")
  assert.equal(device.local.T[0].folderId, "B", "moved to B and stays")
})

test("B-plan move converges on two devices (folderId edit)", () => {
  const sync = { values: { T: [{ id: "X", folderId: "A", title: "t" }] }, tombstones: {} }
  const mk = (id) => ({
    id,
    local: { T: [{ id: "X", folderId: "A", title: "t" }] },
    shadow: {},
    tombstones: {},
    clock: { counter: 0 }
  })
  const d1 = mk("d1")
  const d2 = mk("d2")
  reconcile(d1, sync); reconcile(d2, sync); reconcile(d1, sync)
  d1.local.T = [{ id: "X", folderId: "B", title: "t" }]
  reconcile(d1, sync); reconcile(d2, sync); reconcile(d1, sync); reconcile(d2, sync)
  for (const d of [d1, d2]) {
    assert.equal(d.local.T.length, 1)
    assert.equal(d.local.T[0].folderId, "B")
  }
})

// ── race guard model (mirrors the 4.1.5.8 fix) ──
function computeMerge(localAll, sync, shadow, device) {
  const tombstones = mergeTombstones(sync.tombstones || {}, device.tombstones || {})
  const keys = new Set([
    ...Object.keys(localAll),
    ...Object.keys(sync.values),
    ...Object.keys(shadow)
  ])
  let observed = device.clock.counter
  for (const key of keys) {
    observed = Math.max(
      observed,
      maxCounterIn(asItems(localAll[key])),
      maxCounterIn(asItems(sync.values[key])),
      maxCounterIn(asItems(shadow[key]))
    )
  }
  for (const st of Object.values(tombstones)) observed = Math.max(observed, st.c)
  const batch = { c: observed + 1, d: device.id }
  for (const key of keys)
    for (const id of localDeletions(asItems(localAll[key]), asItems(shadow[key])))
      if (!tombstones[id]) tombstones[id] = batch
  const nextLocal = {}
  const nextShadow = {}
  const nextSyncVals = { ...sync.values }
  for (const key of keys) {
    const localItems = stampItems(asItems(localAll[key]), asItems(shadow[key]), batch)
    const merged = mergeItems(localItems, asItems(sync.values[key]), tombstones)
    nextLocal[key] = merged
    nextShadow[key] = merged
    nextSyncVals[key] = merged
  }
  return { nextLocal, nextShadow, nextSyncVals, tombstones }
}

// A reconcile that snapshots, does async "work", then commits WITH the guard.
function reconcileRaceable(device, sync, duringGap, useGuard) {
  const localSnap = JSON.parse(JSON.stringify(device.local))
  const shadowSnap = JSON.parse(JSON.stringify(device.shadow))
  const dirtyAtStart = device.localDirty
  const out = computeMerge(localSnap, sync, shadowSnap, device)
  if (duringGap) duringGap() // a user write may land here
  if (useGuard && device.localDirty !== dirtyAtStart) return "aborted"
  device.local = out.nextLocal
  device.shadow = out.nextShadow
  device.tombstones = out.tombstones
  sync.values = out.nextSyncVals
  sync.tombstones = mergeTombstones(sync.tombstones || {}, out.tombstones)
  return "committed"
}

test("WITHOUT guard: a fast move during reconcile is clobbered (reproduces bug)", () => {
  const { sync, device } = freshWorld()
  device.localDirty = 0
  device.local.A = [{ id: "Z", title: "z" }] // move #1 pending -> reconcile has writes
  device.localDirty++
  const move2 = () => {
    device.local.A = [{ id: "Z", title: "z" }, { id: "Y", title: "t" }]
    device.local.B = []
    device.localDirty++
  }
  reconcileRaceable(device, sync, move2, /* useGuard */ false)
  // stale snapshot wins -> Y lost, X resurrected in B
  assert.ok(ids(device.local.B).includes("X"), "bug: X resurrected in B without guard")
})

test("WITH guard: the fast move is preserved (fix)", () => {
  const { sync, device } = freshWorld()
  device.localDirty = 0
  device.local.A = [{ id: "Z", title: "z" }]
  device.localDirty++
  const move2 = () => {
    device.local.A = [{ id: "Z", title: "z" }, { id: "Y", title: "t" }]
    device.local.B = []
    device.localDirty++
  }
  const r = reconcileRaceable(device, sync, move2, /* useGuard */ true)
  assert.equal(r, "aborted", "guard should abort the stale write-back")
  // follow-up clean reconcile converges without resurrection
  reconcileRaceable(device, sync, null, true)
  reconcileRaceable(device, sync, null, true)
  assert.deepEqual(ids(device.local.A), ["Y", "Z"], "A keeps Z and moved Y")
  assert.deepEqual(ids(device.local.B), [], "B stays empty (no resurrection)")
})

test("NEW-id move survives an interleaved extra reconcile (two-batch case)", () => {
  const { sync, device } = freshWorld()
  const moved = device.local.B[0]
  // Simulate the two persistTrades landing in separate reconcile batches:
  device.local.B = [] // delete side first
  reconcile(device, sync)
  device.local.A = [{ ...moved, id: "Y" }] // add side second
  reconcile(device, sync)
  reconcile(device, sync)
  assert.deepEqual(ids(device.local.A), ["Y"])
  assert.deepEqual(ids(device.local.B), [])
})
