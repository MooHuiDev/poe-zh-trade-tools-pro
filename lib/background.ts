import { ext } from "./utilities/ext-api"
import { storageService } from "./services/storage"
import type { TradeLocationHistoryStruct } from "./types/trade-location"

let registered = false

// Serializes trade-history writes so concurrent tabs can't clobber each other.
// The background service worker is a single context and processes each message
// through this chain one at a time (read -> dedupe -> write), eliminating the
// lost-update race that per-tab writes have.
let historyWriteChain: Promise<void> = Promise.resolve()

const sameHistoryLocation = (
  a: TradeLocationHistoryStruct | undefined,
  b: TradeLocationHistoryStruct
) =>
  !!a &&
  a.version === b.version &&
  a.league === b.league &&
  a.slug === b.slug &&
  a.type === b.type

type PoeNinjaRequest = {
  query: "poe-ninja-exchange";
  game: "poe1" | "poe2";
  resource: string;
};

type LogHistoryRequest = {
  query: "log-trade-history";
  key: string;
  entry: TradeLocationHistoryStruct;
  max: number;
};

type OpenTabsRequest = {
  query: "open-urls-in-tabs";
  urls: string[];
  active?: boolean;
};

type BackgroundRequest = PoeNinjaRequest | OpenTabsRequest | LogHistoryRequest;

const isPoeNinjaRequest = (request: unknown): request is PoeNinjaRequest => {
  if (!request || typeof request !== "object") {
    return false;
  }

  const candidate = request as Partial<PoeNinjaRequest>;
  return candidate.query === "poe-ninja-exchange"
    && (candidate.game === "poe1" || candidate.game === "poe2")
    && typeof candidate.resource === "string"
    && candidate.resource.startsWith("/exchange/current/overview?");
};

// Only pathofexile(.com/.tw) and poe2.kakaogames trade URLs may be opened, so a
// page can't smuggle arbitrary navigation targets through this handler.
const TRADE_TAB_URL_PATTERN =
  /^https:\/\/(?:(?:[^./]+\.)?pathofexile\.(?:com|tw)|poe2\.kakaogames\.com)\/trade(?:2)?(?:\/|$)/i;

const isOpenTabsRequest = (request: unknown): request is OpenTabsRequest => {
  if (!request || typeof request !== "object") {
    return false;
  }

  const candidate = request as Partial<OpenTabsRequest>;
  return candidate.query === "open-urls-in-tabs"
    && Array.isArray(candidate.urls)
    && candidate.urls.every((url) => typeof url === "string");
};

const isLogHistoryRequest = (request: unknown): request is LogHistoryRequest => {
  if (!request || typeof request !== "object") {
    return false;
  }

  const candidate = request as Partial<LogHistoryRequest>;
  return candidate.query === "log-trade-history"
    && typeof candidate.key === "string"
    && typeof candidate.max === "number"
    && !!candidate.entry
    && typeof candidate.entry === "object";
};

const isBackgroundRequest = (request: unknown): request is BackgroundRequest =>
  isPoeNinjaRequest(request) || isOpenTabsRequest(request) || isLogHistoryRequest(request);

export const registerBackgroundHandlers = () => {
  if (registered) {
    return
  }

  registered = true

  ext.runtime.onMessage.addListener((request, _sender, sendResponse) => {
    if (!isBackgroundRequest(request)) {
      return false;
    }

    if (request.query === "log-trade-history") {
      const { key, entry, max } = request
      historyWriteChain = historyWriteChain
        .then(async () => {
          const history =
            (await storageService.getValue<TradeLocationHistoryStruct[]>(key)) ?? []
          if (!sameHistoryLocation(history[0], entry)) {
            history.unshift(entry)
            await storageService.setValue(key, history.slice(0, max))
          }
          sendResponse({ logged: true })
        })
        .catch((err) => {
          console.error("[Poe Zh Trade Tools Pro-BG] history log failed:", err)
          try {
            sendResponse({ logged: false })
          } catch {
            // Message channel already closed; nothing to do.
          }
        })
      return true
    }

    if (request.query === "open-urls-in-tabs") {
      const urls = request.urls.filter((url) => TRADE_TAB_URL_PATTERN.test(url))
      const active = request.active === true
      ;(async () => {
        for (const url of urls) {
          try {
            await ext.tabs.create({ url, active })
          } catch (err) {
            console.error("[Poe Zh Trade Tools Pro-BG] open tab failed:", { url, error: err })
          }
        }
        sendResponse({ opened: urls.length })
      })()
      return true
    }

    if (request.query === "poe-ninja-exchange") {
      const url = `https://poe.ninja/${request.game}/api/economy${request.resource}`

      fetch(url)
        .then(async (r) => {
          if (!r.ok) {
            throw new Error(`poe.ninja responded with status ${r.status}`)
          }
          return r.json()
        })
        .then((response) => {
          sendResponse(response)
        })
        .catch((err) => {
          console.error("[Poe Zh Trade Tools Pro-BG] poe.ninja exchange fetch failed:", {
            url,
            error: err
          })
          sendResponse(null)
        })
      return true
    }

    return false
  })
}
