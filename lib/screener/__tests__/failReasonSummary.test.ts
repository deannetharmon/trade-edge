// lib/screener/__tests__/failReasonSummary.test.ts

import { describe, expect, it } from 'vitest';
import { summarizeFailReason, summarizeFailReasons } from '../failReasonSummary';

const capital = "Insufficient CSP capacity — requires $15,000, $3,912.305 available. CSP capacity uses the lower of the selected account's cash balance and option buying power; margin is not used by default.";
const ivr = 'Low IVR 25.6% — below the preferred 30% premium environment; ranked lower, not disqualified.';

describe('SCREENER-ROW-REASON-0001', () => {
  it('shortens the capacity message to what is needed and what is available', () => {
    expect(summarizeFailReason(capital)).toBe('Needs $15,000 · $3,912.305 available');
  });
  it('shortens the Low IVR advisory', () => {
    expect(summarizeFailReason(ivr)).toBe('Low IVR 25.6%');
  });
  it('truncates any other long reason and leaves short ones alone', () => {
    expect(summarizeFailReason('Poor liquidity')).toBe('Poor liquidity');
    expect(summarizeFailReason('x'.repeat(100)).length).toBeLessThanOrEqual(48);
    expect(summarizeFailReason('x'.repeat(100)).endsWith('…')).toBe(true);
  });
  it('keeps the full reasons for the hover title', () => {
    const s = summarizeFailReasons([capital, ivr, 'third']);
    expect(s.text).toBe('Needs $15,000 · $3,912.305 available · Low IVR 25.6%');
    expect(s.title).toContain('margin is not used by default');
    expect(s.title.split('\n')).toHaveLength(3);
  });
});
