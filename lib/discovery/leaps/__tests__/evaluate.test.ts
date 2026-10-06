// lib/discovery/leaps/__tests__/evaluate.test.ts

// LEAPS-QV-0001 Gate 4b -- acceptance tests of spec Section 13 as ruled in revision 4: numeric fixtures (Section 9,
// Alan's recomputation), gate boundaries, the Section 6 decision table D1-D16, data failures, quote modes (I6, I12),
// instrument metadata (I8), ranking determinism (fixture T), state discipline, policy pinning, and one real-row run.

import { readFileSync } from 'fs';
import { join } from 'path';
import { describe, expect, it } from 'vitest';
import { fingerprint, stableStringify } from '../../util';
import { acquireLeapsChain, type AcquisitionReport, type LeapsChainAcquisition, type RawLeapsContract } from '../acquisition';
import { QV_LEAPS_ACQUISITION_V1 } from '../acquisitionPolicy';
import { evaluateLeaps, type LeapsEvaluation } from '../evaluate';
import { leapsPolicyInvariantViolations, QV_LEAPS_POLICY_V1 } from '../policy';
import { compareLeapsRank, type RankKeyInputs } from '../rank';

const P = QV_LEAPS_POLICY_V1;
const NOW = '2026-10-05T16:49:00.000Z'; // Monday 12:49 New York (regular hours)
const U_AT = '2026-10-05T16:48:50.000Z';
const Q_AT = '2026-10-05T16:48:55.000Z';

const STANDARD = { rootSymbol: 'XYZ', underlyingSymbol: 'XYZ', optionChainType: 'Standard', sharesPerContract: 100,
  deliverables: [{ amount: '100.0', 'deliverable-type': 'Shares', symbol: 'XYZ' }] };

let seq = 0;
function contract(o: { K: number; bid?: string | null; ask?: string | null; delta?: string | null; oi?: number | null; dte?: number; exp?: string;
  at?: string | null; quote?: 'none'; extra?: Record<string, unknown>; instrument?: Partial<typeof STANDARD> | Record<string, unknown>; occ?: string; dup?: boolean }): RawLeapsContract {
  seq += 1;
  const exp = o.exp ?? '2028-03-17';
  const occ = o.occ ?? `XYZ   ${exp.slice(2).replace(/-/g, '')}C${String(Math.round(o.K * 1000) + seq).padStart(8, '0')}`;
  const q: Record<string, unknown> = { symbol: occ, theta: '-0.01', vega: '0.3', volatility: '0.35', volume: '0', ...o.extra };
  if (o.bid !== null) q.bid = o.bid ?? '24.50';
  if (o.ask !== null) q.ask = o.ask ?? '25.50';
  if (o.delta !== null) q.delta = o.delta ?? '0.80';
  if (o.oi !== null) q['open-interest'] = o.oi ?? 400;
  if (o.at !== null) q['updated-at'] = o.at ?? Q_AT;
  return {
    occSymbol: occ, expiration: exp, dte: o.dte ?? 540, strike: o.K, optionType: 'C',
    instrument: { ...STANDARD, ...o.instrument } as RawLeapsContract['instrument'],
    quote: o.quote === 'none' ? null : q, duplicateInChain: o.dup ?? false, duplicateQuoteRows: false,
  };
}

function report(o: Omit<Partial<AcquisitionReport>, 'contracts'> & { contracts?: Partial<AcquisitionReport['contracts']> } = {}): AcquisitionReport {
  return {
    coverage: 'COMPLETE',
    expirations: { inWindow: 3, selected: 3, omittedByCap: 0 },
    quoteLimitExceeded: false,
    restrictions: [],
    ...o,
    contracts: { candidatesInSelectedExpirations: 0, excludedProvablyIneligible: 0, excludedOutOfPolicyBand: 0, excludedNonStandardRoot: 0, selectedForQuote: 0,
      omittedByQuoteLimit: 0, omittedInOmittedExpirations: 0, quoteChunksFailed: 0, quoteRowsMissing: 0, quoteRowsReceived: 0, ...o.contracts },
  };
}

