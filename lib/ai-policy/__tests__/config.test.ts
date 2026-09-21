// lib/ai-policy/__tests__/config.test.ts
import { describe, expect, it } from 'vitest';
import {
  PROVIDER_TIMEOUT_MS, ROUTE_MAX_DURATION_SECONDS, isRouteEnabled, modelForTier, parsePositiveInt, parseUsdToMicros,
  providerRequestProfile, resolveBudgets, resolveGovernance,
} from '../config';
import { MODEL_PRICES, actualCostMicros, estimateWorstCaseMicros, pricingFor } from '../pricing';
import { TEST_ENV } from '../fixtures/testRoute';

describe('config fails closed', () => {
  it('with no env every route is disabled and nothing resolves', () => {
    for (const route of ['scan_summary', 'grounded_chat', 'leaps_deep_analysis', 'pmcc_deep_analysis', 'retrospective_batch'] as const) {
      expect(isRouteEnabled(route, {})).toBe(false);
      expect(resolveBudgets(route, {})).toBeNull();
    }
    expect(resolveGovernance('economy', {}).ok).toBe(false);
    expect(modelForTier('reasoning', {})).toBeNull();
  });

  it('needs both the global and the route flag, spelled exactly "true"', () => {
    expect(isRouteEnabled('scan_summary', { AI_POLICY_SCAN_SUMMARY_ENABLED: 'true' })).toBe(false);
    expect(isRouteEnabled('scan_summary', { AI_POLICY_ENABLED: 'true' })).toBe(false);
    expect(isRouteEnabled('scan_summary', { AI_POLICY_ENABLED: 'TRUE', AI_POLICY_SCAN_SUMMARY_ENABLED: 'true' })).toBe(false);
    expect(isRouteEnabled('scan_summary', TEST_ENV)).toBe(true);
  });

  it('any unset or invalid budget makes the route unavailable', () => {
    expect(resolveBudgets('scan_summary', TEST_ENV)).toEqual({ routeHourlyLimit: 5, userMonthlyMicros: 5_000_000, globalDailyMicros: 20_000_000 });
    for (const drop of ['AI_POLICY_USER_MONTHLY_BUDGET_USD', 'AI_POLICY_GLOBAL_DAILY_BUDGET_USD', 'AI_POLICY_SCAN_SUMMARY_HOURLY_LIMIT']) {
      expect(resolveBudgets('scan_summary', { ...TEST_ENV, [drop]: undefined })).toBeNull();
      expect(resolveBudgets('scan_summary', { ...TEST_ENV, [drop]: 'abc' })).toBeNull();
      expect(resolveBudgets('scan_summary', { ...TEST_ENV, [drop]: '0' })).toBeNull();
    }
  });

  it('parses numbers strictly', () => {
    expect(parsePositiveInt('20')).toBe(20);
    for (const bad of ['0', '-1', '1.5', '1e3', ' 5', '', undefined]) expect(parsePositiveInt(bad)).toBeNull();
    expect(parseUsdToMicros('0.05')).toBe(50_000);
    for (const bad of ['0', '-1', '1e3', '$5', '', undefined, '0.0000001']) expect(parseUsdToMicros(bad)).toBeNull();
  });

  it('governance needs attestation, policy version, tier model, allowlist entry, and a price', () => {
    expect(resolveGovernance('economy', TEST_ENV)).toMatchObject({ ok: true, model: 'gpt-5.6-luna', providerPolicyVersion: 'test-policy-1' });
    const broken: Array<Record<string, string | undefined>> = [
      { AI_POLICY_PROVIDER_GOVERNANCE_ATTESTED: 'false' },
      { AI_POLICY_PROVIDER_POLICY_VERSION: undefined },
      { AI_POLICY_ECONOMY_MODEL: undefined },
      { AI_POLICY_ALLOWED_MODELS: 'something-else' },
      { AI_POLICY_ECONOMY_MODEL: 'gpt-4o-mini', AI_POLICY_ALLOWED_MODELS: 'gpt-4o-mini' }, // allowlisted but unpriced
    ];
    for (const patch of broken) expect(resolveGovernance('economy', { ...TEST_ENV, ...patch })).toMatchObject({ ok: false, reason: 'GOVERNANCE' });
    expect(resolveGovernance('batch', TEST_ENV).ok).toBe(false);
  });

  it('provider timeout stays below the route maxDuration', () => {
    expect(PROVIDER_TIMEOUT_MS).toBeLessThan(ROUTE_MAX_DURATION_SECONDS * 1000);
  });

  it('picks the token parameter and temperature handling per model family', () => {
    expect(providerRequestProfile('gpt-4o-mini')).toEqual({ tokenParam: 'max_tokens', supportsTemperature: true });
    for (const m of ['gpt-5.6-luna', 'gpt-6-astra', 'o3', 'o4-mini']) {
      expect(providerRequestProfile(m)).toEqual({ tokenParam: 'max_completion_tokens', supportsTemperature: false });
    }
  });
});

describe('pricing', () => {
  it('unknown model is unavailable', () => {
    expect(pricingFor('mystery-model')).toBeNull();
    expect(pricingFor('constructor')).toBeNull();
    expect(estimateWorstCaseMicros('mystery-model', 1000, 100)).toBeNull();
    expect(actualCostMicros('mystery-model', 1, 1)).toBeNull();
  });

  it('every priced model records its source date and a positive price', () => {
    for (const price of Object.values(MODEL_PRICES)) {
      expect(price.inputPerMTokUsd).toBeGreaterThan(0);
      expect(price.outputPerMTokUsd).toBeGreaterThan(price.inputPerMTokUsd);
      expect(price.verifiedOn).toBe('2026-09-21');
    }
  });

  it('worst case covers the full output allowance and is never below the actual cost of the same tokens', () => {
    const worst = estimateWorstCaseMicros('gpt-5.6-luna', 3000, 900)!;
    expect(worst).toBeGreaterThanOrEqual(actualCostMicros('gpt-5.6-luna', 1000, 900)!);
    // luna: 0.20/M input, 1.20/M output. 900 output tokens alone is 1080 micro-dollars.
    expect(worst).toBeGreaterThanOrEqual(1080);
  });
});
