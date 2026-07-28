import { get, writable } from "svelte/store"

import type {
  ExactTradeLocationStruct,
  TradeLocationHistoryStruct,
  TradeLocationStruct,
  TradeSiteVersion
} from "../types/trade-location"
import {
  hasValidExtensionContext,
  isExtensionContextInvalidatedError
} from "../utilities/extension-context"
import { uniqueId } from "../utilities/unique-id"
import { getTradeRealm } from "../config/trade-hosts"
import { getActiveTradeTab } from "./active-trade-tab"
import { languageStore, translate } from "./i18n"
import { searchPanelService } from "./search-panel"
import { storageService } from "./storage"

const DEFAULT_BASE_URL = "https://www.pathofexile.com"
const HISTORY_KEY = "trade-history"
const MAX_HISTORY = 50
// When a bookmark is opened, its title is stashed here keyed by the query slug
// so the freshly-opened tab can label its history entry with the bookmark's
// name instead of the generic "Trade" fallback (a URL-loaded search leaves the
// name box empty). Short-lived (the tab reads it within seconds); the TTL means
// no cross-tab clear is needed, avoiding races.
const PENDING_TITLES_KEY = "pending-bookmark-titles"
const PENDING_TITLE_TTL_MS = 2 * 60 * 1000
const TRADE_REALMS = ["xbox", "sony", "poe2"]
const TRADE_HOSTNAME_PATTERN =
  /(?:^|\.)pathofexile\.(?:com|tw)$|^poe2\.kakaogames\.com$/i

const safeDecodeURIComponent = (value: string | undefined) => {
  if (!value) return value

  try {
    return decodeURIComponent(value)
  } catch {
    return value
  }
}

const encodeTradePathPart = (value: string) =>
  encodeURIComponent(safeDecodeURIComponent(value) || value)

const encodeTradeLeague = (league: string) =>
  league
    .split("/")
    .map((part) => encodeTradePathPart(part))
    .join("/")

export class TradeLocationService {
  private lastLocation: ExactTradeLocationStruct | null = null
  private listeners = new Set<
    (event: {
      old: ExactTradeLocationStruct
      new: ExactTradeLocationStruct
    }) => void
  >()
  private pollingTimer: ReturnType<typeof setInterval> | null = null
  private activeTabTrackingStarted = false
  private focusHandler: (() => void) | null = null
  private blurHandler: (() => void) | null = null
  private activeTabUpdatedHandler:
    | ((
        tabId: number,
        changeInfo: chrome.tabs.OnUpdatedInfo,
        tab: chrome.tabs.Tab
      ) => void)
    | null = null
  private activeTabActivatedHandler:
    ((activeInfo: chrome.tabs.OnActivatedInfo) => void) | null = null

  // Svelte store for reactivity
  public locationStore = writable<ExactTradeLocationStruct>(
    this.parseCurrentLocation()
  )

  constructor() {
    this.lastLocation = this.parseCurrentLocation()
  }

  get current() {
    if (this.isExtensionUi()) {
      return this.lastLocation ?? this.emptyLocation()
    }

    return this.parseCurrentPath()
  }

  startPolling(interval: number = 1000) {
    if (this.isExtensionUi()) {
      if (this.activeTabTrackingStarted) {
        return
      }
      this.activeTabTrackingStarted = true
      void this.startActiveTabTracking()
      return
    }

    if (this.pollingTimer) return // Don't start twice

    this.pollingTimer = setInterval(() => {
      this.syncCurrentLocation()
    }, interval)

    // The polling loop only records history when the location CHANGES, so the
    // search the user is already viewing when the sidebar mounts would never be
    // captured (most visible on a fresh realm like Garena TW, where the history
    // starts empty). Record the current search once up front — maybeLogHistory
    // de-duplicates and ignores non-search pages, so this is safe to call.
    void this.maybeLogHistory(this.parseCurrentPath())

    // Also listen for focus/blur to pause/resume
    if (!this.focusHandler) {
      this.focusHandler = () => this.resumePolling(interval)
      window.addEventListener("focus", this.focusHandler)
    }

    if (!this.blurHandler) {
      this.blurHandler = () => this.pausePolling()
      window.addEventListener("blur", this.blurHandler)
    }
  }

