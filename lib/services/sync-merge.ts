/**
 * Pure, browser-API-free logic for cross-device bookmark sync.
 *
 * Everything here is deterministic and side-effect-free so it can be unit-tested
 * in isolation (see tests/sync-merge.test.mjs). The chrome.storage glue,
 * gzip, and orchestration live in bookmarks-sync.ts.
 */

// ── Lamport stamp: monotonic per-device counter + stable device id ──
export type Stamp = { c: number; d: string }
export type Item = { id?: string; _u?: Stamp | string; [k: string]: unknown }
export type Tombstones = Record<string, Stamp> // id -> deletion stamp

/** Normalize any `_u` (tuple / legacy ISO string / missing) to a comparable stamp.
 *  Legacy or absent values become the oldest possible stamp so any real
 *  post-migration edit (c >= 1) always wins. */
export const asStamp = (v: Stamp | string | undefined): Stamp =>
  v && typeof v === "object" && typeof (v as Stamp).c === "number"
    ? (v as Stamp)
    : { c: 0, d: "" }

/** >0 if a newer than b, <0 if older, 0 if equal. Counter first, deviceId as a
 *  deterministic tie-breaker so both devices converge on the same winner. */
export const cmpStamp = (a: Stamp, b: Stamp): number =>
  a.c !== b.c ? a.c - b.c : a.d < b.d ? -1 : a.d > b.d ? 1 : 0

export const asItems = (value: unknown): Item[] =>
  Array.isArray(value) ? (value as Item[]) : []

export const maxCounterIn = (items: Item[]): number => {
  let m = 0
  for (const it of items) {
    const c = asStamp(it._u).c
    if (c > m) m = c
  }
  return m
}

/** Deep-equal ignoring the `_u` bookkeeping field. */
export const sameItem = (a: Item | undefined, b: Item | undefined): boolean => {
  const strip = (x: Item | undefined) => {
    if (!x) return x
    const { _u, ...rest } = x
    return rest
  }
  return JSON.stringify(strip(a)) === JSON.stringify(strip(b))
}

/** Stamp changed/new items with `batch`; unchanged items keep their stamp. */
export const stampItems = (
  current: Item[],
  shadow: Item[],
  batch: Stamp
): Item[] => {
  const shadowById = new Map(shadow.filter((i) => i.id).map((i) => [i.id, i]))
  return current.map((item) => {
    if (!item.id) return item
    const prev = shadowById.get(item.id)
    if (prev && sameItem(item, prev)) return item._u ? item : { ...item, _u: prev._u }
    return { ...item, _u: batch }
  })
}

/** Ids present in `shadow` but missing from `current` = local deletions. */
export const localDeletions = (current: Item[], shadow: Item[]): string[] => {
  const ids = new Set(current.map((i) => i.id))
  return shadow.filter((s) => s.id && !ids.has(s.id)).map((s) => s.id!)
}

/** Keep the newer stamp per id across two tombstone maps. Retained forever. */
export const mergeTombstones = (a: Tombstones, b: Tombstones): Tombstones => {
  const out: Tombstones = {}
  for (const [id, st] of Object.entries(a)) out[id] = asStamp(st)
  for (const [id, st] of Object.entries(b)) {
    const s = asStamp(st)
    if (!out[id] || cmpStamp(s, out[id]) > 0) out[id] = s
  }
  return out
}

/** Union by id (newer stamp wins); drop ids whose tombstone is >= the surviving
 *  item's stamp (a later edit resurrects; a later/equal delete removes). */
export const mergeItems = (
  local: Item[],
  remote: Item[],
  tombstones: Tombstones
): Item[] => {
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
    if (cmpStamp(asStamp(item._u), asStamp(prev._u)) >= 0) byId.set(item.id, item)
  }
  local.forEach(consider)
  remote.forEach(consider)

  const result: Item[] = []
  for (const id of order) {
    const item = byId.get(id)!
    const tomb = tombstones[id]
    if (tomb && cmpStamp(asStamp(item._u), tomb) <= 0) continue
    result.push(item)
  }
  return result
}

// ── order map (ISO-Lamport; ordering is cosmetic, not data-safety) ──
export type OrderEntry = { seq: string[]; u: string }
export type OrderMap = Record<string, OrderEntry>

export const lamportIso = (...seen: (string | undefined)[]): string => {
  let m = Date.now()
  for (const s of seen) {
    const t = s ? Date.parse(s) : 0
    if (!Number.isNaN(t) && t >= m) m = t + 1
  }
  return new Date(m).toISOString()
}
export const isoMax = (...vals: (string | undefined)[]): string => {
  let m = 0
  for (const v of vals) {
    const t = v ? Date.parse(v) : 0
    if (!Number.isNaN(t) && t > m) m = t
  }
  return new Date(m).toISOString()
}
export const sameRelativeOrder = (a: string[], b: string[]): boolean => {
  const bset = new Set(b)
  const aset = new Set(a)
  return (
    JSON.stringify(a.filter((id) => bset.has(id))) ===
    JSON.stringify(b.filter((id) => aset.has(id)))
  )
}
export const orderBySeq = (items: Item[], seq: string[]): Item[] => {
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

// ── manifest + chunk key scheme (pure string ops) ──
// A logical base (e.g. "bookmark-folders" or "bookmark-trades--<id>") is stored
// as: <base>@m  (manifest: {v,z,n}) and <base>@c0..@c(n-1) (payload string parts).
// The bare <base> key is the legacy (pre-chunk) single-value form, used only as a
// read fallback for migration.
export type Manifest = { v: number; z: boolean; n: number }
export const MANIFEST_VERSION = 1
export const CHUNK_TARGET = 6000 // chars/chunk, comfortably under the 8KB key cap

export const manifestKey = (base: string) => `${base}@m`
export const chunkKey = (base: string, i: number) => `${base}@c${i}`

export const parseSyncKey = (
  key: string
): { base: string; kind: "manifest" | "chunk" | "legacy"; index: number } => {
  const at = key.lastIndexOf("@")
  if (at < 0) return { base: key, kind: "legacy", index: -1 }
  const base = key.slice(0, at)
  const rest = key.slice(at + 1)
  if (rest === "m") return { base, kind: "manifest", index: -1 }
  if (/^c\d+$/.test(rest)) return { base, kind: "chunk", index: Number(rest.slice(1)) }
  return { base: key, kind: "legacy", index: -1 }
}

/** Split a payload string into <= CHUNK_TARGET-char parts (>=1 part, even empty). */
export const splitPayload = (payload: string, size = CHUNK_TARGET): string[] => {
  if (payload.length === 0) return [""]
  const parts: string[] = []
  for (let i = 0; i < payload.length; i += size) parts.push(payload.slice(i, i + size))
  return parts
}

/** Reassemble the payload string from a manifest + chunk map, or null if the
 *  chunk set is missing/incomplete (caller then falls back to the legacy key). */
export const reassembleChunks = (
  manifest: Manifest | undefined,
  chunkMap: Record<number, string>
): string | null => {
  if (!manifest || typeof manifest.n !== "number") return null
  const buf: string[] = []
  for (let i = 0; i < manifest.n; i++) {
    const piece = chunkMap[i]
    if (typeof piece !== "string") return null
    buf.push(piece)
  }
  return buf.join("")
}
