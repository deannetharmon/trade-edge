// lib/scans/__tests__/cspSearch.test.ts
//
// CSP-0002 Layer 1 — pure, table-driven coverage of the exhaustive CSP
// search (lib/scans/cspSearch.ts). This is the module that replaced the
// "pick the closest-to-center contract, then reject it outright on
// liquidity" behavior responsible for the AMD production incident (see
// docs/tickets/CSP-0002-candidate-discovery-correctness.md). Every case here
// maps to a named risk from that ticket, combined where the underlying rule
// is the same shape.

import { describe, it, expect } from 'vitest';
import { searchCspCandidates, describeCspSearchOutcome, type CspSearchRules } from '../cspSearch';

const RULES: CspSearchRules = { deltaMin: 0.15, deltaMax: 0.25, dteMin: 30, dteMax: 45, oiMin: 500, bidAskMax: 0.10 };

function expDate(daysFromNow: number): string {
  const d = new Date();
  d.setDate(d.getDate() + daysFromNow);
  return d.toISOString().slice(0, 10);
}

interface LegSpec {
  strike: number;
  optionType?: 'P' | 'C';
  delta: number | null;
  bid: number;
  ask: number;
  oi: number;
  mid?: number;
}

function chainOf(expirationsWithLegs: Array<{ dte: number; legs: LegSpec[] }>) {
  const expirations: string[] = [];
  const chains: Record<string, any[]> = {};
  for (const { dte, legs } of expirationsWithLegs) {
    const exp = expDate(dte);
    expirations.push(exp);
    chains[exp] = legs.map((l, i) => ({
      strikePrice: l.strike,
      expirationDate: exp,
      optionType: l.optionType ?? 'P',
      delta: l.delta,
      bid: l.bid,
      ask: l.ask,
      mid: l.mid,
      openInterest: l.oi,
      occSymbol: `TEST_${exp}_${l.strike}_${i}`,
    }));
  }
  return { expirations, chains };
}

