// lib/discovery/util.ts

// LEAPS-QV-0001 Gate 1 -- small, dependency-free helpers shared by the Discovery Strategy Engine.
// Nothing here knows about any investment strategy. Everything is deterministic: no Date.now(),
// no Math.random(), no environment access, so the same input always yields the same output.

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };
export type JsonObject = { [key: string]: JsonValue };

const ISO_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/;

/** True for a full ISO-8601 timestamp with an explicit offset that also parses to a real instant. */
export function isIsoTimestamp(value: unknown): value is string {
  return typeof value === 'string' && ISO_TIMESTAMP.test(value) && Number.isFinite(Date.parse(value));
}

/** Recursively freezes plain data so persisted evaluation evidence cannot be mutated after the fact. */
export function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    const record = value as unknown as Record<string, unknown>;
    Object.keys(record).forEach((key) => deepFreeze(record[key]));
  }
  return value;
}

/**
 * Canonical JSON: object keys sorted, undefined object properties omitted, non-finite numbers rejected.
 * Used to derive reproducible snapshot identifiers from content.
 */
export function stableStringify(value: unknown): string {
  if (value === null) return 'null';
  switch (typeof value) {
    case 'string':
      return JSON.stringify(value);
    case 'boolean':
      return value ? 'true' : 'false';
    case 'number':
      if (!Number.isFinite(value)) {
        throw new Error('stableStringify: non-finite numbers cannot be serialized deterministically');
      }
      return JSON.stringify(value);
    case 'object': {
      if (Array.isArray(value)) {
        return `[${value.map((item) => (item === undefined ? 'null' : stableStringify(item))).join(',')}]`;
      }
      const record = value as Record<string, unknown>;
      const parts: string[] = [];
      Object.keys(record)
        .sort()
        .forEach((key) => {
          if (record[key] === undefined) return;
          parts.push(`${JSON.stringify(key)}:${stableStringify(record[key])}`);
        });
      return `{${parts.join(',')}}`;
    }
    default:
      throw new Error(`stableStringify: unsupported value of type ${typeof value}`);
  }
}

/**
 * 53-bit non-cryptographic string hash (cyrb53), rendered as 14 hex characters.
 * Identifiers derived from it are content fingerprints for reproducibility, not security tokens.
 */
export function hashString(input: string): string {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < input.length; i += 1) {
    const ch = input.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  const combined = 4294967296 * (2097151 & h2) + (h1 >>> 0);
  return combined.toString(16).padStart(14, '0');
}

export function uniqueSorted(values: readonly string[]): string[] {
  const seen: Record<string, true> = {};
  values.forEach((value) => {
    seen[value] = true;
  });
  return Object.keys(seen).sort();
}
