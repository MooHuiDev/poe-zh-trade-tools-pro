import { writable } from "svelte/store"

import { ext } from "../utilities/ext-api"
import {
  hasValidExtensionContext,
  isExtensionContextInvalidatedError
} from "../utilities/extension-context"
import {
  asItems,
  chunkKey,
  isoMax,
  lamportIso,
  localDeletions,
  manifestKey,
  MANIFEST_VERSION,
  maxCounterIn,
  mergeItems,
  mergeTombstones,
  orderBySeq,
  parseSyncKey,
  reassembleChunks,
  sameRelativeOrder,
  splitPayload,
  stampItems,
  type Item,
  type Manifest,
  type OrderMap,
  type Stamp,
  type Tombstones
} from "./sync-merge"

/**
 * Cross-device bookmark sync (opt-in, default OFF).
 *
 * Safe-by-design: every reconcile is an item-level UNION keyed by `id`, so an
 * unrelated bookmark on either device is never lost. Same-id conflicts resolve by
 * a Lamport stamp {c,d} (skew-proof). Deletions propagate via a tombstone map
 * (Lamport-stamped, retained indefinitely). Tombstones are created ONLY from
 * local deletions, so an emptied Sync store just gets the local copy re-pushed and
 * can never wipe a device.
 *
 * Storage: each logical list (bookmark-folders, bookmark-trades--<id>) and the
 * tombstone/order maps are stored in Sync as manifest + chunks
 * (<base>@m + <base>@c0..) so no single key exceeds the ~8KB limit. Payloads are
 * gzip-compressed when that is smaller. The pre-chunk single-key form (4.1.3) is
 * read as a fallback and migrated forward on the next write.
 *
 * Pure merge/chunk logic lives in sync-merge.ts (unit-tested).
 */

const FOLDERS_KEY = "bookmark-folders"
const TRADES_PREFIX = "bookmark-trades--"
const TOMBSTONES_KEY = "bookmark-sync-tombstones"
const ORDERS_KEY = "bookmark-sync-orders"
const SHADOW_KEY = "bookmark-sync-shadow"
const ENABLED_KEY = "bookmark-sync-enabled"
const CLOCK_KEY = "bookmark-sync-clock" // local-only: { counter, deviceId }
const STATUS_KEY = "bookmark-sync-status" // local-only: engine -> UI mirror status
const RECONCILE_DEBOUNCE_MS = 500
const SYNC_SAFE_BYTES = 100000 // stop cloud writes below the 102400 total cap

type LocalPayload = { value: unknown; expiresAt: string | null }
type Shadow = Record<string, Item[]>
type Clock = { counter: number; deviceId: string }

export type BookmarkSyncState = {
  enabled: boolean
  lastSyncedAt: string | null
  error: string | null
}

const isManagedItemsKey = (key: string) =>
  key === FOLDERS_KEY || key.startsWith(TRADES_PREFIX)
const isManagedBase = (base: string) =>
  base === FOLDERS_KEY ||
  base.startsWith(TRADES_PREFIX) ||
  base === TOMBSTONES_KEY ||
  base === ORDERS_KEY

const nowIso = () => new Date().toISOString()

// ── gzip (shrink payloads to fit storage.sync's 8KB/item, 100KB total) ──
const compressionAvailable = () =>
  typeof CompressionStream !== "undefined" &&
  typeof DecompressionStream !== "undefined" &&
  typeof btoa !== "undefined"
const bytesToBase64 = (bytes: Uint8Array) => {
  let s = ""
  for (const b of bytes) s += String.fromCharCode(b)
  return btoa(s)
}
const base64ToBytes = (v: string) =>
  Uint8Array.from(atob(v), (c) => c.charCodeAt(0))
const gzip = async (value: string) =>
  new Uint8Array(
    await new Response(
      new Blob([value]).stream().pipeThrough(new CompressionStream("gzip"))
    ).arrayBuffer()
  )
const gunzip = async (bytes: Uint8Array) =>
  new Response(
    new Blob([bytes.buffer as ArrayBuffer])
      .stream()
      .pipeThrough(new DecompressionStream("gzip"))
  ).text()

const newDeviceId = () => {
  try {
    if (typeof crypto !== "undefined" && crypto.randomUUID) return crypto.randomUUID()
  } catch {
    /* ignore */
  }
  return `d${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`
}