describe('searchCspCandidates — structural discovery (Stages 1-3)', () => {
  it('no expiration inside the DTE window -> NO_EXPIRATION_IN_DTE_WINDOW', () => {
    const chain = chainOf([{ dte: 10, legs: [{ strike: 100, delta: -0.20, bid: 1, ask: 1.05, oi: 1000 }] }]);
    const result = searchCspCandidates(chain, RULES);
    expect(result.reason).toBe('NO_EXPIRATION_IN_DTE_WINDOW');
    expect(result.selectedCandidate).toBeNull();
    expect(result.diagnostics.expirationsInDteWindow).toBe(0);
  });

  it('expiration in window but no put delta inside range (a call at that delta, and a put outside range) -> NO_PUT_IN_DELTA_WINDOW', () => {
    const chain = chainOf([{
      dte: 35,
      legs: [
        { strike: 480, optionType: 'C', delta: 0.20, bid: 1, ask: 1.05, oi: 1000 },
        { strike: 350, delta: -0.05, bid: 1, ask: 1.05, oi: 1000 }, // way outside 0.15-0.25
      ],
    }]);
    const result = searchCspCandidates(chain, RULES);
    expect(result.reason).toBe('NO_PUT_IN_DELTA_WINDOW');
    expect(result.diagnostics.expirationsInDteWindow).toBe(1);
    expect(result.diagnostics.putsInDeltaWindow).toBe(0);
  });

  it('negative raw put delta is normalized via abs() and correctly discovered', () => {
    const chain = chainOf([{ dte: 35, legs: [{ strike: 415, delta: -0.20, bid: 10.20, ask: 10.30, oi: 1000 }] }]);
    const result = searchCspCandidates(chain, RULES);
    expect(result.reason).toBeNull();
    expect(result.selectedCandidate?.delta).toBe(0.20);
    expect(result.selectedCandidate?.delta).toBeGreaterThan(0); // never negative in the result
  });

  it.each([
    ['lower boundary 0.15 inclusive', -0.15],
    ['upper boundary 0.25 inclusive', -0.25],
  ])('%s is accepted into the delta window', (_label, rawDelta) => {
    const chain = chainOf([{ dte: 35, legs: [{ strike: 400, delta: rawDelta, bid: 5, ask: 5.05, oi: 1000 }] }]);
    const result = searchCspCandidates(chain, RULES);
    expect(result.diagnostics.putsInDeltaWindow).toBe(1);
    expect(result.selectedCandidate).not.toBeNull();
  });

  it.each([
    ['just outside lower boundary, 0.149', -0.149],
    ['just outside upper boundary, 0.251', -0.251],
  ])('%s is rejected from the delta window', (_label, rawDelta) => {
    const chain = chainOf([{ dte: 35, legs: [{ strike: 400, delta: rawDelta, bid: 5, ask: 5.05, oi: 1000 }] }]);
    const result = searchCspCandidates(chain, RULES);
    expect(result.reason).toBe('NO_PUT_IN_DELTA_WINDOW');
  });

  it.each([
    ['crossed quote (bid > ask)', { strike: 400, delta: -0.20, bid: 5.10, ask: 5.00, oi: 1000 }],
    ['negative bid', { strike: 400, delta: -0.20, bid: -1, ask: 5, oi: 1000 }],
    ['non-finite/NaN open interest', { strike: 400, delta: -0.20, bid: 5, ask: 5.05, oi: NaN }],
    ['negative open interest', { strike: 400, delta: -0.20, bid: 5, ask: 5.05, oi: -10 }],
  ])('invalid quote (%s) is excluded from the valid set -> NO_VALID_QUOTE when nothing else qualifies', (_label, leg) => {
    const chain = chainOf([{ dte: 35, legs: [leg as LegSpec] }]);
    const result = searchCspCandidates(chain, RULES);
    expect(result.reason).toBe('NO_VALID_QUOTE');
    expect(result.diagnostics.putsInDeltaWindow).toBe(1); // delta window is a Stage 2 concern, independent of quote validity
    expect(result.diagnostics.validQuoteCandidates).toBe(0);
  });
});

describe('searchCspCandidates — liquidity evaluation (Stage 4) never discards a candidate', () => {
  it('low OI only -> selected with status QUALIFIED_LOW_OI, not discarded', () => {
    const chain = chainOf([{ dte: 35, legs: [{ strike: 415, delta: -0.20, bid: 10.95, ask: 11.05, oi: 190 }] }]);
    const result = searchCspCandidates(chain, RULES);
    expect(result.reason).toBeNull();
    expect(result.selectedStatus).toBe('QUALIFIED_LOW_OI');
    expect(result.selectedCandidate?.openInterest).toBe(190);
    expect(result.diagnostics.oiPassingCandidates).toBe(0);
    expect(result.diagnostics.spreadPassingCandidates).toBe(1);
    // QUALIFIED_LOW_OI passes the hard qualification rule (bid/ask width) --
    // describeCspSearchOutcome must NOT treat it as a disqualification.
    expect(describeCspSearchOutcome(result, RULES)).toBeNull();
  });

  it('wide bid/ask only -> selected with status DISQUALIFIED_WIDE_MARKET, not discarded', () => {
    const chain = chainOf([{ dte: 35, legs: [{ strike: 415, delta: -0.20, bid: 10.20, ask: 11.90, oi: 1000 }] }]);
    const result = searchCspCandidates(chain, RULES);
    expect(result.reason).toBeNull();
    expect(result.selectedStatus).toBe('DISQUALIFIED_WIDE_MARKET');
    expect(result.selectedCandidate?.bidAskWidth).toBeCloseTo(1.70, 2);
    expect(result.diagnostics.spreadPassingCandidates).toBe(0);
    const message = describeCspSearchOutcome(result, RULES);
    expect(message).toContain('Bid/ask width $1.70 exceeds the maximum of $0.10');
  });

  it('low OI AND wide market together -> DISQUALIFIED_WIDE_MARKET_LOW_OI, still not discarded (the exact AMD 415 put)', () => {
    const chain = chainOf([{ dte: 35, legs: [{ strike: 415, delta: -0.20, bid: 10.20, ask: 11.90, oi: 190 }] }]);
    const result = searchCspCandidates(chain, RULES);
    expect(result.reason).toBeNull();
    expect(result.selectedStatus).toBe('DISQUALIFIED_WIDE_MARKET_LOW_OI');
    const message = describeCspSearchOutcome(result, RULES);
    expect(message).toContain('OI 190 is below the preferred minimum of 500');
    expect(message).toContain('Bid/ask width $1.70 exceeds the maximum of $0.10');
  });

  it('a closer-to-center but liquidity-bad candidate never hides a farther-out fully qualified one', () => {
    const chain = chainOf([{
      dte: 35,
      legs: [
        // Center of 0.15-0.25 is 0.20 — this one is dead-center but illiquid.
        { strike: 415, delta: -0.20, bid: 10.20, ask: 11.90, oi: 190 },
        // Farther from center (0.15) but fully liquid.
        { strike: 410, delta: -0.15, bid: 8.95, ask: 9.05, oi: 1000 },
      ],
    }]);
    const result = searchCspCandidates(chain, RULES);
    expect(result.selectedStatus).toBe('FULLY_QUALIFIED');
    expect(result.selectedCandidate?.strikePrice).toBe(410);
    expect(result.diagnostics.validQuoteCandidates).toBe(2);
  });
});