function acq(contracts: RawLeapsContract[], rep: AcquisitionReport = report(), o: Partial<LeapsChainAcquisition> & { uAt?: string; uLast?: string } = {}): LeapsChainAcquisition {
  return {
    symbol: 'XYZ', status: 'ACQUIRED', reason: null, sessionState: 'REGULAR_HOURS',
    underlying: { symbol: 'XYZ', fields: { last: o.uLast ?? '100', close: '100', 'updated-at': o.uAt ?? U_AT } },
    spot: { price: 100, basis: 'LAST' },
    chain: { provider: 'tastytrade', acquisition: rep, contracts },
    ...o,
  };
}

const run = (contracts: RawLeapsContract[], rep?: AcquisitionReport, o?: Parameters<typeof acq>[2], now = NOW, state = 'SETUP'): LeapsEvaluation =>
  evaluateLeaps({ symbol: 'XYZ', underlyingState: state, now, acquisition: acq(contracts, rep, o), policy: P });
const metric = (e: LeapsEvaluation, i: number, id: string) => (e.contracts[i].metrics[id] as { value: number }).value;
const codes = (r: { code: string; detail?: string }[]) => r.map((x) => x.code);

// Section 9 contracts
const A = () => contract({ K: 80, bid: '24.50', ask: '25.50', delta: '0.80', oi: 400, dte: 540, occ: 'XYZ   280317C00080000' });
const E = () => contract({ K: 75, bid: '28.60', ask: '29.40', delta: '0.84', oi: 250, dte: 730, exp: '2028-10-04', occ: 'XYZ   281004C00075000' });
const B = () => contract({ K: 90, bid: '17.00', ask: '18.00', delta: '0.68', oi: 400, dte: 540, occ: 'XYZ   280317C00090000' });
const C = () => contract({ K: 75, bid: '29.00', ask: '29.50', delta: '0.85', oi: 99, dte: 400, exp: '2027-11-09', occ: 'XYZ   271109C00075000' });

describe('policy (Q6)', () => {
  it('is frozen, fingerprint-pinned and satisfies its invariants', () => {
    expect(Object.isFrozen(P)).toBe(true);
    expect(fingerprint(stableStringify(P))).toBe('c04770bc4f90946a1ee79c34afc0534d14711b871f4b073c5888f293c0463333');
    expect(leapsPolicyInvariantViolations(P)).toEqual([]);
    expect(leapsPolicyInvariantViolations({ ...P, gates: { ...P.gates, extrinsicPctMax: 100 } } as typeof P)).toContain('EXTRINSIC_MAX_NOT_BELOW_100');
  });
});

describe('Section 9 numeric fixtures (Alan, rev 4)', () => {
  const e = run([A(), B(), C(), E()], report({ contracts: { selectedForQuote: 4, quoteRowsReceived: 4 } }));
  const by = (occ: string) => e.contracts.find((c) => c.occSymbol === occ)!;

  it('E ranks 1 (69.695402), A ranks 2 (67.666667); complete chain', () => {
    expect(e.contractStatus).toBe('EVALUATED');
    expect(e.rankingScope).toBe('COMPLETE_CHAIN');
    expect(e.contracts.slice(0, 2).map((c) => [c.occSymbol, c.rank])).toEqual([['XYZ   281004C00075000', 1], ['XYZ   280317C00080000', 2]]);
    expect(by('XYZ   281004C00075000').score!).toBeCloseTo(69.695402, 6);
    expect(by('XYZ   280317C00080000').score!).toBeCloseTo(67.666667, 6);
    expect(by('XYZ   280317C00080000').scoreComponents).toEqual({ timeValueCost: expect.closeTo(46.666667, 6), liquidity: expect.closeTo(21, 6) });
  });

  it('every Section 3 metric for A and E', () => {
    const a = e.contracts.findIndex((c) => c.occSymbol === 'XYZ   280317C00080000');
    const x = e.contracts.findIndex((c) => c.occSymbol === 'XYZ   281004C00075000');
    expect(metric(e, a, 'contract_mid')).toBe(25);
    expect(metric(e, a, 'contract_extrinsic_pct_of_mid')).toBeCloseTo(20, 9);
    expect(metric(e, a, 'contract_spread_pct_of_mid')).toBeCloseTo(4, 9);
    expect(metric(e, a, 'contract_dollar_delta')).toBeCloseTo(8000, 9);
    expect(metric(e, a, 'contract_debit_per_contract')).toBe(2500);
    expect(metric(e, a, 'contract_effective_leverage')).toBeCloseTo(3.2, 9);
    expect(metric(e, a, 'contract_breakeven_price')).toBe(105);
    expect(metric(e, a, 'contract_breakeven_move_pct')).toBeCloseTo(5, 9);
    expect(metric(e, x, 'contract_extrinsic_pct_of_mid')).toBeCloseTo(13.793103, 6);
    expect(metric(e, x, 'contract_spread_pct_of_mid')).toBeCloseTo(2.758621, 6);
    expect(metric(e, x, 'contract_effective_leverage')).toBeCloseTo(2.896552, 6);
    expect(metric(e, x, 'contract_breakeven_move_pct')).toBeCloseTo(4, 9);
  });

  it('B ineligible with two reasons; C ineligible on open interest only; neither scored', () => {
    expect(by('XYZ   280317C00090000')).toMatchObject({ eligibility: 'INELIGIBLE', score: null, rank: null });
    expect(codes(by('XYZ   280317C00090000').reasons).filter((c) => c.indexOf('CONTRACT_') === 0 && c !== 'CONTRACT_LAST_SESSION_QUOTE'))
      .toEqual(['CONTRACT_DELTA_BELOW_MIN', 'CONTRACT_EXTRINSIC_ABOVE_MAX']);
    expect(codes(by('XYZ   271109C00075000').reasons)).toEqual(['CONTRACT_OI_BELOW_MIN']);
  });

  it('identities hold: unresolved = missing + not evaluable; selected = eligible + ineligible + unresolved', () => {
    const c = e.counts;
    expect(c.unresolvedTotal).toBe(c.quoteRowsMissing + c.acquiredNotEvaluable);
    expect(c.selected).toBe(c.eligible + c.ineligible + c.unresolvedTotal);
    expect(c).toMatchObject({ selected: 4, eligible: 2, ineligible: 2, unresolvedTotal: 0 });
  });
});