// legacy 4.1.3 single-key envelope: [1, value] raw or [2, base64gzip]
const decodeLegacy = async (stored: unknown): Promise<unknown> => {
  if (Array.isArray(stored) && stored.length === 2) {
    if (stored[0] === 2 && typeof stored[1] === "string") {
      return JSON.parse(await gunzip(base64ToBytes(stored[1])))
    }
    if (stored[0] === 1) return stored[1]
  }
  return stored
}

type SyncRead = {
  values: Record<string, unknown> // base -> reassembled value
  maxIndex: Record<string, number> // base -> highest present chunk index (or -1)
  fromFallback: boolean // did any base fall back to the legacy key?
}

class BookmarkSyncService {
  private static instance: BookmarkSyncService
  private reconcileTimer: ReturnType<typeof setTimeout> | null = null
  private applying = false
  private runsEngine = false // true only in the background service worker
  private engineEnabled = false // engine's view of the on/off flag
  private uiWatching = false

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

  // Called ONCE from the background service worker — this context owns the sync
  // engine, so sync runs even when no trade tab is open. MV3 wakes the worker on
  // storage.onChanged (remote data arriving), so event-driven is enough.
  async initBackground() {
    if (!this.hasStorage()) return
    this.runsEngine = true
    // Always listen — the listener also catches the enable transition, so it must
    // be attached even while sync is currently off.
    chrome.storage.onChanged.addListener(this.onChangedEngine)
    this.engineEnabled = (await this.getLocalRaw<string>(ENABLED_KEY)) === "true"
    if (this.engineEnabled) this.scheduleReconcile() // catch up on startup
  }

  // Called from the sidebar (content script) — UI mirror only, no engine. Reads
  // the flag + the engine-published status and keeps the Settings toggle in sync.
  async initUiMirror() {
    if (!this.hasStorage()) return
    await this.refreshUiFromStorage()
    if (!this.uiWatching) {
      this.uiWatching = true
      chrome.storage.onChanged.addListener(this.onChangedUi)
    }
  }

  // Toggle from Settings: flip the persisted flag; the background engine reacts
  // (seed + start + reconcile, or stop) via storage.onChanged.
  async setEnabled(on: boolean) {
    if (!this.hasStorage()) return
    this.patch({ enabled: on, error: null })
    await this.setLocalRaw(ENABLED_KEY, on ? "true" : "")
    if (this.runsEngine) {
      if (on) void this.engineEnable()
      else this.engineEnabled = false
    }
  }

  private async refreshUiFromStorage() {
    const enabled = (await this.getLocalRaw<string>(ENABLED_KEY)) === "true"
    const status =
      (await this.getLocalRaw<{ lastSyncedAt?: string | null; error?: string | null }>(
        STATUS_KEY
      )) || {}
    this.patch({
      enabled,
      lastSyncedAt: status.lastSyncedAt ?? null,
      error: status.error ?? null
    })
  }

  private onChangedUi = (
    changes: Record<string, chrome.storage.StorageChange>,
    area: string
  ) => {
    if (area !== "local") return
    if (changes[ENABLED_KEY] || changes[STATUS_KEY]) void this.refreshUiFromStorage()
  }

  private onChangedEngine = (
    changes: Record<string, chrome.storage.StorageChange>,
    area: string
  ) => {
    // Enable/disable transition (handled even while off — listener is always on).
    if (area === "local" && changes[ENABLED_KEY]) {
      const on = changes[ENABLED_KEY].newValue === "true"
      if (on && !this.engineEnabled) void this.engineEnable()
      else if (!on) this.engineEnabled = false
      return
    }
    if (this.applying || !this.engineEnabled) return
    if (area !== "local" && area !== "sync") return
    const touched = Object.keys(changes).some(
      (k) => isManagedItemsKey(k) || isManagedBase(parseSyncKey(k).base)
    )
    if (touched) this.scheduleReconcile()
  }

  private async engineEnable() {
    this.engineEnabled = true
    await this.seedShadowFromLocal()
    this.scheduleReconcile()
  }

  private async persistStatus(s: {
    lastSyncedAt?: string | null
    error?: string | null
  }) {
    if (this.runsEngine) await this.setLocalRaw(STATUS_KEY, s)
  }

  private scheduleReconcile() {
    if (this.reconcileTimer) clearTimeout(this.reconcileTimer)
    this.reconcileTimer = setTimeout(() => {
      this.reconcileTimer = null
      void this.reconcile()
    }, RECONCILE_DEBOUNCE_MS)
  }

