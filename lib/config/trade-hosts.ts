export const tradeHosts = [
  "https://www.pathofexile.com/trade*",
  "https://pathofexile.com/trade*",
  "https://br.pathofexile.com/trade*",
  "https://ru.pathofexile.com/trade*",
  "https://th.pathofexile.com/trade*",
  "https://de.pathofexile.com/trade*",
  "https://fr.pathofexile.com/trade*",
  "https://es.pathofexile.com/trade*",
  "https://jp.pathofexile.com/trade*",
  "https://poe2.kakaogames.com/trade*",
  // Garena Taiwan trade site — already in Chinese, so the tools run here but the
  // localization layer and poe.ninja (no TW economy data) are disabled.
  "https://pathofexile.tw/trade*"
]

export const tradeHostPermissions = [
  "https://www.pathofexile.com/*",
  "https://br.pathofexile.com/*",
  "https://ru.pathofexile.com/*",
  "https://th.pathofexile.com/*",
  "https://de.pathofexile.com/*",
  "https://fr.pathofexile.com/*",
  "https://es.pathofexile.com/*",
  "https://jp.pathofexile.com/*",
  "https://poe2.kakaogames.com/*",
  "https://pathofexile.tw/*"
]

// Trade sites that are already natively Chinese (Garena Taiwan). On these, the
// self-built localization layer and poe.ninja pricing are turned off — the site
// is already localized and poe.ninja has no data for these leagues.
export const NATIVE_CHINESE_TRADE_HOSTS = new Set(["pathofexile.tw"])

export const isNativeChineseTradeSite = (): boolean => {
  try {
    return NATIVE_CHINESE_TRADE_HOSTS.has(location.hostname)
  } catch {
    return false
  }
}

// A trade "realm" separates bookmarks/history by server, because an identical
// search produces a DIFFERENT url on the Garena Taiwan site than on the
// international site — they are distinct economies and cannot be shared.
export type TradeRealm = "intl" | "tw"

// POE2 trade uses a different stat/item set than POE1, and our localization data
// comes from the POE1 (pathofexile.tw) APIs — so localization is not offered on
// POE2. Detected by the "/trade2" path or the dedicated POE2 host.
export const isPoe2TradeSite = (): boolean => {
  try {
    return (
      location.pathname.startsWith("/trade2") ||
      location.hostname === "poe2.kakaogames.com"
    )
  } catch {
    return false
  }
}

export const getTradeRealm = (hostname?: string): TradeRealm => {
  let h = hostname
  if (h == null) {
    try {
      h = location.hostname
    } catch {
      h = ""
    }
  }
  return h === "pathofexile.tw" ? "tw" : "intl"
}
