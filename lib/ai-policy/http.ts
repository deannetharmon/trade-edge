// lib/ai-policy/http.ts
//
// HTTP mapping for the AI policy routes: one neutral body shape and one status per reason code. Bodies never carry a
// stack, a provider error, a prompt, or an internal detail: only a status, a reason code, and an artifact id.

import type { AiArtifact, AiRouteResult, ReasonCode, RenderedOutput } from './types';
import type { FreezeResult } from './freezeScanSession';
import type { ArtifactReadResult } from './artifactRead';

/** The reason-code table for HTTP (0001B): unavailable states are 5xx/4xx by cause; a rejected output is a normal 200. */
export const REASON_HTTP_STATUS: Record<ReasonCode, number> = {
  FLAG_OFF: 503,
  KILL_SWITCH: 503,
  GOVERNANCE: 503,
  CIRCUIT_OPEN: 503,
  TIMEOUT: 503,
  PROVIDER_ERROR: 503,
  BUDGET: 429,
  RATE_LIMIT: 429,
  INPUT_INVALID: 422,
  INPUT_MISSING: 422,
  INPUT_STALE: 409,
  NOT_FOUND: 404,
  VALIDATION_REJECTED: 200,
};

export interface ClientArtifact {
  id: string;
  route: AiArtifact['route'];
  status: AiArtifact['status'];
  inputId: string;
  createdAt: string;
  expiresAt: string;
  model: string;
  output: RenderedOutput | null;
}

/** What the client may see of an artifact: no account scope, trust class, template ids, or raw pointers. */
export function clientArtifact(artifact: AiArtifact): ClientArtifact {
  return {
    id: artifact.id, route: artifact.route, status: artifact.status, inputId: artifact.inputId, createdAt: artifact.createdAt,
    expiresAt: artifact.expiresAt, model: artifact.model, output: artifact.output,
  };
}

const json = (body: unknown, status: number): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });

export const unauthorizedResponse = (): Response => json({ status: 'unauthorized' }, 401);
export const unavailableResponse = (reason: ReasonCode, artifactId: string | null = null): Response =>
  json({ status: 'unavailable', reason, artifactId }, REASON_HTTP_STATUS[reason]);
export const oversizeResponse = (): Response => json({ status: 'unavailable', reason: 'INPUT_INVALID', artifactId: null }, 413);

export function routeResultResponse(result: AiRouteResult): Response {
  if ('artifact' in result) return json({ status: result.status, artifact: clientArtifact(result.artifact) }, 200);
  if (result.status === 'rejected') return json({ status: 'rejected', reason: 'VALIDATION_REJECTED', artifactId: result.artifactId }, 200);
  return unavailableResponse(result.reason, result.artifactId);
}

export function freezeResultResponse(result: FreezeResult): Response {
  if (result.status === 'frozen') return json({ status: 'frozen', analysisInputId: result.analysisInputId, payloadHash: result.payloadHash, createdAt: result.createdAt }, 200);
  return unavailableResponse(result.reason);
}

export function artifactReadResponse(result: ArtifactReadResult): Response {
  if (result.status === 'found') return json({ status: result.artifact.status, artifact: clientArtifact(result.artifact) }, 200);
  return unavailableResponse(result.reason);
}

export type BoundedJson = { ok: true; value: unknown } | { ok: false; reason: 'INVALID' | 'TOO_LARGE' };

/** Reads a JSON body without trusting Content-Length, refusing anything over `maxBytes`. */
export async function readBoundedJson(request: Request, maxBytes: number): Promise<BoundedJson> {
  const declared = Number(request.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > maxBytes) return { ok: false, reason: 'TOO_LARGE' };
  let text: string;
  try {
    text = await request.text();
  } catch {
    return { ok: false, reason: 'INVALID' };
  }
  if (text.length > maxBytes) return { ok: false, reason: 'TOO_LARGE' };
  try {
    return { ok: true, value: JSON.parse(text) };
  } catch {
    return { ok: false, reason: 'INVALID' };
  }
}

/** Strict body shape: a plain object with exactly the allowed keys (unknown keys, e.g. client "messages", are refused). */
export function pickStrict(value: unknown, required: readonly string[], optional: readonly string[] = []): Record<string, unknown> | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const allowed = new Set([...required, ...optional]);
  if (Object.keys(record).some((k) => !allowed.has(k))) return null;
  if (required.some((k) => !(k in record))) return null;
  return record;
}
