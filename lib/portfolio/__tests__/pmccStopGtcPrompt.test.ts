import { describe, it, expect } from 'vitest';
import { buildStopGtcFlags, buildPmccShortLegStopGtcPrompt, type PmccShortLegPromptContext } from '../pmccStopGtcPrompt';
import type { PmccShortLegLike } from '../pmccLegEconomics';

function shortLeg(overrides: Partial<PmccShortLegLike> = {}): PmccShortLegLike {
  return {
    direction: 'Short',
    quantity: 1,
    avgOpenPrice: 3.5,
    dte: 30,
    strikePrice: 200,
    ...overrides,
  };
}

function context(overrides: Partial<PmccShortLegPromptContext> = {}): PmccShortLegPromptContext {
  return {
    symbol: 'AAPL',
    stockPrice: 195,
    buffer: 2.5,
    ivr: 45,
    iv: 30,
    hv30: 28,
    theta: -0.05,
    gamma: 0.02,
    earningsDate: null,
    expDate: '2027-01-01',
    needsClose: false,
    hasGtc: false,
    gtcOrderPrice: null,
    stopLossStatus: 'None',
    stopLossPrice: null,
    ...overrides,
  };
}

describe('buildPmccShortLegStopGtcPrompt', () => {
  it('builds a prompt referencing the short leg\'s own strike, DTE, and credit', () => {
    const prompt = buildPmccShortLegStopGtcPrompt(shortLeg({ strikePrice: 210, dte: 25, avgOpenPrice: 4.0 }), context());
    expect(prompt).toContain('Strike: 210C | DTE: 25');
    expect(prompt).toContain('Original credit: 4.00/contract (400.00 total)');
  });

  it('throws (fails closed) when the short leg has no fill price', () => {
    expect(() => buildPmccShortLegStopGtcPrompt(shortLeg({ avgOpenPrice: null }), context()))
      .toThrow('Short-leg entry economics are unavailable');
  });

  it('throws when given a Long-direction leg -- this function is short-leg-only', () => {
    expect(() => buildPmccShortLegStopGtcPrompt(shortLeg({ direction: 'Long' }), context()))
      .toThrow('Short-leg entry economics are unavailable');
  });

  it('explicitly instructs the model never to reason about a long LEAPS leg', () => {
    const prompt = buildPmccShortLegStopGtcPrompt(shortLeg(), context());
    expect(prompt).toContain('Do NOT reference or reason about a long LEAPS leg');
    expect(prompt).toContain('none of its data is provided to you');
  });

  it('structurally cannot receive long-leg data -- no parameter exists for it', () => {
    // This is the real guarantee (compile-time, not runtime): the function
    // signature is (shortLeg: PmccShortLegLike, context: PmccShortLegPromptContext)
    // -- there is no third parameter, and PmccShortLegPromptContext has no
    // long-leg field. This test documents that guarantee by construction:
    // every value the prompt could possibly reference is enumerated in
    // the two fixtures above, and neither contains anything describing a
    // second option leg.
    const prompt = buildPmccShortLegStopGtcPrompt(shortLeg(), context());
    expect(prompt).not.toMatch(/long.?call.?strike/i);
    expect(prompt).not.toMatch(/leaps.?strike/i);
  });

  it('reuses buildStopGtcFlags, not a duplicated copy -- earnings flag appears when upcoming', () => {
    const soon = new Date();
    soon.setDate(soon.getDate() + 3);
    const earningsDate = soon.toISOString().slice(0, 10);
    const farExpDate = new Date();
    farExpDate.setDate(farExpDate.getDate() + 30);
    const prompt = buildPmccShortLegStopGtcPrompt(
      shortLeg(),
      context({ earningsDate, expDate: farExpDate.toISOString().slice(0, 10) }),
    );
    expect(prompt).toContain('EARNINGS');
  });

  it('flags omit long-leg-only concepts -- profitCaptured is always null for the short-leg path since it has no live quote source yet', () => {
    const prompt = buildPmccShortLegStopGtcPrompt(shortLeg(), context());
    expect(prompt).not.toContain('PROFIT CAPTURED');
  });
});

describe('buildStopGtcFlags', () => {
  it('is a pure function of its explicit inputs, not the position object', () => {
    const flags = buildStopGtcFlags({
      needsClose: false,
      entryDte: 45,
      dte: 30,
      buffer: 1.5,
      earningsDate: null,
      expDate: '2027-01-01',
      ivr: 45,
      profitCaptured: null,
    });
    expect(flags).toContain('CRITICAL buffer');
  });

  it('returns "None" when nothing qualifies', () => {
    const flags = buildStopGtcFlags({
      needsClose: false,
      entryDte: 45,
      dte: 30,
      buffer: 20,
      earningsDate: null,
      expDate: '2027-01-01',
      ivr: 45,
      profitCaptured: null,
    });
    expect(flags).toBe('None');
  });
});