describe('gate boundaries (acceptance test 2)', () => {
  const one = (o: Parameters<typeof contract>[0]) => run([contract(o)]).contracts[0];
  it.each([
    [364, 'INELIGIBLE'], [365, 'ELIGIBLE'], [366, 'ELIGIBLE'], [899, 'ELIGIBLE'], [900, 'ELIGIBLE'], [901, 'INELIGIBLE'],
  ])('DTE %d -> %s', (dte, out) => {
    expect(one({ K: 80, dte }).eligibility).toBe(out);
  });
  it.each([
    ['0.6999', 'INELIGIBLE'], ['0.70', 'ELIGIBLE'], ['0.85', 'ELIGIBLE'], ['0.8501', 'INELIGIBLE'],
  ])('delta %s -> %s', (delta, out) => {
    expect(one({ K: 80, delta }).eligibility).toBe(out);
  });
  it.each([[99, 'INELIGIBLE'], [100, 'ELIGIBLE']])('open interest %d -> %s', (oi, out) => {
    expect(one({ K: 80, oi }).eligibility).toBe(out);
  });
  it('spread 10.0% passes, 10.0001% fails', () => {
    expect(one({ K: 80, bid: '23.75', ask: '26.25' }).eligibility).toBe('ELIGIBLE');
    expect(one({ K: 80, bid: '23.7499875', ask: '26.2500125' }).eligibility).toBe('INELIGIBLE');
  });
  it('extrinsic 20.0% passes, 20.0001% fails; 5/25 x 100 is exactly 20 after quantizing', () => {
    expect(one({ K: 80 }).eligibility).toBe('ELIGIBLE');
    expect(one({ K: 80.000025 }).eligibility).toBe('INELIGIBLE');
  });
  it('LIVE age 15:00 passes, 15:01 stale', () => {
    const aged = (at: string) => run([contract({ K: 80, at })], undefined, { uAt: at }).contracts[0];
    expect(aged('2026-10-05T16:34:00.000Z').eligibility).toBe('ELIGIBLE');
    expect(run([contract({ K: 80, at: '2026-10-05T16:33:59.000Z' })], undefined, { uAt: '2026-10-05T16:34:00.000Z' }).contracts[0].reasons.map((r) => r.code)).toContain('CONTRACT_QUOTE_STALE');
  });
  it('skew 60 s passes, 61 s fails', () => {
    expect(one({ K: 80, at: '2026-10-05T16:47:50.000Z' }).eligibility).toBe('ELIGIBLE');
    expect(codes(one({ K: 80, at: '2026-10-05T16:47:49.000Z' }).reasons)).toContain('CONTRACT_QUOTE_SKEW_EXCEEDED');
  });
  it('future timestamp 5 s tolerated, 6 s invalid', () => {
    const fx = (at: string) => run([contract({ K: 80, at })], undefined, { uAt: '2026-10-05T16:49:00.000Z' }).contracts[0];
    expect(fx('2026-10-05T16:49:05.000Z').eligibility).toBe('ELIGIBLE');
    expect(codes(fx('2026-10-05T16:49:06.000Z').reasons)).toContain('QUOTE_TIMESTAMP_IN_FUTURE');
  });
});

