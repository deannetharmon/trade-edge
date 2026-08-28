import { describe, expect, it, vi } from 'vitest';
import { createScanSession, recordSymbolEvaluated, recordSymbolFailed, completeSession, computeSessionAccounting, shouldGenerateRecommendationsForSession, validateSessionData } from '../../screener/scanSession';
import { DEFAULT_PMCC_PAIRING_LIMITS, DEFAULT_PMCC_QUOTE_POLICY } from '../pmccConfig';
import { pairPmccCandidates } from '../pmccPairing';
import { buildPmccFailureAuditResult, buildPmccScreenResults, derivePmccMarketSession, pmccAuditReasons, PmccProductionError, runPmccProduction, runPmccSymbolProduction } from '../pmccProduction';
import type { PmccChainLeg, PmccPairingCriteria, PmccSessionResult } from '../pmccTypes';
import type { HeldPmccLongCandidate } from '../pmccHeldLeaps';

const asOf = new Date('2026-08-14T15:00:00.000Z');
const criteria: PmccPairingCriteria = {
  dte: { shortMin: 21, shortMax: 45, longMin: 270, longMax: 730 },
  longDelta: { min: 0.70, max: 0.85 }, shortDelta: { min: 0.20, max: 0.30 },
  longOiMin: 100, shortOiMin: 100, requireDebitBelowWidth: true,
  quotePolicy: DEFAULT_PMCC_QUOTE_POLICY, limits: DEFAULT_PMCC_PAIRING_LIMITS,
};
const snapshot = { asOf: asOf.toISOString(), marketSession: 'open' as const, criteria };
const occ = (expiration: string, strike: number) => `GS${expiration.slice(2).replace(/-/g, '')}C${String(strike * 1000).padStart(8, '0')}`;
const leg = (role: 'long' | 'short', strike: number, overrides: Partial<PmccChainLeg> = {}): PmccChainLeg => {
  const expiration = role === 'long' ? '2027-06-18' : '2026-09-18';
  return {
    underlyingSymbol: 'GS', optionType: 'C', expiration, strike,
    delta: role === 'long' ? 0.8 : 0.25, openInterest: 500,
    bid: role === 'long' ? 320 : 8, ask: role === 'long' ? 322 : 8.2,
    occSymbol: occ(expiration, strike), quoteTimestamp: '2026-08-14T14:59:30.000Z', delayed: false, ...overrides,
  };
};
const context = { symbol: 'GS', price: 1037.55, ivr: 35, underlyingType: 'stock' as const };
const run = (longLegs: PmccChainLeg[], shortLegs: PmccChainLeg[], limits = criteria.limits) =>
  pairPmccCandidates({ symbol: 'GS', underlyingPrice: 1037.55, longLegs, shortLegs, criteria: { ...criteria, limits }, asOf, marketSession: 'open' });

