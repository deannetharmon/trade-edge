// lib/discovery/__tests__/util.test.ts

import { createHash } from 'crypto';
import { describe, expect, it } from 'vitest';
import { fingerprint, sha256Hex, stableStringify } from '..';

const nodeSha256 = (text: string) => createHash('sha256').update(text, 'utf8').digest('hex');

describe('sha256Hex / fingerprint (Quinn S1: 256-bit identifiers)', () => {
  it('matches the published SHA-256 test vectors', () => {
    expect(sha256Hex('')).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
    expect(sha256Hex('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
    expect(sha256Hex('abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq')).toBe(
      '248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1',
    );
  });

  it('agrees with Node\'s implementation across every padding boundary', () => {
    for (let length = 0; length <= 200; length += 1) {
      const text = 'x'.repeat(length);
      expect(sha256Hex(text)).toBe(nodeSha256(text));
    }
    const long = 'The quick brown fox jumps over the lazy dog. '.repeat(500);
    expect(sha256Hex(long)).toBe(nodeSha256(long));
  });

  it('hashes non-ASCII text, including surrogate pairs, exactly as UTF-8', () => {
    ['café', '日本語', 'emoji \u{1F600} pair'].forEach((text) => {
      expect(sha256Hex(text)).toBe(nodeSha256(text));
    });
  });

  it('fingerprint is 256 bits (64 hex characters) and deterministic', () => {
    const value = fingerprint('{"a":1}');
    expect(value).toMatch(/^[0-9a-f]{64}$/);
    expect(fingerprint('{"a":1}')).toBe(value);
    expect(fingerprint('{"a":2}')).not.toBe(value);
  });
});

describe('stableStringify', () => {
  it('sorts keys, omits undefined properties and is order-independent', () => {
    expect(stableStringify({ b: 1, a: { d: undefined, c: [3, undefined] } })).toBe('{"a":{"c":[3,null]},"b":1}');
    expect(stableStringify({ a: 1, b: 2 })).toBe(stableStringify({ b: 2, a: 1 }));
  });

  it('refuses values that cannot be serialized deterministically', () => {
    expect(() => stableStringify({ a: NaN })).toThrow(/non-finite/);
    expect(() => stableStringify({ a: () => 1 })).toThrow(/unsupported/);
  });
});
