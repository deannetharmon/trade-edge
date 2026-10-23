// lib/portfolio-facts/__tests__/disagreementLog.test.ts

import { describe, expect, it } from 'vitest';
import { appendDisagreement, backfillOutcome, buildDisagreementEntry, isValidEntry, KEEP_DAYS, MAX_ENTRIES, type DisagreementEntry } from '../disagreementLog';
import type { PositionFacts } from '../positionFacts';
import type { Verdict } from '../verdict';
import type { SecondLook } from '../secondLook';

const NOW = new Date('2026-10-23T12:00:00.000Z');
const facts = { snapshotId: 'snap-1', positionKey: 'NVDA::2026-09-18', identity: { symbol: 'NVDA' }, engineInput: { symbol: 'NVDA', big: 'x'.repeat(100) } } as unknown as PositionFacts;
const verdict = { bucket: 'Hold', label: 'Hold Position', intent: 'HOLD_POSITION', reasons: [{ ruleId: 'baseline-hold' }] } as unknown as Verdict;
const look = { aiRecommendation: 'CLOSE', aiBucket: 'Close', officialBucket: 'Hold', differs: true, dataPoint: 'ivr', dataPointValue: 50, note: 'n', chip: 'AI differs: ivr' } as SecondLook;

const entry = (over: Partial<DisagreementEntry> = {}): DisagreementEntry => ({ ...buildDisagreementEntry(facts, verdict, look, NOW)!, ...over });

describe('buildDisagreementEntry', () => {
  it('records the verdict, the AI view, the data point and the facts used, without the engine input', () => {
    const e = buildDisagreementEntry(facts, verdict, look, NOW)!;
    expect(e.id).toBe('NVDA::2026-09-18|snap-1');
    expect(e).toMatchObject({ officialBucket: 'Hold', aiRecommendation: 'CLOSE', aiBucket: 'Close', dataPoint: 'ivr', dataPointValue: 50, ruleIds: ['baseline-hold'], outcome: null });
    expect('engineInput' in e.factsUsed).toBe(false);
    expect(isValidEntry(e)).toBe(true);
  });
  it('returns null when the AI agrees', () => {
    expect(buildDisagreementEntry(facts, verdict, { ...look, differs: false }, NOW)).toBeNull();
  });
});

describe('appendDisagreement', () => {
  it('keeps one entry per position per snapshot (a repeat replaces)', () => {
    const a = entry({ note: 'first' });
    const b = entry({ note: 'second' });
    const list = appendDisagreement(appendDisagreement([], a, NOW), b, NOW);
    expect(list).toHaveLength(1);
    expect(list[0].note).toBe('second');
  });
  it('a different snapshot of the same position is a separate entry', () => {
    const list = appendDisagreement(appendDisagreement([], entry(), NOW), entry({ id: 'NVDA::2026-09-18|snap-2', snapshotId: 'snap-2' }), NOW);
    expect(list).toHaveLength(2);
  });
  it('drops entries older than 180 days, keeps one at exactly the limit', () => {
    const day = 86_400_000;
    const old = entry({ id: 'old', loggedAt: new Date(NOW.getTime() - (KEEP_DAYS * day + 1)).toISOString() });
    const edge = entry({ id: 'edge', loggedAt: new Date(NOW.getTime() - KEEP_DAYS * day).toISOString() });
    const list = appendDisagreement([old, edge], entry({ id: 'new' }), NOW);
    expect(list.map(e => e.id)).toEqual(['edge', 'new']);
  });
  it('caps at 500 and drops the oldest first', () => {
    const base = NOW.getTime();
    const many = Array.from({ length: MAX_ENTRIES }, (_, i) => entry({ id: `e${i}`, loggedAt: new Date(base - (MAX_ENTRIES - i) * 1000).toISOString() }));
    const list = appendDisagreement(many, entry({ id: 'newest' }), NOW);
    expect(list).toHaveLength(MAX_ENTRIES);
    expect(list[0].id).toBe('e1');
    expect(list[list.length - 1].id).toBe('newest');
  });
  it('does not mutate the list it was given', () => {
    const original = [entry()];
    const before = JSON.stringify(original);
    appendDisagreement(original, entry({ id: 'x' }), NOW);
    expect(JSON.stringify(original)).toBe(before);
  });
});

describe('backfillOutcome', () => {
  it('fills the outcome on the closed position\'s open entries only', () => {
    const outcome = { closedAt: '2026-10-30T00:00:00.000Z', realizedPnl: 120 };
    const list = [entry({ id: 'a' }), entry({ id: 'b', positionKey: 'OTHER' }), entry({ id: 'c', outcome: { closedAt: '2026-10-01T00:00:00.000Z', realizedPnl: 5 } })];
    const next = backfillOutcome(list, 'NVDA::2026-09-18', outcome);
    expect(next[0].outcome).toEqual(outcome);
    expect(next[1].outcome).toBeNull();
    expect(next[2].outcome?.realizedPnl).toBe(5);
  });
});

describe('isValidEntry', () => {
  it('rejects non-records, missing fields, tokens, account numbers and oversized bodies', () => {
    expect(isValidEntry(null)).toBe(false);
    expect(isValidEntry({})).toBe(false);
    expect(isValidEntry({ ...entry(), accessToken: 'secret' })).toBe(false);
    expect(isValidEntry({ ...entry(), accountNumber: '5WX12345' })).toBe(false);
    expect(isValidEntry({ ...entry(), loggedAt: 'not a date' })).toBe(false);
    expect(isValidEntry({ ...entry(), factsUsed: { blob: 'x'.repeat(30_000) } })).toBe(false);
  });
});
