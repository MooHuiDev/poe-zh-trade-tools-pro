import { writable } from "svelte/store"

import { ext } from "../utilities/ext-api"
import {
  hasValidExtensionContext,
  isExtensionContextInvalidatedError
} from "../utilities/extension-context"

/**
 * Cross-device bookmark sync (opt-in, default OFF).
 *
 * Safe-by-design: it NEVER overwrites the whole bookmark set. Every reconcile is
 * an item-level UNION keyed by `id`, so an unrelated bookmark on either device is
 * never lost. Conflicts on the same id are resolved by a per-item `_u`
 * (updatedAt) stamp. Deletions propagate through a tombstone map. If the browser
 * Sync store is unexpectedly emptied, the union simply re-pushes the local copy
 * (we only create tombstones from LOCAL deletions), so an empty cloud can never
 * wipe a device.
 *
 * Decoupled from BookmarksService: it drives everything through chrome.storage,
 * and BookmarksService already re-renders on local storage changes.
 */

const FOLDERS_KEY = "bookmark-folders"
const TRADES_PREFIX = "bookmark-trades--"
const TOMBSTONES_KEY = "bookmark-sync-tombstones"
const ORDERS_KEY = "bookmark-sync-orders"
const SHADOW_KEY = "bookmark-sync-shadow"
const ENABLED_KEY = "bookmark-sync-enabled"
const RECONCILE_DEBOUNCE_MS = 500
const TOMBSTONE_TTL_MS = 30 * 24 * 60 * 60 * 1000 // 30 days

type Item = { id?: string; _u?: string; [k: string]: unknown }
type LocalPayload = { value: unknown; expiresAt: string | null }
type Tombstones = Record<string, string> // id -> deletedAt ISO
type OrderEntry = { seq: string[]; u: string } // id order + Lamport stamp
type OrderMap = Record<string, OrderEntry> // managed key -> order
type Shadow = Record<string, Item[]> // managed key -> items (with _u)

export type BookmarkSyncState = {
  enabled: boolean
  lastSyncedAt: string | null
  error: string | null
}

const isManagedItemsKey = (key: string) =>
  key === FOLDERS_KEY || key.startsWith(TRADES_PREFIX)

const nowIso = () => new Date().toISOString()

// Deep-equal ignoring the `_u` bookkeeping field.
const sameItem = (a: Item | undefined, b: Item | undefined): boolean => {
  const strip = (x: Item | undefined) => {
    if (!x) return x
    const { _u, ...rest } = x
    return rest
  }
  return JSON.stringify(strip(a)) === JSON.stringify(strip(b))
}

const asItems = (value: unknown): Item[] =>
  Array.isArray(value) ? (value as Item[]) : []

// Lamport-style stamp: strictly greater than every `seen` value AND >= now, so an
// edit made after observing another device's value always wins — immune to
// wall-clock skew between machines.
const lamportIso = (...seen: (string | undefined)[]): string => {
  let m = Date.now()
  for (const s of seen) {
    const t = s ? Date.parse(s) : 0
    if (!Number.isNaN(t) && t >= m) m = t + 1
  }
  return new Date(m).toISOString()
}

const isoMax = (...vals: (string | undefined)[]): string => {
  let m = 0
  for (const v of vals) {
    const t = v ? Date.parse(v) : 0
    if (!Number.isNaN(t) && t > m) m = t
  }
  return new Date(m).toISOString()
}

// Do two id lists agree on the relative order of the ids they share?
const sameRelativeOrder = (a: string[], b: string[]): boolean => {
  const bset = new Set(b)
  const aset = new Set(a)
  const af = a.filter((id) => bset.has(id))
  const bf = b.filter((id) => aset.has(id))
  return JSON.stringify(af) === JSON.stringify(bf)
}

