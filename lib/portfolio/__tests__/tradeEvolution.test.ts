// lib/portfolio/__tests__/tradeEvolution.test.ts

// TRADE-EVOLUTION-CARDS-0001: the formatters moved verbatim out of app/portfolio/page.tsx. These pin their output so the move changed nothing.

import { describe, expect, it } from 'vitest';
import { bufferColor, entryChangeColor, fmtEntryNowDelta, fmtEntryNowDte, fmtEntryNowGamma, fmtEntryNowIvr, fmtEntryNowMaybePct, fmtEntryNowNetEdge, fmtEntryNowPct, fmtEntryNowTheta, fmtEntryNowVega } from '../tradeEvolution';

describe('Trade Evolution formatters', () => {
  it('format entry -> now exactly as the legacy card did', () => {
    expect(fmtEntryNowPct(8, 6.12, 1)).toBe('8.0→6.1%');
    expect(fmtEntryNowDelta(-0.3, -0.2)).toBe('-30→-20 sh-eq');
    expect(fmtEntryNowTheta(0.04, 0.06)).toBe('4→6/d');
    expect(fmtEntryNowDte(45, 30)).toBe('45→30d');
    expect(fmtEntryNowGamma(-0.02, -0.031)).toBe('0.020→0.031');
    expect(fmtEntryNowVega(-0.1, 0.08)).toBe('-0.10→+0.08');
    expect(fmtEntryNowNetEdge(4, 6)).toBe('+$4→+$6/d');
    expect(fmtEntryNowMaybePct(0.7, 75)).toBe('70→75%');
    expect(fmtEntryNowIvr(60, 50)).toBe('60→50');
  });
  it('a missing or non-finite side is a dash', () => {
    expect(fmtEntryNowPct(null, 5)).toBe('—');
    expect(fmtEntryNowDelta(1, undefined)).toBe('—');
    expect(fmtEntryNowGamma(NaN, 1)).toBe('—');
    expect(fmtEntryNowMaybePct(null, null)).toBe('—');
  });
  it('colours keep the legacy rules', () => {
    expect(entryChangeColor(50, 40, true)).toBe('text-emerald-400');
    expect(entryChangeColor(40, 50, true)).toBe('text-red-400');
    expect(entryChangeColor(40, 40, true, 'x')).toBe('x');
    expect(bufferColor(null, 30)).toBe('text-[#808080]');
    expect(bufferColor(0, 30)).toBe('text-red-400');
    expect(bufferColor(6, 40)).toBe('text-emerald-400');
  });
});
