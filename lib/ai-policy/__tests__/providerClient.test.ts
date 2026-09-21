// lib/ai-policy/__tests__/providerClient.test.ts
import { describe, expect, it, vi } from 'vitest';
import { FORBIDDEN_REQUEST_KEYS, ProviderRequestError, STUB_EMPTY_OUTPUT, assertRequestBody, buildProviderRequest, callProvider, isProviderStubAllowed } from '../providerClient';
import type { ProviderRequestInput } from '../providerClient';
import { MODEL_OUTPUT_JSON_SCHEMA } from '../validator';

const input = (model = 'gpt-5.6-luna'): ProviderRequestInput => ({ model, system: 'sys', user: 'usr', maxOutputTokens: 500, schemaName: 'test_v1', schema: MODEL_OUTPUT_JSON_SCHEMA });
const okBody = (over: Record<string, unknown> = {}) => JSON.stringify({ model: 'm-1', usage: { prompt_tokens: 10, completion_tokens: 5 }, choices: [{ message: { content: '{"a":1}' } }], ...over });
const respond = (body: string, status = 200): typeof fetch => (async () => new Response(body, { status })) as unknown as typeof fetch;

describe('request builder', () => {
  it('requires a strict json_schema response format and sends no tool-like keys', () => {
    const { body, url } = buildProviderRequest(input());
    expect(url).toBe('https://api.openai.com/v1/chat/completions');
    expect(body.response_format).toMatchObject({ type: 'json_schema', json_schema: { name: 'test_v1', strict: true } });
    for (const key of FORBIDDEN_REQUEST_KEYS) expect(Object.keys(body)).not.toContain(key);
    expect(body.store).toBe(false);
  });

  it('uses the token parameter and temperature handling of the model family', () => {
    expect(buildProviderRequest(input('gpt-5.6-luna')).body).toMatchObject({ max_completion_tokens: 500 });
    expect(buildProviderRequest(input('gpt-5.6-luna')).body).not.toHaveProperty('temperature');
    expect(buildProviderRequest(input('gpt-5.6-luna')).body).not.toHaveProperty('max_tokens');
    expect(buildProviderRequest(input('gpt-4o-mini')).body).toMatchObject({ max_tokens: 500, temperature: 0 });
  });

  it.each(FORBIDDEN_REQUEST_KEYS.map((k) => [k]))('throws when the body contains %s', (key) => {
    const { body } = buildProviderRequest(input());
    expect(() => assertRequestBody({ ...body, [key]: [] })).toThrow(ProviderRequestError);
    expect(() => assertRequestBody({ ...body, messages: [{ role: 'user', content: 'x', [key]: {} }] })).toThrow(ProviderRequestError);
  });

  it.each([
    ['no response_format', undefined],
    ['json_object', { type: 'json_object' }],
    ['non-strict schema', { type: 'json_schema', json_schema: { name: 'x', strict: false, schema: {} } }],
    ['missing schema', { type: 'json_schema', json_schema: { name: 'x', strict: true } }],
  ])('throws for %s', (_n, format) => {
    const { body } = buildProviderRequest(input());
    expect(() => assertRequestBody({ ...body, response_format: format })).toThrow(ProviderRequestError);
  });
});