  // ─── clock ────────────────────────────────────────────────

  private async loadClock(): Promise<Clock> {
    const raw = (await this.getLocalRaw<Clock>(CLOCK_KEY)) || null
    if (raw && typeof raw.counter === "number" && typeof raw.deviceId === "string") {
      return raw
    }
    const clock: Clock = { counter: 0, deviceId: newDeviceId() }
    await this.setLocalRaw(CLOCK_KEY, clock)
    return clock
  }

  // ─── chunked sync I/O ─────────────────────────────────────

  private async encodePayload(value: unknown): Promise<{ z: boolean; parts: string[] }> {
    const json = JSON.stringify(value)
    let z = false
    let payload = json
    if (compressionAvailable()) {
      try {
        const comp = bytesToBase64(await gzip(json))
        if (comp.length < json.length) {
          z = true
          payload = comp
        }
      } catch {
        /* keep raw */
      }
    }
    return { z, parts: splitPayload(payload) }
  }

  private async decodePayload(z: boolean, payload: string): Promise<unknown> {
    return JSON.parse(z ? await gunzip(base64ToBytes(payload)) : payload)
  }

  // Read every managed base from Sync, reassembling manifest+chunks and falling
  // back to the legacy single key when a manifest is absent or incomplete.
  private async readSyncAll(): Promise<SyncRead> {
    const all = await ext.storage.sync.get(null)
    const manifests: Record<string, Manifest> = {}
    const chunks: Record<string, Record<number, string>> = {}
    const legacy: Record<string, unknown> = {}
    for (const [key, val] of Object.entries(all)) {
      const p = parseSyncKey(key)
      if (p.kind === "manifest") manifests[p.base] = val as Manifest
      else if (p.kind === "chunk") (chunks[p.base] ||= {})[p.index] = val as string
      else legacy[p.base] = val
    }
    const bases = new Set<string>([
      ...Object.keys(manifests),
      ...Object.keys(chunks),
      ...Object.keys(legacy)
    ])
    const values: Record<string, unknown> = {}
    const maxIndex: Record<string, number> = {}
    let fromFallback = false
    for (const base of bases) {
      if (!isManagedBase(base)) continue
      const present = chunks[base] ? Object.keys(chunks[base]).map(Number) : []
      maxIndex[base] = present.length ? Math.max(...present) : -1
      const man = manifests[base]
      let ok = false
      const payload = reassembleChunks(man, chunks[base] || {})
      if (payload !== null) {
        try {
          values[base] = await this.decodePayload(!!man.z, payload)
          ok = true
        } catch {
          ok = false
        }
      }
      if (!ok && base in legacy) {
        // manifest missing/incomplete → use the pre-chunk (4.1.3) value.
        try {
          values[base] = await decodeLegacy(legacy[base])
          fromFallback = true
        } catch {
          /* leave undefined */
        }
      }
    }
    return { values, maxIndex, fromFallback }
  }

  // Write a base as manifest+chunks: all chunks FIRST, then the manifest (the
  // commit pointer), then GC stale chunks + the legacy key. Interruption-safe:
  // until the manifest is written, readers keep using the previous complete set.
  private async writeSyncManaged(base: string, value: unknown, oldMaxIndex: number) {
    const { z, parts } = await this.encodePayload(value)
    const setObj: Record<string, unknown> = {}
    for (let i = 0; i < parts.length; i++) setObj[chunkKey(base, i)] = parts[i]
    await ext.storage.sync.set(setObj)
    await ext.storage.sync.set({
      [manifestKey(base)]: { v: MANIFEST_VERSION, z, n: parts.length } as Manifest
    })
    const removals: string[] = [base] // drop legacy single-key form
    for (let i = parts.length; i <= oldMaxIndex; i++) removals.push(chunkKey(base, i))
    if (removals.length) await ext.storage.sync.remove(removals)
  }

  private async removeSyncManaged(base: string, oldMaxIndex: number) {
    const removals = [manifestKey(base), base]
    for (let i = 0; i <= oldMaxIndex; i++) removals.push(chunkKey(base, i))
    await ext.storage.sync.remove(removals)
  }

  // ─── core reconcile ───────────────────────────────────────

