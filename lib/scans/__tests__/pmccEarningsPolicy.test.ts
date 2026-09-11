import { describe, expect, it } from 'vitest';
import { addTradingSessions, evaluateEarningsProximity, tradingSessionsStrictlyBetween } from '../pmccEarningsPolicy';

const base = { source: 'test-provider', asOf: '2026-09-11T12:00:00Z' };

describe('PMCC earnings proximity policy', () => {
  it('counts sessions strictly between expiration and event', () => {
    expect(tradingSessionsStrictlyBetween('2026-09-11', '2026-09-21')).toBe(5);
    expect(addTradingSessions('2026-09-11', 10)).toBe('2026-09-25');
  });

  it('fails an event on or before expiration', () => {
    expect(evaluateEarningsProximity('2026-09-11', { status: 'confirmed', scheduledDate: '2026-09-11', scheduledTime: 'after-market', ...base }).status).toBe('fail');
  });

  it('fails below five sessions, cautions at five through nine, and passes at ten', () => {
    expect(evaluateEarningsProximity('2026-09-11', { status: 'confirmed', scheduledDate: '2026-09-17', scheduledTime: 'after-market', ...base })).toMatchObject({ status: 'fail', tradingSessionsBetween: 3 });
    expect(evaluateEarningsProximity('2026-09-11', { status: 'confirmed', scheduledDate: '2026-09-21', scheduledTime: 'after-market', ...base })).toMatchObject({ status: 'caution', tradingSessionsBetween: 5 });
    expect(evaluateEarningsProximity('2026-09-11', { status: 'confirmed', scheduledDate: '2026-09-28', scheduledTime: 'after-market', ...base })).toMatchObject({ status: 'pass', tradingSessionsBetween: 10 });
  });

  it('uses the earliest date and fails closed when a pending range overlaps the buffer', () => {
    const result = evaluateEarningsProximity('2026-09-11', { status: 'pending-estimated', rangeStart: '2026-09-21', rangeEnd: '2026-09-25', ...base });
    expect(result).toMatchObject({ status: 'unavailable', eventDateUsed: '2026-09-21', tradingSessionsBetween: 5 });
    expect(evaluateEarningsProximity('2026-09-11', { status: 'pending-estimated', rangeStart: '2026-09-28', rangeEnd: '2026-10-02', ...base })).toMatchObject({ status: 'pass', eventDateUsed: '2026-09-28' });
  });

  it('rejects an invalid or reversed pending estimate range', () => {
    expect(evaluateEarningsProximity('2026-09-11', { status: 'pending-estimated', rangeStart: '2026-09-28', rangeEnd: 'bad-date', ...base }).status).toBe('unavailable');
    expect(evaluateEarningsProximity('2026-09-11', { status: 'pending-estimated', rangeStart: '2026-10-02', rangeEnd: '2026-09-28', ...base }).status).toBe('unavailable');
  });

  it('requires not-scheduled coverage through expiration plus ten sessions', () => {
    expect(evaluateEarningsProximity('2026-09-11', { status: 'not-scheduled', coverageThrough: '2026-09-24', ...base }).status).toBe('unavailable');
    expect(evaluateEarningsProximity('2026-09-11', { status: 'not-scheduled', coverageThrough: '2026-09-25', ...base }).status).toBe('pass');
  });

  it.each(['unknown', 'stale'] as const)('fails closed for %s evidence', status => {
    expect(evaluateEarningsProximity('2026-09-11', { status, reason: 'Evidence unavailable', source: null, asOf: null }).status).toBe('unavailable');
  });

  it('supports an explicit not-applicable classification', () => {
    expect(evaluateEarningsProximity('2026-09-11', { status: 'not-applicable', ...base }).status).toBe('not-applicable');
  });
});