describe('decision table D1-D16 (acceptance test 3)', () => {
  const elig = () => contract({ K: 80 });
  const inel = () => contract({ K: 80, oi: 5 });
  const miss = () => contract({ K: 80, quote: 'none' });
  const nev = () => contract({ K: 80, delta: null });
  const n = (f: () => RawLeapsContract, k: number) => Array.from({ length: k }, f);
  const restricted = (omittedExp: number, omittedC: number | null) => report({
    coverage: 'RESTRICTED',
    expirations: { inWindow: 3 + omittedExp, selected: 3, omittedByCap: omittedExp },
    restrictions: [{ kind: 'EXPIRATION_CAP', limit: 6, omittedExpirations: omittedExp, omittedContracts: omittedC }],
  });
  const capRestricted = (omittedC: number) => report({ coverage: 'RESTRICTED', expirations: { inWindow: 7, selected: 6, omittedByCap: 1 }, restrictions: [{ kind: 'EXPIRATION_CAP', limit: 6, omittedExpirations: 1, omittedContracts: omittedC }] });
  const chunkRestricted = () => report({ coverage: 'RESTRICTED', restrictions: [{ kind: 'CHUNK_FAILURE', failedChunks: 1, contractsInFailedChunks: 100 }] });

  const rows: [string, RawLeapsContract[], AcquisitionReport, string, string | null, number | null][] = [
    ['D1', [...n(elig, 2), inel()], report(), 'EVALUATED', 'COMPLETE_CHAIN', 0],
    ['D2', [elig(), inel(), nev()], report(), 'EVALUATED', 'EVALUATED_SUBSET', 0],
    ['D3', [elig(), ...n(inel, 2)], capRestricted(5), 'EVALUATED', 'EVALUATED_SUBSET', 5],
    ['D4', [elig(), ...n(nev, 2)], capRestricted(3), 'EVALUATED', 'EVALUATED_SUBSET', 3],
    ['D5', [...n(inel, 2), nev()], report(), 'DATA_UNAVAILABLE', null, 0],
    ['D6', n(inel, 3), report(), 'NO_SUITABLE_CONTRACT', null, 0],
    ['D7', n(inel, 3), capRestricted(4), 'NO_ELIGIBLE_IN_SUBSET', null, 4],
    ['D8', [...n(inel, 2), miss()], capRestricted(4), 'DATA_UNAVAILABLE', null, 4],
    ['D9', n(miss, 100), chunkRestricted(), 'DATA_UNAVAILABLE', null, 0],
    ['D10', n(nev, 40), capRestricted(60), 'DATA_UNAVAILABLE', null, 60],
    ['D11', [], report({ expirations: { inWindow: 0, selected: 0, omittedByCap: 0 } }), 'NO_SUITABLE_CONTRACT', null, 0],
    ['D12', [], report(), 'NO_SUITABLE_CONTRACT', null, 0],
    ['D13a', [], restricted(2, 14), 'NO_ELIGIBLE_IN_SUBSET', null, 14],
    ['D13b', [], restricted(2, null), 'NO_ELIGIBLE_IN_SUBSET', null, null],
    ['D16', [elig()], report(), 'EVALUATED', 'COMPLETE_CHAIN', 0],
  ];
  it.each(rows)('%s', (_id, contracts, rep, status, scope, omitted) => {
    const e = run(contracts, rep);
    expect(e.contractStatus).toBe(status);
    expect(e.rankingScope).toBe(scope);
    expect(e.counts.omittedContractsByDesign).toBe(omitted);
    expect(e.counts.unresolvedTotal).toBe(e.counts.quoteRowsMissing + e.counts.acquiredNotEvaluable);
    expect(e.counts.selected).toBe(e.counts.eligible + e.counts.ineligible + e.counts.unresolvedTotal);
  });

  it('reason codes: D9 all quotes unavailable, D10 all contracts not evaluable, D11/D12 verified empty, subset label', () => {
    expect(codes(run(n(miss, 100), chunkRestricted()).reasons)).toContain('LEAPS_ALL_QUOTES_UNAVAILABLE');
    expect(codes(run(n(nev, 40), capRestricted(60)).reasons)).toContain('LEAPS_ALL_CONTRACTS_DATA_UNAVAILABLE');
    expect(codes(run([], report({ expirations: { inWindow: 0, selected: 0, omittedByCap: 0 } })).reasons)).toEqual(['LEAPS_NO_LEAPS_EXPIRATIONS']);
    expect(codes(run([], report()).reasons)).toEqual(['LEAPS_NO_CONTRACTS_IN_WINDOW']);
    expect(codes(run([elig(), nev()], report()).reasons)).toContain('LEAPS_RANKING_IS_EVALUATED_SUBSET');
    const d6 = run(n(inel, 3), report());
    expect(d6.reasons).toContainEqual(expect.objectContaining({ code: 'LEAPS_GATE_FAILURE_COUNT', detail: 'CONTRACT_OI_BELOW_MIN', count: 3 }));
  });

  it('an unknown omitted-contract count is worded "an unknown number", never a figure', () => {
    const r = run([], restricted(2, null)).reasons.find((x) => x.code === 'LEAPS_ACQUISITION_RESTRICTED')!;
    expect(r.message).toContain('an unknown number of');
  });

  it('D14 chain failure, D15 not qualified (and run-cap / auth outcomes)', () => {
    const failed = evaluateLeaps({ symbol: 'XYZ', underlyingState: 'SETUP', now: NOW, policy: P,
      acquisition: { ...acq([]), status: 'CHAIN_FAILED', reason: 'LEAPS_CHAIN_PROVIDER_FAILURE:HTTP_500', chain: null } });
    expect(failed).toMatchObject({ contractStatus: 'DATA_UNAVAILABLE', rankingScope: null });
    expect(failed.reasons[0]).toMatchObject({ code: 'LEAPS_CHAIN_PROVIDER_FAILURE', detail: 'HTTP_500' });
    expect(run([elig()], report(), undefined, NOW, 'WATCH')).toMatchObject({ contractStatus: 'NOT_EVALUATED', contracts: [] });
    expect(evaluateLeaps({ symbol: 'XYZ', underlyingState: 'ACTIONABLE', now: NOW, policy: P, acquisition: { ...acq([]), status: 'NOT_EVALUATED_RUN_CAP', chain: null } }).contractStatus).toBe('NOT_EVALUATED');
    expect(evaluateLeaps({ symbol: 'XYZ', underlyingState: 'ACTIONABLE', now: NOW, policy: P, acquisition: { ...acq([]), status: 'AUTH_EXPIRED', chain: null } }).reasons[0].code).toBe('LEAPS_AUTH_EXPIRED');
  });

  it('quote limit exceeded: incomplete and unranked, never a "none eligible" verdict', () => {
    const e = run([], report({ coverage: 'RESTRICTED', quoteLimitExceeded: true, contracts: { omittedByQuoteLimit: 1080 }, restrictions: [{ kind: 'QUOTE_LIMIT', limit: 1000, omittedContracts: 1080 }] }));
    expect(e.contractStatus).toBe('DATA_UNAVAILABLE');
    expect(codes(e.reasons)).toEqual(['LEAPS_ACQUISITION_INCOMPLETE_QUOTE_LIMIT']);
  });
});