  stopPolling() {
    this.pausePolling()
    this.removeWindowListeners()
    this.removeActiveTabListeners()
    this.activeTabTrackingStarted = false
  }

  private resumePolling(interval: number) {
    if (this.pollingTimer) return
    this.pollingTimer = setInterval(() => {
      this.syncCurrentLocation()
    }, interval)
  }

  private async startActiveTabTracking() {
    await this.refreshFromActiveTab()

    if (!hasValidExtensionContext() || !chrome.tabs) {
      return
    }

    if (!this.activeTabUpdatedHandler && chrome.tabs.onUpdated) {
      this.activeTabUpdatedHandler = (tabId, changeInfo, tab) => {
        if (changeInfo.url || tab.active) {
          void this.refreshFromActiveTab()
        }
      }
      try {
        chrome.tabs.onUpdated.addListener(this.activeTabUpdatedHandler)
      } catch (error) {
        if (!isExtensionContextInvalidatedError(error)) {
          console.warn(
            "[Poe Zh Trade Tools Pro] Failed to subscribe to tab updates",
            error
          )
        }
      }
    }

    if (!this.activeTabActivatedHandler && chrome.tabs.onActivated) {
      this.activeTabActivatedHandler = () => {
        void this.refreshFromActiveTab()
      }
      try {
        chrome.tabs.onActivated.addListener(this.activeTabActivatedHandler)
      } catch (error) {
        if (!isExtensionContextInvalidatedError(error)) {
          console.warn(
            "[Poe Zh Trade Tools Pro] Failed to subscribe to tab activation",
            error
          )
        }
      }
    }

    if (!this.focusHandler) {
      this.focusHandler = () => {
        void this.refreshFromActiveTab()
      }
      window.addEventListener("focus", this.focusHandler)
    }
  }

  private async refreshFromActiveTab() {
    const tab = await getActiveTradeTab()
    const current = this.parseUrl(tab?.url ?? null)
    this.locationStore.set(current)

    if (!this.lastLocation || !this.isExactEqual(this.lastLocation, current)) {
      const old = this.lastLocation ?? current
      this.lastLocation = current
      this.notify(old, current)
    }
  }

  private pausePolling() {
    if (this.pollingTimer) {
      clearInterval(this.pollingTimer)
      this.pollingTimer = null
    }
  }

  private removeWindowListeners() {
    if (this.focusHandler) {
      window.removeEventListener("focus", this.focusHandler)
      this.focusHandler = null
    }

    if (this.blurHandler) {
      window.removeEventListener("blur", this.blurHandler)
      this.blurHandler = null
    }
  }

  private removeActiveTabListeners() {
    if (!hasValidExtensionContext() || !chrome.tabs) {
      this.activeTabUpdatedHandler = null
      this.activeTabActivatedHandler = null
      return
    }

    if (this.activeTabUpdatedHandler && chrome.tabs.onUpdated) {
      try {
        chrome.tabs.onUpdated.removeListener(this.activeTabUpdatedHandler)
      } catch (error) {
        if (!isExtensionContextInvalidatedError(error)) {
          console.warn(
            "[Poe Zh Trade Tools Pro] Failed to unsubscribe from tab updates",
            error
          )
        }
      }
      this.activeTabUpdatedHandler = null
    }

    if (this.activeTabActivatedHandler && chrome.tabs.onActivated) {
      try {
        chrome.tabs.onActivated.removeListener(this.activeTabActivatedHandler)
      } catch (error) {
        if (!isExtensionContextInvalidatedError(error)) {
          console.warn(
            "[Poe Zh Trade Tools Pro] Failed to unsubscribe from tab activation",
            error
          )
        }
      }
      this.activeTabActivatedHandler = null
    }
  }

  onChange(
    callback: (event: {
      old: ExactTradeLocationStruct
      new: ExactTradeLocationStruct
    }) => void
  ) {
    this.listeners.add(callback)
    return () => this.listeners.delete(callback)
  }

  private notify(
    old: ExactTradeLocationStruct,
    current: ExactTradeLocationStruct
  ) {
    this.listeners.forEach((l) => l({ old, new: current }))
  }

