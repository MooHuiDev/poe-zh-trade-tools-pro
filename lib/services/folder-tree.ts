// Pure, browser-API-free helpers for one-level bookmark sub-folders and the
// cross-folder "move item" safeguard. Kept dependency-free so it can be unit
// tested with `node --test` (see tests/folder-tree.test.mjs).
//
// Model: a folder is top-level when it has no `parentId`. A folder with a
// `parentId` is a sub-folder of that parent. We only allow ONE level of
// nesting — a sub-folder can never itself be a parent. The UI enforces this by
// only offering "add sub-folder" on top-level folders; `canHoldSubfolders`
// mirrors the rule here for the service layer.

export interface FolderNodeLike {
  id?: string
  parentId?: string | null
}

/** A folder is a sub-folder when it points at a parent. */
export const isSubfolder = (folder: FolderNodeLike): boolean => !!folder.parentId

/** Set of all existing folder ids (drops missing ids). */
export const folderIdSet = (folders: FolderNodeLike[]): Set<string> =>
  new Set(folders.map((f) => f.id).filter((id): id is string => !!id))

/**
 * The parent a folder should render under. If its `parentId` no longer points
 * at an existing folder (e.g. the parent was deleted on another device while
 * this sub-folder was created/edited on ours), it is an ORPHAN and is treated
 * as top-level. This is a read-time rule — no data is lost, the folder just
 * surfaces at the root instead of vanishing.
 */
export const effectiveParentId = (
  folder: FolderNodeLike,
  existingIds: Set<string>
): string | null =>
  folder.parentId && existingIds.has(folder.parentId) ? folder.parentId : null

/** Only top-level folders may hold sub-folders (enforces the one-level rule). */
export const canHoldSubfolders = (folder: FolderNodeLike): boolean =>
  !isSubfolder(folder)

/**
 * Ids to delete when a folder is removed: the folder itself plus every direct
 * sub-folder. One level only, but written defensively so a stray deeper node is
 * still swept up.
 */
export const collectFolderAndDescendantIds = <T extends FolderNodeLike>(
  folders: T[],
  folderId: string
): string[] => {
  const ids = new Set<string>([folderId])
  let changed = true
  while (changed) {
    changed = false
    for (const folder of folders) {
      if (
        folder.id &&
        folder.parentId &&
        ids.has(folder.parentId) &&
        !ids.has(folder.id)
      ) {
        ids.add(folder.id)
        changed = true
      }
    }
  }
  return [...ids]
}

export interface FolderTree<T extends FolderNodeLike> {
  /** Top-level folders in their original order (orphans surface here too). */
  topLevel: T[]
  /** Direct sub-folders keyed by parent id, each in original order. */
  childrenByParent: Map<string, T[]>
}

/**
 * Split a flat, already display-ordered folder list into top-level folders and
 * their children. Orphans (parent missing) are surfaced as top-level.
 */
export const buildFolderTree = <T extends FolderNodeLike>(
  folders: T[]
): FolderTree<T> => {
  const existingIds = folderIdSet(folders)
  const topLevel: T[] = []
  const childrenByParent = new Map<string, T[]>()

  for (const folder of folders) {
    const parent = effectiveParentId(folder, existingIds)
    if (parent) {
      const list = childrenByParent.get(parent) ?? []
      list.push(folder)
      childrenByParent.set(parent, list)
    } else {
      topLevel.push(folder)
    }
  }

  return { topLevel, childrenByParent }
}

/**
 * Cross-folder de-duplication safeguard for the "move item" feature (plan A).
 *
 * Moving a saved search is delete-from-A + add-to-B across two synced groups,
 * which sync cannot make atomic — a rare race can leave the same trade id in
 * two folders. Given the trade ids currently present per folder (in display
 * order), returns the removals needed so each id lives in only ONE folder:
 * the FIRST folder it appears in wins, later copies are dropped. Deterministic
 * given the same folder order, so devices converge.
 */
export const dedupeTradeIdsAcrossFolders = (
  entries: { folderId: string; tradeIds: string[] }[]
): { folderId: string; removeIds: string[] }[] => {
  const seen = new Set<string>()
  const corrections: { folderId: string; removeIds: string[] }[] = []

  for (const { folderId, tradeIds } of entries) {
    const removeIds: string[] = []
    for (const id of tradeIds) {
      if (!id) continue
      if (seen.has(id)) {
        removeIds.push(id)
      } else {
        seen.add(id)
      }
    }
    if (removeIds.length > 0) {
      corrections.push({ folderId, removeIds })
    }
  }

  return corrections
}