  private async reconcile() {
    if (!this.hasStorage()) return
    try {
      const localAll = await ext.storage.local.get(null)
      const sync = await this.readSyncAll()
      const clock = await this.loadClock()
      const shadow: Shadow = (this.unwrap(localAll[SHADOW_KEY]) as Shadow) || {}

      const tombstones = mergeTombstones(
        (sync.values[TOMBSTONES_KEY] as Tombstones) || {},
        (this.unwrap(localAll[TOMBSTONES_KEY]) as Tombstones) || {}
      )

      const keys = new Set<string>()
      for (const k of Object.keys(localAll)) if (isManagedItemsKey(k)) keys.add(k)
      for (const k of Object.keys(sync.values)) if (isManagedItemsKey(k)) keys.add(k)
      for (const k of Object.keys(shadow)) if (isManagedItemsKey(k)) keys.add(k)

      // Advance the Lamport counter past everything we can observe.
      let observed = clock.counter
      for (const key of keys) {
        observed = Math.max(
          observed,
          maxCounterIn(asItems(this.unwrap(localAll[key]))),
          maxCounterIn(asItems(sync.values[key])),
          maxCounterIn(shadow[key] || [])
        )
      }
      for (const st of Object.values(tombstones)) observed = Math.max(observed, st.c)

      const batch: Stamp = { c: observed + 1, d: clock.deviceId }
      let batchUsed = false
      const useBatch = () => {
        batchUsed = true
        return batch
      }

      // Tombstones from LOCAL deletions only.
      for (const key of keys) {
        const del = localDeletions(
          asItems(this.unwrap(localAll[key])),
          shadow[key] || []
        )
        for (const id of del) if (!tombstones[id]) tombstones[id] = useBatch()
      }

      const localOrders: OrderMap =
        (this.unwrap(localAll[ORDERS_KEY]) as OrderMap) || {}
      const syncOrders: OrderMap = (sync.values[ORDERS_KEY] as OrderMap) || {}
      const nextOrders: OrderMap = {}

      const nextShadow: Shadow = {}
      const localWrites: Record<string, LocalPayload> = {}
      const syncItemWrites: Record<string, Item[]> = {}
      const syncItemRemoves: string[] = []

      for (const key of keys) {
        const localRaw = asItems(this.unwrap(localAll[key]))
        const localItems = stampItems(localRaw, shadow[key] || [], batch)
        // stampItems assigns `_u: batch` (same reference) to changed items only.
        if (localItems.some((it) => it._u === batch)) useBatch()

        const syncItems = asItems(sync.values[key])
        let merged = mergeItems(localItems, syncItems, tombstones)

        // order (ISO-Lamport, cosmetic)
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

        if (!this.sameList(localRaw, merged)) {
          localWrites[key] = { value: merged, expiresAt: null }
        }
        if (!this.sameList(asItems(sync.values[key]), merged)) {
          if (merged.length === 0) syncItemRemoves.push(key)
          else syncItemWrites[key] = merged
        }
      }

      // Local bookkeeping (change-gated).
      const localBookkeeping: Record<string, LocalPayload> = {}
      if (
        JSON.stringify(this.unwrap(localAll[SHADOW_KEY])) !==
        JSON.stringify(nextShadow)
      )
        localBookkeeping[SHADOW_KEY] = { value: nextShadow, expiresAt: null }
      if (
        JSON.stringify(this.unwrap(localAll[TOMBSTONES_KEY])) !==
        JSON.stringify(tombstones)
      )
        localBookkeeping[TOMBSTONES_KEY] = { value: tombstones, expiresAt: null }
      if (JSON.stringify(localOrders) !== JSON.stringify(nextOrders))
        localBookkeeping[ORDERS_KEY] = { value: nextOrders, expiresAt: null }

      const nextCounter = batchUsed ? batch.c : observed
      if (nextCounter > clock.counter) {
        await this.setLocalRaw(CLOCK_KEY, {
          counter: nextCounter,
          deviceId: clock.deviceId
        })
      }

      const syncTombChanged =
        JSON.stringify(sync.values[TOMBSTONES_KEY] || {}) !==
        JSON.stringify(tombstones)
      const syncOrdersChanged =
        JSON.stringify(sync.values[ORDERS_KEY] || {}) !==
        JSON.stringify(nextOrders)

      const nothingToDo =
        !Object.keys(localWrites).length &&
        !Object.keys(localBookkeeping).length &&
        !Object.keys(syncItemWrites).length &&
        !syncItemRemoves.length &&
        !syncTombChanged &&
        !syncOrdersChanged &&
        !sync.fromFallback // a fallback read means we still owe a chunked rewrite

      let quotaSkipped = false
      if (!nothingToDo) {
        this.applying = true
        try {
          if (Object.keys(localWrites).length)
            await ext.storage.local.set(localWrites)
          if (Object.keys(localBookkeeping).length)
            await ext.storage.local.set(localBookkeeping)

          // Removals first — they only free space, so they are always safe.
          for (const base of syncItemRemoves) {
            await this.removeSyncManaged(base, sync.maxIndex[base] ?? -1)
          }

          const hasSyncAdds =
            Object.keys(syncItemWrites).length > 0 ||
            syncTombChanged ||
            syncOrdersChanged ||
            sync.fromFallback
          if (hasSyncAdds) {
            const used = await ext.storage.sync
              .getBytesInUse(null)
              .catch(() => 0)
            if (used >= SYNC_SAFE_BYTES) {
              // Near the 100KB total cap: keep everything on this device and skip
              // cloud writes, rather than hammering doomed (and CPU-heavy) writes.
              // Deleting bookmarks frees space and re-enables syncing.
              quotaSkipped = true
            } else {
              for (const [base, items] of Object.entries(syncItemWrites)) {
                await this.writeSyncManaged(base, items, sync.maxIndex[base] ?? -1)
              }
              if (syncTombChanged || sync.fromFallback) {
                await this.writeSyncManaged(
                  TOMBSTONES_KEY,
                  tombstones,
                  sync.maxIndex[TOMBSTONES_KEY] ?? -1
                )
              }
              if (syncOrdersChanged || sync.fromFallback) {
                await this.writeSyncManaged(
                  ORDERS_KEY,
                  nextOrders,
                  sync.maxIndex[ORDERS_KEY] ?? -1
                )
              }
              // Migration: after falling back to any legacy key, rewrite each
              // managed item base in chunked form so the legacy keys drop.
              if (sync.fromFallback) {
                for (const key of keys) {
                  if (nextShadow[key]?.length && !(key in syncItemWrites)) {
                    await this.writeSyncManaged(
                      key,
                      nextShadow[key],
                      sync.maxIndex[key] ?? -1
                    )
                  }
                }
              }
            }
          }
        } finally {
          setTimeout(() => {
            this.applying = false
          }, 50)
        }
      }

      await this.logStats()
      const status = {
        lastSyncedAt: nowIso(),
        error: quotaSkipped ? "quota" : null
      }
      this.patch(status)
      await this.persistStatus(status)
    } catch (error) {
      if (isExtensionContextInvalidatedError(error)) return
      const message =
        error instanceof Error && /quota|QUOTA/.test(error.message)
          ? "quota"
          : "error"
      console.warn("[bookmark-sync] reconcile failed", error)
      this.patch({ error: message })
      await this.persistStatus({ error: message })
    }
  }