describe('searchCspCandidates — CSP-0002 corrective pass BLOCKER: selection tier matches actual qualification policy', () => {
  it('a narrow-market, low-OI candidate is selected over a closer-delta, wide-market, sufficient-OI candidate -- because the real qualification rule is bid/ask width, not OI', () => {
    // Candidate A: closest to the 0.20 delta center, sufficient OI, but its
    // market is too wide (width $1.70 > $0.10 max). Under the real policy
    // (bid/ask width is the hard gate) this is DISQUALIFIED regardless of
    // its excellent OI.
    const candidateA = { strike: 415, delta: -0.20, bid: 10.20, ask: 11.90, oi: 1000 };
    // Candidate B: farther from center (0.15), OI below the preferred
    // minimum, but a valid narrow market (width $0.10 <= max). Under the
    // real policy this IS qualified -- with an OI warning, never hidden by
    // Candidate A's better delta/OI.
    const candidateB = { strike: 410, delta: -0.15, bid: 8.95, ask: 9.05, oi: 190 };
    const chain = chainOf([{ dte: 35, legs: [candidateA, candidateB] }]);

    const result = searchCspCandidates(chain, RULES);

    expect(result.selectedCandidate?.strikePrice).toBe(410);
    expect(result.selectedStatus).toBe('QUALIFIED_LOW_OI');
    expect(result.selectedCandidate?.oiPassing).toBe(false);
    expect(result.selectedCandidate?.bidAskPassing).toBe(true);
    // Qualified per policy -- describeCspSearchOutcome must not describe
    // this as a disqualification.
    expect(describeCspSearchOutcome(result, RULES)).toBeNull();
  });

  it('when otherwise comparable (same delta distance, same width), the candidate with sufficient OI is preferred as a tie-break', () => {
    const chain = chainOf([
      { dte: 35, legs: [{ strike: 420, delta: -0.20, bid: 10.95, ask: 11.05, oi: 100 }] },  // low OI
      { dte: 40, legs: [{ strike: 420, delta: -0.20, bid: 10.95, ask: 11.05, oi: 600 }] },  // sufficient OI, otherwise identical
    ]);
    const result = searchCspCandidates(chain, RULES);
    expect(result.selectedCandidate?.dte).toBe(40);
    expect(result.selectedCandidate?.openInterest).toBe(600);
    expect(result.selectedStatus).toBe('FULLY_QUALIFIED');
  });
});