// Order `items` by the id sequence `seq`; ids not in seq keep their trailing order.
const orderBySeq = (items: Item[], seq: string[]): Item[] => {
  const rank = new Map(seq.map((id, i) => [id, i]))
  const big = seq.length
  return items
    .map((item, i) => ({ item, i }))
    .sort((x, y) => {
      const rx = rank.has(x.item.id!) ? rank.get(x.item.id!)! : big + x.i
      const ry = rank.has(y.item.id!) ? rank.get(y.item.id!)! : big + y.i
      return rx - ry
    })
    .map((x) => x.item)
}

// ── gzip helpers (shrink data to fit storage.sync's 8KB/item, 100KB total) ──
const SYNC_RAW = 1
const SYNC_GZIP = 2
const compressionAvailable = () =>
  typeof CompressionStream !== "undefined" &&
  typeof DecompressionStream !== "undefined" &&
  typeof btoa !== "undefined"

const bytesToBase64 = (bytes: Uint8Array) => {
  let binary = ""
  for (const b of bytes) binary += String.fromCharCode(b)
  return btoa(binary)
}
const base64ToBytes = (value: string) =>
  Uint8Array.from(atob(value), (c) => c.charCodeAt(0))

const gzip = async (value: string) => {
  const stream = new Blob([value])
    .stream()
    .pipeThrough(new CompressionStream("gzip"))
  return new Uint8Array(await new Response(stream).arrayBuffer())
}
const gunzip = async (bytes: Uint8Array) => {
  const stream = new Blob([bytes.buffer as ArrayBuffer])
    .stream()
    .pipeThrough(new DecompressionStream("gzip"))
  return new Response(stream).text()
}

class BookmarkSyncService {
  private static instance: BookmarkSyncService
  private started = false
  private reconcileTimer: ReturnType<typeof setTimeout> | null = null
  private applying = false // re-entrancy guard for our own writes

  private store = writable<BookmarkSyncState>({
    enabled: false,
    lastSyncedAt: null,
    error: null
  })
  public subscribe = this.store.subscribe

  static getInstance() {
    if (!this.instance) this.instance = new BookmarkSyncService()
    return this.instance
  }

  /** Read the persisted flag and start listening if sync was left on. */
  async init() {
    if (!this.hasStorage()) return
    const enabled = (await this.getLocalRaw<string>(ENABLED_KEY)) === "true"
    this.patch({ enabled })
    if (enabled) this.start()
  }

  async enable() {
    if (!this.hasStorage()) return
    await this.setLocalRaw(ENABLED_KEY, "true")
    this.patch({ enabled: true, error: null })
    // Seed the shadow from the current local state so the first reconcile does
    // not mistake existing bookmarks for remote deletions.
    await this.seedShadowFromLocal()
    this.start()
    this.scheduleReconcile()
  }

  async disable() {
    await this.setLocalRaw(ENABLED_KEY, "")
    this.patch({ enabled: false })
    this.stop()
    // Intentionally leave the Sync store intact so re-enabling is seamless.
  }

  // ─── listeners ────────────────────────────────────────────

  private start() {
    if (this.started || !this.hasStorage()) return
    this.started = true
    chrome.storage.onChanged.addListener(this.onChanged)
  }

  private stop() {
    if (!this.started) return
    this.started = false
    chrome.storage.onChanged.removeListener(this.onChanged)
    if (this.reconcileTimer) clearTimeout(this.reconcileTimer)
  }

  private onChanged = (
    changes: Record<string, chrome.storage.StorageChange>,
    area: string
  ) => {
    if (this.applying) return
    if (area !== "local" && area !== "sync") return
    const touched = Object.keys(changes).some(
      (k) => isManagedItemsKey(k) || k === TOMBSTONES_KEY || k === ORDERS_KEY
    )
    if (touched) this.scheduleReconcile()
  }

  private scheduleReconcile() {
    if (this.reconcileTimer) clearTimeout(this.reconcileTimer)
    this.reconcileTimer = setTimeout(() => {
      this.reconcileTimer = null
      void this.reconcile()
    }, RECONCILE_DEBOUNCE_MS)
  }

  // ─── core reconcile ───────────────────────────────────────

