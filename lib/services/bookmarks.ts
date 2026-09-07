import { get, writable } from "svelte/store"

import type {
  BookmarksCategoryStruct,
  BookmarksFolderIcon,
  BookmarksFolderStruct,
  BookmarksTradeStruct,
  PartialBookmarksTradeLocation
} from "../types/bookmarks"
import type { TradeRealm } from "../config/trade-hosts"
import type { TradeSiteVersion } from "../types/trade-location"
import { decodeBase64Utf8, encodeBase64Utf8 } from "../utilities/base64"
import { uniqueId } from "../utilities/unique-id"
import { languageStore, translate } from "./i18n"
import { storageService } from "./storage"
import { ext } from "../utilities/ext-api"
import { collectFolderAndDescendantIds, isSubfolder } from "./folder-tree"

const FOLDERS_KEY = "bookmark-folders"
const TRADES_PREFIX_KEY = "bookmark-trades"
// B-plan: all saved searches live in ONE synced list, each tagged with its
// `folderId`. A move is then a single-item field edit (atomic under sync),
// which removes the cross-folder resurrection/duplication class of bugs.
const ALL_TRADES_KEY = "bookmark-trades-all"
const SECTION_DELIMITER = "\n--------------------\n"
const LINE_DELIMITER = "\n"

const getStorageChangeValue = <T>(
  change: chrome.storage.StorageChange | undefined
): T | undefined => {
  const payload = change?.newValue

  if (
    typeof payload !== "object" ||
    payload === null ||
    !("value" in payload)
  ) {
    return undefined
  }

  return payload.value as T
}

type ExportVersion = 1 | 2 | 3 | 4 | 5 | 6
type BookmarksChangeEvent = {
  foldersChanged?: boolean
  tradesChanged?: boolean
  folderId?: string
}

interface ExportedFolderStruct {
  icn: string
  tit: string
  ver?: TradeSiteVersion
  cats?: Array<{ id: string; tit: string }>
  trs: Array<{ tit: string; loc: string; cat?: string }>
  // v6: sub-folders bundled with the parent (one level; each with its own trades).
  subs?: ExportedFolderStruct[]
}

export class BookmarksService {
  private foldersStore = writable<BookmarksFolderStruct[]>([])
  private listeners = new Set<(event?: BookmarksChangeEvent) => void>()
  private allTradesCache: BookmarksTradeStruct[] | null = null
  private allTradesRequest: Promise<BookmarksTradeStruct[]> | null = null
  public subscribe = this.foldersStore.subscribe

  constructor() {
    this.refresh()
    this.bindStorageSync()
  }

  async refresh() {
    const folders = await this.fetchFolders()
    this.foldersStore.set(folders)
    this.notifyChange()
  }

  onChange(callback: (event?: BookmarksChangeEvent) => void) {
    this.listeners.add(callback)
    return () => this.listeners.delete(callback)
  }

  private notifyChange(event?: BookmarksChangeEvent) {
    this.listeners.forEach((listener) => listener(event))
  }

  private bindStorageSync() {
    if (typeof chrome === "undefined" || !chrome.storage?.onChanged) return

    chrome.storage.onChanged.addListener((changes, areaName) => {
      if (areaName !== "local") return

      const foldersChange = changes[FOLDERS_KEY]
      if (foldersChange) {
        const folders = this.normalizeFolders(
          getStorageChangeValue<Partial<BookmarksFolderStruct>[]>(foldersChange)
        )
        this.foldersStore.set(folders)
        this.notifyChange({ foldersChanged: true })
      }

      const allChange = changes[ALL_TRADES_KEY]
      if (allChange) {
        this.allTradesCache = this.normalizeTrades(
          getStorageChangeValue<BookmarksTradeStruct[]>(allChange)
        )
        // No folderId = every folder may be affected (e.g. a sync merge).
        this.notifyChange({ tradesChanged: true })
      }
    })
  }

  // ─── STORAGE ──────────────────────────────────────────────

  async fetchFolders(): Promise<BookmarksFolderStruct[]> {
    const folders =
      await storageService.getValue<Partial<BookmarksFolderStruct>[]>(
        FOLDERS_KEY
      )
    return this.normalizeFolders(folders)
  }

