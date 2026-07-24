// lib/trader-commitments/__tests__/store.test.ts
//
// MB-0001B: coverage for the Trader Commitment store's pure logic --
// creation of every commitment kind, immutable upsert/remove, subject
// lookup, and defensive parsing (valid store, missing/corrupt input,
// partially-corrupt entries).

import { describe, expect, it } from 'vitest';
import {
  commitmentsForSubject,
  createTraderCommitment,
  createTraderCommitmentId,
  listActiveCommitments,
  parseTraderCommitmentStore,
  removeTraderCommitment,
  upsertTraderCommitment,
} from '../store';
import type { TraderCommitmentStore, TraderCommitmentSubject } from '../types';

const POSITION_SUBJECT: TraderCommitmentSubject = { type: 'position', id: 'pos_1', symbol: 'AAPL', label: 'AAPL position' };
const PORTFOLIO_SUBJECT: TraderCommitmentSubject = { type: 'portfolio', id: null, symbol: null, label: 'Portfolio' };
const NOW = new Date('2026-07-25T09:00:00.000Z');

describe('createTraderCommitmentId', () => {
  it('produces a stable, unique-looking id per call', () => {
    const a = createTraderCommitmentId(NOW);
    const b = createTraderCommitmentId(NOW);
    expect(a).toMatch(/^commitment_/);
    expect(a).not.toBe(b);
  });
});

describe('createTraderCommitment', () => {
  it('builds a HOLD_UNTIL_DTE commitment with the given target and an honest null note by default', () => {
    const commitment = createTraderCommitment({ kind: 'HOLD_UNTIL_DTE', subject: POSITION_SUBJECT, targetDte: 21 }, NOW);

    expect(commitment.kind).toBe('HOLD_UNTIL_DTE');
    expect(commitment.status).toBe('active');
    expect(commitment.subject).toEqual(POSITION_SUBJECT);
    expect(commitment.note).toBeNull();
    expect(commitment.createdAt).toBe(NOW.toISOString());
    if (commitment.kind === 'HOLD_UNTIL_DTE') {
      expect(commitment.targetDte).toBe(21);
    }
  });

  it('builds a MONITOR commitment against a portfolio-level subject', () => {
    const commitment = createTraderCommitment({ kind: 'MONITOR', subject: PORTFOLIO_SUBJECT }, NOW);
    expect(commitment.kind).toBe('MONITOR');
    expect(commitment.subject).toEqual(PORTFOLIO_SUBJECT);
  });

  it('builds a LET_THETA_WORK commitment', () => {
    const commitment = createTraderCommitment({ kind: 'LET_THETA_WORK', subject: POSITION_SUBJECT }, NOW);
    expect(commitment.kind).toBe('LET_THETA_WORK');
  });

  it('builds a WAIT_FOR_EARNINGS commitment', () => {
    const commitment = createTraderCommitment({ kind: 'WAIT_FOR_EARNINGS', subject: POSITION_SUBJECT }, NOW);
    expect(commitment.kind).toBe('WAIT_FOR_EARNINGS');
  });

  it('builds a GTC_WORKING commitment, honestly carrying a null orderId when not yet known', () => {
    const commitment = createTraderCommitment({ kind: 'GTC_WORKING', subject: POSITION_SUBJECT, orderId: null }, NOW);
    expect(commitment.kind).toBe('GTC_WORKING');
    if (commitment.kind === 'GTC_WORKING') {
      expect(commitment.orderId).toBeNull();
    }
  });

  it('preserves a trader-authored note when supplied', () => {
    const commitment = createTraderCommitment(
      { kind: 'MONITOR', subject: POSITION_SUBJECT, note: 'Watching for a technical breakdown.' },
      NOW,
    );
    expect(commitment.note).toBe('Watching for a technical breakdown.');
  });
});