  private async reconcile() {
    if (!this.hasStorage()) return
    try {
      const localAll = await ext.storage.local.get(null)
      const syncAll = await ext.storage.sync.get(null)

      // Sync values are gzip-compressed envelopes; decode them all up front.
      const syncDecoded: Record<string, unknown> = {}
      for (const k of Object.keys(syncAll)) {
        syncDecoded[k] = await this.syncDecode(syncAll[k])
      }

      const shadow: Shadow =
        (this.unwrap(localAll[SHADOW_KEY]) as Shadow) || {}
      let tombstones: Tombstones = {
        ...((syncDecoded[TOMBSTONES_KEY] as Tombstones) || {}),
        ...((this.unwrap(localAll[TOMBSTONES_KEY]) as Tombstones) || {})
      }

      // Every managed items key seen on either side, plus any in the shadow.
      const keys = new Set<string>()
      for (const k of Object.keys(localAll)) if (isManagedItemsKey(k)) keys.add(k)
      for (const k of Object.keys(syncAll)) if (isManagedItemsKey(k)) keys.add(k)
      for (const k of Object.keys(shadow)) if (isManagedItemsKey(k)) keys.add(k)

      // 1) Derive tombstones from LOCAL deletions only (shadow had it, local
      //    dropped it). Remote deletions arrive via the synced tombstone map.
      for (const key of keys) {
        const localItems = asItems(this.unwrap(localAll[key]))
        const shadowItems = shadow[key] || []
        const localIds = new Set(localItems.map((i) => i.id))
        for (const s of shadowItems) {
          if (s.id && !localIds.has(s.id) && !tombstones[s.id]) {
            tombstones[s.id] = nowIso()
          }
        }
      }
      tombstones = this.pruneTombstones(tombstones)

      const localOrders: OrderMap =
        (this.unwrap(localAll[ORDERS_KEY]) as OrderMap) || {}
      const syncOrders: OrderMap =
        (syncDecoded[ORDERS_KEY] as OrderMap) || {}
      const nextOrders: OrderMap = {}

      // 2) Stamp updatedAt on local items that changed vs shadow, merge each key
      //    as a union (membership), then decide the ORDER via a Lamport-stamped
      //    order map (whoever reordered most recently wins the sequence).
      const nextShadow: Shadow = {}
      const localWrites: Record<string, LocalPayload> = {}
      const syncWrites: Record<string, unknown> = {}
      const syncRemoves: string[] = []

      for (const key of keys) {
        const localItems = this.stamp(
          asItems(this.unwrap(localAll[key])),
          shadow[key] || []
        )
        const syncItems = asItems(syncDecoded[key])
        let merged = this.mergeItems(localItems, syncItems, tombstones)

        // ── ordering ──
        const localSeq = localItems.map((i) => i.id!).filter(Boolean)
        const recorded = localOrders[key]
        const syncOrder = syncOrders[key]
        const reordered = recorded
          ? !sameRelativeOrder(localSeq, recorded.seq)
          : localSeq.length > 0
        let ownU = recorded?.u
        if (reordered) ownU = lamportIso(recorded?.u, syncOrder?.u)
        const useLocalOrder = (ownU || "") >= (syncOrder?.u || "")
        const winnerSeq = useLocalOrder ? localSeq : syncOrder!.seq
        merged = orderBySeq(merged, winnerSeq)
        if (merged.length > 0) {
          nextOrders[key] = {
            seq: merged.map((i) => i.id!).filter(Boolean),
            u: isoMax(ownU, syncOrder?.u) || nowIso()
          }
        }

        nextShadow[key] = merged

        const localCur = asItems(this.unwrap(localAll[key]))
        if (!this.sameList(localCur, merged)) {
          localWrites[key] = { value: merged, expiresAt: null }
        }
        const syncCur = asItems(syncDecoded[key])
        if (!this.sameList(syncCur, merged)) {
          if (merged.length === 0) syncRemoves.push(key)
          else syncWrites[key] = merged
        }
      }

      // Local bookkeeping writes, change-gated.
      const localBookkeeping: Record<string, LocalPayload> = {}
      const prevShadow = this.unwrap(localAll[SHADOW_KEY])
      if (JSON.stringify(prevShadow) !== JSON.stringify(nextShadow)) {
        localBookkeeping[SHADOW_KEY] = { value: nextShadow, expiresAt: null }
      }
      const prevLocalTomb = this.unwrap(localAll[TOMBSTONES_KEY])
      if (JSON.stringify(prevLocalTomb) !== JSON.stringify(tombstones)) {
        localBookkeeping[TOMBSTONES_KEY] = { value: tombstones, expiresAt: null }
      }
      const prevSyncTomb = syncDecoded[TOMBSTONES_KEY]
      const syncTombChanged =
        JSON.stringify(prevSyncTomb) !== JSON.stringify(tombstones)

      if (JSON.stringify(localOrders) !== JSON.stringify(nextOrders)) {
        localBookkeeping[ORDERS_KEY] = { value: nextOrders, expiresAt: null }
      }
      const syncOrdersChanged =
        JSON.stringify(syncDecoded[ORDERS_KEY] || {}) !==
        JSON.stringify(nextOrders)

      const nothingToDo =
        !Object.keys(localWrites).length &&
        !Object.keys(localBookkeeping).length &&
        !Object.keys(syncWrites).length &&
        !syncRemoves.length &&
        !syncTombChanged &&
        !syncOrdersChanged

      // 3) Persist. Every write below is change-gated, so a steady state does
      //    zero writes and cannot echo into an infinite loop.
      if (!nothingToDo) {
        this.applying = true
        try {
          if (Object.keys(localWrites).length) {
            await ext.storage.local.set(localWrites)
          }
          if (Object.keys(localBookkeeping).length) {
            await ext.storage.local.set(localBookkeeping)
          }
          if (Object.keys(syncWrites).length) {
            const encoded: Record<string, unknown> = {}
            for (const [k, v] of Object.entries(syncWrites)) {
              encoded[k] = await this.syncEncode(v)
            }
            await ext.storage.sync.set(encoded)
          }
          if (syncRemoves.length) await ext.storage.sync.remove(syncRemoves)
          if (syncTombChanged) {
            await ext.storage.sync.set({
              [TOMBSTONES_KEY]: await this.syncEncode(tombstones)
            })
          }
          if (syncOrdersChanged) {
            await ext.storage.sync.set({
              [ORDERS_KEY]: await this.syncEncode(nextOrders)
            })
          }
        } finally {
          setTimeout(() => {
            this.applying = false
          }, 50)
        }
      }

      this.patch({ lastSyncedAt: nowIso(), error: null })
    } catch (error) {
      if (isExtensionContextInvalidatedError(error)) return
      const message =
        error instanceof Error && /quota|QUOTA/.test(error.message)
          ? "quota"
          : "error"
      console.warn("[bookmark-sync] reconcile failed", error)
      this.patch({ error: message })
    }
  }

