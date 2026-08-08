// lib/scans/candidateIdentity.ts
// CSP-WORKFLOW-0001 — canonical, stable candidate identity.
//
// Every discovered option contract (CSP today; usable by any future
// single-leg-or-multi-leg strategy that adopts the same pattern) needs one
// stable identity string usable consistently across search results, session
// results, React keys, Best Opportunities, recommendations, auxiliary
// caches, CSV rows, and accessibility labels — see
// docs/reviews/FIND-CSP-Comprehensive-Code-Audit.md §22.1 for the audited
// requirement this module implements.
//
// Primary identity: a valid OCC-shaped option symbol whose PARSED FIELDS
// actually match the candidate it claims to identify (underlying,
// expiration, option type, strike) — never accepted on shape/length alone.
// Validated fallback: strategy + underlying symbol + expiration + option
// type + strike, when the OCC symbol is missing or fails validation.
//
// CSP-WORKFLOW-0001 core-correction pass (final identity correction):
// parsing is delegated entirely to lib/optionSymbol.ts's parseOccSymbol —
// the one canonical OCC parser in this codebase. This module does not
// implement (or compete with) a second parser; it only decides, from the
// parsed result, whether the symbol is trustworthy enough to serve as
// primary identity for a specific candidate.
//
// Deliberately pure and framework-free — no I/O, no React — so it is
// trivially unit-testable and safe to call from search, presentation, CSV,
// and cache code alike without re-deriving the rule differently in each
// place.

import { parseOccSymbol } from '@/lib/optionSymbol';

export type CandidateOptionType = 'put' | 'call';

export interface CandidateIdentityInput {
  occSymbol?: string | null;
  strategy: string;
  underlyingSymbol: string;
  expiration: string; // YYYY-MM-DD
  optionType: CandidateOptionType;
  strike: number;
}

// OCC strikes are encoded as 8 digits of dollars-and-thousandths
// (strikeDigits / 1000 in parseOccSymbol). That division can leave the
// parsed value a hair off an exact decimal (binary floating point cannot
// represent every thousandth exactly), so strike equality is checked with
// a tolerance of half the smallest representable OCC increment ($0.001) —
// tight enough that two genuinely different strikes ($415 vs $415.50)
// never compare equal, but loose enough that floating-point noise from the
// /1000 division never causes a false rejection of a real match.
const OCC_STRIKE_EPSILON = 0.0005;

function strikesMatch(parsedStrike: number, candidateStrike: number): boolean {
  return Math.abs(parsedStrike - candidateStrike) < OCC_STRIKE_EPSILON;
}

// Normalizes a candidate's underlying symbol the same way parseOccSymbol
// normalizes the OCC root: trimmed and upper-cased. Used so "amd " and
// "AMD" are recognized as the same underlying when matching a parsed OCC
// symbol against the candidate it was attached to.
function normalizeUnderlying(symbol: string): string {
  return symbol.trim().toUpperCase();
}

// True only when `occSymbol` parses as a structurally valid OCC symbol
// (via the single canonical parser, parseOccSymbol) AND every parsed field
// — option type, underlying, expiration, strike — matches the candidate it
// is being validated against. A symbol that merely "looks plausible" (any
// string ≥ 6 characters, the prior policy) is never accepted; a symbol
// that parses cleanly but describes a *different* contract than the
// candidate (wrong strike, wrong expiration, a call supplied for a CSP,
// etc.) is also rejected, never silently used.
export function isOccSymbolMatch(
  occSymbol: string | null | undefined,
  candidate: Omit<CandidateIdentityInput, 'occSymbol'>,
): occSymbol is string {
  if (occSymbol == null || typeof occSymbol !== 'string') return false;
  if (occSymbol.trim().length === 0) return false;

  const parsed = parseOccSymbol(occSymbol);
  if (
    parsed.underlyingSymbol == null ||
    parsed.optionType == null ||
    parsed.strikePrice == null ||
    parsed.expiry == null
  ) {
    return false; // malformed OCC symbol -- never a valid primary identity
  }

  const expectedOptionType = candidate.optionType === 'put' ? 'P' : 'C';
  if (parsed.optionType !== expectedOptionType) return false; // e.g. a call OCC symbol supplied for a CSP (put) candidate

  if (parsed.underlyingSymbol !== normalizeUnderlying(candidate.underlyingSymbol)) return false;

  if (parsed.expiry !== candidate.expiration) return false;

  if (!strikesMatch(parsed.strikePrice, candidate.strike)) return false;

  return true;
}

// Canonicalizes a raw OCC symbol string exactly the way parseOccSymbol
// does internally (strip all whitespace, upper-case) so that insignificant
// broker-formatting differences -- e.g. "amd240119p00415000" vs
// "AMD 240119 P 00415000" -- for the SAME contract always produce the SAME
// candidateId. Only ever called after isOccSymbolMatch has already
// confirmed the symbol parses and matches the candidate, so this never
// needs to re-validate.
function canonicalizeOccSymbol(occSymbol: string): string {
  return occSymbol.replace(/\s+/g, '').toUpperCase();
}

// Deterministic composite fallback identity. Stable across repeated scans
// of the same contract (no timestamps, no random component) so the same
// contract restored from cache, re-scanned, or re-ranked always produces
// the same candidateId.
export function buildCompositeIdentity(input: Omit<CandidateIdentityInput, 'occSymbol'>): string {
  const typeCode = input.optionType === 'put' ? 'P' : 'C';
  return `composite:${input.strategy}:${normalizeUnderlying(input.underlyingSymbol)}:${input.expiration}:${typeCode}:${input.strike}`;
}

// The single canonical entry point every caller should use. A matching,
// well-formed OCC symbol is used first (canonicalized so whitespace/casing
// differences can't fork identity for the same contract); the validated
// composite fallback is used otherwise. Never discards the candidate for
// having a malformed or mismatched OCC symbol -- it always falls through
// to the deterministic composite identity instead.
export function buildCandidateId(input: CandidateIdentityInput): string {
  const { occSymbol, ...candidate } = input;
  if (isOccSymbolMatch(occSymbol, candidate)) {
    return `occ:${canonicalizeOccSymbol(occSymbol)}`;
  }
  return buildCompositeIdentity(candidate);
}
