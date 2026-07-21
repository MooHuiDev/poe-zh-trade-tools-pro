/**
 * Shared gate for the trade-site translation layer.
 *
 * The extension UI language (i18n) is independent from whether we translate the
 * live trade site itself. Trade-site translation is opt-in and only offered for
 * Chinese interface languages, so the translation content scripts (zh-core /
 * zh-results / zh-supplement) must no-op unless BOTH conditions hold:
 *   1. the interface language is a Chinese variant, and
 *   2. the user turned on "translate the trade site".
 *
 * Reads the global app settings written by StorageService, whose payload is
 * wrapped as { value, expiresAt } under the lowercased key "app-settings".
 */

export const TRADE_TRANSLATION_LANGS = new Set(["zh-tw", "zh-cn"])

const APP_SETTINGS_KEY = "app-settings"

export interface TradeTranslationState {
  language: string
  enabled: boolean
}

const readAppSettings = async (): Promise<Record<string, unknown>> => {
  try {
    const res = await chrome.storage.local.get(APP_SETTINGS_KEY)
    const payload = (res as Record<string, unknown>)?.[APP_SETTINGS_KEY] as
      | Record<string, unknown>
      | undefined
    if (!payload) return {}
    // StorageService wraps values as { value, expiresAt }.
    const inner = (payload.value ?? payload) as Record<string, unknown>
    return inner && typeof inner === "object" ? inner : {}
  } catch {
    return {}
  }
}

export const getTradeTranslationState =
  async (): Promise<TradeTranslationState> => {
    const settings = await readAppSettings()
    const language = String(settings.language ?? "en")
    const enabled =
      TRADE_TRANSLATION_LANGS.has(language) &&
      settings.translateTradeSite === true
    return { language, enabled }
  }

export const isTradeTranslationEnabled = async (): Promise<boolean> =>
  (await getTradeTranslationState()).enabled
