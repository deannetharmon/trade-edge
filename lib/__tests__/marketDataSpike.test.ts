// lib/__tests__/marketDataSpike.test.ts

import { describe, expect, it } from 'vitest';
import {
  countAdvanced,
  parseQuoteTime,
  pickExpirations,
  pickStrikes,
  spikeVerdict,
  summarizeQuotes,
} from '../trademap/marketDataSpike';

const NOW = Date.parse('2026-11-17T20:00:00Z');

describe('OPTMAP-0001 spike: parseQuoteTime', () => {
  it('parses ISO strings, epoch ms and epoch seconds', () => {
    expect(parseQuoteTime('2026-11-17T19:59:58Z')).toBe(NOW - 2000);
    expect(parseQuoteTime(NOW)).toBe(NOW);
    expect(parseQuoteTime(String(NOW / 1000))).toBe(NOW);
  });
  it('returns null for missing or unusable values', () => {
    expect(parseQuoteTime(null)).toBeNull();
    expect(parseQuoteTime('')).toBeNull();
    expect(parseQuoteTime('not a date')).toBeNull();
    expect(parseQuoteTime(5)).toBeNull();
  });
});

describe('OPTMAP-0001 spike: summarizeQuotes', () => {
  const live = (sym: string, ageSec: number) => ({
    symbol: sym,
    bid: '1.00', ask: '1.10', mark: '1.05',
    delta: '0.30', gamma: '0.01', theta: '-0.02', vega: '0.05',
    volatility: '0.62', volume: 10, 'open-interest': 100,
    delayed: false,
    'updated-at': new Date(NOW - ageSec * 1000).toISOString(),
  });

  it('counts delayed flags, field coverage and quote age without assuming names', () => {
    const s = summarizeQuotes([live('A', 2), live('B', 4), { ...live('C', 6), delayed: true }], NOW);
    expect(s.total).toBe(3);
    expect(s.delayedTrue).toBe(1);
    expect(s.delayedFalse).toBe(2);
    expect(s.coverage.iv.keys).toEqual(['volatility']);
    expect(s.coverage.iv.present).toBe(3);
    expect(s.coverage.openInterest.present).toBe(3);
    expect(s.ageByKey['updated-at'].medianSec).toBe(4);
    expect(s.ageByKey['updated-at'].maxSec).toBe(6);
  });

  it('reports a missing delayed flag as unknown, never as live', () => {
    const noFlag = { ...live('A', 1) } as Record<string, unknown>;
    delete noFlag.delayed;
    const s = summarizeQuotes([noFlag], NOW);
    expect(s.delayedUnknown).toBe(1);
    expect(spikeVerdict(s, 15).notDelayed).toBe('UNKNOWN');
  });

  it('does not count empty strings as present', () => {
    const s = summarizeQuotes([{ ...live('A', 1), volatility: '' }], NOW);
    expect(s.coverage.iv.present).toBe(0);
    expect(spikeVerdict(s, 15).ivPerLeg).toBe('NO');
  });
});

describe('OPTMAP-0001 spike: spikeVerdict', () => {
  const mk = (ageSec: number, delayed: boolean | null) => ({
    symbol: 'A', volatility: '0.5', 'updated-at': new Date(NOW - ageSec * 1000).toISOString(),
    ...(delayed == null ? {} : { delayed }),
  });

  it('passes fresh, non-delayed quotes with IV on every leg', () => {
    const v = spikeVerdict(summarizeQuotes([mk(3, false), mk(5, false)], NOW), 15);
    expect(v).toEqual({ notDelayed: 'YES', quoteFresh: 'YES', ivPerLeg: 'YES', freshnessKey: 'updated-at' });
  });
  it('fails stale quotes', () => {
    expect(spikeVerdict(summarizeQuotes([mk(900, false)], NOW), 15).quoteFresh).toBe('NO');
  });
  it('fails when any quote is flagged delayed', () => {
    expect(spikeVerdict(summarizeQuotes([mk(3, false), mk(3, true)], NOW), 15).notDelayed).toBe('NO');
  });
  it('is unknown (not a pass) when no quote carries a time key', () => {
    const v = spikeVerdict(summarizeQuotes([{ symbol: 'A', volatility: '0.5', delayed: false }], NOW), 15);
    expect(v.quoteFresh).toBe('UNKNOWN');
    expect(v.freshnessKey).toBeNull();
  });
});

describe('OPTMAP-0001 spike: pickers and sample comparison', () => {
  it('picks distinct expirations nearest each target DTE', () => {
    const all = [3, 10, 16, 30, 38, 45, 100, 130].map(d => ({ date: `D${d}`, dte: d }));
    expect(pickExpirations(all, [14, 38, 120]).map(e => e.dte)).toEqual([16, 38, 130]);
    expect(pickExpirations([{ date: 'x', dte: 20 }], [14, 38, 120])).toHaveLength(1);
  });
  it('ignores expirations that are today or past', () => {
    expect(pickExpirations([{ date: 'x', dte: 0 }], [14])).toEqual([]);
  });
  it('picks the strikes nearest spot, ascending', () => {
    expect(pickStrikes([40, 45, 47, 50, 55, 60], 48, 3)).toEqual([45, 47, 50]);
  });
  it('counts symbols whose newest quote time advanced between samples', () => {
    expect(countAdvanced({ A: 1, B: 5, C: 9 }, { A: 2, B: 5 })).toEqual({ compared: 2, advanced: 1 });
  });
});
