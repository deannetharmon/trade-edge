// lib/ai-policy/pointer.ts
//
// RFC 6901 JSON Pointer helpers and the citable-field registry matcher. A registry pattern is a pointer in which a
// `*` segment matches exactly one segment (an array index or an object key).

import type { CitableField, CitableFieldRegistry } from './types';

export type Primitive = string | number | boolean;

export function parsePointer(pointer: string): string[] | null {
  if (typeof pointer !== 'string' || pointer.length === 0 || pointer[0] !== '/' || pointer.length > 300) return null;
  const segments = pointer.slice(1).split('/');
  const out: string[] = [];
  for (const raw of segments) {
    if (/~(?![01])/.test(raw)) return null;
    out.push(raw.replace(/~1/g, '/').replace(/~0/g, '~'));
  }
  return out;
}

export function escapeSegment(segment: string): string {
  return segment.replace(/~/g, '~0').replace(/\//g, '~1');
}

export function resolvePointer(root: unknown, pointer: string): { found: boolean; value: unknown } {
  const segments = parsePointer(pointer);
  if (!segments) return { found: false, value: undefined };
  let node: unknown = root;
  for (const segment of segments) {
    if (Array.isArray(node)) {
      if (!/^(?:0|[1-9]\d*)$/.test(segment)) return { found: false, value: undefined };
      const index = Number(segment);
      if (index >= node.length) return { found: false, value: undefined };
      node = node[index];
    } else if (typeof node === 'object' && node !== null && Object.prototype.hasOwnProperty.call(node, segment)) {
      node = (node as Record<string, unknown>)[segment];
    } else {
      return { found: false, value: undefined };
    }
  }
  return { found: true, value: node };
}

export function isPrimitiveValue(value: unknown): value is Primitive {
  return typeof value === 'string' || typeof value === 'boolean' || (typeof value === 'number' && Number.isFinite(value));
}

/** Compare a concrete pointer with a pattern using the raw (escaped) segments of both. */
export function matchesPattern(pointer: string, pattern: string): boolean {
  if (!parsePointer(pointer)) return false;
  const a = pointer.slice(1).split('/');
  const b = pattern.slice(1).split('/');
  return a.length === b.length && b.every((seg, i) => seg === '*' || seg === a[i]);
}

export function findCitableField(registry: CitableFieldRegistry, pointer: string): CitableField | null {
  return registry.find((field) => matchesPattern(pointer, field.pattern)) ?? null;
}

/**
 * The payload may contain only registry fields plus structural containers: every primitive leaf must match a registry
 * pattern. Returns the first offending pointer, or null when the payload is allowed.
 */
export function firstUnregisteredLeaf(payload: unknown, registry: CitableFieldRegistry): string | null {
  const walk = (node: unknown, segments: string[]): string | null => {
    if (Array.isArray(node)) {
      for (let i = 0; i < node.length; i += 1) {
        const hit = walk(node[i], [...segments, String(i)]);
        if (hit) return hit;
      }
      return null;
    }
    if (typeof node === 'object' && node !== null) {
      for (const key of Object.keys(node as Record<string, unknown>)) {
        const hit = walk((node as Record<string, unknown>)[key], [...segments, escapeSegment(key)]);
        if (hit) return hit;
      }
      return null;
    }
    const pointer = `/${segments.join('/')}`;
    return findCitableField(registry, pointer) ? null : pointer;
  };
  return walk(payload, []);
}
