// SALVAGE-0001 slice B fixtures: eligibility and wing candidates.
import { describe, expect, it } from 'vitest';
import type { Position } from '@/lib/portfolio-data/types';
import { salvageEligibility } from '../salvageEligibility';
import {
  buildWingRows,
  earningsBeforeExpiry,
  isStaleQuote,
  isWideMarket,
  type ChainQuote,
} from '../salvageCandidates';
import type { LongLeg } from '../salvageMath';

const NOW = 1_800_000_000_000;

function pos(over: Record<string, unknown> = {}): Position {
  return {
    key: 'MRNA-1',
    symbol: 'MRNA',
    expDate: '2026-11-20',
    dte: 35,
    strategy: 'Long Put',
    structureAmbiguous: false,
    structureBlockMessage: null,
    pairedShortCallKey: null,
    hasGtc: false,
    legs: [
      { symbol: 'MRNA 261120P00140000', optionType: 'P', strikePrice: 140, direction: 'Long', quantity: 1, avgOpenPrice: 25.74, currentPrice: 2.08, currentDelta: -0.074 },
    ],
    identity: { structureType: 'NAKED', quantity: 1, entryPriceEffect: 'Debit', entryTotalCashFlowDollars: -2574 },
    ...over,
  } as unknown as Position;
}

describe('salvageEligibility', () => {
  it('MRNA long put is eligible', () => {
    const r = salvageEligibility(pos());
    expect(r).toMatchObject({ eligible: true, right: 'P', strike: 140, quantity: 1, entryDebit: 2574, underlying: 'MRNA' });
  });
  it('ambiguous structure is blocked', () => {
    expect(salvageEligibility(pos({ structureAmbiguous: true }))).toMatchObject({ eligible: false, reason: 'STRUCTURE_AMBIGUOUS' });
    expect(salvageEligibility(pos({ identity: null }))).toMatchObject({ eligible: false, reason: 'STRUCTURE_AMBIGUOUS' });
  });
  it('PMCC LEAPS is excluded', () => {
    expect(salvageEligibility(pos({ pairedShortCallKey: 'X' }))).toMatchObject({ eligible: false, reason: 'PMCC_LEAPS' });
  });
  it('short option and spread are excluded', () => {
    const short = pos({ legs: [{ optionType: 'P', strikePrice: 140, direction: 'Short', quantity: 1, currentPrice: 2 }] });
    expect(salvageEligibility(short)).toMatchObject({ eligible: false, reason: 'NOT_SINGLE_LONG_OPTION' });
    const spread = pos({
      legs: [
        { optionType: 'P', strikePrice: 140, direction: 'Long', quantity: 1, currentPrice: 2 },
        { optionType: 'P', strikePrice: 130, direction: 'Short', quantity: 1, currentPrice: 1 },
      ],
      identity: { structureType: 'VERTICAL', quantity: 1, entryPriceEffect: 'Debit', entryTotalCashFlowDollars: -500 },
    });
    expect(salvageEligibility(spread)).toMatchObject({ eligible: false, reason: 'NOT_SINGLE_LONG_OPTION' });
  });
  it('unknown entry debit or mark is blocked', () => {
    expect(salvageEligibility(pos({ identity: { structureType: 'NAKED', quantity: 1, entryPriceEffect: 'Credit', entryTotalCashFlowDollars: 100 } }))).toMatchObject({ reason: 'ENTRY_DEBIT_UNKNOWN' });
    const noMark = pos();
    (noMark.legs[0] as { currentPrice: number | null }).currentPrice = null;
    expect(salvageEligibility(noMark)).toMatchObject({ reason: 'MARK_UNAVAILABLE' });
  });
  it('worth more than half of cost is not eligible; exactly half is', () => {
    const up = pos();
    (up.legs[0] as { currentPrice: number }).currentPrice = 12.88;
    expect(salvageEligibility(up)).toMatchObject({ eligible: false, reason: 'NOT_DOWN_ENOUGH' });
    const half = pos();
    (half.legs[0] as { currentPrice: number }).currentPrice = 12.87;
    expect(salvageEligibility(half).eligible).toBe(true);
  });
  it('a working closing order blocks', () => {
    expect(salvageEligibility(pos({ hasGtc: true }))).toMatchObject({ eligible: false, reason: 'WORKING_CLOSE_ORDER' });
    expect(salvageEligibility(pos(), { hasWorkingCloseOrder: true })).toMatchObject({ eligible: false, reason: 'WORKING_CLOSE_ORDER' });
  });
});

