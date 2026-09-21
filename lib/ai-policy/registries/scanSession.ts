// lib/ai-policy/registries/scanSession.ts
//
// Citable-field registry for the frozen scan-session snapshot (routes scan_summary and grounded_chat). Pure data: it
// imports nothing from scan or screener code, so the boundary between AI and deterministic modules stays one-directional.
// The builder (builders/attested/scanSession.ts) fills payloads FROM these tables, so the payload and the registry cannot
// drift apart. Every leaf a payload may contain is listed here and nothing else can be stored.
//
// DRAFT: the field list needs Ian's approval and the labels Diane's before any route is enabled. Labels are user-visible
// (0001C). Numeric fields are shown as raw numbers because the scan does not record whether a ratio is a fraction or a
// percent; units are not guessed here.

import type { CitableField, CitableFormat } from '../types';

export interface FieldDef {
  key: string;
  label: string;
  format: CitableFormat;
}

/** Everything is scanCalculation: the client-attested snapshot carries one as-of time, the scan's completion. */
const SOURCE = 'scanCalculation' as const;

export const SCAN_FIELDS: readonly FieldDef[] = [
  { key: 'strategy', label: 'Scan strategy', format: 'text' },
  { key: 'mode', label: 'Scan mode', format: 'text' },
  { key: 'symbolsSelected', label: 'Symbols selected', format: 'integer' },
  { key: 'symbolsPlanned', label: 'Symbols planned for scanning', format: 'integer' },
  { key: 'symbolsEvaluated', label: 'Symbols evaluated', format: 'integer' },
  { key: 'symbolsFailed', label: 'Symbols that failed', format: 'integer' },
  { key: 'symbolsSkipped', label: 'Symbols skipped', format: 'integer' },
  { key: 'candidatesFound', label: 'Candidates found', format: 'integer' },
  { key: 'candidatesPassedRules', label: 'Candidates that passed the scan rules', format: 'integer' },
  { key: 'candidatesFailedRules', label: 'Candidates that did not pass the scan rules', format: 'integer' },
  { key: 'candidateRowsIncluded', label: 'Candidate rows included in this snapshot', format: 'integer' },
  { key: 'candidateRowsOmitted', label: 'Candidate rows omitted from this snapshot', format: 'integer' },
];

export const FILTER_FIELDS: readonly FieldDef[] = [
  { key: 'preset', label: 'Rule preset', format: 'text' },
  { key: 'ivrMin', label: 'Minimum IV rank', format: 'number' },
  { key: 'ivrMax', label: 'Maximum IV rank', format: 'number' },
  { key: 'deltaMin', label: 'Minimum delta', format: 'number' },
  { key: 'deltaMax', label: 'Maximum delta', format: 'number' },
  { key: 'dteMin', label: 'Minimum days to expiration', format: 'integer' },
  { key: 'dteMax', label: 'Maximum days to expiration', format: 'integer' },
  { key: 'oiMin', label: 'Minimum open interest', format: 'integer' },
  { key: 'bidAskMax', label: 'Maximum bid-ask spread', format: 'number' },
  { key: 'popMin', label: 'Minimum probability of profit', format: 'number' },
  { key: 'otmMin', label: 'Minimum out-of-the-money distance', format: 'number' },
  { key: 'rocMin', label: 'Minimum return on capital', format: 'number' },
  { key: 'minimumCreditRatio', label: 'Minimum credit ratio', format: 'number' },
  { key: 'creditRatioOverride', label: 'Credit ratio overridden', format: 'boolean' },
];

export const OUTCOME_FIELDS: readonly FieldDef[] = [
  { key: 'symbol', label: 'Symbol', format: 'text' },
  { key: 'status', label: 'Scan outcome', format: 'text' },
  { key: 'reasonCode', label: 'Reason code', format: 'text' },
  { key: 'reasonLabel', label: 'Reason', format: 'text' },
  { key: 'candidateCount', label: 'Candidates for this symbol', format: 'integer' },
];

/** Where a candidate field is read from in a scan result: the result itself, its best candidate, or its PMCC decision. */
export type CandidateSource = 'result' | 'candidate' | 'pmccDecision';
export interface CandidateFieldDef extends FieldDef {
  from: CandidateSource;
  /** Property name on the source object (defaults to `key`). */
  prop?: string;
}

export const CANDIDATE_FIELDS: readonly CandidateFieldDef[] = [
  { key: 'symbol', label: 'Symbol', format: 'text', from: 'result' },
  { key: 'strategy', label: 'Strategy', format: 'text', from: 'result' },
  { key: 'price', label: 'Underlying price', format: 'usd', from: 'result' },
  { key: 'ivr', label: 'IV rank', format: 'number', from: 'result' },
  { key: 'earningsDate', label: 'Next earnings date', format: 'date', from: 'result' },
  { key: 'passedRules', label: 'Passed the scan rules', format: 'boolean', from: 'result', prop: 'qualified' },
  { key: 'pmccQualification', label: 'PMCC qualification', format: 'text', from: 'pmccDecision', prop: 'qualification' },
  { key: 'pmccReadiness', label: 'PMCC readiness', format: 'text', from: 'pmccDecision', prop: 'readiness' },
  { key: 'expiration', label: 'Expiration', format: 'date', from: 'candidate' },
  { key: 'dte', label: 'Days to expiration', format: 'integer', from: 'candidate' },
  { key: 'shortStrike', label: 'Short strike', format: 'usd', from: 'candidate' },
  { key: 'longStrike', label: 'Long strike', format: 'usd', from: 'candidate' },
  { key: 'shortDelta', label: 'Short delta', format: 'number', from: 'candidate' },
  { key: 'credit', label: 'Credit per share', format: 'usd', from: 'candidate' },
  { key: 'creditRatio', label: 'Credit ratio', format: 'number', from: 'candidate' },
  { key: 'roc', label: 'Return on capital', format: 'number', from: 'candidate' },
  { key: 'annualizedRoc', label: 'Annualized return on capital', format: 'number', from: 'candidate' },
  { key: 'pop', label: 'Probability of profit', format: 'number', from: 'candidate' },
  { key: 'capitalRequired', label: 'Capital required', format: 'usd', from: 'candidate' },
  { key: 'requiredCash', label: 'Cash required', format: 'usd', from: 'candidate' },
  { key: 'breakeven', label: 'Breakeven price', format: 'usd', from: 'candidate' },
  { key: 'longExpiration', label: 'Long leg expiration', format: 'date', from: 'candidate' },
  { key: 'longDte', label: 'Long leg days to expiration', format: 'integer', from: 'candidate' },
  { key: 'longDelta', label: 'Long leg delta', format: 'number', from: 'candidate' },
  { key: 'netDebit', label: 'Net debit per share', format: 'usd', from: 'candidate' },
  { key: 'maxProfit', label: 'Maximum profit', format: 'usd', from: 'candidate' },
];

const toFields = (base: string, defs: readonly FieldDef[]): CitableField[] =>
  defs.map((d) => ({ pattern: `${base}/${d.key}`, label: d.label, source: SOURCE, format: d.format }));

export const SCAN_REGISTRY: readonly CitableField[] = [
  ...toFields('/scan', SCAN_FIELDS),
  ...toFields('/filters', FILTER_FIELDS),
  ...toFields('/outcomes/*', OUTCOME_FIELDS),
  ...toFields('/candidates/*', CANDIDATE_FIELDS),
];

/** Bounds. The candidate-row cap N is per the ticket (proposed 25); outcomes are all included up to a hard limit. */
export const MAX_CANDIDATE_ROWS = 25;
export const MAX_OUTCOME_ROWS = 200;
