// lib/ai-policy/providerClient.ts
//
// The ONLY outbound provider call in the AI policy library. It builds the request, refuses any request that could give
// the model a capability (tools, functions, web search, plugins, MCP), requires a strict JSON-schema response format,
// enforces a timeout, and returns text plus token usage. It never logs or returns prompt text or the API key.

import { PROVIDER_TIMEOUT_MS, providerRequestProfile } from './config';
import type { Env } from './types';

export const OPENAI_CHAT_URL = 'https://api.openai.com/v1/chat/completions';

/** Any of these anywhere in the request body (outside the static response schema) makes the request illegal. */
export const FORBIDDEN_REQUEST_KEYS = ['tools', 'functions', 'tool_choice', 'function_call', 'web_search', 'plugins', 'mcp'] as const;

export class ProviderRequestError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ProviderRequestError';
  }
}

export interface ProviderRequestInput {
  model: string;
  system: string;
  user: string;
  maxOutputTokens: number;
  schemaName: string;
  schema: Record<string, unknown>;
}

export interface ProviderRequest {
  url: string;
  body: Record<string, unknown>;
}

function findForbiddenKey(node: unknown): string | null {
  if (Array.isArray(node)) {
    for (const item of node) {
      const hit = findForbiddenKey(item);
      if (hit) return hit;
    }
    return null;
  }
  if (typeof node === 'object' && node !== null) {
    for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
      if ((FORBIDDEN_REQUEST_KEYS as readonly string[]).includes(key)) return key;
      if (key === 'response_format') continue; // the static schema is ours and is checked separately
      const hit = findForbiddenKey(value);
      if (hit) return hit;
    }
  }
  return null;
}

/** Throws ProviderRequestError when the body would carry a tool-like capability or lacks a strict json_schema format. */
export function assertRequestBody(body: Record<string, unknown>): void {
  const forbidden = findForbiddenKey(body);
  if (forbidden) throw new ProviderRequestError(`Forbidden request key: ${forbidden}`);
  const format = body.response_format as { type?: unknown; json_schema?: { strict?: unknown; schema?: unknown } } | undefined;
  if (!format || format.type !== 'json_schema' || format.json_schema?.strict !== true || typeof format.json_schema?.schema !== 'object') {
    throw new ProviderRequestError('A strict json_schema response format is required');
  }
}

export function buildProviderRequest(input: ProviderRequestInput): ProviderRequest {
  const profile = providerRequestProfile(input.model);
  const body: Record<string, unknown> = {
    model: input.model,
    messages: [
      { role: 'system', content: input.system },
      { role: 'user', content: input.user },
    ],
    response_format: { type: 'json_schema', json_schema: { name: input.schemaName, strict: true, schema: input.schema } },
    [profile.tokenParam]: input.maxOutputTokens,
    store: false,
  };
  if (profile.supportsTemperature) body.temperature = 0;
  assertRequestBody(body);
  return { url: OPENAI_CHAT_URL, body };
}

export interface ProviderUsage {
  inputTokens: number;
  outputTokens: number;
}

export type ProviderResult =
  | { ok: true; text: string; usage: ProviderUsage | null; providerModelId: string | null }
  | { ok: false; reason: 'TIMEOUT' | 'PROVIDER_ERROR'; /** True when tokens may have been billed although no usable answer came back. */ chargeUnknown: boolean };

export interface ProviderDeps {
  env?: Env;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

/**
 * The test-only stub. Allowed only outside production: on Vercel that means VERCEL_ENV is preview/development
 * (NODE_ENV is 'production' on Preview builds, so it cannot be used as the guard there); off Vercel, NODE_ENV must not
 * be 'production'.
 */
export function isProviderStubAllowed(env: Env = process.env): boolean {
  if (env.AI_POLICY_PROVIDER_STUB !== 'true') return false;
  if (env.VERCEL_ENV) return env.VERCEL_ENV !== 'production';
  return env.NODE_ENV !== 'production';
}

export const STUB_EMPTY_OUTPUT = JSON.stringify({
  summary: '', observations: [], tradeoffs: [], missingOrStaleData: [], questionsForTrader: [], limitations: [], citations: [],
});

export async function callProvider(request: ProviderRequest, deps: ProviderDeps = {}): Promise<ProviderResult> {
  const env = deps.env ?? process.env;
  assertRequestBody(request.body);

  if (isProviderStubAllowed(env)) {
    return {
      ok: true,
      text: env.AI_POLICY_PROVIDER_STUB_OUTPUT ?? STUB_EMPTY_OUTPUT,
      usage: { inputTokens: 100, outputTokens: 100 },
      providerModelId: 'stub',
    };
  }

  const apiKey = env.OPENAI_API_KEY;
  if (!apiKey) return { ok: false, reason: 'PROVIDER_ERROR', chargeUnknown: false };

  const fetchImpl = deps.fetchImpl ?? fetch;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), deps.timeoutMs ?? PROVIDER_TIMEOUT_MS);
  try {
    const response = await fetchImpl(request.url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify(request.body),
      signal: controller.signal,
    });
    if (!response.ok) return { ok: false, reason: 'PROVIDER_ERROR', chargeUnknown: false };
    const data = (await response.json()) as {
      model?: unknown;
      usage?: { prompt_tokens?: unknown; completion_tokens?: unknown };
      choices?: Array<{ message?: { content?: unknown; refusal?: unknown; tool_calls?: unknown; function_call?: unknown } }>;
    };
    const message = data.choices?.[0]?.message;
    const usage =
      typeof data.usage?.prompt_tokens === 'number' && typeof data.usage?.completion_tokens === 'number'
        ? { inputTokens: data.usage.prompt_tokens, outputTokens: data.usage.completion_tokens }
        : null;
    // Defence in depth: a no-tools request must never come back with a tool call.
    if (!message || message.tool_calls != null || message.function_call != null || message.refusal || typeof message.content !== 'string') {
      return { ok: false, reason: 'PROVIDER_ERROR', chargeUnknown: usage == null };
    }
    return { ok: true, text: message.content, usage, providerModelId: typeof data.model === 'string' ? data.model : null };
  } catch (error) {
    const aborted = error instanceof Error && error.name === 'AbortError';
    return { ok: false, reason: aborted ? 'TIMEOUT' : 'PROVIDER_ERROR', chargeUnknown: aborted };
  } finally {
    clearTimeout(timer);
  }
}