describe('data failures (acceptance test 4)', () => {
  const one = (c: RawLeapsContract) => run([c]).contracts[0];
  it('crossed market is not evaluable', () => {
    expect(codes(one(contract({ K: 80, bid: '25.60', ask: '25.50' })).reasons)).toContain('CONTRACT_CROSSED_MARKET');
  });
  it('zero bid during the session is ineligible through the spread gate, not hidden', () => {
    expect(one(contract({ K: 80, bid: '0', ask: '50.00' }))).toMatchObject({ eligibility: 'INELIGIBLE', reasons: [expect.objectContaining({ code: 'CONTRACT_SPREAD_ABOVE_MAX' })] });
  });
  it.each([['delta', { delta: null }], ['bid', { bid: null }], ['ask', { ask: null }], ['open interest', { oi: null }]])('missing %s is unavailable, never 0', (_n, o) => {
    const c = one(contract({ K: 80, ...(o as object) }));
    expect(c.resolution).toBe('NOT_EVALUABLE');
    expect(codes(c.reasons)).toContain('CONTRACT_METRIC_UNAVAILABLE');
  });
  it('missing, unparseable and epoch timestamps are not evaluable', () => {
    expect(codes(one(contract({ K: 80, at: null })).reasons)).toEqual(['CONTRACT_QUOTE_TIMESTAMP_MISSING']);
    expect(codes(one(contract({ K: 80, at: 'yesterday' })).reasons)).toEqual(['QUOTE_TIMESTAMP_UNPARSEABLE']);
    expect(codes(one(contract({ K: 80, extra: { 'updated-at': 1791211735 }, at: null })).reasons)).toEqual(['QUOTE_TIMESTAMP_UNPARSEABLE']);
  });
  it('duplicate in chain: none of its copies is used', () => {
    expect(one(contract({ K: 80, dup: true }))).toMatchObject({ resolution: 'NOT_EVALUABLE', reasons: [expect.objectContaining({ code: 'CHAIN_DUPLICATE_CONTRACT' })] });
  });
  it('missing quote row counts as quoteRowsMissing', () => {
    expect(one(contract({ K: 80, quote: 'none' })).resolution).toBe('QUOTE_ROW_MISSING');
  });
  it('underlying quote missing timestamp or stale: whole result DATA_UNAVAILABLE', () => {
    expect(run([contract({ K: 80 })], undefined, { uAt: '' }).reasons[0].code).toBe('LEAPS_UNDERLYING_QUOTE_UNAVAILABLE');
    expect(run([contract({ K: 80 })], undefined, { uAt: '2026-10-05T16:00:00.000Z' }).contractStatus).toBe('DATA_UNAVAILABLE');
  });
  it('optional metrics missing: still eligible, flagged', () => {
    const c = one(contract({ K: 80, extra: { theta: '', vega: '', volatility: '', volume: '' } }));
    expect(c.eligibility).toBe('ELIGIBLE');
    expect(c.reasons[0]).toMatchObject({ code: 'INCOMPLETE_OPTIONAL_METRICS', detail: 'contract_theta,contract_vega,contract_implied_volatility,contract_volume' });
  });
  it('COMPLETE coverage with one not-evaluable contract and no eligible: DATA_UNAVAILABLE', () => {
    expect(run([contract({ K: 80, oi: 5 }), contract({ K: 80, delta: null })]).contractStatus).toBe('DATA_UNAVAILABLE');
  });
});