  private syncCurrentLocation() {
    const current = this.parseCurrentPath()
    this.locationStore.set(current)
    if (!this.lastLocation || !this.isExactEqual(this.lastLocation, current)) {
      const old = this.lastLocation ?? current
      this.lastLocation = current
      this.notify(old, current)
      void this.maybeLogHistory(current)
    }
  }

  private async maybeLogHistory(location: ExactTradeLocationStruct) {
    if (!location.slug || !location.type || !location.league) return

    const key = this.getHistoryStorageKey(location.version)
    // Migrate any legacy (pre-realm) history into the scoped key first, so the
    // background append below can't overwrite still-unmigrated entries.
    await this.fetchHistory(location.version)

    // A bookmark-opened tab knows its intended title (stashed by the bookmark);
    // prefer that over the page-scraped recommendation, which is empty for a
    // URL-loaded query and would otherwise fall back to the generic "Trade".
    const pendingTitle = await this.readPendingTitle(location.slug)
    const entry = {
      ...location,
      id: uniqueId(),
      title:
        pendingTitle ||
        searchPanelService.recommendTitle() ||
        translate(get(languageStore), "history.untitledSearch"),
      createdAt: new Date().toISOString()
    } as TradeLocationHistoryStruct

    // Serialize the read-modify-write through the background service worker (a
    // single writer that processes messages one at a time) so multiple trade
    // tabs — especially the bookmark "open all in new tabs" action, which spawns
    // many tabs that each log at once — can't clobber each other's entries the
    // way concurrent per-tab writes would (lost update).
    if (await this.logHistoryViaBackground(key, entry)) return

    // Fallback (background unavailable): local read-modify-write.
    const history = await this.fetchHistory(location.version)
    if (history[0] && this.isEqual(history[0], location)) return
    history.unshift(entry)
    await storageService.setValue(key, history.slice(0, MAX_HISTORY))
  }

  // Remember bookmark titles by query slug just before opening them, so the
  // opened tab(s) can label their history entries with the bookmark name.
  async stashPendingTitles(titlesBySlug: Record<string, string>) {
    const entries = Object.entries(titlesBySlug).filter(
      ([slug, title]) => slug && typeof title === "string" && title.trim()
    )
    if (entries.length === 0) return
    const existing =
      (await storageService.getValue<Record<string, string>>(
        PENDING_TITLES_KEY
      )) ?? {}
    for (const [slug, title] of entries) existing[slug] = title
    await storageService.setEphemeralValue(
      PENDING_TITLES_KEY,
      existing,
      new Date(Date.now() + PENDING_TITLE_TTL_MS)
    )
  }

  private async readPendingTitle(slug: string | null): Promise<string | null> {
    if (!slug) return null
    const map = await storageService.getValue<Record<string, string>>(
      PENDING_TITLES_KEY
    )
    const title = map?.[slug]
    return typeof title === "string" && title.trim() ? title : null
  }

  private async logHistoryViaBackground(
    key: string,
    entry: TradeLocationHistoryStruct
  ): Promise<boolean> {
    if (!hasValidExtensionContext() || !chrome.runtime?.sendMessage) return false
    try {
      const response = await chrome.runtime.sendMessage({
        query: "log-trade-history",
        key,
        entry,
        max: MAX_HISTORY
      })
      return !!response && typeof response === "object"
    } catch (error) {
      if (!isExtensionContextInvalidatedError(error)) {
        console.warn(
          "[Poe Zh Trade Tools Pro] history log via background failed",
          error
        )
      }
      return false
    }
  }

  async fetchHistory(
    version: TradeSiteVersion = this.current.version
  ): Promise<TradeLocationHistoryStruct[]> {
    const historyKey = this.getHistoryStorageKey(version)
    const scopedHistory =
      await storageService.getValue<TradeLocationHistoryStruct[]>(historyKey)

    if (scopedHistory) {
      return scopedHistory
    }

    const legacyHistory =
      (await storageService.getValue<TradeLocationHistoryStruct[]>(
        HISTORY_KEY
      )) || []
    const migratedHistory = legacyHistory
      .filter((entry) => entry.version === version)
      .slice(0, MAX_HISTORY)

    if (migratedHistory.length > 0) {
      await storageService.setValue(historyKey, migratedHistory)
    }

    return migratedHistory
  }

