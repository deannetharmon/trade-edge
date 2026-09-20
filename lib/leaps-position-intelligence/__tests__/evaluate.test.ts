import { describe, expect, it } from 'vitest';
import { evaluateLeapsPositionIntelligence, handoffForCandidate, NEW_LEAPS_ENTRY_DTE, validateIncomeCallHandoff, type EvaluationFacts } from '..';

const now = '2026-09-19T15:00:00.000Z';
const fresh = '2026-09-19T14:59:00.000Z';
const base = (): EvaluationFacts => ({
  asOf: now,
  marketOpen: true,
  brokerSnapshotAsOf: fresh,
  canonicalAccountId: 'acct_opaque',
  longCall: { occSymbol: 'NVDA280119C00155000', quantity: 1, strike: 155, dte: 490, delta: 0.74, entryDebitPerShare: 13.2, bid: 13, ask: 13.4, quoteAsOf: fresh },
  underlyingPrice: 150,
  mandate: { version: 'LEAPS-PI-1.1', thesis: 'Long-term growth', invalidation: 'Thesis breaks', thesisTargetHigh: 190, invalidationPrice: 130, posture: 'balanced', incomeCapStrike: 170, minimumCycleCredit: .25, allowKnownEarningsCycle: false },
  event: { status: 'clear', asOf: fresh },
  capacity: 'available',
  assignmentOrCorporateAction: false,
  thesisInvalidated: false,
  exactPairingVerified: true,
  candidate: { occSymbol: 'NVDA260101C00175000', expiration: '2026-10-19', strike: 175, dte: 30, delta: 0.25, openInterest: 500, spreadPct: 7.7, quoteSnapshotId: 'quote_1', bid: 1.2, ask: 1.3, quoteAsOf: fresh },
});

