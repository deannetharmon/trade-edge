// lib/tradeLookup/defaultDeps.ts

// TRADE-LOOKUP-0001B: the real broker wiring for loadTradeLookup. Browser-side only (TastyTrade blocks Vercel
// server IPs), and it reuses the scan client's reads instead of adding a second chain path:
//   - expirations:  /option-chains/{symbol}/nested  (the same call getChain starts with)
//   - one expiry:   getChain with a one-day DTE window, so only that expiration is quoted
//   - coverage:     getCoveredCallCapacityReport + getPmccBrokerSnapshot (the Covered Call and PMCC scans' own reads)
// lib/screener/provider.ts is legacy and is deliberately not used here.

import { DEFAULT_RULES, YAHOO_INDEX_CHART_MAP } from '@/lib/scans/constants';
import { fetchDailyBars } from '@/lib/scans/dailyBarsMemo';
import { daysUntil, normalizeTickerToken } from '@/lib/scans/scan-utils';
import { getAccessToken, getChain, getCoveredCallCapacityReport, getMarketMetrics, getPmccBrokerSnapshot, getQuote, ttFetch } from '@/lib/scans/tastytrade-client';
import type { LookupDeps } from './loadLookup';

export const defaultLookupDeps: LookupDeps = {
  async getToken() {
    try {
      return await getAccessToken();
    } catch {
      return null;
    }
  },

  async getListedExpirations(symbol, token) {
    const nested = await ttFetch('/option-chains/' + encodeURIComponent(symbol) + '/nested', token);
    const groups = (nested && nested.data && nested.data.items && nested.data.items[0] && nested.data.items[0].expirations) || [];
    const out: string[] = [];
    for (let i = 0; i < groups.length; i++) {
      const d = groups[i] && groups[i]['expiration-date'];
      if (typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d) && out.indexOf(d) === -1) out.push(d);
    }
    out.sort();
    return out;
  },

  async fetchChain(symbol, token, expiration) {
    // getChain filters by daysUntil(), so the window uses the same function to land on exactly this date.
    const dte = daysUntil(expiration);
    const chain = await getChain(symbol, token, DEFAULT_RULES, { min: dte, max: dte });
    return { chains: chain.chains, classification: chain.classification };
  },

  async getUnderlyingPrice(symbol, token) {
    return getQuote(symbol, token);
  },

  async getCoverageReports(token) {
    const [capacity, snapshot] = await Promise.all([
      getCoveredCallCapacityReport(token).catch(function () { return null; }),
      getPmccBrokerSnapshot(token).catch(function () { return null; }),
    ]);
    return { capacity, foundations: snapshot ? snapshot.foundations : null };
  },

  async getDailyCloses(symbol) {
    // Same chart request the trend and RSI code use, through the shared 60 s memo.
    const clean = normalizeTickerToken(symbol) || symbol.toUpperCase();
    const bars = (await fetchDailyBars(YAHOO_INDEX_CHART_MAP[clean] || clean, clean)) as Array<{ c: number }>;
    const closes = bars.map(function (b) { return b.c; }).filter(function (c) { return typeof c === 'number' && isFinite(c); });
    return closes.length > 0 ? closes : null;
  },

  async getEarningsDate(symbol, token) {
    const items = await getMarketMetrics([symbol], token);
    const first = items && items[0];
    return first && typeof first.earningsExpectedDate === 'string' ? first.earningsExpectedDate : null;
  },

  today() {
    const now = new Date();
    return { year: now.getFullYear(), month: now.getMonth() + 1, day: now.getDate() };
  },
};