describe('upsertTraderCommitment / removeTraderCommitment', () => {
  it('upsert adds without mutating the original store', () => {
    const store: TraderCommitmentStore = {};
    const commitment = createTraderCommitment({ kind: 'MONITOR', subject: POSITION_SUBJECT }, NOW);

    const next = upsertTraderCommitment(store, commitment);

    expect(store).toEqual({});
    expect(next[commitment.id]).toEqual(commitment);
  });

  it('upsert replaces an existing entry with the same id', () => {
    const commitment = createTraderCommitment({ kind: 'HOLD_UNTIL_DTE', subject: POSITION_SUBJECT, targetDte: 21 }, NOW);
    const store = upsertTraderCommitment({}, commitment);
    const updated = { ...commitment, note: 'Updated note.' };

    const next = upsertTraderCommitment(store, updated);

    expect(Object.keys(next)).toEqual([commitment.id]);
    expect(next[commitment.id].note).toBe('Updated note.');
  });

  it('remove drops the given id without mutating the original store', () => {
    const commitment = createTraderCommitment({ kind: 'MONITOR', subject: POSITION_SUBJECT }, NOW);
    const store = upsertTraderCommitment({}, commitment);

    const next = removeTraderCommitment(store, commitment.id);

    expect(store[commitment.id]).toBeDefined();
    expect(next[commitment.id]).toBeUndefined();
  });

  it('remove is a no-op (returns the same reference) for an id that is not present', () => {
    const store: TraderCommitmentStore = {};
    expect(removeTraderCommitment(store, 'not_present')).toBe(store);
  });
});

describe('listActiveCommitments / commitmentsForSubject', () => {
  it('lists every commitment in the store', () => {
    const a = createTraderCommitment({ kind: 'MONITOR', subject: POSITION_SUBJECT }, NOW);
    const b = createTraderCommitment({ kind: 'WAIT_FOR_EARNINGS', subject: PORTFOLIO_SUBJECT }, NOW);
    const store = upsertTraderCommitment(upsertTraderCommitment({}, a), b);

    expect(listActiveCommitments(store).map((c) => c.id).sort()).toEqual([a.id, b.id].sort());
  });

  it('filters to only the commitments for a given subject id', () => {
    const forAapl = createTraderCommitment({ kind: 'MONITOR', subject: POSITION_SUBJECT }, NOW);
    const forPortfolio = createTraderCommitment({ kind: 'WAIT_FOR_EARNINGS', subject: PORTFOLIO_SUBJECT }, NOW);
    const store = upsertTraderCommitment(upsertTraderCommitment({}, forAapl), forPortfolio);

    expect(commitmentsForSubject(store, 'pos_1')).toEqual([forAapl]);
    expect(commitmentsForSubject(store, 'nonexistent')).toEqual([]);
  });
});

describe('parseTraderCommitmentStore', () => {
  it('returns an empty store for null/undefined/empty input', () => {
    expect(parseTraderCommitmentStore(null)).toEqual({});
    expect(parseTraderCommitmentStore(undefined)).toEqual({});
    expect(parseTraderCommitmentStore('')).toEqual({});
  });

  it('returns an empty store for invalid JSON, never throwing', () => {
    expect(() => parseTraderCommitmentStore('{not valid json')).not.toThrow();
    expect(parseTraderCommitmentStore('{not valid json')).toEqual({});
  });

  it('returns an empty store for valid JSON that is not a plain object', () => {
    expect(parseTraderCommitmentStore('[1,2,3]')).toEqual({});
    expect(parseTraderCommitmentStore('"a string"')).toEqual({});
  });

  it('round-trips a real store through JSON.stringify/parse', () => {
    const commitment = createTraderCommitment({ kind: 'HOLD_UNTIL_DTE', subject: POSITION_SUBJECT, targetDte: 21 }, NOW);
    const store = upsertTraderCommitment({}, commitment);

    const parsed = parseTraderCommitmentStore(JSON.stringify(store));

    expect(parsed).toEqual(store);
  });

  it('drops only the individually malformed entries in an otherwise-valid store', () => {
    const good = createTraderCommitment({ kind: 'MONITOR', subject: POSITION_SUBJECT }, NOW);
    const raw = JSON.stringify({
      [good.id]: good,
      bad_entry: { kind: 'MONITOR' }, // missing required fields
    });

    const parsed = parseTraderCommitmentStore(raw);

    expect(Object.keys(parsed)).toEqual([good.id]);
  });
});
