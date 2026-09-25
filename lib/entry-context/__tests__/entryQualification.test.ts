// lib/entry-context/__tests__/entryQualification.test.ts

// QUAL-STATES-0001 phase 2: the override record travels order window -> pending entry ->
// entry snapshot (-> Trade Log) and is never trusted blindly on the way in.

import { describe, expect, it } from 'vitest';
import { buildEntryQualification, sanitizeEntryQualification } from '../entryQualification';
import { createPendingCreditSpreadEntry, createPendingIronCondorEntry, type PendingCreditSpreadEntry } from '../pending';
import { promotePendingEntryOnConfirmedFills, promotePendingIronCondorEntryOnConfirmedFills } from '../promote';
import { unavailableEvidence } from '../types';

const at = '2026-09-25T15:00:00.000Z';
const u = () => unavailableEvidence<number>('test');

function pending(extra: Record<string, unknown> = {}): PendingCreditSpreadEntry {
  return createPendingCreditSpreadEntry({
    accountId: 'acct', brokerOrderId: 'complex-order', openingOrderIds: ['open-order'], submittedAt: at,
    strategy: 'BPS', symbol: 'AMD', expiration: '2026-11-20', shortStrike: 540, longStrike: 530, quantity: 1,
    fillPrice: u(), underlyingPrice: u(), shortDelta: u(), shortLegIv: u(), ivr: u(), underlyingIv: u(), expectedMove: u(),
    earningsDate: unavailableEvidence<string>('test'), quoteBid: u(), quoteAsk: u(), quoteMid: u(),
    scoreMomentum: u(), scoreIvr: u(), scoreEmClearance: u(), scoreRange: u(), scoreTechnical: u(), scoreLiquidity: u(),
    scoreBuffer: u(), scoreStrategyAlignment: u(), scoreDeltaQuality: u(), scoreComposite: u(),
    profitTarget: u(), stopLoss: u(), stopLossPct: u(),
    ...extra,
  } as PendingCreditSpreadEntry);
}

const record = () => buildEntryQualification({
  state: 'disqualified', failing: ['earnings'], warning: ['oi'],
  reasonFor: key => (key === 'earnings' ? 'earnings inside the 10-day buffer: Earnings 6d after expiry' : 'low OI 208/371: below the 500 target'),
  acknowledged: true, at, scanMode: 'rank',
});

describe('buildEntryQualification', () => {
  it('records the state, every reason with its text, and that the trader overrode it', () => {
    expect(record()).toEqual({
      state: 'disqualified',
      failing: [{ key: 'earnings', text: 'earnings inside the 10-day buffer: Earnings 6d after expiry' }],
      warning: [{ key: 'oi', text: 'low OI 208/371: below the 500 target' }],
      overridden: true, acknowledgedAt: at, scanMode: 'rank',
    });
  });
  it('a Qualified trade is never marked overridden, and an unacknowledged one has no acknowledgment time', () => {
    const q = buildEntryQualification({ state: 'qualified', failing: [], warning: [], reasonFor: () => '', acknowledged: true, at, scanMode: 'targeted' });
    expect(q.overridden).toBe(false);
    const n = buildEntryQualification({ state: 'caution', failing: [], warning: ['oi'], reasonFor: () => 'x', acknowledged: false, at, scanMode: null });
    expect(n).toMatchObject({ overridden: false, acknowledgedAt: null });
  });
});

