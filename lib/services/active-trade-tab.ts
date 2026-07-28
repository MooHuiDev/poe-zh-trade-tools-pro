import { hasValidExtensionContext, isExtensionContextInvalidatedError } from "../utilities/extension-context"

const TRADE_URL_PATTERN = /^https:\/\/(?:(?:[^./]+\.)?pathofexile\.com|poe2\.kakaogames\.com)\/trade(?:2)?(?:\/|$)/i

const getActiveTab = async () => {
  if (!hasValidExtensionContext() || !chrome.tabs?.query) {
    return null
  }

  try {
    const [tab] = await chrome.tabs.query({
      active: true,
      currentWindow: true
    })

    return tab ?? null
  } catch (error) {
    if (!isExtensionContextInvalidatedError(error)) {
      console.warn("[Poe Zh Trade Tools Pro] Failed to query active tab", error)
    }
    return null
  }
}

export const getActiveTradeTab = async () => {
  const tab = await getActiveTab()
  if (!tab?.url || !TRADE_URL_PATTERN.test(tab.url)) {
    return null
  }

  return tab
}

export const getActiveTradeTabTitle = async () => {
  const tab = await getActiveTradeTab()
  return tab?.title ?? null
}

export const openUrlInActiveTab = async (url: string) => {
  const tab = await getActiveTab()

  // Background script / popup script case
  if (hasValidExtensionContext() && chrome.tabs?.update && typeof tab?.id === "number") {
    try {
      await chrome.tabs.update(tab.id, { url, active: true })
      return
    } catch (error) {
      if (!isExtensionContextInvalidatedError(error)) {
        console.warn("[Poe Zh Trade Tools Pro] Failed to update active tab", error)
      }
    }
  }

  // Content script case - navigate the current page directly
  if (typeof window !== "undefined") {
    window.location.href = url
    return
  }

  // Final fallback
  if (typeof globalThis.open === "function") {
    globalThis.open(url, "_blank", "noopener")
  }
}

// Open one URL in a NEW tab (leaving the current page intact). In the popup /
// background context chrome.tabs.create is used directly; in a content-script
// sidebar (no chrome.tabs) we ask the background to create it, falling back to
// window.open for the single-tab case.
export const openUrlInNewTab = async (url: string, active = true) => {
  if (hasValidExtensionContext() && chrome.tabs?.create) {
    try {
      await chrome.tabs.create({ url, active })
      return
    } catch (error) {
      if (!isExtensionContextInvalidatedError(error)) {
        console.warn("[Poe Zh Trade Tools Pro] Failed to open new tab", error)
      }
    }
  }

  if (hasValidExtensionContext() && chrome.runtime?.sendMessage) {
    try {
      await chrome.runtime.sendMessage({ query: "open-urls-in-tabs", urls: [url], active })
      return
    } catch (error) {
      if (!isExtensionContextInvalidatedError(error)) {
        console.warn("[Poe Zh Trade Tools Pro] Failed to request new tab", error)
      }
    }
  }

  if (typeof globalThis.open === "function") {
    globalThis.open(url, "_blank", "noopener")
  }
}

// Open several URLs, each in its own new background tab. Routed through the
// background so a content-script sidebar can open many tabs at once without
// tripping the browser's popup blocker (a window.open loop would).
export const openUrlsInNewTabs = async (urls: string[]) => {
  const cleaned = urls.filter((url) => typeof url === "string" && url.length > 0)
  if (cleaned.length === 0) return

  if (hasValidExtensionContext() && chrome.tabs?.create) {
    try {
      for (const url of cleaned) {
        await chrome.tabs.create({ url, active: false })
      }
      return
    } catch (error) {
      if (!isExtensionContextInvalidatedError(error)) {
        console.warn("[Poe Zh Trade Tools Pro] Failed to open tabs", error)
      }
    }
  }

  if (hasValidExtensionContext() && chrome.runtime?.sendMessage) {
    try {
      await chrome.runtime.sendMessage({ query: "open-urls-in-tabs", urls: cleaned, active: false })
      return
    } catch (error) {
      if (!isExtensionContextInvalidatedError(error)) {
        console.warn("[Poe Zh Trade Tools Pro] Failed to request tabs", error)
      }
    }
  }

  if (typeof globalThis.open === "function") {
    for (const url of cleaned) globalThis.open(url, "_blank", "noopener")
  }
}

export const sendMessageToActiveTradeTab = async <T>(message: unknown) => {
  const tab = await getActiveTradeTab()

  if (!tab?.id || !hasValidExtensionContext() || !chrome.tabs?.sendMessage) {
    return null
  }

  try {
    return await chrome.tabs.sendMessage(tab.id, message) as T
  } catch (error) {
    if (!isExtensionContextInvalidatedError(error)) {
      console.warn("[Poe Zh Trade Tools Pro] Failed to send message to active trade tab", error)
    }
    return null
  }
}
