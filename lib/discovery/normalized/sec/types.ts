// lib/discovery/normalized/sec/types.ts

// LEAPS-QV-0001 Gate 2b -- shapes of SEC EDGAR XBRL "companyfacts" JSON (data.sec.gov/api/xbrl/companyfacts) and of
// the compact, validated fact list this layer works with. Pure data; no I/O here.
// Verified against the live structure: each fact has start (durations only), end, val, accn, fy, fp, form, filed and
// optionally frame. NOTE: fy/fp describe the FILING's fiscal period, not the fact's, and the same fact is repeated in
// every later filing that shows it as a comparative -- so they are never used to place a fact in time.

export interface SecFactRaw {
  readonly start?: string;
  readonly end?: string;
  readonly val?: unknown;
  readonly accn?: string;
  readonly fy?: number | null;
  readonly fp?: string | null;
  readonly form?: string;
  readonly filed?: string;
  readonly frame?: string;
}

export interface SecConceptRaw {
  readonly label?: string;
  readonly units?: Readonly<Record<string, readonly SecFactRaw[]>>;
}

export interface SecCompanyFactsRaw {
  readonly cik?: number | string;
  readonly entityName?: string;
  readonly facts?: Readonly<Record<string, Readonly<Record<string, SecConceptRaw>>>>;
}

/** One validated fact. `start` is null for instant (balance-sheet / cover-page) facts. */
export interface SecFact {
  readonly taxonomy: string;
  readonly tag: string;
  readonly unit: string;
  readonly start: string | null;
  readonly end: string;
  readonly val: number;
  readonly accn: string;
  readonly form: string;
  readonly filed: string;
}

export interface CompactFacts {
  /** Version of the concept map the facts were filtered with (a different map invalidates cached compact facts). */
  readonly conceptMapVersion: string;
  readonly cik: string;
  readonly entityName: string | null;
  readonly facts: readonly SecFact[];
  /** Raw facts discarded during compaction, by reason (observability; never silently repaired). */
  readonly dropped: Readonly<Record<string, number>>;
}

export interface SecSubmissionsInfo {
  readonly sic: string | null;
  readonly sicDescription: string | null;
  /** ISO time the submissions payload was fetched. */
  readonly fetchedAt: string;
}

export type SecItemStatusKind = 'OK' | 'MISSING' | 'AMBIGUOUS' | 'INCONSISTENT' | 'INVALID';

export interface SecItemStatus {
  readonly status: SecItemStatusKind;
  readonly reason: string;
}

/** Where a number came from (Gate 2b: "explain where every fundamental metric came from"). */
export interface SecProvenance {
  readonly item: string;
  readonly role: string;
  readonly tag: string;
  readonly unit: string;
  readonly start: string | null;
  readonly end: string;
  readonly value: number;
  readonly accn: string;
  readonly form: string;
  readonly filed: string;
  /** True when the same period appears in several filings with different values (the latest filing was used). */
  readonly restated: boolean;
}
