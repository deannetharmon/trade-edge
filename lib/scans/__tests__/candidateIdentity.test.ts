// lib/scans/__tests__/candidateIdentity.test.ts
// CSP-WORKFLOW-0001 core-correction (final candidate-identity correction) --
// pure tests for the canonical candidate-identity module
// (lib/scans/candidateIdentity.ts). No I/O, no React; every assertion is on
// the exported functions' return values directly.
//
// The module now delegates all OCC parsing to lib/optionSymbol.ts's
// parseOccSymbol (the one canonical parser in this codebase) and accepts an
// OCC symbol as primary identity ONLY when its parsed fields (option type,
// underlying, expiration, strike) actually match the candidate it is
// attached to -- never on shape/length alone.

import { describe, it, expect } from 'vitest';
import { isOccSymbolMatch, buildCompositeIdentity, buildCandidateId } from '../candidateIdentity';

const amdPut415 = {
  strategy: 'CSP',
  underlyingSymbol: 'AMD',
  expiration: '2026-01-19',
  optionType: 'put' as const,
  strike: 415,
};

describe('isOccSymbolMatch', () => {
  it('accepts a valid, compact OCC put symbol that matches the candidate exactly', () => {
    expect(isOccSymbolMatch('AMD260119P00415000', amdPut415)).toBe(true);
  });

  it('accepts a valid OCC symbol containing broker-style whitespace', () => {
    expect(isOccSymbolMatch('AMD 260119 P 00415000', amdPut415)).toBe(true);
  });

  it('rejects an OCC symbol whose underlying does not match the candidate', () => {
    expect(isOccSymbolMatch('NKE260119P00415000', amdPut415)).toBe(false);
  });

  it('rejects an OCC symbol whose expiration does not match the candidate', () => {
    expect(isOccSymbolMatch('AMD260220P00415000', amdPut415)).toBe(false); // Feb 2026, candidate is Jan 2026
  });

  it('rejects an OCC symbol whose strike does not match the candidate', () => {
    expect(isOccSymbolMatch('AMD260119P00420000', amdPut415)).toBe(false); // 420 strike, candidate is 415
  });

  it('rejects a call OCC symbol supplied for a CSP (put) candidate', () => {
    expect(isOccSymbolMatch('AMD260119C00415000', amdPut415)).toBe(false);
  });

  it('rejects a malformed OCC symbol (fails to parse at all)', () => {
    expect(isOccSymbolMatch('not-an-occ-symbol', amdPut415)).toBe(false);
    expect(isOccSymbolMatch('AMD_260119_P415_0', amdPut415)).toBe(false); // legacy synthetic shape, not real OCC
  });

  it('rejects a missing OCC symbol (null/undefined/empty)', () => {
    expect(isOccSymbolMatch(null, amdPut415)).toBe(false);
    expect(isOccSymbolMatch(undefined, amdPut415)).toBe(false);
    expect(isOccSymbolMatch('', amdPut415)).toBe(false);
    expect(isOccSymbolMatch('   ', amdPut415)).toBe(false);
  });

  it('rejects a synthetic test-fixture symbol merely because it is long enough -- length/shape alone is never sufficient', () => {
    // This is exactly the shape used by this codebase's own synthetic test
    // chains (e.g. `AMD_2026-01-19_P415_0`) -- 20+ characters, "plausible"
    // under the old length>=6 policy, but not a real OCC symbol and must
    // never be trusted as primary identity.
    expect(isOccSymbolMatch('AMD_2026-01-19_P415_0', amdPut415)).toBe(false);
  });

  it('treats the same valid contract as a match regardless of insignificant formatting differences (whitespace, casing)', () => {
    const compact = isOccSymbolMatch('AMD260119P00415000', amdPut415);
    const spaced = isOccSymbolMatch('amd 260119 p 00415000', amdPut415);
    expect(compact).toBe(true);
    expect(spaced).toBe(true);
  });
});

