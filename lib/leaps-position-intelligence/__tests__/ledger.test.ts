// lib/leaps-position-intelligence/__tests__/ledger.test.ts
//
// LEAPS-LEDGER-0001 -- what the browser may report, when an evaluation is worth recording, and how each event reads.

import { describe, expect, it } from 'vitest';
import { buildOrderDecisionEvent, describeLedgerEvent, EVALUATION_MIN_GAP_MS, isDecisionHistoryEvent, LEDGER_CALLOUTS_MAX, LEDGER_TEXT_MAX, OPENED_REVIEW_MIN_GAP_MS, sanitizeClientEvent, shouldRecordEvaluation, shouldRecordOpenedReview } from '../ledger';

const evalEvent = (payload: Record<string, unknown> = {}) => ({
  type: 'decision-evaluated',
  payload: { state: 'monitor', reasonCode: 'income-floor', candidate: { strike: 360, expiration: '2026-10-16', credit: 6.4, delta: 0.28, dte: 24 }, stockPrice: 350.86,
    callouts: [{ tone: 'bad', text: 'Short strike $360 is below your LEAPS breakeven $363.55.' }], rules: 'No income rules saved: floor $363.55 (your breakeven).', ...payload },
});
const ok = (raw: unknown) => { const r = sanitizeClientEvent(raw); if (!r.ok) throw new Error(r.errors.join('; ')); return r.event; };
const errors = (raw: unknown) => { const r = sanitizeClientEvent(raw); return r.ok ? [] : r.errors; };