describe('quote modes (I6, I12; acceptance test 5)', () => {
  // Outside the session S is the regular-session close; the underlying stamp must be from the latest session window.
  const closed = (now: string, optionAt: string, uAt = optionAt) =>
    run([contract({ K: 80, at: optionAt })], undefined, { uAt, spot: { price: 100, basis: 'REGULAR_SESSION_CLOSE' } }, now).contracts[0];

  it('Friday 17:00, option 15:57: LAST_SESSION accepted, flagged closing values', () => {
    const c = closed('2026-10-02T21:00:00.000Z', '2026-10-02T19:57:00.000Z');
    expect(c).toMatchObject({ quoteMode: 'LAST_SESSION', eligibility: 'ELIGIBLE' });
    expect(codes(c.reasons)).toContain('CONTRACT_LAST_SESSION_QUOTE');
  });
  it('Friday 17:00, option 09:40 Friday: stale (before close - 60 min)', () => {
    expect(codes(closed('2026-10-02T21:00:00.000Z', '2026-10-02T13:40:00.000Z', '2026-10-02T19:58:00.000Z').reasons)).toContain('CONTRACT_QUOTE_STALE');
  });
  it('I12: Saturday, quote re-stamped Friday 20:00 ET: accepted', () => {
    expect(closed('2026-10-03T14:00:00.000Z', '2026-10-03T00:00:00.000Z').eligibility).toBe('ELIGIBLE');
  });
  it('Saturday, option from Thursday: stale (not the latest completed session)', () => {
    expect(codes(closed('2026-10-03T14:00:00.000Z', '2026-10-01T19:58:00.000Z', '2026-10-02T19:59:00.000Z').reasons)).toContain('CONTRACT_QUOTE_STALE');
  });
  it('Monday 08:00 pre-open, Friday 15:58: accepted', () => {
    expect(closed('2026-10-05T12:00:00.000Z', '2026-10-02T19:58:00.000Z').eligibility).toBe('ELIGIBLE');
  });
  it('Monday 09:35 open, Friday quote: LIVE stale', () => {
    const c = run([contract({ K: 80, at: '2026-10-02T19:58:00.000Z' })], undefined, { uAt: '2026-10-05T13:35:00.000Z' }, '2026-10-05T13:35:00.000Z').contracts[0];
    expect(c.quoteMode).toBe('LIVE');
    expect(codes(c.reasons)).toContain('CONTRACT_QUOTE_STALE');
  });
  it('after Good Friday 2027 (closed), Thursday 15:58 quote accepted on the weekend', () => {
    expect(closed('2027-03-27T15:00:00.000Z', '2027-03-25T19:58:00.000Z').eligibility).toBe('ELIGIBLE');
  });
  it('early close (day after Thanksgiving): window 12:00-13:00 ET', () => {
    expect(closed('2026-11-27T20:00:00.000Z', '2026-11-27T17:30:00.000Z').eligibility).toBe('ELIGIBLE'); // 12:30 EST
    expect(codes(closed('2026-11-27T20:00:00.000Z', '2026-11-27T16:30:00.000Z', '2026-11-27T17:59:00.000Z').reasons)).toContain('CONTRACT_QUOTE_STALE'); // 11:30
  });
  it('Ian I12(b): a closing quote must be two-sided', () => {
    const c = run([contract({ K: 80, bid: '0', at: '2026-10-02T19:57:00.000Z' })], undefined, { uAt: '2026-10-02T19:57:00.000Z' }, '2026-10-02T21:00:00.000Z').contracts[0];
    expect(codes(c.reasons)).toContain('CONTRACT_QUOTE_NOT_TWO_SIDED');
  });
  it('a stale underlying outside the session makes the whole result unavailable', () => {
    expect(run([contract({ K: 80, at: '2026-10-02T19:57:00.000Z' })], undefined, { uAt: '2026-10-01T19:57:00.000Z' }, '2026-10-02T21:00:00.000Z').contractStatus).toBe('DATA_UNAVAILABLE');
  });
});