  async clearHistoryEntries(version: TradeSiteVersion = this.current.version) {
    await storageService.deleteValue(this.getHistoryStorageKey(version))

    const legacyHistory =
      await storageService.getValue<TradeLocationHistoryStruct[]>(HISTORY_KEY)
    if (!legacyHistory) {
      return
    }

    const remainingLegacyHistory = legacyHistory.filter(
      (entry) => entry.version !== version
    )
    if (remainingLegacyHistory.length === 0) {
      await storageService.deleteValue(HISTORY_KEY)
      return
    }

    await storageService.setValue(HISTORY_KEY, remainingLegacyHistory)
  }

  getTradeUrl(
    version: TradeSiteVersion,
    type: string,
    slug: string,
    league: string
  ) {
    const basePath = version === "2" ? "trade2" : "trade"
    return `${this.getTradeBaseUrl()}/${basePath}/${encodeTradePathPart(type)}/${encodeTradeLeague(league)}/${encodeTradePathPart(slug)}`
  }

  compareTradeLocations(a: TradeLocationStruct, b: TradeLocationStruct) {
    return (
      a.version === b.version &&
      a.league === b.league &&
      a.slug === b.slug &&
      a.type === b.type
    )
  }

  private isEqual(a: TradeLocationStruct, b: TradeLocationStruct) {
    return this.compareTradeLocations(a, b)
  }

  private isExactEqual(
    a: ExactTradeLocationStruct,
    b: ExactTradeLocationStruct
  ) {
    return this.isEqual(a, b) && a.isLive === b.isLive
  }

  private isExtensionUi() {
    return window.location.protocol === "chrome-extension:"
  }

  private getTradeBaseUrl() {
    if (
      typeof window !== "undefined" &&
      TRADE_HOSTNAME_PATTERN.test(window.location.hostname) &&
      window.location.pathname.startsWith("/trade")
    ) {
      return window.location.origin
    }

    return DEFAULT_BASE_URL
  }

  private parseCurrentLocation() {
    if (this.isExtensionUi()) {
      return this.emptyLocation()
    }

    return this.parseCurrentPath()
  }

  private emptyLocation(): ExactTradeLocationStruct {
    return {
      version: "1",
      type: null,
      league: null,
      slug: null,
      isLive: false
    }
  }

  private parseCurrentPath(): ExactTradeLocationStruct {
    return this.parseUrl(window.location.href)
  }

  private getHistoryStorageKey(version: TradeSiteVersion) {
    // Realm-scope the history so Garena TW searches never mix with the
    // international ones (their urls differ). International keeps the original
    // key for backward compatibility; TW gets a "-tw" suffix.
    const realm = getTradeRealm()
    return `${HISTORY_KEY}-poe${version}${realm === "tw" ? "-tw" : ""}`
  }

  private parseUrl(urlString: string | null): ExactTradeLocationStruct {
    if (!urlString) {
      return this.emptyLocation()
    }

    let url: URL

    try {
      url = new URL(urlString)
    } catch {
      return this.emptyLocation()
    }

    if (
      !TRADE_HOSTNAME_PATTERN.test(url.hostname) ||
      !url.pathname.startsWith("/trade")
    ) {
      return this.emptyLocation()
    }

    const pathParts = url.pathname.split("/").slice(1)
    let versionPart: string,
      type: string | undefined,
      league: string | undefined,
      slug: string | undefined,
      live: string | undefined

    // Handle realm-based URLs: /trade/search/xbox/LeagueName/slug
    if (pathParts.length > 2 && TRADE_REALMS.includes(pathParts[2])) {
      let realm: string, leagueInRealm: string
      ;[versionPart, type, realm, leagueInRealm, slug, live] = pathParts
      league = `${safeDecodeURIComponent(realm)}/${safeDecodeURIComponent(leagueInRealm)}`
    } else {
      ;[versionPart, type, league, slug, live] = pathParts
      league = safeDecodeURIComponent(league)
    }

    return {
      version: versionPart === "trade2" ? "2" : "1",
      type: type || null,
      league: league || null,
      slug: slug || null,
      isLive: live === "live"
    }
  }
}

export const tradeLocationService = new TradeLocationService()