describe('PMCC production integration', () => {
  it('retains multiple valid pairs as distinct canonical ScreenResults in contract order', () => {
    const pairing = run([leg('long', 720)], [leg('short', 1060), leg('short', 1070)]);
    const results = buildPmccScreenResults(pairing, context);
    expect(results).toHaveLength(2);
    expect(results.map(result => result.candidateId)).toEqual(pairing.qualifiedPairs.map(pair => pair.pairId));
    expect(results.map(result => result.publishedOrder)).toEqual([1, 2]);
    expect(results.every(result => result.pmccPair != null)).toBe(true);
  });

  it('retains an alternate valid pair when the deterministic first combination fails', () => {
    const pairing = run([leg('long', 720)], [leg('short', 1038, { bid: 1, ask: 1.1 }), leg('short', 1070)]);
    const results = buildPmccScreenResults(pairing, context);
    expect(pairing.nearMissPairs).toHaveLength(1);
    expect(results.some(result => result.qualified && result.pmccPair?.shortLeg.strike === 1070)).toBe(true);
  });

  it('reports pair and omission accounting and marks safety-limited analysis incomplete', () => {
    const pairing = run([leg('long', 720), leg('long', 700, { bid: 340, ask: 342 })], [leg('short', 1060), leg('short', 1070)], { ...criteria.limits, maxCombinationsEvaluated: 1 });
    const result = buildPmccScreenResults(pairing, context)[0];
    expect(result.pmccPairingCounts).toMatchObject({ potentialCombinations: 4, combinationsEvaluated: 1, combinationsOmittedBySafetyLimit: 3 });
    expect(result.pmccIncompleteAnalysis).toBe(true);
    let session = createScanSession({ mode: 'filter', requestedStrategy: 'pmcc', scope: { universeSymbols: ['GS'], eligibleSymbols: ['GS'] }, pmccSnapshot: snapshot });
    session = completeSession(recordSymbolEvaluated(session, 'GS', buildPmccScreenResults(pairing, context)));
    expect(computeSessionAccounting(session).pmccPairing).toMatchObject({ combinationsEvaluated: 1, combinationsOmitted: 3, incompleteSymbolCount: 1 });
  });

  it('distinguishes zero-long, zero-short, zero-pair, and incomplete outcomes', () => {
    const zeroLong = run([leg('long', 720, { delta: 0.5 })], [leg('short', 1070)]);
    const zeroShort = run([leg('long', 720)], [leg('short', 1070, { delta: 0.5 })]);
    const zeroPair = run([leg('long', 720)], [leg('short', 1038, { bid: 1, ask: 1.1 })]);
    const incomplete = run([leg('long', 720), leg('long', 700, { bid: 340, ask: 342 })], [leg('short', 1060), leg('short', 1070)], { ...criteria.limits, maxCombinationsEvaluated: 1 });
    expect(pmccAuditReasons(zeroLong)).toContain('No eligible long legs');
    expect(pmccAuditReasons(zeroShort)).toContain('No eligible short legs');
    expect(pmccAuditReasons(zeroPair)).toContain('No valid combinations');
    expect(pmccAuditReasons({ ...incomplete, qualifiedPairs: [], nearMissPairs: [] } as PmccSessionResult)).toContain('Incomplete analysis');
  });

  it('preserves canonical pair data through session serialization and restoration validation', () => {
    const results = buildPmccScreenResults(run([leg('long', 720)], [leg('short', 1070)]), context);
    let session = createScanSession({ mode: 'filter', requestedStrategy: 'pmcc', scope: { universeSymbols: ['GS'], eligibleSymbols: ['GS'] }, pmccSnapshot: snapshot });
    session = completeSession(recordSymbolEvaluated(session, 'GS', results));
    const restored = validateSessionData(JSON.parse(JSON.stringify(session)));
    expect(restored.valid).toBe(true);
    if (restored.valid) expect(restored.session.results[0].pmccPair).toEqual(results[0].pmccPair);
  });
  it('fails closed when restored canonical PMCC pair or snapshot data is corrupt', () => {
    const results = buildPmccScreenResults(run([leg('long', 720)], [leg('short', 1070)]), context);
    let session = createScanSession({
      mode: 'filter', requestedStrategy: 'pmcc',
      scope: { universeSymbols: ['GS'], eligibleSymbols: ['GS'] }, pmccSnapshot: snapshot,
    });
    session = completeSession(recordSymbolEvaluated(session, 'GS', results));
    const corruptions: Array<(value: any) => void> = [
      value => { value.results[0].pmccPair.pairId = 'wrong'; },
      value => { value.results[0].pmccPair.longLeg.role = 'short'; },
      value => { value.results[0].pmccPair.shortLeg.underlyingSymbol = 'IBM'; },
      value => { value.results[0].pmccPair.shortLeg.candidateId = 'occ:wrong'; },
      value => { value.results[0].pmccPair.orderingLabel = 'Best'; },
      value => { value.results[0].publishedOrder = 0; },
      value => { value.results[0].publishedOrder = 2; },
      value => { value.results[0].pmccPairingCounts.potentialCombinations = 2; },
      value => { value.results[0].pmccPair.failureReasons = [{ code: 'INSUFFICIENT_DATA', message: 'contradiction' }]; value.results[0].pmccPair.primaryFailureReason = value.results[0].pmccPair.failureReasons[0]; },
      value => { value.results[0].candidateId = `pmcc-audit:IBM:${snapshot.asOf}:MARKET_DATA_FAILURE`; value.results[0].pmccPair = undefined; value.results[0].qualified = false; },
      value => { value.results[0].pmccAsOf = '2026-08-15T00:00:00.000Z'; },
      value => { value.results[0].pmccPair.shortLeg.quote.bid = 'bad'; },
      value => { value.results[0].pmccPair.metrics.netDelta = Number.POSITIVE_INFINITY; },
      value => { value.results[0].qualified = !value.results[0].pmccPair.qualified; },
    ];
    for (const corrupt of corruptions) {
      const value = JSON.parse(JSON.stringify(session));
      corrupt(value);
      const validation = validateSessionData(value);
      expect(validation.valid).toBe(false);
      if (!validation.valid) expect(validation.errors).toContain('INVALID_PMCC_RESULT');
    }

    const malformedPolicy = JSON.parse(JSON.stringify(session));
    malformedPolicy.pmccSnapshot.criteria.quotePolicy.acceptableSpreadPctMax = 11;
    malformedPolicy.pmccSnapshot.criteria.quotePolicy.qualifyingSpreadPctMax = 10;
    const validation = validateSessionData(malformedPolicy);
    expect(validation.valid).toBe(false);
    if (!validation.valid) expect(validation.errors).toContain('INVALID_PMCC_SNAPSHOT');
  });
  it('rejects audit-only sessions whose retained counts claim nonexistent pairs', () => {
    const audit = buildPmccScreenResults(run([], []), context)[0];
    let session = createScanSession({
      mode: 'filter', requestedStrategy: 'pmcc',
      scope: { universeSymbols: ['GS'], eligibleSymbols: ['GS'] }, pmccSnapshot: snapshot,
    });
    session = completeSession(recordSymbolEvaluated(session, 'GS', [audit]));
    const corrupt = JSON.parse(JSON.stringify(session));
    corrupt.results[0].pmccPairingCounts.nearMissPairsBeforeRetention = 1;
    corrupt.results[0].pmccPairingCounts.nearMissPairsRetained = 1;
    const validation = validateSessionData(corrupt);
    expect(validation.valid).toBe(false);
    if (!validation.valid) expect(validation.errors).toContain('INVALID_PMCC_RESULT');
  });



  it('routes production through adaptation and pairing with no implicit fallback', () => {
    const adapt = vi.fn(() => ({ longLegs: [leg('long', 720)], shortLegs: [leg('short', 1070)] }));
    const pair = vi.fn(pairPmccCandidates);
    const results = runPmccProduction({ shortExpirations: [], longExpirations: [], chains: {} }, context, snapshot, { adapt, pair });
    expect(adapt).toHaveBeenCalledOnce();
    expect(pair).toHaveBeenCalledOnce();
    expect(results).toHaveLength(1);
    expect(results[0].pmccPair).not.toBeNull();

    const pairingNeverCalled = vi.fn(pairPmccCandidates);
    expect(() => runPmccProduction({ shortExpirations: [], longExpirations: [], chains: {} }, context, snapshot, {
      adapt: vi.fn(() => { throw new Error('bad chain'); }),
      pair: pairingNeverCalled,
    })).toThrowError(expect.objectContaining({ stage: 'CHAIN_ADAPTATION_FAILURE' }));
    expect(pairingNeverCalled).not.toHaveBeenCalled();
    expect(() => runPmccProduction({ shortExpirations: [], longExpirations: [], chains: {} }, context, snapshot, {
      adapt,
      pair: vi.fn(() => { throw new Error('bad config'); }),
    })).toThrowError(PmccProductionError);
  });

  it('uses an exact held long as the only long candidate and marks the result review-only', () => {
    const held: HeldPmccLongCandidate = {
      accountNumber: '5WT00001', positionKey: 'held-gs', underlyingSymbol: 'GS',
      occSymbol: occ('2027-06-18', 720), expiration: '2027-06-18', dte: 308, strike: 720, quantity: 2,
    };
    const results = runPmccProduction(
      { shortExpirations: [], longExpirations: [], chains: {} }, context, snapshot,
      { adapt: vi.fn(() => ({ longLegs: [leg('long', 720), leg('long', 700)], shortLegs: [leg('short', 1070)] })), pair: pairPmccCandidates },
      [held],
    );
    expect(results).toHaveLength(1);
    expect(results[0].pmccPair).toMatchObject({
      entryMode: 'covered-short-call-against-held-leaps',
      heldLongLeg: { accountNumber: '5WT00001', positionKey: 'held-gs', quantity: 2 },
      longLeg: { occSymbol: held.occSymbol },
    });
    expect(results[0].candidateId).toContain(':held:held-gs');
  });

  it('does not substitute a new long entry when the held contract is absent', () => {
    const held: HeldPmccLongCandidate = {
      accountNumber: '5WT00001', positionKey: 'missing-held', underlyingSymbol: 'GS',
      occSymbol: 'missing', expiration: '2027-06-18', dte: 308, strike: 720, quantity: 1,
    };
    const results = runPmccProduction(
      { shortExpirations: [], longExpirations: [], chains: {} }, context, snapshot,
      { adapt: vi.fn(() => ({ longLegs: [leg('long', 700)], shortLegs: [leg('short', 1070)] })), pair: pairPmccCandidates },
      [held],
    );
    expect(results).toHaveLength(1);
    expect(results[0].pmccPair).toBeUndefined();
    expect(results[0].failReasons.join(' ')).toContain('could not be matched exactly');
  });

  it('persists held-long identity and rejects a corrupted held contract binding', () => {
    const held: HeldPmccLongCandidate = {
      accountNumber: '5WT00001', positionKey: 'persisted-held', underlyingSymbol: 'GS',
      occSymbol: occ('2027-06-18', 720), expiration: '2027-06-18', dte: 308, strike: 720, quantity: 1,
    };
    const results = runPmccProduction(
      { shortExpirations: [], longExpirations: [], chains: {} }, context, snapshot,
      { adapt: vi.fn(() => ({ longLegs: [leg('long', 720)], shortLegs: [leg('short', 1070)] })), pair: pairPmccCandidates }, [held],
    );
    let session = createScanSession({ mode: 'filter', requestedStrategy: 'pmcc', scope: { universeSymbols: ['GS'], eligibleSymbols: ['GS'] }, pmccSnapshot: snapshot });
    session = completeSession(recordSymbolEvaluated(session, 'GS', results));
    expect(validateSessionData(JSON.parse(JSON.stringify(session))).valid).toBe(true);
    const corrupted = JSON.parse(JSON.stringify(session));
    corrupted.results[0].pmccPair.heldLongLeg.occSymbol = 'wrong';
    expect(validateSessionData(corrupted)).toMatchObject({ valid: false, errors: expect.arrayContaining(['INVALID_PMCC_RESULT']) });
  });

  it('derives deterministic NYSE session state including holidays', () => {
    expect(derivePmccMarketSession(new Date('2026-08-14T15:00:00Z'))).toBe('open');
    expect(derivePmccMarketSession(new Date('2026-07-03T15:00:00Z'))).toBe('closed');
    expect(derivePmccMarketSession(new Date('2027-06-18T15:00:00Z'))).toBe('closed');
  });
  it('keeps acquisition, adaptation, and pairing failures distinct', () => {
    const audits = [
      buildPmccFailureAuditResult(context, snapshot.asOf, 'MARKET_DATA_FAILURE', 'quote unavailable'),
      buildPmccFailureAuditResult(context, snapshot.asOf, 'CHAIN_ADAPTATION_FAILURE', 'malformed chain'),
      buildPmccFailureAuditResult(context, snapshot.asOf, 'PAIRING_ENGINE_FAILURE', 'invalid config'),
    ];
    expect(audits.map(result => result.pmccAuditKind)).toEqual([
      'MARKET_DATA_FAILURE', 'CHAIN_ADAPTATION_FAILURE', 'PAIRING_ENGINE_FAILURE',
    ]);
    expect(audits.map(result => result.failReasons[0])).toEqual([
      'Market-data acquisition failure', 'Chain adaptation failure', 'Pairing-engine/configuration failure',
    ]);
  });

  it('records every symbol-orchestration failure as a distinct persisted failed-symbol audit', async () => {
    const emptyChain = { shortExpirations: [], longExpirations: [], chains: {} };
    const fallbackContext = { ...context, price: null };
    const acquireSuccess = async () => ({ chain: emptyChain, context });
    const outcomes = [
      await runPmccSymbolProduction({
        snapshot, fallbackContext,
        acquire: async () => { throw new Error('quote unavailable'); },
      }),
      await runPmccSymbolProduction({
        snapshot, fallbackContext, acquire: acquireSuccess,
        dependencies: {
          adapt: vi.fn(() => { throw new Error('malformed chain'); }),
          pair: vi.fn(pairPmccCandidates),
        },
      }),
      await runPmccSymbolProduction({
        snapshot, fallbackContext, acquire: acquireSuccess,
        dependencies: {
          adapt: vi.fn(() => ({ longLegs: [leg('long', 720)], shortLegs: [leg('short', 1070)] })),
          pair: vi.fn(() => { throw new Error('invalid config'); }),
        },
      }),
    ];
    expect(outcomes.every(outcome => outcome.status === 'failed')).toBe(true);
    expect(outcomes.map(outcome => outcome.status === 'failed' ? outcome.audit.pmccAuditKind : null)).toEqual([
      'MARKET_DATA_FAILURE', 'CHAIN_ADAPTATION_FAILURE', 'PAIRING_ENGINE_FAILURE',
    ]);
    for (const outcome of outcomes) {
      if (outcome.status !== 'failed') throw new Error('Expected failed PMCC outcome');
      let session = createScanSession({
        mode: 'filter', requestedStrategy: 'pmcc',
        scope: { universeSymbols: ['GS'], eligibleSymbols: ['GS'] }, pmccSnapshot: snapshot,
      });
      session = completeSession(recordSymbolFailed(session, 'GS', 'MARKET_DATA_REQUEST_FAILED', outcome.audit));
      expect(session.symbolOutcomes[0]).toMatchObject({ status: 'failed', candidateCount: 0 });
      expect(session.results).toHaveLength(1);
      expect(session.results[0].pmccPair).toBeUndefined();
      const restored = validateSessionData(JSON.parse(JSON.stringify(session)));
      expect(restored.valid).toBe(true);
      if (restored.valid) expect(restored.session.results[0].pmccAuditKind).toBe(outcome.audit.pmccAuditKind);
    }
  });

  it('replaces a prior strategy session with isolated PMCC results and suppresses recommendations', async () => {
    const source = buildPmccScreenResults(run([leg('long', 720)], [leg('short', 1070)]), context)[0];
    const priorResult = {
      ...source, strategy: 'BPS' as const, candidateId: 'prior-bps',
      pmccPair: undefined, pmccPairingCounts: undefined, pmccIncompleteAnalysis: undefined,
      pmccLegRejections: undefined, pmccAsOf: undefined, publishedOrder: undefined,
    };
    let prior = createScanSession({
      mode: 'filter', requestedStrategy: 'spreads',
      scope: { universeSymbols: ['GS'], eligibleSymbols: ['GS'] },
    });
    prior = completeSession(recordSymbolEvaluated(prior, 'GS', [priorResult]));

    const outcome = await runPmccSymbolProduction({
      snapshot, fallbackContext: { ...context, price: null },
      acquire: async () => ({ chain: { shortExpirations: [], longExpirations: [], chains: {} }, context }),
      dependencies: {
        adapt: vi.fn(() => ({ longLegs: [leg('long', 720)], shortLegs: [leg('short', 1070)] })),
        pair: vi.fn(pairPmccCandidates),
      },
    });
    if (outcome.status !== 'evaluated') throw new Error('Expected evaluated PMCC outcome');
    let replacement = createScanSession({
      mode: 'filter', requestedStrategy: 'pmcc',
      scope: { universeSymbols: ['GS'], eligibleSymbols: ['GS'] }, pmccSnapshot: snapshot,
    });
    replacement = completeSession(recordSymbolEvaluated(replacement, 'GS', outcome.results));

    expect(replacement.sessionId).not.toBe(prior.sessionId);
    expect(replacement.results.every(result => result.strategy === 'PMCC')).toBe(true);
    expect(replacement.results.some(result => result.candidateId === 'prior-bps')).toBe(false);
    expect(shouldGenerateRecommendationsForSession(replacement, replacement.sessionId)).toBe(false);
    const restored = validateSessionData(JSON.parse(JSON.stringify(replacement)));
    expect(restored.valid).toBe(true);
    if (restored.valid) expect(restored.session.results.every(result => result.strategy === 'PMCC')).toBe(true);
  });


});
