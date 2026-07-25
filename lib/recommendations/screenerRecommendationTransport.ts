import { screenResultsToAutopilotCandidates } from '@/lib/autopilot/decision/screenerCandidateAdapter';
import type { AutopilotCandidate } from '@/lib/autopilot/types';
import type { DuplicateCandidateRecord } from '@/lib/autopilot/decision/candidatePipelineTypes';
import type { DecisionAnalysis } from '@/lib/decision-engine';
import type { ScreenResult } from '@/lib/scans/types';
import type { RecommendationsApiResponseSkippedEntry } from '@/lib/command-center/screenerOpportunityRecommendations';

/**
 * Vercel Functions reject request bodies above 4.5 MB before the route can
 * read request.json(). Keep recommendation requests far below that ingress
 * boundary, with headroom for headers/platform accounting and for the larger
 * DecisionAnalysis response generated from each compact candidate batch.
 */
export const VERCEL_FUNCTION_BODY_LIMIT_BYTES = 4_500_000;
export const RECOMMENDATION_SAFE_REQUEST_BYTES = 900_000;
export const RECOMMENDATION_ENGINE_BUSY_CODE = 'AUTOPILOT_ENGINE_BUSY';
export const DEFAULT_BUSY_RETRY_LIMIT = 12;
export const DEFAULT_BUSY_RETRY_BASE_DELAY_MS = 500;
export const DEFAULT_BUSY_RETRY_MAX_DELAY_MS = 5_000;

export interface RecommendationCandidateBatch {
  candidates: AutopilotCandidate[];
  body: string;
  byteLength: number;
}

export interface BatchedRecommendationTransportPlan {
  batches: RecommendationCandidateBatch[];
  candidateCount: number;
  skipped: RecommendationsApiResponseSkippedEntry[];
}

export interface BatchedRecommendationApiBody {
  success: true;
  result: {
    recommendations: DecisionAnalysis[];
    duplicates: DuplicateCandidateRecord[];
    candidatesScanned: number;
    killSwitchActive: boolean;
  };
  skipped: RecommendationsApiResponseSkippedEntry[];
  transport: {
    batchCount: number;
    candidateCount: number;
    requestBytes: number[];
  };
}

export class RecommendationEvaluationPausedError extends Error {
  readonly pausedResult: BatchedRecommendationApiBody;

  constructor(pausedResult: BatchedRecommendationApiBody) {
    super('Autopilot kill switch is active. Ranked Opportunities were not updated.');
    this.name = 'RecommendationEvaluationPausedError';
    this.pausedResult = pausedResult;
  }
}

type FetchLike = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Pick<Response, 'ok' | 'status' | 'json'>>;

function supersededError(): DOMException {
  return new DOMException('Recommendation evaluation was superseded.', 'AbortError');
}

function waitForAbortableDelay(delayMs: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) return Promise.reject(supersededError());

  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, delayMs);
    const onAbort = () => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
      reject(supersededError());
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

