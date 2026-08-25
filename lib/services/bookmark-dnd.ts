// Shared drag state for dragging a saved search between folders. The source and
// destination are separate <BookmarkFolder> component instances, so the dragged
// item is tracked here (module singleton) rather than in either component. The
// dataTransfer payload isn't readable during dragover, so this holder is what
// the drop target consults.

interface TradeDragState {
  tradeId: string | null
  fromFolderId: string | null
  title: string
}

const state: TradeDragState = {
  tradeId: null,
  fromFolderId: null,
  title: ""
}

export const setTradeDrag = (
  tradeId: string,
  fromFolderId: string,
  title: string
) => {
  state.tradeId = tradeId
  state.fromFolderId = fromFolderId
  state.title = title
}

export const clearTradeDrag = () => {
  state.tradeId = null
  state.fromFolderId = null
  state.title = ""
}

export const getTradeDrag = (): Readonly<TradeDragState> => ({ ...state })

/** True when a trade is being dragged and the drop is a different folder. */
export const isCrossFolderTradeDrop = (targetFolderId: string): boolean =>
  !!state.tradeId &&
  !!state.fromFolderId &&
  !!targetFolderId &&
  state.fromFolderId !== targetFolderId
