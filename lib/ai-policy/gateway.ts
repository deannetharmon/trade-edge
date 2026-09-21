// lib/ai-policy/gateway.ts
//
// runAiRoute(): the single controlled entry point in front of AI. Stage order (every failure returns a neutral
// unavailable/rejected result; the function never throws to the route; the provider is called only after stages 1-7):
//   1 flags, then Redis kill switches   2 governance, budgets configured   3 load input (user-scoped)
//   4 freshness   5 idempotency claim   6 circuit breaker   7 budget reserve
//   8 provider call (no tools, strict JSON schema, timeout)   9 validate + render
//   10 persist provenance + artifact, reconcile budget, update breaker and `current` pointer
// The gateway reads the frozen input and writes only to its own `ai-policy:*` Redis keys. It has no access to scan,
// portfolio, or order code (import-boundary test).

import { randomUUID } from 'crypto';
import { getRedis } from '@/lib/jobs/redis';
import { markCurrent, saveArtifact, getArtifact, subjectHash } from './artifactStore';
import { hasArtifactKey } from './artifactCrypto';
import { sha256Hex } from './canonical';
import { AI_POLICY_VERSION, ARTIFACT_TTL_SECONDS, ROUTE_ENV, isGloballyEnabled, isRouteEnabled, resolveBudgets, resolveGovernance } from './config';
import { RedisBudgetStore } from './budget';
import type { BudgetReservation, BudgetStore } from './budget';
import * as breaker from './circuitBreaker';
import { evaluateFreshness } from './freshness';
import type { LaunchGate } from './launchGates';
import * as idempotency from './idempotency';
import { getInput } from './inputStore';
import { checkKillSwitch } from './killSwitch';
import { LEXICON_VERSION } from './lexicon';
import { actualCostMicros, estimateWorstCaseMicros } from './pricing';
import { saveProvenance, userScopeId } from './provenance';
import type { ProvenanceRecord } from './provenance';
import { buildProviderRequest, callProvider } from './providerClient';
import { redactUserText } from './redact';
import { ROUTE_SPECS } from './routeSpecs';
import type { RouteSpec } from './routeSpecs';
import { VALIDATOR_VERSION, validateAndRender } from './validator';
import { SOURCE_LABELS, isSafeUserId } from './types';
import type { AiArtifact, AiRouteId, AiRouteResult, ArtifactStatus, Claim, Env, ReasonCode, RedisLike, RenderedOutput, SourceKind } from './types';

export interface RunAiRouteRequest {
  route: AiRouteId;
  /** Server-resolved authenticated user id. Never a client value, never the debug-bypass identity. */
  userId: string;
  /** Opaque analysis-input id issued by the server. */
  inputId: string;
  idempotencyKey: string;
  /** grounded_chat only; redacted and bounded here. */
  question?: string;
  /** grounded_chat only: earlier artifact ids for the same input. The server loads them (same user); never client text. */
  priorArtifactIds?: string[];
  /** What the user did, for provenance (e.g. 'click:explain_scan'). */
  userAction: string;
}

export interface GatewayDeps {
  env?: Env;
  redis?: RedisLike;
  budgetStore?: BudgetStore;
  now?: () => number;
  fetchImpl?: typeof fetch;
  providerTimeoutMs?: number;
  specs?: Record<AiRouteId, RouteSpec>;
  /** Launch-gate registry to consult (defaults to LAUNCH_GATES); injected by tests. */
  gates?: readonly LaunchGate[];
}

const USER_ACTION_RE = /^[a-z0-9_:.-]{1,64}$/;
const MAX_PROMPT_CHARS = 200_000;
export const MAX_PRIOR_ARTIFACTS = 4;

const unavailable = (reason: ReasonCode, artifactId: string | null = null): AiRouteResult => ({ status: 'unavailable', reason, artifactId });

function tryRedis(deps: GatewayDeps): RedisLike | null {
  if (deps.redis) return deps.redis;
  try {
    return getRedis() as unknown as RedisLike;
  } catch {
    return null;
  }
}

function disclosureClaims(notFresh: readonly { source: SourceKind }[]): Claim[] {
  return notFresh.map(({ source }) => ({
    text: `${SOURCE_LABELS[source]} data was missing or stale in this snapshot, so this explanation does not cover it.`,
    citationIds: [],
  }));
}