function jsonByteLength(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

function serializeCandidates(candidates: AutopilotCandidate[]): string {
  return JSON.stringify({ candidates });
}

/**
 * The canonical candidate pipeline deduplicates by this economic-structure
 * identity. Keeping equivalent candidates in the same transport batch lets
 * that existing pipeline retain exactly the same winner/duplicate semantics
 * it has when all candidates arrive in one request. This key is used only for
 * transport co-location; it never drops, ranks, scores, or evaluates anything.
 */
function candidateDedupeAffinityKey(candidate: AutopilotCandidate): string {
  return [
    candidate.symbol.trim().toUpperCase(),
    candidate.strategy,
    candidate.legs
      .map((leg) => `${leg.direction}:${leg.optionType ?? 'stock'}:${leg.strike ?? 'na'}`)
      .join('|'),
  ].join('::');
}

function groupCandidatesByDedupeAffinity(
  candidates: AutopilotCandidate[],
): AutopilotCandidate[][] {
  const groups = new Map<string, AutopilotCandidate[]>();

  for (const candidate of candidates) {
    const key = candidateDedupeAffinityKey(candidate);
    const group = groups.get(key);
    if (group) group.push(candidate);
    else groups.set(key, [candidate]);
  }

  return Array.from(groups.values());
}

export function buildBatchedRecommendationTransportPlan(
  results: ScreenResult[],
  maxRequestBytes = RECOMMENDATION_SAFE_REQUEST_BYTES,
): BatchedRecommendationTransportPlan {
  if (
    !Number.isSafeInteger(maxRequestBytes)
    || maxRequestBytes <= jsonByteLength(serializeCandidates([]))
    || maxRequestBytes >= VERCEL_FUNCTION_BODY_LIMIT_BYTES
  ) {
    throw new Error(
      `Recommendation request byte limit must be a positive integer below ${VERCEL_FUNCTION_BODY_LIMIT_BYTES}.`,
    );
  }

  // Adapt exactly once, before partitioning. This is the existing canonical
  // Screener -> AutopilotCandidate adapter; no transport-only candidate model
  // or second eligibility engine is introduced.
  const { candidates, skipped } = screenResultsToAutopilotCandidates(results);
  const groups = groupCandidatesByDedupeAffinity(candidates);
  const batches: RecommendationCandidateBatch[] = [];
  let current: AutopilotCandidate[] = [];
  let currentByteLength = jsonByteLength(serializeCandidates([]));

  const pushCurrent = () => {
    if (!current.length) return;
    const body = serializeCandidates(current);
    batches.push({ candidates: current, body, byteLength: jsonByteLength(body) });
    current = [];
    currentByteLength = jsonByteLength(serializeCandidates([]));
  };

  for (const group of groups) {
    const groupBody = serializeCandidates(group);
    const groupBytes = jsonByteLength(groupBody);
    if (groupBytes > maxRequestBytes) {
      throw new Error(
        `A duplicate-equivalent recommendation candidate group requires ${groupBytes} bytes, exceeding the safe ${maxRequestBytes}-byte request limit.`,
      );
    }

    // Both bodies have the same fixed `{"candidates":[` / `]}` envelope.
    // Adding a group means removing one envelope and adding one comma between
    // the existing and incoming arrays. This is the exact UTF-8 byte count,
    // without repeatedly serializing an ever-growing batch.
    const emptyEnvelopeBytes = jsonByteLength(serializeCandidates([]));
    const combinedBytes = current.length
      ? currentByteLength + groupBytes - emptyEnvelopeBytes + 1
      : groupBytes;
    if (current.length && combinedBytes > maxRequestBytes) {
      pushCurrent();
    }
    current.push(...group);
    currentByteLength = current.length === group.length
      ? groupBytes
      : currentByteLength + groupBytes - emptyEnvelopeBytes + 1;
  }
  pushCurrent();

  return {
    batches,
    candidateCount: candidates.length,
    skipped,
  };
}

export async function evaluateScreenResultsInBatches(
  results: ScreenResult[],
  options: {
    fetch?: FetchLike;
    signal?: AbortSignal;
    maxRequestBytes?: number;
    maxBusyRetries?: number;
    busyRetryBaseDelayMs?: number;
    busyRetryMaxDelayMs?: number;
  } = {},
): Promise<BatchedRecommendationApiBody> {
  const plan = buildBatchedRecommendationTransportPlan(
    results,
    options.maxRequestBytes ?? RECOMMENDATION_SAFE_REQUEST_BYTES,
  );
  const fetchImpl = options.fetch ?? fetch;
  const recommendations: DecisionAnalysis[] = [];
  const duplicates: DuplicateCandidateRecord[] = [];
  let candidatesScanned = 0;
  const maxBusyRetries = options.maxBusyRetries ?? DEFAULT_BUSY_RETRY_LIMIT;
  const busyRetryBaseDelayMs = options.busyRetryBaseDelayMs ?? DEFAULT_BUSY_RETRY_BASE_DELAY_MS;
  const busyRetryMaxDelayMs = options.busyRetryMaxDelayMs ?? DEFAULT_BUSY_RETRY_MAX_DELAY_MS;

  if (
    !Number.isSafeInteger(maxBusyRetries)
    || maxBusyRetries < 0
    || !Number.isSafeInteger(busyRetryBaseDelayMs)
    || busyRetryBaseDelayMs < 0
    || !Number.isSafeInteger(busyRetryMaxDelayMs)
    || busyRetryMaxDelayMs < busyRetryBaseDelayMs
  ) {
    throw new Error('Recommendation busy-retry settings must be non-negative bounded integers.');
  }

  for (let index = 0; index < plan.batches.length; index += 1) {
    if (options.signal?.aborted) {
      throw supersededError();
    }

    const batch = plan.batches[index];
    let body: any;
    let busyRetries = 0;
    while (true) {
      const response = await fetchImpl('/api/autopilot/recommendations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: batch.body,
        signal: options.signal,
      });
      body = await response.json().catch(() => ({}));

      if (response.ok) break;

      const explicitlyBusy = (
        response.status === 409
        && body?.code === RECOMMENDATION_ENGINE_BUSY_CODE
        && body?.retryable === true
      );
      if (!explicitlyBusy) {
        throw new Error(
          body?.error
          ?? `Recommendation engine batch ${index + 1} of ${plan.batches.length} failed (${response.status}).`,
        );
      }
      if (busyRetries >= maxBusyRetries) {
        throw new Error(
          `Recommendation engine remained busy after ${busyRetries + 1} attempts for batch ${index + 1} of ${plan.batches.length}; the evaluation was not published.`,
        );
      }

      const delayMs = Math.min(
        busyRetryBaseDelayMs * (2 ** busyRetries),
        busyRetryMaxDelayMs,
      );
      busyRetries += 1;
      await waitForAbortableDelay(delayMs, options.signal);
    }

    const batchRecommendations = body?.result?.recommendations;
    const batchDuplicates = body?.result?.duplicates ?? [];
    if (!Array.isArray(batchRecommendations) || !Array.isArray(batchDuplicates)) {
      throw new Error(
        `Recommendation engine batch ${index + 1} of ${plan.batches.length} returned an invalid response.`,
      );
    }

    if (body?.result?.killSwitchActive === true) {
      throw new RecommendationEvaluationPausedError({
        success: true,
        result: {
          recommendations: [],
          duplicates: [],
          candidatesScanned: 0,
          killSwitchActive: true,
        },
        skipped: plan.skipped,
        transport: {
          batchCount: index + 1,
          candidateCount: plan.candidateCount,
          requestBytes: plan.batches.slice(0, index + 1).map((item) => item.byteLength),
        },
      });
    }

    recommendations.push(...batchRecommendations);
    duplicates.push(...batchDuplicates);
    candidatesScanned += Number(body?.result?.candidatesScanned ?? batch.candidates.length);
  }

  return {
    success: true,
    result: {
      recommendations,
      duplicates,
      candidatesScanned,
      killSwitchActive: false,
    },
    skipped: plan.skipped,
    transport: {
      batchCount: plan.batches.length,
      candidateCount: plan.candidateCount,
      requestBytes: plan.batches.map((batch) => batch.byteLength),
    },
  };
}
