import { test } from "node:test"
import assert from "node:assert/strict"

import {
  asItems,
  maxCounterIn,
  stampItems,
  localDeletions,
  mergeItems,
  mergeTombstones,
  sameRelativeOrder,
  lamportIso,
  isoMax,
  orderBySeq
} from "../lib/services/sync-merge.ts"

// Reconcile model INCLUDING the order map (mirrors bookmarks-sync.ts order code),
// to verify a reorder on device A propagates to device B.
function reconcile(device, sync) {
  const tombstones = mergeTombstones(sync.tombstones || {}, device.tombstones || {})
  const itemKeys = new Set([
    ...Object.keys(device.local),
    ...Object.keys(sync.values),
    ...Object.keys(device.shadow)
  ])

  let observed = device.clock.counter
  for (const key of itemKeys) {
    observed = Math.max(
      observed,
      maxCounterIn(asItems(device.local[key])),
      maxCounterIn(asItems(sync.values[key])),
      maxCounterIn(asItems(device.shadow[key]))
    )
  }
  const batch = { c: observed + 1, d: device.id }
  for (const key of itemKeys)
    for (const id of localDeletions(asItems(device.local[key]), asItems(device.shadow[key])))
      if (!tombstones[id]) tombstones[id] = batch

  const localOrders = device.orders || {}
  const syncOrders = sync.orders || {}
  const nextOrders = {}
  const nextShadow = {}

  for (const key of itemKeys) {
    const localItems = stampItems(asItems(device.local[key]), asItems(device.shadow[key]), batch)
    let merged = mergeItems(localItems, asItems(sync.values[key]), tombstones)

    const localSeq = localItems.map((i) => i.id).filter(Boolean)
    const recorded = localOrders[key]
    const syncOrder = syncOrders[key]
    const reordered = recorded
      ? !sameRelativeOrder(localSeq, recorded.seq)
      : localSeq.length > 0
    let ownU = recorded?.u
    if (reordered) ownU = lamportIso(recorded?.u, syncOrder?.u)
    const useLocalOrder = (ownU || "") >= (syncOrder?.u || "")
    const winnerSeq = useLocalOrder ? localSeq : syncOrder.seq
    merged = orderBySeq(merged, winnerSeq)
    if (merged.length > 0) {
      nextOrders[key] = {
        seq: merged.map((i) => i.id).filter(Boolean),
        u: isoMax(ownU, syncOrder?.u) || new Date().toISOString()
      }
    }

    nextShadow[key] = merged
    device.local[key] = merged
    sync.values[key] = merged
  }

  device.shadow = nextShadow
  device.orders = nextOrders
  sync.orders = { ...sync.orders, ...nextOrders }
  device.tombstones = tombstones
  sync.tombstones = mergeTombstones(sync.tombstones || {}, tombstones)
  device.clock.counter = batch.c
}

const seq = (arr) => (arr || []).map((i) => i.id)

test("reorder on A propagates to B via the order map", () => {
  const items = () => [
    { id: "a", folderId: "F", title: "a" },
    { id: "b", folderId: "F", title: "b" },
    { id: "c", folderId: "F", title: "c" }
  ]
  const sync = { values: { T: items() }, orders: {}, tombstones: {} }
  const mk = (id) => ({ id, local: { T: items() }, shadow: {}, orders: {}, clock: { counter: 0 } })
  const d1 = mk("d1")
  const d2 = mk("d2")
  // establish baseline
  reconcile(d1, sync); reconcile(d2, sync); reconcile(d1, sync); reconcile(d2, sync)

  // A reorders to [c, a, b]
  d1.local.T = [
    { id: "c", folderId: "F", title: "c" },
    { id: "a", folderId: "F", title: "a" },
    { id: "b", folderId: "F", title: "b" }
  ]
  reconcile(d1, sync)
  reconcile(d2, sync)
  reconcile(d1, sync)
  reconcile(d2, sync)

  assert.deepEqual(seq(d1.local.T), ["c", "a", "b"], "A keeps its order")
  assert.deepEqual(seq(d2.local.T), ["c", "a", "b"], "B adopts A's order")
})
