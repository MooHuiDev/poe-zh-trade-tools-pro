import { tradeLocationService } from "../services/trade-location";
import type { TradeSiteVersion } from "../types/trade-location";

export const getTradeUrl = (
  version: TradeSiteVersion, 
  type: string, 
  slug: string, 
  league: string, 
  suffix: string = ""
) => {
  return tradeLocationService.getTradeUrl(version, type, slug, league) + suffix;
};

export interface TradeUrlLike {
  version: TradeSiteVersion;
  type: string;
  slug: string;
  league: string | null;
}

export const resolveTradeLeague = (league: string | null | undefined, currentLeague: string | null | undefined = tradeLocationService.current.league) =>
  league || currentLeague || "Standard";

export const resolveTradeUrl = (
  trade: TradeUrlLike,
  suffix: string = "",
  useActiveLeague: boolean = false
) => {
  const activeLocation = tradeLocationService.current;
  const activeLeague =
    useActiveLeague && activeLocation.version === trade.version
      ? activeLocation.league
      : null;

  return getTradeUrl(
    trade.version,
    trade.type,
    trade.slug,
    resolveTradeLeague(activeLeague || trade.league),
    suffix
  );
};