describe('instrument metadata (I8; acceptance test 6)', () => {
  const one = (instrument: Record<string, unknown>) => run([contract({ K: 80, instrument })]).contracts[0];
  it('missing deliverable or shares-per-contract: DATA_UNAVAILABLE, multiplier metrics unavailable', () => {
    const c = one({ deliverables: null });
    expect(c.resolution).toBe('NOT_EVALUABLE');
    expect(codes(c.reasons)).toContain('INSTRUMENT_METADATA_UNAVAILABLE');
    expect(c.metrics.contract_dollar_delta.validity).not.toBe('VALID');
    expect(c.metrics.contract_debit_per_contract.validity).not.toBe('VALID');
    expect(codes(one({ sharesPerContract: null }).reasons)).toContain('INSTRUMENT_METADATA_UNAVAILABLE');
  });
  it('100 shares but a different root, other deliverable or non-100: INELIGIBLE "Adjusted contract"', () => {
    expect(one({ rootSymbol: 'XYZ1' })).toMatchObject({ eligibility: 'INELIGIBLE', reasons: [expect.objectContaining({ code: 'CONTRACT_NON_STANDARD_DELIVERABLE' })] });
    expect(one({ deliverables: [{ amount: '100.0', 'deliverable-type': 'Shares', symbol: 'XYZ' }, { amount: '50', 'deliverable-type': 'Cash', symbol: 'USD' }] }).eligibility).toBe('INELIGIBLE');
    expect(one({ sharesPerContract: 150 }).eligibility).toBe('INELIGIBLE');
    expect(one({ sharesPerContract: 150 }).reasons[0].message).toContain('Adjusted contract: not evaluated');
  });
});