describe('LEAPS Position Intelligence evaluator', () => {
  it('keeps new-entry eligibility distinct from held-position management', () => {
    expect(NEW_LEAPS_ENTRY_DTE).toEqual({ min: 270, max: 720 });
    // A broker-held 269-DTE long is not a bad historical entry; only the
    // separate 180-DTE existing-position rule may later trigger review.
    const facts = base(); facts.longCall!.dte = 269;
    expect(evaluateLeapsPositionIntelligence(facts).state).toBe('review-income-call');
  });
  it('returns a review with broker-executable economics and break-even warning', () => {
    const output = evaluateLeapsPositionIntelligence(base());
    expect(output.state).toBe('review-income-call');
    expect(output.economics).toMatchObject({ executableCreditPerShare: 1.2, totalCredit: 120, creditAsPctOfLeapsCapital: expect.closeTo(9.09, 1), netDeltaAfterShort: .49, longExpirationBreakeven: 168.2, belowOriginalExpirationBreakeven: false });
  });

  it('does not evaluate income calls without a trader mandate', () => {
    const facts = base(); facts.mandate = null;
    expect(evaluateLeapsPositionIntelligence(facts).state).toBe('health-only');
  });

  it('fails closed for unknown event data even when known-event permission is enabled', () => {
    const facts = base(); facts.mandate!.allowKnownEarningsCycle = true; facts.event = { status: 'unavailable', asOf: null };
    const output = evaluateLeapsPositionIntelligence(facts);
    expect(output).toMatchObject({ state: 'monitor', monitorReason: 'event-data-unavailable' });
  });

  it('holds uncovered when the candidate violates the posture participation floor', () => {
    const facts = base(); facts.mandate!.posture = 'upside-first'; facts.candidate!.strike = 172;
    expect(evaluateLeapsPositionIntelligence(facts).state).toBe('hold-uncovered');
  });

  it('reassesses instead of opening a new cycle below the active-cycle buffer', () => {
    const facts = base(); facts.activeCycle = { shortExpiry: '2026-10-19', longDteAfterShortExpiry: 119 };
    expect(evaluateLeapsPositionIntelligence(facts).state).toBe('monitor');
  });

  it('surfaces a warning when the short strike is below the original expiration break-even', () => {
    const facts = base(); facts.candidate!.strike = 167; facts.mandate!.incomeCapStrike = 160; facts.mandate!.posture = 'income-first';
    const output = evaluateLeapsPositionIntelligence(facts);
    expect(output.evidence).toContainEqual(expect.objectContaining({ code: 'below-original-expiration-breakeven', severity: 'warning' }));
  });

  it('blocks a stale broker snapshot before any market policy is applied', () => {
    const facts = base(); facts.brokerSnapshotAsOf = '2026-09-19T14:54:59.000Z';
    expect(evaluateLeapsPositionIntelligence(facts)).toMatchObject({ state: 'not-ready', evidence: [expect.objectContaining({ code: 'stale-broker-snapshot' })] });
  });

  it('does not treat a zero bid as executable income', () => {
    const facts = base(); facts.candidate!.bid = 0;
    expect(evaluateLeapsPositionIntelligence(facts)).toMatchObject({ state: 'monitor', monitorReason: 'quote-quality' });
  });

  it('requires explicit reconfirmation when the review candidate changes', () => {
    const facts = base(); const output = evaluateLeapsPositionIntelligence(facts);
    const handoff = handoffForCandidate({ canonicalAccountId: 'acct_opaque', positionKey: 'position_1', longOccSymbol: facts.longCall!.occSymbol, longQuantity: 1, evaluatedAt: now }, facts.candidate!);
    const replacement = { ...output, candidate: { ...facts.candidate!, occSymbol: 'NVDA260101C00180000' } };
    expect(validateIncomeCallHandoff(handoff, { canonicalAccountId: 'acct_opaque', positionKey: 'position_1', longOccSymbol: facts.longCall!.occSymbol, longQuantity: 1 }, replacement, now)).toEqual({ ok: false, reason: 'candidate-changed' });
  });

  it('returns preference monitor for missing target or income-cap strike', () => {
    const target = base(); target.mandate!.thesisTargetHigh = null;
    const cap = base(); cap.mandate!.incomeCapStrike = null;
    expect(evaluateLeapsPositionIntelligence(target)).toMatchObject({ state: 'monitor', monitorReason: 'preference-not-met' });
    expect(evaluateLeapsPositionIntelligence(cap)).toMatchObject({ state: 'monitor', monitorReason: 'preference-not-met' });
  });

  it('reassesses deterministically at the invalidation-price boundary', () => {
    const facts = base(); facts.underlyingPrice = 130;
    expect(evaluateLeapsPositionIntelligence(facts).state).toBe('reassess-thesis');
  });

  it('only blocks a disallowed known event inside the candidate cycle', () => {
    const outside = base(); outside.event = { status: 'known-event', asOf: fresh, eventDate: '2026-10-20', eventType: 'earnings' };
    const inside = base(); inside.event = { status: 'known-event', asOf: fresh, eventDate: '2026-10-19', eventType: 'earnings' };
    expect(evaluateLeapsPositionIntelligence(outside).state).toBe('review-income-call');
    expect(evaluateLeapsPositionIntelligence(inside)).toMatchObject({ state: 'monitor', monitorReason: 'known-event' });
  });

  it('fails closed for missing or malformed known-event timing', () => {
    const missing = base(); missing.event = { status: 'known-event', asOf: fresh, eventType: 'earnings' };
    const malformed = base(); malformed.event = { status: 'known-event', asOf: fresh, eventDate: 'no-date', eventType: 'earnings' };
    expect(evaluateLeapsPositionIntelligence(missing)).toMatchObject({ state: 'monitor', monitorReason: 'event-data-unavailable' });
    expect(evaluateLeapsPositionIntelligence(malformed)).toMatchObject({ state: 'monitor', monitorReason: 'event-data-unavailable' });
  });

  it('rejects malformed DTE and negative quote width', () => {
    const dte = base(); dte.candidate!.dte = Number.NaN;
    const width = base(); width.candidate!.spreadPct = -1;
    expect(evaluateLeapsPositionIntelligence(dte)).toMatchObject({ state: 'monitor', monitorReason: 'no-qualifying-short-call' });
    expect(evaluateLeapsPositionIntelligence(width)).toMatchObject({ state: 'monitor', monitorReason: 'quote-quality' });
  });


  it('keeps capital percentage unavailable when entry debit is unavailable', () => {
    const facts = base(); facts.longCall!.entryDebitPerShare = null;
    expect(evaluateLeapsPositionIntelligence(facts).economics?.creditAsPctOfLeapsCapital).toBeNull();
  });
});