describe('what the browser may report', () => {
  it('accepts a full card evaluation and marks it client-attested', () => {
    expect(ok(evalEvent())).toEqual({ type: 'decision-evaluated', payload: {
      source: 'positions-card', attestation: 'client', state: 'monitor', reasonCode: 'income-floor',
      candidate: { strike: 360, expiration: '2026-10-16', credit: 6.4, delta: 0.28, dte: 24 }, stockPrice: 350.86,
      callouts: [{ tone: 'bad', text: 'Short strike $360 is below your LEAPS breakeven $363.55.' }], rules: 'No income rules saved: floor $363.55 (your breakeven).' } });
  });

  it('accepts the minimum (state and rules) and defaults the rest to null / empty', () => {
    expect(ok({ type: 'decision-evaluated', payload: { state: 'review-income-call', rules: 'r' } })).toMatchObject({ payload: { reasonCode: null, candidate: null, stockPrice: null, callouts: [] } });
  });

  it('drops unknown fields and ignores a client-supplied attestation or source', () => {
    const e = ok(evalEvent({ attestation: 'server', source: 'x', extra: 'junk', callouts: [{ tone: 'good', text: 'ok', extra: 1 }] })) as unknown as { payload: Record<string, unknown> };
    expect(e.payload.attestation).toBe('client');
    expect(e.payload.source).toBe('positions-card');
    expect('extra' in e.payload).toBe(false);
    expect(e.payload.callouts).toEqual([{ tone: 'good', text: 'ok' }]);
  });

  it('the only user decision the browser can report is opening the review (orders are written by the server)', () => {
    expect(ok({ type: 'user-decision', payload: { action: 'opened-review', quantity: 99, limitPrice: 1 } })).toEqual({ type: 'user-decision', payload: { action: 'opened-review', attestation: 'client' } });
    for (const action of ['sold-short-call', 'bought-leaps', 'opened-pmcc', 'anything']) {
      expect(errors({ type: 'user-decision', payload: { action, attestation: 'server' } })).toEqual(['Only "opened-review" can be reported from the browser.']);
    }
  });

  it.each([
    [evalEvent({ state: 'checking' }), 'A valid state is required.'],
    [evalEvent({ state: undefined }), 'A valid state is required.'],
    [evalEvent({ rules: '' }), 'The rules in force are required (up to 300 characters).'],
    [evalEvent({ rules: 'x'.repeat(301) }), 'The rules in force are required (up to 300 characters).'],
    [evalEvent({ reasonCode: 'x'.repeat(61) }), 'The reason code must be short text.'],
    [evalEvent({ candidate: { strike: -1, expiration: '2026-10-16', credit: 1, delta: 0.3, dte: 20 } }), 'The candidate is not valid.'],
    [evalEvent({ candidate: { strike: 360, expiration: '10/16/2026', credit: 1, delta: 0.3, dte: 20 } }), 'The candidate is not valid.'],
    [evalEvent({ candidate: { strike: 360, expiration: '2026-10-16', credit: -1, delta: 0.3, dte: 20 } }), 'The candidate is not valid.'],
    [evalEvent({ candidate: { strike: 360, expiration: '2026-10-16', credit: 1, delta: 'x', dte: 20 } }), 'The candidate is not valid.'],
    [evalEvent({ stockPrice: 0 }), 'The stock price must be a positive number.'],
    [evalEvent({ stockPrice: 'high' }), 'The stock price must be a positive number.'],
    [evalEvent({ callouts: Array.from({ length: LEDGER_CALLOUTS_MAX + 1 }, () => ({ tone: 'good', text: 'a' })) }), `At most ${LEDGER_CALLOUTS_MAX} callouts are allowed.`],
    [evalEvent({ callouts: [{ tone: 'loud', text: 'a' }] }), 'A callout is not valid.'],
    [evalEvent({ callouts: [{ tone: 'good', text: 'x'.repeat(LEDGER_TEXT_MAX + 1) }] }), 'A callout is not valid.'],
    [evalEvent({ callouts: 'text' }), `At most ${LEDGER_CALLOUTS_MAX} callouts are allowed.`],
  ])('rejects %j', (raw, message) => {
    expect(errors(raw)).toContain(message);
  });

  it('accepts callouts exactly at the limits', () => {
    expect(ok(evalEvent({ rules: 'x'.repeat(300), callouts: Array.from({ length: LEDGER_CALLOUTS_MAX }, () => ({ tone: 'good', text: 'x'.repeat(LEDGER_TEXT_MAX) })) }))).toBeTruthy();
  });

  it.each([[null], [undefined], ['text'], [5], [[]], [{ type: 'mandate-changed', payload: {} }], [{ type: 'outcome-recorded', payload: {} }], [{}]])('rejects %j', raw => {
    expect(errors(raw).length).toBeGreaterThan(0);
  });
});

describe('shouldRecordEvaluation', () => {
  const NOW = Date.parse('2026-09-21T15:00:00.000Z');
  const last = (over: Partial<{ at: string; state: string; reasonCode: string | null }> = {}) => ({ at: '2026-09-21T12:00:00.000Z', state: 'monitor', reasonCode: 'income-floor', ...over });

  it('records the first evaluation', () => {
    expect(shouldRecordEvaluation(null, { state: 'monitor', reasonCode: 'income-floor' }, NOW)).toBe(true);
  });
  it('skips an unchanged state and reason, however long ago the last one was', () => {
    expect(shouldRecordEvaluation(last({ at: '2026-01-01T00:00:00.000Z' }), { state: 'monitor', reasonCode: 'income-floor' }, NOW)).toBe(false);
    expect(shouldRecordEvaluation(last({ reasonCode: null }), { state: 'monitor', reasonCode: null }, NOW)).toBe(false);
  });
  it('a change of state, or of reason within the same state, is recorded once the minimum gap has passed', () => {
    expect(shouldRecordEvaluation(last(), { state: 'review-income-call', reasonCode: null }, NOW)).toBe(true);
    expect(shouldRecordEvaluation(last(), { state: 'monitor', reasonCode: 'known-event-blocked' }, NOW)).toBe(true);
  });
  it('a change inside the minimum gap is held back (boundary: exactly the gap is allowed)', () => {
    const next = { state: 'review-income-call', reasonCode: null };
    expect(shouldRecordEvaluation(last({ at: new Date(NOW - EVALUATION_MIN_GAP_MS + 1).toISOString() }), next, NOW)).toBe(false);
    expect(shouldRecordEvaluation(last({ at: new Date(NOW - EVALUATION_MIN_GAP_MS).toISOString() }), next, NOW)).toBe(true);
  });
  it('an unreadable last timestamp does not block a genuine change', () => {
    expect(shouldRecordEvaluation(last({ at: 'garbage' }), { state: 'review-income-call', reasonCode: null }, NOW)).toBe(true);
  });
});

