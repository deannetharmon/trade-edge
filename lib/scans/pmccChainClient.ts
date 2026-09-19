import { classifyUnderlying, ttFetch } from './tastytrade-client';
import { daysUntil } from './scan-utils';
import { classifyPmccDte } from './pmccDteRanges';

export interface PmccClientChain {
  shortExpirations: string[];
  longExpirations: string[];
  chains: Record<string, any[]>;
  isEtfOrIndex: boolean;
  classification: 'index' | 'etf' | 'stock';
}

/**
 * The sole browser-side PMCC chain acquisition path. Both the Screener and
 * future Portfolio readiness consumers must use this function so quote,
 * DTE-window, symbol classification, and chain-shape semantics cannot drift.
 */
export async function getPmccChain(
  symbol: string,
  token: string,
  dteRanges: { shortMin: number; shortMax: number; longMin: number; longMax: number },
): Promise<PmccClientChain> {
  const nested = await ttFetch(`/option-chains/${symbol}/nested`, token);
  const rawClassification = await classifyUnderlying(symbol, token);
  const classification = rawClassification === 'unsupported' ? 'stock' : rawClassification;
  const isEtfOrIndex = classification === 'index' || classification === 'etf';
  const shortExpirations: string[] = [], longExpirations: string[] = [], chains: Record<string, any[]> = {}, allOCCSymbols: string[] = [];
  const symbolMeta: Record<string, { expDate: string; strike: number; optionType: string }> = {};
  for (const expGroup of nested?.data?.items?.[0]?.expirations ?? []) {
    const expDate: string = expGroup['expiration-date']; if (!expDate) continue;
    const dte = daysUntil(expDate);
    const { isShortWindow, isLongWindow } = classifyPmccDte(dte, dteRanges);
    if (!isShortWindow && !isLongWindow) continue;
    for (const strike of expGroup.strikes ?? []) {
      const strikePrice = parseFloat(strike['strike-price'] ?? '0');
      const callSym: string = strike['call'];
      if (callSym) { allOCCSymbols.push(callSym); symbolMeta[callSym] = { expDate, strike: strikePrice, optionType: 'C' }; }
    }
    if (isShortWindow) shortExpirations.push(expDate);
    if (isLongWindow) longExpirations.push(expDate);
  }
  if (allOCCSymbols.length === 0) return { shortExpirations, longExpirations, chains, isEtfOrIndex, classification };
  for (let i = 0; i < allOCCSymbols.length; i += 100) {
    const chunk = allOCCSymbols.slice(i, i + 100);
    const qs = chunk.map(s => `equity-option=${encodeURIComponent(s)}`).join('&');
    let greeksData: any;
    try { greeksData = await ttFetch(`/market-data/by-type?${qs}`, token); } catch { continue; }
    for (const item of greeksData?.data?.items ?? []) {
      const meta = symbolMeta[item.symbol]; if (!meta) continue;
      const bid = parseFloat(item.bid ?? '0'), ask = parseFloat(item.ask ?? '0');
      const delta = item.delta != null ? parseFloat(item.delta) : null;
      const oi = parseInt(item['open-interest'] ?? '0', 10);
      if (!chains[meta.expDate]) chains[meta.expDate] = [];
      chains[meta.expDate].push({
        underlyingSymbol: symbol, strikePrice: meta.strike, expirationDate: meta.expDate, optionType: 'C', delta,
        openInterest: oi, bid, ask, mid: (bid + ask) / 2, occSymbol: item.symbol,
        quoteTimestamp: item['quote-time'] ?? item['updated-at'] ?? item.timestamp ?? null,
        delayed: item.delayed ?? item['is-delayed'] ?? null,
      });
    }
  }
  shortExpirations.sort(); longExpirations.sort();
  return { shortExpirations, longExpirations, chains, isEtfOrIndex, classification };
}