describe('callProvider', () => {
  const request = buildProviderRequest(input());

  it('makes zero network calls without a key', async () => {
    const fetchImpl = vi.fn();
    const result = await callProvider(request, { env: {}, fetchImpl: fetchImpl as unknown as typeof fetch });
    expect(result).toEqual({ ok: false, reason: 'PROVIDER_ERROR', chargeUnknown: false });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('refuses an illegal request before any network call', async () => {
    const fetchImpl = vi.fn();
    await expect(callProvider({ ...request, body: { ...request.body, tools: [] } }, { env: { OPENAI_API_KEY: 'k' }, fetchImpl: fetchImpl as unknown as typeof fetch })).rejects.toThrow(ProviderRequestError);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('sends the key as a bearer header and returns text, usage and the served model id', async () => {
    const fetchImpl = vi.fn(respond(okBody()));
    const result = await callProvider(request, { env: { OPENAI_API_KEY: 'sk-secret' }, fetchImpl: fetchImpl as unknown as typeof fetch });
    expect(result).toEqual({ ok: true, text: '{"a":1}', usage: { inputTokens: 10, outputTokens: 5 }, providerModelId: 'm-1' });
    const init = fetchImpl.mock.calls[0][1] as RequestInit;
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer sk-secret');
    expect(JSON.stringify(result)).not.toContain('sk-secret');
  });

  it('a non-2xx response is a provider error and does not leak the body', async () => {
    const result = await callProvider(request, { env: { OPENAI_API_KEY: 'k' }, fetchImpl: respond('{"error":"secret detail"}', 500) });
    expect(result).toEqual({ ok: false, reason: 'PROVIDER_ERROR', chargeUnknown: false });
  });

  it('times out with an AbortController and marks the charge unknown', async () => {
    const hang = ((_u: string, init: RequestInit) => new Promise((_res, rej) => init.signal!.addEventListener('abort', () => rej(Object.assign(new Error('aborted'), { name: 'AbortError' }))))) as unknown as typeof fetch;
    const result = await callProvider(request, { env: { OPENAI_API_KEY: 'k' }, fetchImpl: hang, timeoutMs: 15 });
    expect(result).toEqual({ ok: false, reason: 'TIMEOUT', chargeUnknown: true });
  });

  it('a network failure is a provider error', async () => {
    const boom = (async () => { throw new Error('ECONNRESET'); }) as unknown as typeof fetch;
    expect(await callProvider(request, { env: { OPENAI_API_KEY: 'k' }, fetchImpl: boom })).toMatchObject({ ok: false, reason: 'PROVIDER_ERROR' });
  });

  it.each([
    ['tool_calls', { choices: [{ message: { content: '{}', tool_calls: [{ id: 'x' }] } }] }],
    ['function_call', { choices: [{ message: { content: '{}', function_call: { name: 'x' } } }] }],
    ['refusal', { choices: [{ message: { content: null, refusal: 'no' } }] }],
    ['no message', { choices: [] }],
    ['non-string content', { choices: [{ message: { content: 5 } }] }],
  ])('defence in depth: %s in the response is a provider error', async (_n, over) => {
    const result = await callProvider(request, { env: { OPENAI_API_KEY: 'k' }, fetchImpl: respond(okBody(over)) });
    expect(result).toMatchObject({ ok: false, reason: 'PROVIDER_ERROR' });
  });
});

describe('test-only stub is inert in production', () => {
  const stub = { AI_POLICY_PROVIDER_STUB: 'true' };
  it('is off unless explicitly enabled', () => expect(isProviderStubAllowed({})).toBe(false));
  it('is allowed in test/dev and on Vercel Preview (where NODE_ENV is production)', () => {
    expect(isProviderStubAllowed({ ...stub, NODE_ENV: 'test' })).toBe(true);
    expect(isProviderStubAllowed({ ...stub, NODE_ENV: 'development' })).toBe(true);
    expect(isProviderStubAllowed({ ...stub, NODE_ENV: 'production', VERCEL_ENV: 'preview' })).toBe(true);
  });
  it('is never allowed in production', () => {
    expect(isProviderStubAllowed({ ...stub, NODE_ENV: 'production', VERCEL_ENV: 'production' })).toBe(false);
    expect(isProviderStubAllowed({ ...stub, NODE_ENV: 'development', VERCEL_ENV: 'production' })).toBe(false);
    expect(isProviderStubAllowed({ ...stub, NODE_ENV: 'production' })).toBe(false);
  });
  it('returns canned output when allowed, and reaches for the real provider (or fails) when not', async () => {
    const request = buildProviderRequest(input());
    const canned = await callProvider(request, { env: { ...stub, NODE_ENV: 'test' } });
    expect(canned).toMatchObject({ ok: true, text: STUB_EMPTY_OUTPUT, providerModelId: 'stub' });
    const fetchImpl = vi.fn();
    const prod = await callProvider(request, { env: { ...stub, NODE_ENV: 'production', VERCEL_ENV: 'production' }, fetchImpl: fetchImpl as unknown as typeof fetch });
    expect(prod).toMatchObject({ ok: false, reason: 'PROVIDER_ERROR' });
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
