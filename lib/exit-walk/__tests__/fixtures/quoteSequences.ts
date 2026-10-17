// lib/exit-walk/__tests__/fixtures/quoteSequences.ts
//
// EXIT-WALK-0001A: immutable, timestamped NBBO quote sequences (integer cents) for the Oct 17, 2026 snapshot positions.
// Re-anchoring cannot be tested from one static snapshot, so each position has a calm and a mid-move sequence.
// Quotes marked "implied" are derived from the snapshot's mid and bid/ask, not read from the broker; the exact quotes replace
// them when the Oct 17 export is attached (S2). Oct 19, 2026 is EDT (-04:00).

import type { Quote } from '@/lib/exit-walk/types';

const freeze = (q: Quote[]): ReadonlyArray<Readonly<Quote>> => Object.freeze(q.map(x => Object.freeze({ ...x })));

/** MRNA Nov 20 2026 $140 put, sell to close. Snapshot: bid 2.08, mid 2.54, so ask 3.00 (implied). Step is 9c. */
export const MRNA_CALM = freeze([
  { t: '2026-10-19T10:30:00-04:00', bid_c: 208, ask_c: 300 },
  { t: '2026-10-19T10:31:30-04:00', bid_c: 209, ask_c: 301 }, // mid 255: moved 1c
  { t: '2026-10-19T10:33:00-04:00', bid_c: 208, ask_c: 302 }, // mid 255
]);

export const MRNA_MID_MOVE = freeze([
  { t: '2026-10-19T10:30:00-04:00', bid_c: 208, ask_c: 300 }, // mid 254
  { t: '2026-10-19T10:31:30-04:00', bid_c: 218, ask_c: 310 }, // mid 264: up 10c, more than one step (9c)
  { t: '2026-10-19T10:33:00-04:00', bid_c: 195, ask_c: 285 }, // mid 240: down 24c
]);

/** TQQQ Nov 6 2026 $75.50 put, buy to close. Snapshot: ask 9.50, mid 8.90, so bid 8.30 (implied). Step is 12c at a 1c tick. */
export const TQQQ_CALM = freeze([
  { t: '2026-10-19T10:30:00-04:00', bid_c: 830, ask_c: 950 },
  { t: '2026-10-19T10:31:30-04:00', bid_c: 831, ask_c: 951 }, // mid 891
  { t: '2026-10-19T10:33:00-04:00', bid_c: 832, ask_c: 952 }, // mid 892
]);

export const TQQQ_MID_MOVE = freeze([
  { t: '2026-10-19T10:30:00-04:00', bid_c: 830, ask_c: 950 }, // mid 890
  { t: '2026-10-19T10:31:30-04:00', bid_c: 845, ask_c: 965 }, // mid 905: up 15c, more than one step (12c)
  { t: '2026-10-19T10:33:00-04:00', bid_c: 810, ask_c: 930 }, // mid 870: down 35c
]);

/** A quote that goes stale: the last quote is older than the 60 second default at the evaluation instant. */
export const MRNA_STALE_GAP = freeze([
  { t: '2026-10-19T10:30:00-04:00', bid_c: 208, ask_c: 300 },
  { t: '2026-10-19T10:30:10-04:00', bid_c: 208, ask_c: 300 },
]);

/** Walk-schedule goldens (Alan, Oct 17), 50% slippage, default 10% step. */
export const MRNA_GOLDEN_1C = [254, 245, 236, 227, 218, 209, 208] as const;
export const TQQQ_GOLDEN_1C = [890, 902, 914, 926, 938, 950] as const;
export const TQQQ_GOLDEN_5C = [890, 900, 910, 920, 930, 940, 950] as const;
