/**
 * One shared download of data/stat-templates.json for the background worker.
 *
 * Two refreshers need this file at the same time (trade-data.ts for the Stat
 * Filter, build-item-map.ts for the results page). Without sharing, a data
 * update meant downloading ~8 MB (≈1.9 MB compressed) twice. Concurrent
 * callers now share one request + one parse; the result is kept briefly so a
 * caller arriving a moment later reuses it, then dropped to free memory.
 */

export const REMOTE_STAT_URL =
  "https://raw.githubusercontent.com/MooHuiDev/poe-zh-trade-tools-pro/main/data/stat-templates.json"

export type RemoteStatTemplates = {
  version?: string
  tw?: Record<string, string>
  cn?: Record<string, string>
  twIdx?: Record<string, string>
  cnIdx?: Record<string, string>
  twText?: Record<string, string>
  cnText?: Record<string, string>
  /** Official 国服 base-item names, keyed lowercase a-z0-9 English. */
  cnName?: Record<string, string>
}

/** How long a finished download is reused before the next call fetches again. */
const KEEP_MS = 60_000

let pending: Promise<RemoteStatTemplates | null> | null = null
let dropTimer: ReturnType<typeof setTimeout> | null = null

type Fetcher = (url: string, init?: RequestInit) => Promise<Response>

/**
 * The parsed file, or null if it could not be fetched / parsed. Never throws.
 * `fetcher` is only for tests.
 */
export const loadRemoteStatTemplates = (
  fetcher: Fetcher = (url, init) => fetch(url, init)
): Promise<RemoteStatTemplates | null> => {
  if (pending) return pending
  pending = (async () => {
    try {
      const res = await fetcher(REMOTE_STAT_URL, { credentials: "omit", cache: "no-cache" })
      if (!res.ok) {
        console.warn("[zh-core] stat templates HTTP", res.status)
        return null
      }
      const json = (await res.json()) as RemoteStatTemplates
      return json && typeof json === "object" ? json : null
    } catch (e) {
      console.error("[zh-core] stat templates fetch failed", e)
      return null
    }
  })()
  const mine = pending
  // A failure is not kept: the next caller may try again right away.
  void mine.then((value) => {
    if (dropTimer) clearTimeout(dropTimer)
    if (value === null) {
      if (pending === mine) pending = null
      return
    }
    dropTimer = setTimeout(() => {
      if (pending === mine) pending = null
      dropTimer = null
    }, KEEP_MS)
    // Node (unit tests) only: don't keep the process alive for this timer.
    ;(dropTimer as { unref?: () => void }).unref?.()
  })
  return mine
}