  private normalizeFolders(
    folders: Partial<BookmarksFolderStruct>[] | null | undefined
  ): BookmarksFolderStruct[] {
    return (folders || []).map((f) =>
      this.initializeFolderStruct(f.version || "1", f)
    )
  }

  private normalizeCategories(
    categories: BookmarksFolderStruct["categories"] | null | undefined
  ): BookmarksCategoryStruct[] {
    return (categories || [])
      .filter(
        (category) =>
          typeof category.id === "string" && typeof category.title === "string"
      )
      .map((category) => ({
        id: category.id,
        title: category.title
      }))
  }

  private normalizeTrades(
    trades: BookmarksTradeStruct[] | null | undefined
  ): BookmarksTradeStruct[] {
    return (trades || []).map((t) => ({
      ...t,
      categoryId:
        typeof t.categoryId === "string" && t.categoryId ? t.categoryId : null,
      location: {
        ...t.location,
        version: t.location.version || "1",
        league: t.location.league || null
      }
    }))
  }

  // ── single-store trade access ──
  private async fetchAllTrades(force = false): Promise<BookmarksTradeStruct[]> {
    if (!force && this.allTradesCache) return [...this.allTradesCache]
    if (!force && this.allTradesRequest) return this.allTradesRequest

    const request = (async () => {
      const stored = await storageService.getValue<BookmarksTradeStruct[]>(
        ALL_TRADES_KEY
      )
      const all =
        stored === null
          ? await this.migrateLegacyTrades()
          : this.normalizeTrades(stored)
      this.allTradesCache = all
      return [...all]
    })()

    this.allTradesRequest = request
    try {
      return await request
    } finally {
      this.allTradesRequest = null
    }
  }

  private async persistAllTrades(
    all: BookmarksTradeStruct[]
  ): Promise<BookmarksTradeStruct[]> {
    const safe = this.normalizeTrades(all.map((t) => ({ ...t, id: t.id || uniqueId() })))
    this.allTradesCache = safe
    await storageService.setValue(ALL_TRADES_KEY, safe)
    return [...safe]
  }

  // One-time migration: fold the legacy per-folder keys (bookmark-trades--<id>)
  // into the single store, tagging each trade with its folderId, then drop them.
  private async migrateLegacyTrades(): Promise<BookmarksTradeStruct[]> {
    const all: BookmarksTradeStruct[] = []
    const legacyKeys: string[] = []
    try {
      const raw = await ext.storage.local.get(null)
      const prefix = `${TRADES_PREFIX_KEY}--`
      for (const [key, payload] of Object.entries(raw)) {
        if (!key.startsWith(prefix)) continue
        legacyKeys.push(key)
        const folderId = key.slice(prefix.length)
        const value =
          payload && typeof payload === "object" && "value" in payload
            ? (payload as { value: unknown }).value
            : payload
        for (const t of this.normalizeTrades(
          Array.isArray(value) ? (value as BookmarksTradeStruct[]) : []
        )) {
          all.push({ ...t, folderId, id: t.id || uniqueId() })
        }
      }
    } catch {
      /* fall through with whatever we gathered */
    }
    await storageService.setValue(ALL_TRADES_KEY, all)
    if (legacyKeys.length && ext.storage?.local?.remove) {
      try {
        await ext.storage.local.remove(legacyKeys)
      } catch {
        /* leaving stale legacy keys is harmless */
      }
    }
    return all
  }

  getCachedTradesByFolderId(folderId: string): BookmarksTradeStruct[] | null {
    if (!this.allTradesCache) return null
    return this.allTradesCache.filter((t) => t.folderId === folderId)
  }

  async fetchTradesByFolderId(
    folderId: string,
    options?: { force?: boolean }
  ): Promise<BookmarksTradeStruct[]> {
    const all = await this.fetchAllTrades(options?.force)
    return all.filter((t) => t.folderId === folderId)
  }

  async fetchTradeByLocation(
    location: PartialBookmarksTradeLocation
  ): Promise<BookmarksTradeStruct | null> {
    const folders = await this.fetchFolders()

    const unarchivedFolders = folders.filter((f) => !f.archivedAt)
    const archivedFolders = folders.filter((f) => f.archivedAt)

    const matchLocation = (t: BookmarksTradeStruct) =>
      t.location.version === location.version &&
      t.location.slug === location.slug &&
      t.location.type === location.type &&
      (t.location.league === null || t.location.league === location.league)

    const unarchivedResults = await Promise.all(
      unarchivedFolders.map((f) => this.fetchTradesByFolderId(f.id!))
    )
    for (const trades of unarchivedResults) {
      const match = trades.find(matchLocation)
      if (match) return match
    }

    const archivedResults = await Promise.all(
      archivedFolders.map((f) => this.fetchTradesByFolderId(f.id!))
    )
    for (const trades of archivedResults) {
      const match = trades.find(matchLocation)
      if (match) return match
    }

    return null
  }

