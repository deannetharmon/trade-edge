// lib/ai-policy/__tests__/artifactCrypto.test.ts
import { describe, expect, it } from 'vitest';
import { ArtifactCryptoError, decryptText, encryptText, hasArtifactKey, openJson, resolveKeys, sealJson } from '../artifactCrypto';
import { TEST_KEY_HEX, TEST_KEY_PREVIOUS_HEX } from '../fixtures/testRoute';

const ENV = { AI_POLICY_ARTIFACT_KEY: TEST_KEY_HEX };

describe('artifact crypto', () => {
  it('round-trips and produces a fresh iv each time', () => {
    const a = encryptText('hello', ENV);
    const b = encryptText('hello', ENV);
    expect(decryptText(a, ENV)).toBe('hello');
    expect(a.iv).not.toBe(b.iv);
    expect(a.data).not.toBe(b.data);
  });

  it('kid is the first 8 hex of SHA-256(key)', () => {
    expect(resolveKeys(ENV).current?.kid).toMatch(/^[0-9a-f]{8}$/);
    expect(encryptText('x', ENV).kid).toBe(resolveKeys(ENV).current?.kid);
  });

  it('fails closed when no valid key is configured', () => {
    expect(hasArtifactKey({})).toBe(false);
    expect(hasArtifactKey({ AI_POLICY_ARTIFACT_KEY: 'short' })).toBe(false);
    expect(() => encryptText('x', {})).toThrow(ArtifactCryptoError);
  });

  it('a wrong key fails to decrypt', () => {
    const sealed = encryptText('secret', ENV);
    expect(() => decryptText(sealed, { AI_POLICY_ARTIFACT_KEY: TEST_KEY_PREVIOUS_HEX })).toThrow(ArtifactCryptoError);
  });

  it('_PREVIOUS decrypts data written under the old key after rotation', () => {
    const old = encryptText('old data', ENV);
    const rotated = { AI_POLICY_ARTIFACT_KEY: TEST_KEY_PREVIOUS_HEX, AI_POLICY_ARTIFACT_KEY_PREVIOUS: TEST_KEY_HEX };
    expect(decryptText(old, rotated)).toBe('old data');
    expect(encryptText('new', rotated).kid).not.toBe(old.kid);
  });

  it('tampering is detected', () => {
    const sealed = encryptText('secret', ENV);
    const flipped = { ...sealed, data: (sealed.data[0] === '0' ? '1' : '0') + sealed.data.slice(1) };
    expect(() => decryptText(flipped, ENV)).toThrow(ArtifactCryptoError);
  });

  it('AAD binds a ciphertext to its owner', () => {
    const sealed = sealJson({ a: 1 }, ENV, 'artifact|user-a|id-1');
    expect(openJson(sealed, ENV, 'artifact|user-a|id-1')).toEqual({ a: 1 });
    expect(() => openJson(sealed, ENV, 'artifact|user-b|id-1')).toThrow(ArtifactCryptoError);
    expect(() => openJson(sealed, ENV)).toThrow(ArtifactCryptoError);
  });

  it('rejects malformed envelopes', () => {
    expect(() => openJson('not json', ENV)).toThrow(ArtifactCryptoError);
    expect(() => openJson('{"kid":1}', ENV)).toThrow(ArtifactCryptoError);
  });

  it('reads the key lazily: importing the module needs no key', () => {
    expect(resolveKeys({}).current).toBeNull();
  });
});