export async function runAiRoute(request: RunAiRouteRequest, deps: GatewayDeps = {}): Promise<AiRouteResult> {
  const cleanup: { fp: string | null; claimed: boolean; probeTier: RouteSpec['tier'] | null; redis: RedisLike | null } = {
    fp: null, claimed: false, probeTier: null, redis: null,
  };
  try {
    return await execute(request, deps, cleanup);
  } catch {
    // Never throw to the route. Free anything we hold; a held budget reservation is intentionally kept (spend unknown).
    if (cleanup.redis && cleanup.claimed && cleanup.fp && isSafeUserId(request.userId)) await idempotency.release(cleanup.redis, request.userId, cleanup.fp);
    if (cleanup.redis && cleanup.probeTier) await breaker.releaseProbe(cleanup.redis, cleanup.probeTier);
    return unavailable('PROVIDER_ERROR');
  }
}

async function execute(
  request: RunAiRouteRequest,
  deps: GatewayDeps,
  cleanup: { fp: string | null; claimed: boolean; probeTier: RouteSpec['tier'] | null; redis: RedisLike | null },
): Promise<AiRouteResult> {
  const env = deps.env ?? process.env;
  const now = deps.now ?? Date.now;
  const spec = (deps.specs ?? ROUTE_SPECS)[request.route];

  // Stage 1: flags, then kill switches. With no env set nothing below runs (no Redis, no network).
  if (!spec || spec.deferred || !isGloballyEnabled(env) || !isRouteEnabled(request.route, env, { gates: deps.gates, nowMs: now() }) || !spec.template) return unavailable('FLAG_OFF');
  const redis = tryRedis(deps);
  if (!redis) return unavailable('KILL_SWITCH');
  cleanup.redis = redis;
  if ((await checkKillSwitch(redis, request.route)).killed) return unavailable('KILL_SWITCH');

  // Stage 2: governance attestation, model allowlist and price, artifact key, budgets configured.
  const governance = resolveGovernance(spec.tier, env);
  if (!governance.ok || !governance.model || !governance.providerPolicyVersion) return unavailable('GOVERNANCE');
  if (!hasArtifactKey(env)) return unavailable('GOVERNANCE');
  const budgets = resolveBudgets(request.route, env);
  if (!budgets) return unavailable('BUDGET');

  // Request shape.
  if (!isSafeUserId(request.userId) || !USER_ACTION_RE.test(request.userAction ?? '')) return unavailable('INPUT_INVALID');
  let question: string | null = null;
  if (spec.requiresQuestion) {
    question = redactUserText(request.question ?? '').text;
    if (!question) return unavailable('INPUT_INVALID');
  }

  // Stage 3: load the input scoped to the acting user (missing and foreign are identical).
  const loaded = await getInput(redis, request.userId, request.inputId, env);
  if (!loaded.ok) return unavailable(loaded.reason);
  const input = loaded.input;
  const inputSpec = (deps.specs ?? ROUTE_SPECS)[spec.inputKind ?? request.route];
  if (
    !inputSpec || input.route !== inputSpec.route || input.schemaVersion !== inputSpec.schemaVersion ||
    !spec.allowedTrust.includes(input.trust) || Date.parse(input.expiresAt) <= now()
  ) {
    return unavailable('INPUT_INVALID');
  }

  // Earlier artifacts for this input, loaded by the server for the acting user only (never client-supplied text).
  const priorIds = request.priorArtifactIds ?? [];
  if (priorIds.length > 0 && (!spec.allowsPriorArtifacts || priorIds.length > MAX_PRIOR_ARTIFACTS || new Set(priorIds).size !== priorIds.length)) {
    return unavailable('INPUT_INVALID');
  }
  const priorOutputs: RenderedOutput[] = [];
  for (const priorId of priorIds) {
    const prior = await getArtifact(redis, request.userId, priorId, env);
    // Missing, foreign, another input's, or without a usable output: all the same NOT_FOUND.
    if (!prior || prior.inputId !== input.id || (prior.status !== 'ready' && prior.status !== 'stale') || !prior.output) return unavailable('NOT_FOUND');
    priorOutputs.push(prior.output);
  }

  // Stage 4: source-specific freshness. Deep routes need every source fresh; summary/chat disclose what is missing.
  const freshness = evaluateFreshness(input.sourceAsOf, spec.requiredSources, now());
  if (spec.strictFreshness && !freshness.allFresh) return unavailable('INPUT_STALE');

  // Prompt and worst-case cost (needed for the budget reservation).
  const system = spec.template.system;
  const user = spec.template.buildUserMessage(input, question, priorOutputs);
  if (system.length + user.length > MAX_PROMPT_CHARS) return unavailable('INPUT_INVALID');
  const estimateMicros = estimateWorstCaseMicros(governance.model, system.length + user.length, spec.maxOutputTokens);
  if (estimateMicros == null) return unavailable('GOVERNANCE');

  // Stage 5: idempotency. A completed claim returns the stored artifact without spending budget.
  const fp = idempotency.fingerprint(request.route, input.id, request.idempotencyKey, priorIds.length > 0 ? `${question ?? ''}\u0000${priorIds.join(',')}` : (question ?? ''));
  const claimed = await idempotency.claim(redis, request.userId, fp, request.idempotencyKey);
  if (claimed.state === 'invalid') return unavailable('INPUT_INVALID');
  if (claimed.state === 'pending' || claimed.state === 'error') return unavailable('RATE_LIMIT');
  if (claimed.state === 'cached') {
    const cached = await getArtifact(redis, request.userId, claimed.artifactId, env);
    if (!cached) return unavailable('NOT_FOUND');
    if (cached.status === 'ready' || cached.status === 'stale') return { status: cached.status, artifact: cached };
    if (cached.status === 'rejected') return { status: 'rejected', reason: 'VALIDATION_REJECTED', artifactId: cached.id };
    return unavailable(cached.reason ?? 'PROVIDER_ERROR', cached.id);
  }
  cleanup.claimed = true;
  cleanup.fp = fp;
  const freeClaim = async (): Promise<void> => {
    await idempotency.release(redis, request.userId, fp);
    cleanup.claimed = false;
  };

  // Stage 6: circuit breaker.
  const admission = await breaker.admit(redis, spec.tier, now());
  if (!admission.admitted) {
    await freeClaim();
    return unavailable('CIRCUIT_OPEN');
  }
  if (admission.probe) cleanup.probeTier = spec.tier;
  const abandonGate = async (): Promise<void> => {
    await freeClaim();
    if (admission.probe) await breaker.releaseProbe(redis, spec.tier);
    cleanup.probeTier = null;
  };

  // Stage 7: atomic budget reservation (route hourly, user monthly USD, global daily USD).
  const budgetStore = deps.budgetStore ?? new RedisBudgetStore(redis);
  const reserved = await budgetStore.reserve({ userId: request.userId, route: request.route, estimateMicros, limits: budgets, nowMs: now() });
  if (!reserved.ok) {
    await abandonGate();
    return unavailable(reserved.reason);
  }
  const reservation: BudgetReservation = reserved.reservation;

  // Stage 8: the only provider call.
  const providerRequest = buildProviderRequest({
    model: governance.model, system, user, maxOutputTokens: spec.maxOutputTokens, schemaName: `${request.route}_v1`, schema: spec.outputSchema,
  });
  const started = now();
  const provider = await callProvider(providerRequest, { env, fetchImpl: deps.fetchImpl, timeoutMs: deps.providerTimeoutMs });
  const latencyMs = Math.max(0, now() - started);
  cleanup.probeTier = null;

  const artifactId = randomUUID();
  // A refresh supersedes earlier artifacts for the same subject; standalone routes (chat turns) never do.
  const subject = subjectHash(request.route, spec.supersedesPrior === false ? `${input.subjectKey}\u0000${artifactId}` : input.subjectKey);
  const createdAt = new Date(now()).toISOString();
  const promptHash = sha256Hex(`${system}\u0000${user}`);
  const baseArtifact = {
    id: artifactId, userId: request.userId, route: request.route, inputId: input.id, accountScope: input.accountScope, trust: input.trust,
    tier: spec.tier, model: governance.model, templateId: spec.template.id, templateVersion: spec.template.version, createdAt,
    expiresAt: new Date(now() + ARTIFACT_TTL_SECONDS * 1000).toISOString(),
  };
  const provenanceBase = {
    artifactId, artifactType: request.route, provider: 'openai' as const, model: governance.model,
    templateId: spec.template.id, templateVersion: spec.template.version, policyVersion: AI_POLICY_VERSION,
    providerPolicyVersion: governance.providerPolicyVersion, lexiconVersion: LEXICON_VERSION, validatorVersion: VALIDATOR_VERSION,
    input: { id: input.id, payloadHash: input.payloadHash, schemaVersion: input.schemaVersion, trustClass: input.trust },
    authorizationScope: { accountScope: input.accountScope, userScope: userScopeId(request.userId) },
    sourceAsOf: input.sourceAsOf, deterministicStates: input.deterministicStates, promptHash,
    featureFlag: { global: 'AI_POLICY_ENABLED', route: ROUTE_ENV[request.route].flag }, userAction: request.userAction, createdAt,
  };
  const persist = async (status: ArtifactStatus, reason: ReasonCode | null, output: RenderedOutput | null, prov: Partial<ProvenanceRecord>): Promise<boolean> => {
    const record = {
      ...provenanceBase, status, providerModelId: null, citations: [], claimMap: [],
      validation: { result: 'not_run' as const, rule: null, outputHash: null },
      latencyMs, cost: { estimatedMicros: estimateMicros, actualMicros: null, inputTokens: null, outputTokens: null },
      failureReason: reason, ...prov,
    } as ProvenanceRecord;
    if (!(await saveProvenance(redis, request.userId, record))) return false;
    const artifact: AiArtifact = { ...baseArtifact, status, reason, output };
    return saveArtifact(redis, artifact, subject, env);
  };

  if (!provider.ok) {
    await breaker.recordFailure(redis, spec.tier, now(), admission.probe);
    if (!provider.chargeUnknown) await budgetStore.reconcile(reservation, 0);
    await persist('unavailable', provider.reason, null, {});
    await freeClaim();
    return unavailable(provider.reason, artifactId);
  }

  await breaker.recordSuccess(redis, spec.tier, admission.probe);
  const actual = provider.usage ? actualCostMicros(governance.model, provider.usage.inputTokens, provider.usage.outputTokens) : null;
  await budgetStore.reconcile(reservation, actual ?? estimateMicros);
  const spend = {
    providerModelId: provider.providerModelId,
    cost: { estimatedMicros: estimateMicros, actualMicros: actual, inputTokens: provider.usage?.inputTokens ?? null, outputTokens: provider.usage?.outputTokens ?? null },
  };
  const outputHash = sha256Hex(provider.text);

  // Stage 9: default-reject validation, then render.
  const verdict = validateAndRender({ rawText: provider.text, registry: spec.citableFields, input, nowMs: now() });
  if (!verdict.ok) {
    const stored = await persist('rejected', 'VALIDATION_REJECTED', null, { ...spend, validation: { result: 'rejected', rule: verdict.rule, outputHash } });
    if (!stored) {
      await freeClaim();
      return unavailable('PROVIDER_ERROR');
    }
    await idempotency.complete(redis, request.userId, fp, artifactId);
    return { status: 'rejected', reason: 'VALIDATION_REJECTED', artifactId };
  }

  // Stage 10: mandatory disclosure of omitted/stale sources (server-written, whatever the model said), then persist.
  const output: RenderedOutput = {
    ...verdict.output,
    missingOrStaleData: [
      ...verdict.output.missingOrStaleData,
      ...disclosureClaims(freshness.notFresh),
      ...(spec.serverDisclosures?.(input) ?? []).map((text): Claim => ({ text, citationIds: [] })),
    ],
  };
  const stored = await persist('ready', null, output, {
    ...spend, citations: verdict.citations, claimMap: verdict.claimMap, validation: { result: 'accepted', rule: null, outputHash },
  });
  if (!stored) {
    await freeClaim();
    return unavailable('PROVIDER_ERROR');
  }
  await markCurrent(redis, request.userId, request.route, subject, artifactId);
  await idempotency.complete(redis, request.userId, fp, artifactId);
  const artifact = await getArtifact(redis, request.userId, artifactId, env);
  return artifact ? { status: artifact.status === 'stale' ? 'stale' : 'ready', artifact } : unavailable('NOT_FOUND', artifactId);
}
