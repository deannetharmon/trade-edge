// lib/ai-policy/canonical.ts
//
// Canonical JSON + SHA-256. Keys are sorted by Unicode code point (NOT localeCompare and NOT UTF-16 code unit order,
// which differ for astral characters). Rejects NaN, Infinity, undefined, functions, symbols, bigint, and non-plain objects.

import { createHash } from 'crypto';

export class CanonicalError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CanonicalError';
  }
}

const MAX_DEPTH = 64;

export function compareCodePoints(a: string, b: string): number {
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    const ca = a.codePointAt(i)!;
    const cb = b.codePointAt(j)!;
    if (ca !== cb) return ca < cb ? -1 : 1;
    i += ca > 0xffff ? 2 : 1;
    j += cb > 0xffff ? 2 : 1;
  }
  if (i < a.length) return 1;
  if (j < b.length) return -1;
  return 0;
}

function isPlainObject(value: object): boolean {
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function write(value: unknown, depth: number, path: string): string {
  if (depth > MAX_DEPTH) throw new CanonicalError(`Too deep at ${path}`);
  if (value === null) return 'null';
  switch (typeof value) {
    case 'string':
      return JSON.stringify(value);
    case 'boolean':
      return value ? 'true' : 'false';
    case 'number':
      if (!Number.isFinite(value)) throw new CanonicalError(`Non-finite number at ${path}`);
      return JSON.stringify(value);
    case 'undefined':
      throw new CanonicalError(`undefined at ${path}`);
    case 'object': {
      if (Array.isArray(value)) {
        const parts: string[] = [];
        for (let i = 0; i < value.length; i += 1) {
          if (!(i in value)) throw new CanonicalError(`Sparse array at ${path}[${i}]`);
          parts.push(write(value[i], depth + 1, `${path}[${i}]`));
        }
        return `[${parts.join(',')}]`;
      }
      if (!isPlainObject(value as object)) throw new CanonicalError(`Non-plain object at ${path}`);
      const record = value as Record<string, unknown>;
      const keys = Object.keys(record).sort(compareCodePoints);
      return `{${keys.map((k) => `${JSON.stringify(k)}:${write(record[k], depth + 1, `${path}.${k}`)}`).join(',')}}`;
    }
    default:
      throw new CanonicalError(`Unsupported ${typeof value} at ${path}`);
  }
}

export function canonicalize(value: unknown): string {
  return write(value, 0, '$');
}

export function sha256Hex(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

export function canonicalHash(value: unknown): string {
  return sha256Hex(canonicalize(value));
}