describe('ranking determinism (fixture T; acceptance test 7)', () => {
  const key = (occ: string, score: number, ext: number, spread: number): RankKeyInputs => ({ score, extrinsicPctOfMid: ext, spreadPctOfMid: spread, openInterest: 100, dte: 500, strike: 80, expiration: '2028-01-21', occSymbol: occ });
  const X = key('X', 50.0000000018, 14, 1);
  const Y = key('Y', 50.0000000009, 13, 2);
  const Z = key('Z', 50.0, 13, 1.5);
  const perms = [[X, Y, Z], [X, Z, Y], [Y, X, Z], [Y, Z, X], [Z, X, Y], [Z, Y, X]];
  it('all 6 permutations give Z, Y, X', () => {
    perms.forEach((p) => expect(p.slice().sort((a, b) => compareLeapsRank(a, b, P)).map((k) => k.occSymbol)).toEqual(['Z', 'Y', 'X']));
  });
  it('every tie-breaker rung decides when the earlier ones tie', () => {
    const base = key('B', 60, 10, 1);
    const cmp = (o: Partial<RankKeyInputs>) => compareLeapsRank(base, { ...base, ...o }, P);
    expect(cmp({ score: 61 })).toBeGreaterThan(0);
    expect(cmp({ extrinsicPctOfMid: 9 })).toBeGreaterThan(0);
    expect(cmp({ spreadPctOfMid: 0.5 })).toBeGreaterThan(0);
    expect(cmp({ openInterest: 200 })).toBeGreaterThan(0);
    expect(cmp({ dte: 600 })).toBeGreaterThan(0);
    expect(cmp({ strike: 70 })).toBeGreaterThan(0);
    expect(cmp({ expiration: '2027-01-15' })).toBeGreaterThan(0);
    expect(cmp({ occSymbol: 'A' })).toBeGreaterThan(0);
    expect(cmp({})).toBe(0);
  });
  it('evaluator output is independent of input order', () => {
    const list = [A(), B(), C(), E()];
    const a = run(list).contracts.map((c) => c.occSymbol);
    const b = run(list.slice().reverse()).contracts.map((c) => c.occSymbol);
    expect(b).toEqual(a);
  });
});

describe('state discipline (acceptance test 8) and IV (test 9)', () => {
  it('never mutates its input; repeated runs are identical', () => {
    const input = acq([A(), E()]);
    const before = JSON.stringify(input);
    const r1 = evaluateLeaps({ symbol: 'XYZ', underlyingState: 'SETUP', now: NOW, acquisition: input, policy: P });
    const r2 = evaluateLeaps({ symbol: 'XYZ', underlyingState: 'SETUP', now: NOW, acquisition: input, policy: P });
    expect(JSON.stringify(input)).toBe(before);
    expect(JSON.stringify(r2)).toBe(JSON.stringify(r1));
  });
  it('implied volatility is observable only: changing it changes neither eligibility nor score', () => {
    const lo = run([contract({ K: 80, extra: { volatility: '0.10' } })]).contracts[0];
    const hi = run([contract({ K: 80, extra: { volatility: '1.50' } })]).contracts[0];
    expect(hi.score).toBe(lo.score);
    expect(hi.eligibility).toBe(lo.eligibility);
  });
});

describe('real-row run (UBER, regular-hours audit capture)', () => {
  it('acquisition -> evaluation end to end, identities hold, every ranked contract passes every gate', async () => {
    const fx = JSON.parse(readFileSync(join(__dirname, '..', '__fixtures__', 'uber-regular-hours-2026-10-05.json'), 'utf8'));
    const get = async (path: string) => {
      if (path.indexOf('equity=') >= 0) return { status: 200, body: fx.underlyingQuote };
      if (path.indexOf('/option-chains/') === 0) return { status: 200, body: fx.nestedChain };
      const asked = path.split('&').map((p) => decodeURIComponent(p.split('=')[1]));
      return { status: 200, body: { data: { items: fx.optionQuoteRows.filter((r: { symbol: string }) => asked.indexOf(r.symbol) >= 0) } } };
    };
    const acquisition = await acquireLeapsChain('UBER', get, Date.parse(fx.nowIso) / 1000, QV_LEAPS_ACQUISITION_V1);
    const e = evaluateLeaps({ symbol: 'UBER', underlyingState: 'ACTIONABLE', now: fx.nowIso, acquisition, policy: P });
    expect(e.counts.selected).toBe(59);
    expect(e.counts.selected).toBe(e.counts.eligible + e.counts.ineligible + e.counts.unresolvedTotal);
    expect(['EVALUATED', 'NO_SUITABLE_CONTRACT', 'DATA_UNAVAILABLE']).toContain(e.contractStatus);
    e.contracts.filter((c) => c.rank !== null).forEach((c) => {
      expect(c.gates.every((g) => g.status === 'pass')).toBe(true);
      expect(c.metrics.contract_delta.validity).toBe('VALID');
    });
  });
});