describe('buildCompositeIdentity', () => {
  it('is deterministic and stable across repeated calls with the same input', () => {
    const input = { strategy: 'CSP', underlyingSymbol: 'AMD', expiration: '2026-01-19', optionType: 'put' as const, strike: 415 };
    expect(buildCompositeIdentity(input)).toBe(buildCompositeIdentity(input));
  });

  it('encodes strategy/underlying/expiration/type/strike distinctly', () => {
    const id = buildCompositeIdentity({ strategy: 'CSP', underlyingSymbol: 'AMD', expiration: '2026-01-19', optionType: 'put', strike: 415 });
    expect(id).toBe('composite:CSP:AMD:2026-01-19:P:415');
  });

  it('uses "C" for calls, distinguishing option type in the identity', () => {
    const put = buildCompositeIdentity({ strategy: 'CSP', underlyingSymbol: 'AMD', expiration: '2026-01-19', optionType: 'put', strike: 415 });
    const call = buildCompositeIdentity({ strategy: 'CSP', underlyingSymbol: 'AMD', expiration: '2026-01-19', optionType: 'call', strike: 415 });
    expect(put).not.toBe(call);
  });
});

describe('buildCandidateId -- identity fixtures required by CSP-WORKFLOW-0001', () => {
  it('prefers a matching, valid OCC symbol as the primary identity, canonicalized (compact, upper-case, no whitespace)', () => {
    const id = buildCandidateId({ ...amdPut415, occSymbol: 'AMD260119P00415000' });
    expect(id).toBe('occ:AMD260119P00415000');
  });

  it('same valid contract, formatted with broker-style whitespace and lower-case, produces the SAME candidateId as the compact form (canonicalization)', () => {
    const compact = buildCandidateId({ ...amdPut415, occSymbol: 'AMD260119P00415000' });
    const spaced = buildCandidateId({ ...amdPut415, occSymbol: 'amd 260119 p 00415000' });
    expect(spaced).toBe(compact);
    expect(spaced).toBe('occ:AMD260119P00415000');
  });

  it('falls back to the validated composite identity when occSymbol is missing', () => {
    const id = buildCandidateId({ ...amdPut415, occSymbol: null });
    expect(id).toBe('composite:CSP:AMD:2026-01-19:P:415');
  });

  it('falls back to the validated composite identity when occSymbol is structurally malformed -- never discards the candidate', () => {
    const id = buildCandidateId({ ...amdPut415, occSymbol: 'AMD_undefined_P415' });
    expect(id).toBe('composite:CSP:AMD:2026-01-19:P:415');
  });

  it('falls back to the validated composite identity when occSymbol parses but describes a different contract (wrong strike) -- never discards the candidate', () => {
    const id = buildCandidateId({ ...amdPut415, occSymbol: 'AMD260119P00420000' });
    expect(id).toBe('composite:CSP:AMD:2026-01-19:P:415');
  });

  it('falls back to the validated composite identity for a synthetic test-fixture symbol, never accepted merely for its length', () => {
    const id = buildCandidateId({ ...amdPut415, occSymbol: 'AMD_2026-01-19_P415_0' });
    expect(id).toBe('composite:CSP:AMD:2026-01-19:P:415');
  });

  it('composite fallback is stable/deterministic across repeated calls -- required for cache restoration to match a live re-scan', () => {
    const first = buildCandidateId({ ...amdPut415, occSymbol: null });
    const second = buildCandidateId({ ...amdPut415, occSymbol: null });
    expect(first).toBe(second);
  });

  it('two distinct strikes never collide (no OCC symbol available -- composite fallback)', () => {
    const a = buildCandidateId({ ...amdPut415, occSymbol: null, strike: 415 });
    const b = buildCandidateId({ ...amdPut415, occSymbol: null, strike: 420 });
    expect(a).not.toBe(b);
  });

  it('the same strike with different expirations never collide (composite fallback)', () => {
    const a = buildCandidateId({ ...amdPut415, occSymbol: null, expiration: '2026-01-19' });
    const b = buildCandidateId({ ...amdPut415, occSymbol: null, expiration: '2026-02-20' });
    expect(a).not.toBe(b);
  });

  it('two structurally distinct contracts with valid, distinct, matching OCC symbols never collide', () => {
    const a = buildCandidateId({ ...amdPut415, strike: 415, occSymbol: 'AMD260119P00415000' });
    const b = buildCandidateId({ ...amdPut415, strike: 420, occSymbol: 'AMD260119P00420000' });
    expect(a).not.toBe(b);
  });
});
