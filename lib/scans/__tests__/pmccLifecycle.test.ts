import { describe, expect, it } from 'vitest';
import { evaluatePmccLifecycle } from '../pmccLifecycle';

const input = { now: '2026-09-10T12:00:00.000Z', shortExpiration: '2026-10-16', shortStrike: 500, underlyingPrice: 480, quoteAgeSeconds: 5, earningsDate: null, exDividendDate: null };
describe('evaluatePmccLifecycle', () => {
  it('is on track with current data and no events', () => expect(evaluatePmccLifecycle(input).status).toBe('ON_TRACK'));
  it('raises action required for earnings inside the short cycle', () => expect(evaluatePmccLifecycle({ ...input, earningsDate: '2026-10-01' }).status).toBe('ACTION_REQUIRED'));
  it('surfaces ex-dividend assignment risk for a near-ITM short call', () => expect(evaluatePmccLifecycle({ ...input, underlyingPrice: 498, exDividendDate: '2026-10-01' }).status).toBe('ACTION_REQUIRED'));
  it('does not suggest a roll or trade action', () => expect(JSON.stringify(evaluatePmccLifecycle({ ...input, shortExpiration: '2026-09-15' }))).not.toMatch(/roll|buy|sell/i));
});