describe('searchCspCandidates — CSP-0002 corrective pass IMPORTANT: midpoint is validated or safely derived', () => {
  it('a supplied mid below the bid is rejected in favor of the canonical (bid+ask)/2', () => {
    const chain = chainOf([{ dte: 35, legs: [{ strike: 415, delta: -0.20, bid: 10.20, ask: 10.40, oi: 1000, mid: 9.00 }] }]);
    const result = searchCspCandidates(chain, RULES);
    expect(result.selectedCandidate?.mid).toBeCloseTo(10.30, 4); // (10.20 + 10.40) / 2, not the stale 9.00
  });

  it('a supplied mid above the ask is rejected in favor of the canonical (bid+ask)/2', () => {
    const chain = chainOf([{ dte: 35, legs: [{ strike: 415, delta: -0.20, bid: 10.20, ask: 10.40, oi: 1000, mid: 99.00 }] }]);
    const result = searchCspCandidates(chain, RULES);
    expect(result.selectedCandidate?.mid).toBeCloseTo(10.30, 4);
  });

  it('a missing mid is derived as the canonical (bid+ask)/2', () => {
    const chain = chainOf([{ dte: 35, legs: [{ strike: 415, delta: -0.20, bid: 10.20, ask: 10.40, oi: 1000 }] }]); // no mid field
    const result = searchCspCandidates(chain, RULES);
    expect(result.selectedCandidate?.mid).toBeCloseTo(10.30, 4);
  });

  it('a valid mid within [bid, ask] is used as supplied, not overwritten', () => {
    const chain = chainOf([{ dte: 35, legs: [{ strike: 415, delta: -0.20, bid: 10.20, ask: 10.40, oi: 1000, mid: 10.33 }] }]);
    const result = searchCspCandidates(chain, RULES);
    expect(result.selectedCandidate?.mid).toBeCloseTo(10.33, 4);
  });

  it('bid equal to ask (a locked market) is handled safely -- mid equals that single price', () => {
    const chain = chainOf([{ dte: 35, legs: [{ strike: 415, delta: -0.20, bid: 10.30, ask: 10.30, oi: 1000, mid: 10.30 }] }]);
    const result = searchCspCandidates(chain, RULES);
    expect(result.selectedCandidate?.mid).toBeCloseTo(10.30, 4);
    expect(result.selectedCandidate?.bidAskWidth).toBe(0);
  });
});

describe('searchCspCandidates — deterministic selection across multiple expirations', () => {
  it('two equally-eligible candidates at the same delta distance tie-break on narrower width, then higher OI, then earlier expiration, then lower strike', () => {
    const chain = chainOf([
      { dte: 35, legs: [{ strike: 420, delta: -0.20, bid: 10.95, ask: 11.05, oi: 500 }] }, // width 0.10, OI 500
      { dte: 40, legs: [{ strike: 415, delta: -0.20, bid: 10.97, ask: 11.02, oi: 600 }] }, // width 0.05, OI 600 -- wins on width
    ]);
    const result = searchCspCandidates(chain, RULES);
    expect(result.selectedCandidate?.strikePrice).toBe(415);
    expect(result.selectedCandidate?.dte).toBe(40);
  });

  it('is deterministic (same input always produces the same selection) across repeated calls', () => {
    const chain = chainOf([
      { dte: 35, legs: [{ strike: 420, delta: -0.20, bid: 10.95, ask: 11.05, oi: 500 }] },
      { dte: 40, legs: [{ strike: 415, delta: -0.20, bid: 10.95, ask: 11.05, oi: 500 }] },
    ]);
    const first = searchCspCandidates(chain, RULES);
    const second = searchCspCandidates(chain, RULES);
    expect(first.selectedCandidate?.occSymbol).toBe(second.selectedCandidate?.occSymbol);
  });
});