describe('market guardrails', () => {
  it('wide market: over 25% of mid, or over $0.10 under $1', () => {
    expect(isWideMarket(0.1, 0.45)).toBe(true);
    expect(isWideMarket(0.5, 0.62)).toBe(true);   // under $1, gap 0.12
    expect(isWideMarket(0.5, 0.58)).toBe(false);
    expect(isWideMarket(4, 5.2)).toBe(true);      // gap 1.2 > 25% of 4.6
    expect(isWideMarket(4, 4.4)).toBe(false);
  });
  it('quote older than 60s or unknown age is stale', () => {
    expect(isStaleQuote(NOW - 59_000, NOW)).toBe(false);
    expect(isStaleQuote(NOW - 61_000, NOW)).toBe(true);
    expect(isStaleQuote(null, NOW)).toBe(true);
  });
  it('earnings before expiry', () => {
    expect(earningsBeforeExpiry('2026-11-06', '2026-11-20', '2026-10-16')).toEqual({ before: true, daysAway: 21 });
    expect(earningsBeforeExpiry('2026-12-01', '2026-11-20', '2026-10-16').before).toBe(false);
    expect(earningsBeforeExpiry(null, '2026-11-20', '2026-10-16').before).toBe(false);
  });
});

describe('buildWingRows (synthetic chain)', () => {
  const long: LongLeg = { right: 'P', strike: 140, quantity: 1, bid: 2.08, entryDebit: 2574 };
  const q = (strike: number, bid: number | null, ask: number | null, age = 5_000, right: 'P' | 'C' = 'P'): ChainQuote => ({ right, strike, bid, ask, delta: -0.02, asOfMs: NOW - age });
  const chain: ChainQuote[] = [
    q(150, 3, 3.2), q(140, 2.08, 2.2), q(130, 1.35, 1.45), q(120, 0.85, 0.95),
    q(110, 0.5, 0.55), q(100, 0.3, 0.35), q(90, 0.005, 0.1), q(80, null, 0.05), q(110, 9, 9.5, 5_000, 'C'),
  ];
  const rows = buildWingRows(chain, { long, wingQuantity: 1, nowMs: NOW, targetDollars: 2574 });

  it('lists only strictly lower puts with a bid that clears fees, closest first', () => {
    expect(rows.map((r) => r.strike)).toEqual([130, 120, 110, 100]);
  });
  it('net credit matches the math module', () => {
    expect(rows.find((r) => r.strike === 110)?.creditNet).toBe(48.86);
    expect(rows.find((r) => r.strike === 110)?.maxFromToday).toBe(3048.86);
  });
  it('objective verdicts for the original debit', () => {
    const v = Object.fromEntries(rows.map((r) => [r.strike, r.objective?.verdict]));
    expect(v).toEqual({ 130: 'partial-only', 120: 'partial-only', 110: 'can-meet', 100: 'can-meet' });
  });
  it('stale quote is flagged and not proposable', () => {
    const stale = buildWingRows([q(110, 0.5, 0.55, 90_000)], { long, wingQuantity: 1, nowMs: NOW });
    expect(stale[0].warnings).toContain('STALE_QUOTE');
    expect(stale[0].proposable).toBe(false);
  });
  it('wide market is flagged but still proposable', () => {
    const wide = buildWingRows([q(110, 0.5, 0.9)], { long, wingQuantity: 1, nowMs: NOW });
    expect(wide[0].warnings).toContain('WIDE_MARKET');
    expect(wide[0].proposable).toBe(true);
  });
  it('wing quantity above the long leg yields nothing', () => {
    expect(buildWingRows(chain, { long, wingQuantity: 2, nowMs: NOW })).toEqual([]);
  });
});