  // Union by id; newer `_u` wins; drop ids whose tombstone is newer than the
  // surviving item's `_u` (a later edit resurrects, a later delete removes).
  private mergeItems(
    local: Item[],
    remote: Item[],
    tombstones: Tombstones
  ): Item[] {
    const byId = new Map<string, Item>()
    const order: string[] = []
    const consider = (item: Item) => {
      if (!item.id) return
      const prev = byId.get(item.id)
      if (!prev) {
        order.push(item.id)
        byId.set(item.id, item)
        return
      }
      const a = prev._u || ""
      const b = item._u || ""
      if (b >= a) byId.set(item.id, item)
    }
    // Local first so its insertion order is preserved for stable-looking lists.
    local.forEach(consider)
    remote.forEach(consider)

    const result: Item[] = []
    for (const id of order) {
      const item = byId.get(id)!
      const deletedAt = tombstones[id]
      if (deletedAt && !(item._u && item._u > deletedAt)) continue
      result.push(item)
    }
    return result
  }

  // Stamp changed/new items with a Lamport `_u` (strictly newer than any version
  // this device has seen for that item), so an edit made after observing the
  // other device's value always wins — regardless of wall-clock skew. Unchanged
  // items inherit the shadow's `_u`.
  private stamp(current: Item[], shadow: Item[]): Item[] {
    const shadowById = new Map(shadow.filter((i) => i.id).map((i) => [i.id, i]))
    return current.map((item) => {
      if (!item.id) return item
      const prev = shadowById.get(item.id)
      if (prev && sameItem(item, prev)) {
        return item._u ? item : { ...item, _u: prev._u || nowIso() }
      }
      return { ...item, _u: lamportIso(item._u, prev?._u) }
    })
  }

