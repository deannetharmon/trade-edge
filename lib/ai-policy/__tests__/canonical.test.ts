// lib/ai-policy/__tests__/canonical.test.ts
import { describe, expect, it } from 'vitest';
import { CanonicalError, canonicalHash, canonicalize, compareCodePoints, sha256Hex } from '../canonical';

describe('canonical JSON', () => {
  it('is independent of key order', () => {
    expect(canonicalize({ b: 1, a: 2 })).toBe(canonicalize({ a: 2, b: 1 }));
    expect(canonicalHash({ a: { y: 1, x: 2 } })).toBe(canonicalHash({ a: { x: 2, y: 1 } }));
  });

  it('sorts keys by code point, not UTF-16 code unit', () => {
    // U+FF5E (BMP) sorts BEFORE U+1F600 (astral) by code point; UTF-16 unit order would put the astral key first.
    expect(canonicalize({ '😀': 1, '～': 2 })).toBe('{"～":2,"😀":1}');
    expect(compareCodePoints('～', '😀')).toBe(-1);
    expect(compareCodePoints('a', 'a')).toBe(0);
    expect(compareCodePoints('a', 'ab')).toBe(-1);
  });

  it('matches golden hash vectors computed independently with sha256sum semantics', () => {
    expect(canonicalHash({ b: [1, 2, { c: 'x' }], a: 1 })).toBe('b1cbb9c0e5bf13762ba45b91fdde3aae760ead3bfbda365b5c412ae55478120a');
    expect(canonicalHash({ z: 1, a: 2 })).toBe('c2985c5ba6f7d2a55e768f92490ca09388e95bc4cccb9fdf11b15f4d42f93e73');
    expect(canonicalHash({ '😀': 1, '～': 2 })).toBe('676eced5da6311f3e768f35d0921b3e2759791654ea8e5adb3b281c6f405776d');
    expect(canonicalHash(null)).toBe('74234e98afe7498fb5daf1f36ac2d78acc339464f950703b8c019892f982b90b');
    expect(sha256Hex('[]')).toBe('4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945');
  });

  it.each([
    ['NaN', { a: NaN }],
    ['Infinity', { a: Infinity }],
    ['-Infinity', [-Infinity]],
    ['undefined', { a: undefined }],
    ['function', { a: () => 1 }],
    ['symbol', { a: Symbol('x') }],
    ['bigint', { a: BigInt(1) }],
    ['Date', { a: new Date() }],
    ['sparse array', [1, , 3]], // eslint-disable-line no-sparse-arrays
  ])('rejects %s', (_name, value) => {
    expect(() => canonicalize(value)).toThrow(CanonicalError);
  });

  it('rejects excessive depth', () => {
    let deep: unknown = 1;
    for (let i = 0; i < 80; i += 1) deep = { a: deep };
    expect(() => canonicalize(deep)).toThrow(CanonicalError);
  });
});
