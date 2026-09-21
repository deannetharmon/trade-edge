// lib/ai-policy/config.ts
//
// Resolves flags, tier -> model, allowlist, governance attestation, budgets, and the freshness table from the
// environment. Every function FAILS CLOSED: a missing or invalid value makes the route unavailable, never permissive.
// Env is read at call time (never at import) and can be injected for tests.

import type { AiRouteId, AiTier, Env, ReasonCode, SourceKind } from './types';
import { pricingFor } from './pricing';

/** Vercel `maxDuration` for AI routes; the provider timeout must stay below it (Alan's condition). */
export const ROUTE_MAX_DURATION_SECONDS = 60;
export const PROVIDER_TIMEOUT_MS = 45_000;

export const AI_POLICY_VERSION = 'ai-policy-v1';

export const ROUTE_ENV: Record<AiRouteId, { flag: string; hourlyLimit: string }> = {
  scan_summary: { flag: 'AI_POLICY_SCAN_SUMMARY_ENABLED', hourlyLimit: 'AI_POLICY_SCAN_SUMMARY_HOURLY_LIMIT' },
  grounded_chat: { flag: 'AI_POLICY_GROUNDED_CHAT_ENABLED', hourlyLimit: 'AI_POLICY_GROUNDED_CHAT_HOURLY_LIMIT' },
  leaps_deep_analysis: { flag: 'AI_POLICY_LEAPS_DEEP_ENABLED', hourlyLimit: 'AI_POLICY_LEAPS_DEEP_HOURLY_LIMIT' },
  pmcc_deep_analysis: { flag: 'AI_POLICY_PMCC_DEEP_ENABLED', hourlyLimit: 'AI_POLICY_PMCC_DEEP_HOURLY_LIMIT' },
  retrospective_batch: { flag: 'AI_POLICY_RETRO_BATCH_ENABLED', hourlyLimit: 'AI_POLICY_RETRO_BATCH_HOURLY_LIMIT' },
};

/** D7 (Ian, accepted 2026-09-19). A source with no entry here is treated as stale. */
export const FRESHNESS_MAX_AGE_SECONDS: Record<SourceKind, number> = {
  quoteGreeks: 300,
  brokerPositionCapacity: 900,
  earningsCalendar: 86_400,
  scanCalculation: 8 * 3600,
};

export const ARTIFACT_TTL_SECONDS = 90 * 24 * 3600; // D4
export const AUDIT_TTL_SECONDS = 548 * 24 * 3600; // D4

function isTrue(value: string | undefined): boolean {
  return value === 'true';
}

export function isGloballyEnabled(env: Env = process.env): boolean {
  return isTrue(env.AI_POLICY_ENABLED);
}

export function isRouteEnabled(route: AiRouteId, env: Env = process.env): boolean {
  return isGloballyEnabled(env) && isTrue(env[ROUTE_ENV[route].flag]);
}

export function parsePositiveInt(value: string | undefined, max = 1_000_000): number | null {
  if (value == null || !/^[1-9]\d{0,9}$/.test(value)) return null;
  const n = Number(value);
  return n <= max ? n : null;
}

/** Positive decimal USD with up to 6 places, returned as integer micro-dollars. */
export function parseUsdToMicros(value: string | undefined): number | null {
  if (value == null || !/^\d{1,7}(\.\d{1,6})?$/.test(value)) return null;
  const micros = Math.round(Number(value) * 1_000_000);
  return micros > 0 ? micros : null;
}

export interface BudgetConfig {
  routeHourlyLimit: number;
  userMonthlyMicros: number;
  globalDailyMicros: number;
}

export function resolveBudgets(route: AiRouteId, env: Env = process.env): BudgetConfig | null {
  const routeHourlyLimit = parsePositiveInt(env[ROUTE_ENV[route].hourlyLimit], 100_000);
  const userMonthlyMicros = parseUsdToMicros(env.AI_POLICY_USER_MONTHLY_BUDGET_USD);
  const globalDailyMicros = parseUsdToMicros(env.AI_POLICY_GLOBAL_DAILY_BUDGET_USD);
  if (routeHourlyLimit == null || userMonthlyMicros == null || globalDailyMicros == null) return null;
  return { routeHourlyLimit, userMonthlyMicros, globalDailyMicros };
}

export function resolveAllowlist(env: Env = process.env): string[] {
  return (env.AI_POLICY_ALLOWED_MODELS ?? '')
    .split(',')
    .map((m) => m.trim())
    .filter(Boolean);
}

export function modelForTier(tier: AiTier, env: Env = process.env): string | null {
  const raw = tier === 'economy' ? env.AI_POLICY_ECONOMY_MODEL : tier === 'reasoning' ? env.AI_POLICY_REASONING_MODEL : undefined;
  const model = raw?.trim();
  return model ? model : null;
}

export interface ProviderRequestProfile {
  tokenParam: 'max_tokens' | 'max_completion_tokens';
  supportsTemperature: boolean;
}

/**
 * Token-limit parameter and temperature handling per model family (recorded here per the ticket).
 * Newer reasoning-capable families (gpt-5.x, gpt-6.x, o-series) take `max_completion_tokens` and reject `temperature`;
 * older chat models take `max_tokens` and `temperature`. Confirm with the first live call before enabling a route.
 */
export function providerRequestProfile(model: string): ProviderRequestProfile {
  const reasoningFamily = /^(?:gpt-[5-9]|o\d)/.test(model);
  return reasoningFamily
    ? { tokenParam: 'max_completion_tokens', supportsTemperature: false }
    : { tokenParam: 'max_tokens', supportsTemperature: true };
}

export interface GovernanceResolution {
  ok: boolean;
  reason: ReasonCode | null;
  model: string | null;
  providerPolicyVersion: string | null;
}

/** Stage 2 of the gateway: attestation, policy version, model set, allowlisted, and priced. */
export function resolveGovernance(tier: AiTier, env: Env = process.env): GovernanceResolution {
  const fail = (): GovernanceResolution => ({ ok: false, reason: 'GOVERNANCE', model: null, providerPolicyVersion: null });
  if (!isTrue(env.AI_POLICY_PROVIDER_GOVERNANCE_ATTESTED)) return fail();
  const providerPolicyVersion = env.AI_POLICY_PROVIDER_POLICY_VERSION?.trim();
  if (!providerPolicyVersion) return fail();
  const model = modelForTier(tier, env);
  if (!model) return fail();
  if (!resolveAllowlist(env).includes(model)) return fail();
  if (!pricingFor(model)) return fail();
  return { ok: true, reason: null, model, providerPolicyVersion };
}

export function maxAgeSeconds(source: SourceKind): number | null {
  return FRESHNESS_MAX_AGE_SECONDS[source] ?? null;
}