  async persistFolder(
    folder: BookmarksFolderStruct,
    options?: { moveToEnd?: boolean }
  ): Promise<string> {
    const folders = await this.fetchFolders()
    let updated: BookmarksFolderStruct[]
    const id = folder.id || uniqueId()

    if (!folder.id) {
      updated = [...folders, { ...folder, id }]
    } else {
      updated = folders.map((f) =>
        f.id === folder.id ? { ...f, ...folder } : f
      )
      if (options?.moveToEnd) {
        updated = [
          ...updated.filter((f) => f.id !== id),
          ...updated.filter((f) => f.id === id)
        ]
      }
    }
    await this.persistFolders(updated)
    await this.refresh()
    return id
  }

  async persistFolders(folders: BookmarksFolderStruct[]) {
    await storageService.setValue(FOLDERS_KEY, folders)
  }

  async persistTrade(
    trade: BookmarksTradeStruct,
    folderId: string
  ): Promise<string> {
    const trades = await this.fetchTradesByFolderId(folderId, { force: true })
    let updated: BookmarksTradeStruct[]
    const id = trade.id || uniqueId()

    if (!trade.id) {
      updated = [...trades, { ...trade, id }]
    } else {
      updated = trades.map((t) => (t.id === trade.id ? { ...t, ...trade } : t))
    }
    await this.persistTrades(updated, folderId)
    await this.refresh()
    return id
  }

  async persistTrades(
    trades: BookmarksTradeStruct[],
    folderId: string
  ): Promise<BookmarksTradeStruct[]> {
    const all = await this.fetchAllTrades()
    // Replace this folder's slice; other folders' trades are untouched. Order
    // within the folder is preserved (we filter by folderId when reading).
    const others = all.filter((t) => t.folderId !== folderId)
    const mine = trades.map((t) => ({
      ...t,
      folderId,
      id: t.id || uniqueId()
    }))
    const saved = await this.persistAllTrades([...others, ...mine])
    return saved.filter((t) => t.folderId === folderId)
  }

  async deleteTrade(
    tradeId: string,
    folderId: string
  ): Promise<BookmarksTradeStruct[]> {
    const trades = await this.fetchTradesByFolderId(folderId, { force: true })
    const updated = trades.filter((t) => t.id !== tradeId)
    const persisted = await this.persistTrades(updated, folderId)
    await this.refresh()
    return persisted
  }

  async deleteFolder(folderId: string) {
    const folders = await this.fetchFolders()
    // Cascade: remove the folder together with any of its sub-folders. The
    // existing per-key deletion → sync-tombstone path propagates each removal.
    const removeIds = new Set(collectFolderAndDescendantIds(folders, folderId))
    const updated = folders.filter((f) => !f.id || !removeIds.has(f.id))
    await this.persistFolders(updated)
    // Drop all trades belonging to the removed folder(s) from the single store.
    const all = await this.fetchAllTrades(true)
    const kept = all.filter((t) => !t.folderId || !removeIds.has(t.folderId))
    if (kept.length !== all.length) await this.persistAllTrades(kept)
    await this.refresh()
  }

  getChildFolders(
    folders: BookmarksFolderStruct[],
    parentId: string
  ): BookmarksFolderStruct[] {
    return folders.filter((f) => f.parentId === parentId)
  }

  // Create a sub-folder under a top-level folder. Enforces the one-level rule:
  // returns null if the target is missing or is itself a sub-folder.
  async createSubfolder(
    parentId: string,
    base: Partial<BookmarksFolderStruct>
  ): Promise<string | null> {
    const folders = await this.fetchFolders()
    const parent = folders.find((f) => f.id === parentId)
    if (!parent || isSubfolder(parent)) return null
    return this.persistFolder({
      ...this.initializeFolderStruct(parent.version, base),
      parentId,
      version: parent.version,
      realm: parent.realm
    })
  }

