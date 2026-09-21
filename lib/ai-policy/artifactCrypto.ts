// lib/ai-policy/artifactCrypto.ts
//
// AES-256-GCM envelope {kid, iv, tag, data} for AI inputs and artifacts. Keys come from AI_POLICY_ARTIFACT_KEY (current)
// and AI_POLICY_ARTIFACT_KEY_PREVIOUS (rotation), resolved lazily on every call (never at import). `kid` is the first
// 8 hex characters of SHA-256(key). Fails closed if no current key is configured. An optional AAD binds a ciphertext to
// its owner (userId + record id) so a record copied to another key cannot be decrypted.
// lib/crypto.ts is intentionally untouched: it reads its key at import and has no key id.

import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'crypto';
import type { Env } from './types';

export interface Envelope {
  kid: string;
  iv: string;
  tag: string;
  data: string;
}

export class ArtifactCryptoError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ArtifactCryptoError';
  }
}

interface KeyEntry {
  kid: string;
  key: Buffer;
}

function parseKey(hex: string | undefined): KeyEntry | null {
  if (!hex || !/^[0-9a-fA-F]{64}$/.test(hex)) return null;
  const key = Buffer.from(hex, 'hex');
  return { kid: createHash('sha256').update(key).digest('hex').slice(0, 8), key };
}

export function resolveKeys(env: Env = process.env): { current: KeyEntry | null; previous: KeyEntry | null } {
  return { current: parseKey(env.AI_POLICY_ARTIFACT_KEY), previous: parseKey(env.AI_POLICY_ARTIFACT_KEY_PREVIOUS) };
}

export function hasArtifactKey(env: Env = process.env): boolean {
  return resolveKeys(env).current != null;
}

export function encryptText(plaintext: string, env: Env = process.env, aad?: string): Envelope {
  const { current } = resolveKeys(env);
  if (!current) throw new ArtifactCryptoError('AI_POLICY_ARTIFACT_KEY is not configured');
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', current.key, iv);
  if (aad) cipher.setAAD(Buffer.from(aad, 'utf8'));
  const data = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  return { kid: current.kid, iv: iv.toString('hex'), tag: cipher.getAuthTag().toString('hex'), data: data.toString('hex') };
}

export function decryptText(envelope: Envelope, env: Env = process.env, aad?: string): string {
  const { current, previous } = resolveKeys(env);
  const entry = [current, previous].find((k) => k != null && k.kid === envelope.kid);
  if (!entry) throw new ArtifactCryptoError('No key for this envelope');
  try {
    const decipher = createDecipheriv('aes-256-gcm', entry.key, Buffer.from(envelope.iv, 'hex'));
    if (aad) decipher.setAAD(Buffer.from(aad, 'utf8'));
    decipher.setAuthTag(Buffer.from(envelope.tag, 'hex'));
    return Buffer.concat([decipher.update(Buffer.from(envelope.data, 'hex')), decipher.final()]).toString('utf8');
  } catch {
    throw new ArtifactCryptoError('Decryption failed');
  }
}

export function isEnvelope(value: unknown): value is Envelope {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return typeof v.kid === 'string' && typeof v.iv === 'string' && typeof v.tag === 'string' && typeof v.data === 'string';
}

export function sealJson(value: unknown, env: Env = process.env, aad?: string): string {
  return JSON.stringify(encryptText(JSON.stringify(value), env, aad));
}

export function openJson<T>(sealed: string, env: Env = process.env, aad?: string): T {
  let envelope: unknown;
  try {
    envelope = JSON.parse(sealed);
  } catch {
    throw new ArtifactCryptoError('Malformed envelope');
  }
  if (!isEnvelope(envelope)) throw new ArtifactCryptoError('Malformed envelope');
  return JSON.parse(decryptText(envelope, env, aad)) as T;
}
