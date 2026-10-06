// lib/tradeLog/__tests__/coachingPrompt.test.ts

import { describe, expect, it } from 'vitest';
import type { ClosedTrade } from '../types';
import { buildPerformanceReport } from '../performanceMetrics';
import { buildCoachingInput } from '../coachingInput';
import { answerText, buildCoachingUserMessage, changeImpact, parseCoachingAnswer } from '../coachingPrompt';
import dean from './fixtures/dean-trade-log-2026-10-06.json';

const ci = buildCoachingInput({ report: buildPerformanceReport(dean as unknown as ClosedTrade[]), from: '2026-04-29', to: '2026-10-05', label: 'Apr 29 – Oct 5', accountProfit: { status: 'UNAVAILABLE', reason: 'x' }, balanceHistory: [], sizeOverrides: new Set() });

describe('PERF-AI-0001 coaching prompt contract', () => {
  it('the user message carries the full DATA and the JSON contract', () => {
    const m = buildCoachingUserMessage(ci);
    expect(m).toContain('ONE JSON object');
    expect(JSON.parse(m.slice(m.indexOf('DATA:\n') + 6)).counts.included).toBe(66);
  });
  it('parses a valid answer, drops unknown habit keys and caps changes at 3', () => {
    const a = parseCoachingAnswer('Sure: {"summary":"S.","habits":{"beyondStop":"B.","bogus":"x"},"strategies":{"BPS":"P."},"tickers":"T.","changes":[{"title":"A","habit":"beyondStop","detail":"d"},{"title":"B","habit":"nope"},{"title":"C","habit":"openedInside21Dte"},{"title":"D","habit":"target"},{"title":"E","habit":"assigned"}]}');
    expect(a?.habits).toEqual({ beyondStop: 'B.' });
    expect(a?.changes.map(c => c.title)).toEqual(['A', 'C', 'D']);
    expect(answerText(a!)).toContain('B.');
  });
  it('returns null for non-JSON or a missing summary', () => {
    expect(parseCoachingAnswer('no json here')).toBeNull();
    expect(parseCoachingAnswer('{"habits":{}}')).toBeNull();
  });
  it("change dollars come from the app's input, never the AI", () => {
    expect(changeImpact(ci, 'beyondStop').dollars).toBeCloseTo(402, 2);
    expect(changeImpact(ci, 'openedInside21Dte').dollars).toBeCloseTo(614.54, 2);
    expect(changeImpact(ci, 'creditToWidth').dollars).toBeNull();
  });
});