  // Move a saved search from one folder to another, keeping its id (plan A):
  // delete-from-source + add-to-target. Not atomic across the two synced
  // groups; the load-time de-dupe safeguard heals the rare duplicate a
  // concurrent edit during propagation can leave behind.
  // Move a saved search between folders. Single-store model: this is one
  // item's `folderId` field changing in ONE synced list — atomic under the sync
  // merge (newer stamp wins), so no cross-group race, no resurrection, no
  // duplicate. The id is preserved (it's an edit, not delete+add).
  async moveTradeToFolder(
    tradeId: string,
    fromFolderId: string,
    toFolderId: string
  ): Promise<boolean> {
    if (!tradeId || fromFolderId === toFolderId) return false

    const all = await this.fetchAllTrades(true)
    const index = all.findIndex(
      (t) => t.id === tradeId && t.folderId === fromFolderId
    )
    if (index === -1) return false

    const next = [...all]
    // Category ids are folder-scoped, so drop it when changing folders.
    next[index] = { ...next[index], folderId: toFolderId, categoryId: null }
    await this.persistAllTrades(next)

    this.notifyChange({ tradesChanged: true, folderId: fromFolderId })
    this.notifyChange({ tradesChanged: true, folderId: toFolderId })
    await this.refresh()
    return true
  }

  // upgrade-on-open: replace a bookmark's soon-to-expire short-id slug with the
  // trade site's new self-contained long slug (captured when the user opens it).
  // Matches by slug + league + version so only the right saved search changes.
  async upgradeBookmarkSlug(
    oldSlug: string,
    newSlug: string,
    league: string | null,
    version: TradeSiteVersion
  ): Promise<number> {
    if (!oldSlug || !newSlug || oldSlug === newSlug) return 0
    const all = await this.fetchAllTrades(true)
    let changed = 0
    const next = all.map((t) => {
      if (
        t.location?.slug === oldSlug &&
        t.location?.version === version &&
        (t.location?.league ?? null) === (league ?? null)
      ) {
        changed++
        return { ...t, location: { ...t.location, slug: newSlug } }
      }
      return t
    })
    if (changed > 0) {
      await this.persistAllTrades(next)
      this.notifyChange({ tradesChanged: true })
      await this.refresh()
    }
    return changed
  }

  async duplicateTrade(
    trade: BookmarksTradeStruct,
    targetFolderId: string
  ): Promise<BookmarksTradeStruct[]> {
    const newTrade = { ...trade, id: uniqueId() }
    const trades = await this.fetchTradesByFolderId(targetFolderId, {
      force: true
    })
    const persisted = await this.persistTrades(
      [...trades, newTrade],
      targetFolderId
    )
    await this.refresh()
    return persisted
  }

  async renameFolder(folder: BookmarksFolderStruct, title: string) {
    return this.persistFolder({ ...folder, title })
  }

  async duplicateFolder(folder: BookmarksFolderStruct) {
    if (!folder.id) throw new Error("Cannot duplicate a folder without an id")
    const language = get(languageStore)
    const newFolder = {
      ...folder,
      id: undefined,
      title: translate(language, "bookmarks.folderCopyTitle", {
        title: folder.title
      })
    }
    const newFolderId = await this.persistFolder(newFolder)
    const trades = await this.fetchTradesByFolderId(folder.id)
    const duplicatedTrades = trades.map((trade) => {
      const { id, ...tradeWithoutId } = trade
      return { ...tradeWithoutId, id: undefined }
    })
    await this.persistTrades(duplicatedTrades, newFolderId)
    await this.refresh()
  }

  async renameTrade(
    trade: BookmarksTradeStruct,
    folderId: string,
    title: string
  ): Promise<BookmarksTradeStruct[]> {
    const trades = await this.fetchTradesByFolderId(folderId, { force: true })
    const updated = trades.map((t) => (t.id === trade.id ? { ...t, title } : t))
    const persisted = await this.persistTrades(updated, folderId)
    await this.refresh()
    return persisted
  }

  async assignTradeCategory(
    trade: BookmarksTradeStruct,
    folderId: string,
    categoryId: string | null
  ): Promise<BookmarksTradeStruct[]> {
    const trades = await this.fetchTradesByFolderId(folderId, { force: true })
    const safeCategoryId = categoryId || null
    const updated = trades.map((t) =>
      t.id === trade.id ? { ...t, categoryId: safeCategoryId } : t
    )
    const persisted = await this.persistTrades(updated, folderId)
    await this.refresh()
    return persisted
  }

