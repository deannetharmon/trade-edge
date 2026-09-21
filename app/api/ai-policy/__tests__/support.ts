// app/api/ai-policy/__tests__/support.ts
//
// Shared helpers for the AI policy route tests. (Each test file declares its own vi.mock calls; mocks cannot be shared.)

import { expect, vi } from 'vitest';
import { TEST_ENV } from '@/lib/ai-policy/fixtures/testRoute';

export const KEY_A = 'route-test-key-a-000001';

/** Sets the AI policy env for a test and returns a restore function. Undefined values are removed. */
export function applyEnv(over: Record<string, string | undefined> = {}): () => void {
  const merged = { ...TEST_ENV, ...over };
  const previous: Record<string, string | undefined> = {};
  for (const [k, v] of Object.entries(merged)) {
    previous[k] = process.env[k];
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  return () => {
    for (const [k, v] of Object.entries(previous)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  };
}

export function post(url: string, body: unknown, raw = false): Request {
  return new Request(`http://localhost${url}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: raw ? (body as string) : JSON.stringify(body) });
}

/** Fetch stand-in for the provider: returns the given model text as a chat-completions body. */
export function stubProvider(text: string): ReturnType<typeof vi.fn> {
  const fn = vi.fn(async () => new Response(JSON.stringify({ model: 'test-model', usage: { prompt_tokens: 500, completion_tokens: 200 }, choices: [{ message: { content: text } }] }), { status: 200 }));
  vi.stubGlobal('fetch', fn);
  return fn as unknown as ReturnType<typeof vi.fn>;
}

/** Every body an AI policy route returns must be one of these neutral shapes with no internals. */
export function expectNeutralBody(body: Record<string, unknown>): void {
  // The reason code is an enum (PROVIDER_ERROR etc.), so it is checked by shape below, not by the word scan.
  const { reason, ...rest } = body as { reason?: unknown } & Record<string, unknown>;
  expect(reason === undefined || /^[A-Z_]+$/.test(String(reason))).toBe(true);
  const text = JSON.stringify(rest);
  expect(text).not.toMatch(/stack|Error|at \/|node_modules|openai|sk-|prompt|traceback/i);
  const allowed = new Set(['status', 'reason', 'artifactId', 'artifact', 'analysisInputId', 'payloadHash', 'createdAt']);
  expect(Object.keys(body).every((k) => allowed.has(k))).toBe(true);
}