describe('describeLedgerEvent', () => {
  const ev = (type: string, payload: Record<string, unknown>) => ({ id: 'e1', at: '2026-09-21T15:00:00.000Z', type, actor: 'trader', payload });
  const line = (type: string, payload: Record<string, unknown>) => describeLedgerEvent(ev(type, payload));

  it('a card evaluation names the state, the candidate and the first red reason', () => {
    expect(line('decision-evaluated', ok(evalEvent()).payload as unknown as Record<string, unknown>)).toEqual({
      id: 'e1', at: '2026-09-21T15:00:00.000Z', title: 'Card said: Monitor', tone: 'watch', evidence: 'client',
      detail: 'Candidate $360 C 2026-10-16, credit $6.40, delta 0.28 · Short strike $360 is below your LEAPS breakeven $363.55.',
    });
  });
  it.each([['review-income-call', 'Review income call', 'good'], ['monitor', 'Monitor', 'watch'], ['hold-uncovered', 'Hold uncovered', 'watch'], ['reassess-thesis', 'Reassess thesis', 'bad']])('%s -> %s (%s)', (state, label, tone) => {
    expect(line('decision-evaluated', { state, callouts: [] })).toMatchObject({ title: `Card said: ${label}`, tone, detail: null });
  });
  it('an evaluation with an unknown state is a neutral, generic line', () => {
    expect(line('decision-evaluated', { state: 'mystery' })).toMatchObject({ title: 'The card was evaluated', tone: 'neutral' });
  });

  it('opening the review is marked as reported by the browser', () => {
    expect(line('user-decision', { action: 'opened-review', attestation: 'client' })).toMatchObject({ title: 'You opened the PMCC review', evidence: 'client', tone: 'neutral' });
  });
  it('orders are marked as recorded by the server, with quantity, contract and price', () => {
    expect(line('user-decision', { action: 'sold-short-call', attestation: 'server', quantity: 1, limitPrice: 6.4, priceEffect: 'Credit', shortOccSymbol: 'GOOGL 261016C00375000' }))
      .toMatchObject({ title: 'You sold a short call', detail: '1× $375 C 2026-10-16 for $6.40 credit', evidence: 'server' });
    expect(line('user-decision', { action: 'bought-leaps', attestation: 'server', quantity: 2, limitPrice: 113.55, priceEffect: 'Debit' }))
      .toMatchObject({ title: 'You bought this LEAPS', detail: '2× at $113.55 debit', evidence: 'server' });
    expect(line('user-decision', { action: 'opened-pmcc', attestation: 'server', quantity: 1, limitPrice: 107.15, priceEffect: 'Debit', shortOccSymbol: 'GOOGL 261016C00375000' }))
      .toMatchObject({ title: 'You opened a PMCC pair', detail: '1× · short $375 C 2026-10-16 · net $107.15 debit' });
  });
  it('a missing quantity or price simply leaves that part out', () => {
    expect(line('user-decision', { action: 'sold-short-call', attestation: 'server' })).toMatchObject({ detail: null });
    expect(line('user-decision', { action: 'sold-short-call', attestation: 'server', shortOccSymbol: 'not an occ' }).detail).toBe('not an occ');
    expect(line('user-decision', { action: 'teleported' })).toMatchObject({ title: 'You acted on this LEAPS' });
  });

  it('a rules change shows the rules that were saved', () => {
    const mandate = { version: 'LEAPS-PI-1.1', thesis: '', invalidation: '', thesisTargetHigh: 390, invalidationPrice: null, posture: 'balanced', incomeCapStrike: 365, minimumCycleCredit: null, allowKnownEarningsCycle: false };
    expect(line('mandate-changed', { mandate })).toMatchObject({ title: 'You changed your income rules', detail: 'target $390 · floor $365 · balanced · earnings not allowed', evidence: 'rules' });
    expect(line('mandate-changed', {})).toMatchObject({ detail: null });
  });

  it('an unknown event type is generic', () => {
    expect(line('outcome-recorded', {})).toMatchObject({ title: 'Recorded event', tone: 'neutral' });
  });

  it('only decisions, evaluations and rule changes belong on the Decision history list', () => {
    expect(['decision-evaluated', 'user-decision', 'mandate-changed', 'outcome-recorded'].filter(type => isDecisionHistoryEvent({ type }))).toEqual(['decision-evaluated', 'user-decision', 'mandate-changed']);
  });
});

