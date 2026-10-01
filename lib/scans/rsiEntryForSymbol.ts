// lib/scans/rsiEntryForSymbol.ts

// RSI-ENTRY-0001 slice A1b: the entry-timing gate for one scanned symbol.
// Reads the daily bars through the shared memo (a hit when getTrend ran first), keeps only completed bars, and
// evaluates the gate. Never throws: any failure is "RSI n/a" (UNAVAILABLE), which fails closed when the gate is On.
// It touches nothing else: no TrendResult, no scoring, no order path.

import { completedDailyCloses } from '@/lib/indicators/completedBars';
import { evaluateRsiEntryGate, type EntryGateStrategy, type RsiEntryGateResult } from '@/lib/indicators/rsiEntryGate';
import type { RsiTurnParams } from '@/lib/indicators/rsiTurn';
import { YAHOO_INDEX_CHART_MAP } from './constants';
import { fetchDailyBars } from './dailyBarsMemo';
import { normalizeTickerToken } from './scan-utils';

/**
 * Attach one symbol's verdict to each of its result rows. With no verdict (the gate is Off) it returns the SAME array
 * untouched, so a scan with the gate Off is byte-for-byte what it was before this feature existed.
 */
export function attachRsiEntry<T extends object>(results: T[], entry: RsiEntryGateResult | undefined): Array<T & { rsiEntry?: RsiEntryGateResult }> {
  return entry ? results.map((result) => ({ ...result, rsiEntry: entry })) : results;
}

const UNAVAILABLE: RsiEntryGateResult = {
  verdict: 'UNAVAILABLE',
  reason: 'UNAVAILABLE',
  label: 'RSI n/a',
  latest: null,
  extreme: null,
  extremeBarsAgo: null,
};

export async function getRsiEntryGate(
  symbol: string,
  strategy: EntryGateStrategy,
  now: Date = new Date(),
  params?: RsiTurnParams,
): Promise<RsiEntryGateResult> {
  try {
    const cleanSymbol = normalizeTickerToken(symbol) ?? symbol.toUpperCase();
    if (!cleanSymbol.trim()) return UNAVAILABLE; // no symbol, no request
    const chartSymbol = YAHOO_INDEX_CHART_MAP[cleanSymbol] ?? cleanSymbol;
    const bars = await fetchDailyBars(chartSymbol, cleanSymbol);
    const closes = completedDailyCloses(bars, now);
    if (!closes) return UNAVAILABLE;
    return evaluateRsiEntryGate(strategy, closes, params);
  } catch {
    return UNAVAILABLE;
  }
}