  // ─── observability ────────────────────────────────────────

  private async logStats() {
    try {
      const bytes = await ext.storage.sync.getBytesInUse(null)
      const all = await ext.storage.sync.get(null)
      let manifests = 0
      let chunkCount = 0
      let maxChunk = 0
      for (const [k, v] of Object.entries(all)) {
        const p = parseSyncKey(k)
        if (p.kind === "manifest") manifests++
        else if (p.kind === "chunk") {
          chunkCount++
          const size = JSON.stringify(v).length
          if (size > maxChunk) maxChunk = size
        }
      }
      console.log(
        `[bookmark-sync] synced. sync bytes=${bytes}/102400, ` +
          `manifests=${manifests}, chunks=${chunkCount}, maxChunkBytes=${maxChunk}`
      )
    } catch {
      /* stats are best-effort */
    }
  }

  private async seedShadowFromLocal() {
    if (!this.hasStorage()) return
    const localAll = await ext.storage.local.get(null)
    const shadow: Shadow = {}
    for (const key of Object.keys(localAll)) {
      if (!isManagedItemsKey(key)) continue
      shadow[key] = asItems(this.unwrap(localAll[key]))
    }
    await ext.storage.local.set({ [SHADOW_KEY]: { value: shadow, expiresAt: null } })
  }

  // ─── helpers ──────────────────────────────────────────────

  private sameList(a: Item[], b: Item[]): boolean {
    return JSON.stringify(a) === JSON.stringify(b)
  }

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
      const v = r[key]
      const unwrapped = this.unwrap(v)
      return (unwrapped as T) ?? (v as T) ?? null
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