describe('shouldRecordOpenedReview', () => {
  const NOW = Date.parse('2026-09-21T15:00:00.000Z');
  it('records the first click, then not again inside the gap (boundary: exactly the gap is allowed)', () => {
    expect(shouldRecordOpenedReview(null, NOW)).toBe(true);
    expect(shouldRecordOpenedReview(new Date(NOW - OPENED_REVIEW_MIN_GAP_MS + 1).toISOString(), NOW)).toBe(false);
    expect(shouldRecordOpenedReview(new Date(NOW - OPENED_REVIEW_MIN_GAP_MS).toISOString(), NOW)).toBe(true);
  });
  it('an unreadable previous time does not block', () => {
    expect(shouldRecordOpenedReview('garbage', NOW)).toBe(true);
  });
});

describe('buildOrderDecisionEvent (server-attested orders)', () => {
  const base = { id: 'ev-1', at: '2026-08-14T15:30:00.000Z', entryRecordId: 'rec-1', brokerOrderId: '4711', quantity: 1, limitPrice: 6.4, priceEffect: 'Credit' as const, shortOccSymbol: 'GOOGL 261016C00375000', underlyingPrice: 350.858 };

  it.each([['leaps-entry', 'bought-leaps'], ['pmcc-entry', 'opened-pmcc'], ['short-call-sold', 'sold-short-call']] as const)('%s -> %s', (kind, action) => {
    expect(buildOrderDecisionEvent({ ...base, kind }).payload.action).toBe(action);
  });

  it('is an append-only, server-attested trader decision tied to the entry record, with an id derived from the broker order', () => {
    expect(buildOrderDecisionEvent({ ...base, kind: 'short-call-sold' })).toEqual({
      id: 'ev-1', at: '2026-08-14T15:30:00.000Z', policyVersion: 'LEAPS-PI-1.1', type: 'user-decision', actor: 'trader', requestId: 'order-4711',
      retention: 'append-only', recovery: 'rebuild-from-ledger',
      payload: { action: 'sold-short-call', attestation: 'server', brokerOrderId: '4711', quantity: 1, limitPrice: 6.4, priceEffect: 'Credit', shortOccSymbol: 'GOOGL 261016C00375000', entryRecordId: 'rec-1', underlyingPrice: 350.858 },
    });
  });

  it('without a readable broker order id the request id falls back to the entry record', () => {
    expect(buildOrderDecisionEvent({ ...base, kind: 'leaps-entry', brokerOrderId: null }).requestId).toBe('entry-rec-1');
  });

  it('reads back through describeLedgerEvent as a server-recorded order', () => {
    expect(describeLedgerEvent(buildOrderDecisionEvent({ ...base, kind: 'short-call-sold' }))).toMatchObject({ title: 'You sold a short call', evidence: 'server', detail: '1× $375 C 2026-10-16 for $6.40 credit' });
  });
});