describe('sanitizeEntryQualification', () => {
  it('keeps a well-formed record', () => {
    expect(sanitizeEntryQualification(record())).toEqual(record());
  });
  it('drops anything malformed instead of throwing (the order is already placed)', () => {
    expect(sanitizeEntryQualification(undefined)).toBeUndefined();
    expect(sanitizeEntryQualification('x')).toBeUndefined();
    expect(sanitizeEntryQualification({ ...record(), state: 'great' })).toBeUndefined();
    expect(sanitizeEntryQualification({ ...record(), failing: 'nope' })).toBeUndefined();
    expect(sanitizeEntryQualification({ ...record(), overridden: 'yes' })).toBeUndefined();
    expect(sanitizeEntryQualification({ ...record(), failing: [{ key: 1, text: 'x' }] })).toBeUndefined();
    expect(sanitizeEntryQualification({ ...record(), failing: new Array(25).fill({ key: 'a', text: 'b' }) })).toBeUndefined();
  });
  it('caps text length and normalizes an unknown scan mode to null', () => {
    const r = sanitizeEntryQualification({ ...record(), scanMode: 'filter', failing: [{ key: 'k'.repeat(90), text: 't'.repeat(900) }] })!;
    expect(r.scanMode).toBeNull();
    expect(r.failing[0].key).toHaveLength(40);
    expect(r.failing[0].text).toHaveLength(300);
  });
});

describe('order -> pending entry -> snapshot', () => {
  it('a pending entry keeps a valid record, drops a malformed one, and omits it when absent', () => {
    expect(pending({ entryQualification: record() }).entryQualification).toEqual(record());
    expect('entryQualification' in pending({ entryQualification: { state: 'bogus' } })).toBe(false);
    expect('entryQualification' in pending()).toBe(false);
  });
  it('the record is carried into the immutable snapshot when the fill is confirmed', () => {
    const p = pending({ entryQualification: record() });
    const snapshot = promotePendingEntryOnConfirmedFills(p, [], [{ id: 'a', 'order-id': 'open-order', 'transaction-type': 'Trade', 'executed-at': at }]);
    expect(snapshot?.entryQualification).toEqual(record());
  });
  it('a pending entry without a record promotes to a snapshot without one (older orders keep working)', () => {
    const snapshot = promotePendingEntryOnConfirmedFills(pending(), [], [{ id: 'a', 'order-id': 'open-order', 'transaction-type': 'Trade', 'executed-at': at }]);
    expect(snapshot).not.toBeNull();
    expect(snapshot && 'entryQualification' in snapshot).toBe(false);
  });
  it('iron condor pending entries sanitize the record too', () => {
    const ic = createPendingIronCondorEntry({
      accountId: 'acct', brokerOrderId: 'o', openingOrderIds: ['x'], submittedAt: at, strategy: 'IC', symbol: 'AMD', expiration: '2026-11-20',
      putShortStrike: 540, putLongStrike: 530, callShortStrike: 700, callLongStrike: 710, quantity: 1,
      entryQualification: { state: 'bogus' },
    } as never);
    expect('entryQualification' in ic).toBe(false);
  });
  it('an iron condor entry carries the record all the way into its snapshot', () => {
    const ic = createPendingIronCondorEntry({
      accountId: 'acct', brokerOrderId: 'o', openingOrderIds: ['open-order'], submittedAt: at, strategy: 'IC', symbol: 'AMD', expiration: '2026-11-20',
      putShortStrike: 540, putLongStrike: 530, callShortStrike: 700, callLongStrike: 710, quantity: 1,
      fillPrice: u(), underlyingPrice: u(), putShortDelta: u(), callShortDelta: u(), putShortLegIv: u(), callShortLegIv: u(),
      ivr: u(), underlyingIv: u(), expectedMove: u(), earningsDate: unavailableEvidence<string>('test'),
      putQuoteBid: u(), putQuoteAsk: u(), callQuoteBid: u(), callQuoteAsk: u(),
      scoreMomentum: u(), scoreIvr: u(), scoreEmClearance: u(), scoreRange: u(), scoreTechnical: u(), scoreLiquidity: u(),
      scoreBuffer: u(), scoreStrategyAlignment: u(), scoreDeltaQuality: u(), scoreComposite: u(),
      profitTarget: u(), stopLoss: u(), stopLossPct: u(),
      entryQualification: record(),
    } as never);
    const snapshot = promotePendingIronCondorEntryOnConfirmedFills(ic, [], [{ id: 'a', 'order-id': 'open-order', 'transaction-type': 'Trade', 'executed-at': at }]);
    expect(snapshot?.entryQualification).toEqual(record());
  });
});