  async reorderTrade(
    tradeId: string,
    folderId: string,
    direction: "up" | "down"
  ) {
    const trades = await this.fetchTradesByFolderId(folderId, { force: true })
    const index = trades.findIndex((t) => t.id === tradeId)
    if (index === -1) return

    const newIndex = direction === "up" ? index - 1 : index + 1
    if (newIndex < 0 || newIndex >= trades.length) return

    const updated = [...trades]
    ;[updated[index], updated[newIndex]] = [updated[newIndex], updated[index]]
    await this.persistTrades(updated, folderId)
    await this.refresh()
  }

  async moveTrade(
    tradeId: string,
    folderId: string,
    newIndex: number
  ): Promise<BookmarksTradeStruct[]> {
    const trades = await this.fetchTradesByFolderId(folderId, { force: true })
    const index = trades.findIndex((t) => t.id === tradeId)
    if (index === -1) return trades

    const safeIndex = Math.max(0, Math.min(newIndex, trades.length - 1))
    if (index === safeIndex) return trades

    const updated = [...trades]
    const [movedElement] = updated.splice(index, 1)
    updated.splice(safeIndex, 0, movedElement)

    const persisted = await this.persistTrades(updated, folderId)
    await this.refresh()
    return persisted
  }

  async moveFolder(
    folderId: string,
    newIndex: number,
    options: { version: TradeSiteVersion; realm?: TradeRealm; archived: boolean }
  ) {
    const folders = await this.fetchFolders()
    // Drag-reorder acts on top-level folders only; sub-folders keep their spot
    // (they are grouped under their parent at render time, not by array order).
    const matchingFolders = folders.filter(
      (folder) =>
        !folder.parentId &&
        folder.version === options.version &&
        (options.realm === undefined ||
          (folder.realm ?? "intl") === options.realm) &&
        !!folder.archivedAt === options.archived
    )
    const currentIndex = matchingFolders.findIndex(
      (folder) => folder.id === folderId
    )
    if (currentIndex === -1) return

    const safeIndex = Math.max(
      0,
      Math.min(newIndex, matchingFolders.length - 1)
    )
    if (currentIndex === safeIndex) return

    const reorderedFolders = [...matchingFolders]
    const [movedFolder] = reorderedFolders.splice(currentIndex, 1)
    reorderedFolders.splice(safeIndex, 0, movedFolder)

    const updatedFolders = this.partiallyReorderFolders(
      folders,
      reorderedFolders
    )
    await this.persistFolders(updatedFolders)
    await this.refresh()
  }

  // ─── LOGIC ────────────────────────────────────────────────

  async toggleTradeCompletion(
    trade: BookmarksTradeStruct,
    folderId: string
  ): Promise<BookmarksTradeStruct[]> {
    const trades = await this.fetchTradesByFolderId(folderId, { force: true })
    const updated = trades.map((entry) =>
      entry.id === trade.id
        ? {
            ...entry,
            completedAt: entry.completedAt ? null : new Date().toISOString()
          }
        : entry
    )
    const persisted = await this.persistTrades(updated, folderId)
    await this.refresh()
    return persisted
  }

  async toggleFolderArchive(folder: BookmarksFolderStruct) {
    return this.persistFolder(
      {
        ...folder,
        archivedAt: folder.archivedAt ? null : new Date().toISOString()
      },
      { moveToEnd: true }
    )
  }

  async createCategory(
    folder: BookmarksFolderStruct,
    title: string
  ): Promise<BookmarksCategoryStruct | null> {
    if (!folder.id) return null
    const category: BookmarksCategoryStruct = {
      id: uniqueId(),
      title
    }
    const categories = [...(folder.categories || []), category]
    await this.persistFolder({ ...folder, categories })
    return category
  }

  async renameCategory(
    folder: BookmarksFolderStruct,
    categoryId: string,
    title: string
  ) {
    const categories = (folder.categories || []).map((category) =>
      category.id === categoryId ? { ...category, title } : category
    )
    await this.persistFolder({ ...folder, categories })
  }

