import { STRIKE_TESTNET_API } from '../strike-missions/strike';

const decimal = (value: unknown) => typeof value === 'string' && /^\d+(\.\d+)?$/.test(value) && Number.isFinite(Number(value)) ? value : null;
export function normalizeMarkets(raw: unknown) {
  const source = (raw as { markets?: Record<string, Record<string, unknown>> })?.markets;
  if (!source || typeof source !== 'object' || Array.isArray(source)) throw new Error('Invalid market snapshot');
  const markets = ['ETH-USD', 'ADA-USD', 'BTC-USD'].flatMap(symbol => {
    const market = source[symbol];
    if (!market || !decimal(market.mark_price) || Number(market.mark_price) <= 0) return [];
    const minimum = decimal(market.order_min_price), maximum = decimal(market.order_max_price);
    return [{ symbol, mark: decimal(market.mark_price)!, status: market.status === 'trading' ? 'trading' : 'unavailable',
      boundsConsistent: !!minimum && !!maximum && Number(minimum) <= Number(market.mark_price) && Number(maximum) >= Number(market.mark_price),
    }];
  });
  if (!markets.length) throw new Error('No valid markets');
  return markets;
}
let cached: { expires: number; promise: Promise<{ checkedAt: number; markets: ReturnType<typeof normalizeMarkets> } | null> } | undefined;
export function resetMarketsCache() { cached = undefined; }
export function strikeMarkets() {
  if (!cached || cached.expires < Date.now()) {
    cached = { expires: Date.now() + 30_000, promise: (async () => {
      try {
        const response = await fetch(`${STRIKE_TESTNET_API}/v2/markets`, { redirect: 'error', cache: 'no-store', signal: AbortSignal.timeout(10_000) });
        if (!response.ok) return null;
        return { markets: normalizeMarkets(await response.json()), checkedAt: Date.now() };
      } catch { return null; }
    })() };
  }
  return cached.promise;
}