  // Encode a value for storage.sync: gzip+base64 in a tagged envelope when that
  // is smaller, else a raw envelope. Falls back to raw if compression is
  // unavailable. Shrinks payloads to fit the 8KB-per-item / 100KB-total quota.
  private async syncEncode(value: unknown): Promise<unknown> {
    const raw: [number, unknown] = [SYNC_RAW, value]
    if (!compressionAvailable()) return raw
    try {
      const compressed: [number, string] = [
        SYNC_GZIP,
        bytesToBase64(await gzip(JSON.stringify(value)))
      ]
      return JSON.stringify(compressed).length < JSON.stringify(raw).length
        ? compressed
        : raw
    } catch {
      return raw
    }
  }

  // Decode a stored sync value. Handles gzip and raw envelopes, and treats any
  // untagged legacy value (from before compression) as raw for compatibility.
  private async syncDecode(stored: unknown): Promise<unknown> {
    if (Array.isArray(stored) && stored.length === 2) {
      if (stored[0] === SYNC_GZIP && typeof stored[1] === "string") {
        return JSON.parse(await gunzip(base64ToBytes(stored[1])))
      }
      if (stored[0] === SYNC_RAW) return stored[1]
    }
    return stored
  }

  private async seedShadowFromLocal() {
    if (!this.hasStorage()) return
    const localAll = await ext.storage.local.get(null)
    const shadow: Shadow = {}
    for (const key of Object.keys(localAll)) {
      if (!isManagedItemsKey(key)) continue
      shadow[key] = this.stamp(asItems(this.unwrap(localAll[key])), [])
    }
    await ext.storage.local.set({
      [SHADOW_KEY]: { value: shadow, expiresAt: null }
    })
  }

  private pruneTombstones(t: Tombstones): Tombstones {
    const cutoff = Date.now() - TOMBSTONE_TTL_MS
    const out: Tombstones = {}
    for (const [id, iso] of Object.entries(t)) {
      if (new Date(iso).getTime() >= cutoff) out[id] = iso
    }
    return out
  }

  // ─── helpers ──────────────────────────────────────────────

  private sameList(a: Item[], b: Item[]): boolean {
    return JSON.stringify(a) === JSON.stringify(b)
  }

  // Local managed values are wrapped as { value, expiresAt }; sync values and
  // the tombstone map are stored raw. Unwrap either shape to the payload.
  private unwrap(raw: unknown): unknown {
    if (
      raw &&
      typeof raw === "object" &&
      "value" in (raw as Record<string, unknown>) &&
      "expiresAt" in (raw as Record<string, unknown>)
    ) {
      return (raw as LocalPayload).value
    }
    return raw
  }

  private hasStorage() {
    return (
      hasValidExtensionContext() &&
      !!ext.storage?.local &&
      !!ext.storage?.sync &&
      typeof chrome !== "undefined" &&
      !!chrome.storage?.onChanged
    )
  }

  private async getLocalRaw<T>(key: string): Promise<T | null> {
    try {
      const r = await ext.storage.local.get([key])
      return (r[key] as T) ?? null
    } catch {
      return null
    }
  }

  private async setLocalRaw(key: string, value: unknown) {
    try {
      await ext.storage.local.set({ [key]: value })
    } catch {
      /* ignore */
    }
  }

  private patch(next: Partial<BookmarkSyncState>) {
    this.store.update((s) => ({ ...s, ...next }))
  }
}

export const bookmarkSyncService = BookmarkSyncService.getInstance()
