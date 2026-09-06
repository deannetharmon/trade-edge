import { describe, expect, it } from 'vitest';
import { evaluateEventRisk } from '../eventRisk';

const policy = { version: 'event-risk-v1' as const, quoteMaxAgeSeconds: 15, eventMaxAgeMinutes: 15 };
const input = { now: '2026-09-10T12:00:00.000Z', shortExpiration: '2026-10-16', longExpiration: '2027-06-18', quoteAgeSeconds: 5, tradingHalted: false, eventCheckedAt: '2026-09-10T12:00:00.000Z', earningsDate: null, exDividendDate: null, splitOrSymbolChangeDate: null, shortIsItmOrNearItm: false, standardContract: true, occAcknowledgedAt: null };
describe('evaluateEventRisk', () => {
  it('clears verified, current data with no events', () => expect(evaluateEventRisk(input, policy).status).toBe('CLEAR'));
  it('fails closed on stale event data', () => expect(evaluateEventRisk({ ...input, eventCheckedAt: '2026-09-10T11:00:00.000Z' }, policy).status).toBe('WAIT_MONITOR'));
  it('requires an OCC acknowledgment when contract standardness is unknown', () => {
    expect(evaluateEventRisk({ ...input, standardContract: null }, policy).status).toBe('WAIT_MONITOR');
    expect(evaluateEventRisk({ ...input, standardContract: null, occAcknowledgedAt: '2026-09-10T12:00:00.000Z' }, policy).status).toBe('CLEAR');
  });
  it('blocks earnings before the short call expires', () => expect(evaluateEventRisk({ ...input, earningsDate: '2026-10-01' }, policy).status).toBe('NOT_QUALIFIED'));
});
