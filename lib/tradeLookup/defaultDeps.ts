// lib/tradeLookup/defaultDeps.ts

// TRADE-LOOKUP-0001B: the real broker wiring for loadTradeLookup. Browser-side only (TastyTrade blocks Vercel
// server IPs), and it reuses the scan client's reads instead of adding a second chain path:
//   - expirations:  /option-chains/{symbol}/nested  (the same call getChain starts with)
//   - one expiry:   getChain with a one-day DTE window, so only that expiration is quoted
//   - coverage:     getCoveredCallCapacityReport + getPmccBrokerSnapshot (the Covered Call and PMCC scans' own reads)
// lib/screener/provider.ts is legacy and is deliberately not used here.

import { DEFAULT_RULES } from '@/lib/scans/constants';
import { daysUntil } from '@/lib/scans/scan-utils';
import { getAccessToken, getChain, getCoveredCallCapacityReport, getPmccBrokerSnapshot, getQuote, ttFetch } from '@/lib/scans/tastytrade-client';
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

  today() {
    const now = new Date();
    return { year: now.getFullYear(), month: now.getMonth() + 1, day: now.getDate() };
  },
};