  async deleteCategory(
    folder: BookmarksFolderStruct,
    categoryId: string
  ): Promise<BookmarksTradeStruct[]> {
    if (!folder.id) return []
    const categories = (folder.categories || []).filter(
      (category) => category.id !== categoryId
    )
    await this.persistFolder({ ...folder, categories })

    const trades = await this.fetchTradesByFolderId(folder.id, { force: true })
    const updatedTrades = trades.map((trade) =>
      trade.categoryId === categoryId ? { ...trade, categoryId: null } : trade
    )
    const persisted = await this.persistTrades(updatedTrades, folder.id)
    await this.refresh()
    return persisted
  }

  partiallyReorderFolders(
    allFolders: BookmarksFolderStruct[],
    reorderedFolders: BookmarksFolderStruct[]
  ): BookmarksFolderStruct[] {
    const reorderedSet = new Set(reorderedFolders)
    const result = [...allFolders]
    let reorderedIndex = 0
    for (let i = 0; i < allFolders.length; i++) {
      if (reorderedSet.has(allFolders[i])) {
        result[i] = reorderedFolders[reorderedIndex]
        reorderedIndex++
      }
    }
    return result
  }

  // ─── EXPORT / IMPORT ──────────────────────────────────────

  private buildExportPayload(
    folder: BookmarksFolderStruct,
    trades: BookmarksTradeStruct[]
  ): ExportedFolderStruct {
    return {
      icn: folder.icon as string,
      tit: folder.title,
      ver: folder.version,
      cats: (folder.categories || []).map((category) => ({
        id: category.id,
        tit: category.title
      })),
      trs: trades.map((t) => ({
        tit: t.title,
        loc: `${t.location.version}:${t.location.type}:${t.location.league || ""}:${t.location.slug}`,
        cat: t.categoryId || undefined
      }))
    }
  }

  serializeFolder(
    folder: BookmarksFolderStruct,
    trades: BookmarksTradeStruct[]
  ): string {
    return `5:${encodeBase64Utf8(JSON.stringify(this.buildExportPayload(folder, trades)))}`
  }

  // Export a top-level folder together with its sub-folders (and their trades).
  // Backward compatible: v5 importers ignore `subs`; v6 importers restore them.
  async serializeFolderTree(
    folder: BookmarksFolderStruct,
    trades: BookmarksTradeStruct[]
  ): Promise<string> {
    const payload = this.buildExportPayload(folder, trades)
    const children = get(this.foldersStore).filter(
      (f) => f.id && f.parentId === folder.id
    )
    if (children.length > 0) {
      const subs: ExportedFolderStruct[] = []
      for (const child of children) {
        const childTrades = await this.fetchTradesByFolderId(child.id!)
        subs.push(this.buildExportPayload(child, childTrades))
      }
      payload.subs = subs
    }
    return `6:${encodeBase64Utf8(JSON.stringify(payload))}`
  }

  private decodeExportPayload(
    payload: ExportedFolderStruct,
    exportVersion: ExportVersion
  ): [BookmarksFolderStruct, BookmarksTradeStruct[]] {
    const folder: BookmarksFolderStruct = {
      version: "1",
      icon: payload.icn as BookmarksFolderIcon,
      title: payload.tit,
      archivedAt: null,
      categories: []
    }

    if (exportVersion >= 3 && payload.ver) {
      folder.version = payload.ver
    }

    if (exportVersion >= 5 && Array.isArray(payload.cats)) {
      folder.categories = payload.cats
        .filter((category) => category.id && category.tit)
        .map((category) => ({ id: category.id, title: category.tit }))
    }

    const trades: BookmarksTradeStruct[] = payload.trs.map((trade) => {
      let version: string, type: string, slug: string, league: string | null
      if (exportVersion >= 4) {
        ;[version, type, league, slug] = trade.loc.split(":")
      } else if (exportVersion >= 3) {
        ;[version, type, slug] = trade.loc.split(":")
        league = null
      } else {
        version = "1"
        ;[type, slug] = trade.loc.split(":")
        league = null
      }
      return {
        title: trade.tit,
        completedAt: null,
        categoryId: exportVersion >= 5 && trade.cat ? trade.cat : null,
        location: { version: version as TradeSiteVersion, type, slug, league }
      }
    })

    return [folder, trades]
  }

  deserializeFolder(
    serializedFolder: string
  ): [BookmarksFolderStruct, BookmarksTradeStruct[]] | null {
    try {
      const exportVersion = this.parseExportVersion(serializedFolder)
      const json = this.jsonFromExportString(exportVersion, serializedFolder)
      const payload: ExportedFolderStruct = JSON.parse(json)
      return this.decodeExportPayload(payload, exportVersion)
    } catch {
      return null
    }
  }

  // Like deserializeFolder, but also returns bundled sub-folders (v6).
  deserializeFolderTree(serializedFolder: string): {
    folder: BookmarksFolderStruct
    trades: BookmarksTradeStruct[]
    children: [BookmarksFolderStruct, BookmarksTradeStruct[]][]
  } | null {
    try {
      const exportVersion = this.parseExportVersion(serializedFolder)
      const json = this.jsonFromExportString(exportVersion, serializedFolder)
      const payload: ExportedFolderStruct = JSON.parse(json)
      const [folder, trades] = this.decodeExportPayload(payload, exportVersion)
      const children =
        exportVersion >= 6 && Array.isArray(payload.subs)
          ? payload.subs.map((sub) => this.decodeExportPayload(sub, exportVersion))
          : []
      return { folder, trades, children }
    } catch {
      return null
    }
  }

  private parseExportVersion(exportString: string): ExportVersion {
    if (exportString.startsWith("6:")) return 6
    if (exportString.startsWith("5:")) return 5
    if (exportString.startsWith("4:")) return 4
    if (exportString.startsWith("3:")) return 3
    if (exportString.startsWith("2:")) return 2
    return 1
  }

  private jsonFromExportString(
    version: ExportVersion,
    exportString: string
  ): string {
    if (version >= 2) {
      return decodeBase64Utf8(exportString.slice(2))
    }
    return atob(exportString)
  }

  // ─── BACKUP / RESTORE ─────────────────────────────────────

  async generateBackupDataString(): Promise<string> {
    const activeFolderStrings: string[] = []
    const archivedFolderStrings: string[] = []

    const folders = await this.fetchFolders()
    for (const folder of folders) {
      if (!folder.id) continue
      const trades = await this.fetchTradesByFolderId(folder.id)
      const serialized = this.serializeFolder(folder, trades)
      ;(folder.archivedAt ? archivedFolderStrings : activeFolderStrings).push(
        serialized
      )
    }

    return [
      activeFolderStrings.join(LINE_DELIMITER),
      archivedFolderStrings.join(LINE_DELIMITER)
    ].join(SECTION_DELIMITER)
  }

  async restoreFromDataString(dataString: string): Promise<boolean> {
    try {
      const [activeSection, archivedSection] =
        dataString.split(SECTION_DELIMITER)
      const activeFolderStrings = activeSection
        .split(LINE_DELIMITER)
        .filter(Boolean)
      const archivedFolderStrings = (archivedSection || "")
        .split(LINE_DELIMITER)
        .filter(Boolean)

      let restoredCount = 0
      restoredCount += await this.restoreFolders(activeFolderStrings)
      restoredCount += await this.restoreFolders(archivedFolderStrings, {
        archivedAt: new Date().toISOString()
      })

      await this.refresh()
      return restoredCount > 0
    } catch {
      return false
    }
  }

  private async restoreFolders(
    folderStrings: string[],
    overrides: Partial<BookmarksFolderStruct> = {}
  ): Promise<number> {
    let count = 0
    for (const folderString of folderStrings) {
      const deserialized = this.deserializeFolder(folderString)
      if (!deserialized) continue

      const [folder, trades] = deserialized
      const folderId = await this.persistFolder({ ...folder, ...overrides })
      await this.persistTrades(trades, folderId)
      count++
    }
    return count
  }

  // ─── HELPERS ──────────────────────────────────────────────

  initializeFolderStruct(
    version: TradeSiteVersion,
    partial?: Partial<BookmarksFolderStruct>
  ): BookmarksFolderStruct {
    return {
      version,
      icon: null,
      title: "",
      archivedAt: null,
      ...partial,
      categories: this.normalizeCategories(partial?.categories)
    }
  }

  initializeTradeStructFrom(location: {
    version: TradeSiteVersion
    type: string
    slug: string
    league: string | null
  }): BookmarksTradeStruct {
    return {
      location,
      title: "",
      completedAt: null,
      categoryId: null
    }
  }
}

export const bookmarksService = new BookmarksService()
