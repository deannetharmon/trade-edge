// lib/ai-policy/__tests__/launchGates.test.ts
//
// AI-POLICY-0001F acceptance 1, 2, 3 and 5: the registry, its validation, and the gate on route enablement.

import { existsSync, readFileSync } from 'fs';
import path from 'path';
import { describe, expect, it, vi } from 'vitest';
import { isRouteEnabled } from '../config';
import { freezeScanSession } from '../freezeScanSession';
import { readArtifactForUser } from '../artifactRead';
import { runAiRoute } from '../gateway';
import { LAUNCH_GATES, MEASURE_KEYS, findActiveGate, gateRecordPath, hasLaunchGate, isGateActive, isProductionEnv, isUngatedPreviewAllowed, validateGateRecord, validateRegistry } from '../launchGates';
import type { LaunchGate } from '../launchGates';
import { FakeRedis } from '../fixtures/fakeRedis';
import { testGate } from '../fixtures/testGate';
import { TEST_ENV, USER, fakeFetch } from '../fixtures/testRoute';
import { makeSession, scanOutputJson } from '../builders/testing/scanSessionFixture';
import { AI_ROUTE_IDS } from '../types';
import type { AiRouteId } from '../types';

const ROOT = path.resolve(__dirname, '..', '..', '..');
const DAY = 86_400_000;
const NOW = Date.now();
const LIVE_ROUTES: AiRouteId[] = ['scan_summary', 'grounded_chat', 'leaps_deep_analysis', 'pmcc_deep_analysis'];

/** All flags on and NO bypass: the shape of a real Production environment. */
const PROD_ENV = { ...TEST_ENV, VERCEL_ENV: 'production', AI_POLICY_ALLOW_UNGATED_PREVIEW: undefined };
const flagsOn = (env: Record<string, string | undefined>): Record<string, string | undefined> => ({ ...env, AI_POLICY_LEAPS_DEEP_ENABLED: 'true', AI_POLICY_PMCC_DEEP_ENABLED: 'true' });

describe('acceptance 2: a record missing anything fails validation at test time', () => {
  it('the test record is valid', () => expect(validateGateRecord(testGate())).toEqual([]));

  const strip = (mutate: (g: Record<string, any>) => void): unknown => {
    const g = JSON.parse(JSON.stringify(testGate())) as Record<string, any>;
    mutate(g);
    return g;
  };

  it.each([
    ['owner', (g: any) => delete g.owner, 'owner is missing'],
    ['a blank owner', (g: any) => { g.owner = '   '; }, 'owner is missing'],
    ['approver', (g: any) => delete g.approver, 'approver is missing'],
    ['a template placeholder approver', (g: any) => { g.approver = '<name>'; }, 'approver is missing'],
    ['a TBD owner', (g: any) => { g.owner = 'TBD'; }, 'owner is missing'],
    ['approvedAt', (g: any) => delete g.approvedAt, 'approvedAt'],
    ['an unparsable approvedAt', (g: any) => { g.approvedAt = 'next week'; }, 'approvedAt'],
    ['expiresAt', (g: any) => delete g.expiresAt, 'expiresAt'],
    ['an expiresAt before approvedAt', (g: any) => { g.expiresAt = g.approvedAt; }, 'expiresAt must be after approvedAt'],
    ['thresholds', (g: any) => delete g.thresholds, 'thresholds are missing'],
    ['minSample', (g: any) => delete g.minSample, 'minSample is missing'],
    ['minSample.syntheticFixtures', (g: any) => { g.minSample.syntheticFixtures = 0; }, 'minSample.syntheticFixtures'],
    ['minSample.humanAuditedOutputs', (g: any) => delete g.minSample.humanAuditedOutputs, 'minSample.humanAuditedOutputs'],
    ['a fractional sample', (g: any) => { g.minSample.syntheticFixtures = 2.5; }, 'minSample.syntheticFixtures'],
    ['a negative consented sample', (g: any) => { g.minSample.consentedSnapshots = -1; }, 'minSample.consentedSnapshots'],
    ['holdPeriodDays', (g: any) => delete g.holdPeriodDays, 'holdPeriodDays'],
    ['a zero hold period', (g: any) => { g.holdPeriodDays = 0; }, 'holdPeriodDays'],
    ['rollbackTriggers', (g: any) => delete g.rollbackTriggers, 'rollbackTriggers'],
    ['an empty rollbackTriggers list', (g: any) => { g.rollbackTriggers = []; }, 'rollbackTriggers'],
    ['a trigger without a description', (g: any) => { g.rollbackTriggers[0].description = ''; }, 'rollbackTriggers[0].description'],
    ['a trigger without a measurement', (g: any) => delete g.rollbackTriggers[0].measurement, 'rollbackTriggers[0].measurement'],
    ['a trigger with an unknown action', (g: any) => { g.rollbackTriggers[0].action = 'ignore'; }, 'rollbackTriggers[0].action'],
    ['a duplicate trigger id', (g: any) => { g.rollbackTriggers.push({ ...g.rollbackTriggers[0] }); }, 'duplicate'],
    ['an unknown route', (g: any) => { g.route = 'other_route'; }, 'route is missing or unknown'],
    ['a zero version', (g: any) => { g.version = 0; }, 'version'],
    ['an id that does not match route and version', (g: any) => { g.id = 'scan_summary-v9'; }, 'id must be'],
    ['an unknown measure', (g: any) => { g.thresholds.vibes = 1; }, 'not a known measure'],
    ['a malformed revokedAt', (g: any) => { g.revokedAt = 'yesterday-ish'; }, 'revokedAt'],
  ])('rejects %s', (_name, mutate, expected) => {
    const errors = validateGateRecord(strip(mutate as (g: Record<string, any>) => void));
    expect(errors.length).toBeGreaterThan(0);
    expect(errors.join('\n')).toContain(expected);
  });

  it.each(MEASURE_KEYS.map((k) => [k]))('rejects a record missing the %s threshold', (key) => {
    const errors = validateGateRecord(strip((g) => delete g.thresholds[key]));
    expect(errors.join('\n')).toContain(`thresholds.${key}`);
  });

  it.each([
    ['gte rate of 0', 'groundedAccuracy', 0], ['lte rate of 1', 'falseRejectionRate', 1], ['a rate above 1', 'claimVerificationRate', 1.2], ['a negative rate', 'freshnessHandlingRate', -0.1],
    ['a non-number', 'p95LatencyMs', 'fast'], ['a zero latency', 'p95LatencyMs', 0], ['a zero cost', 'p95CostPerRequestUsd', 0], ['NaN', 'userMonthlyBudgetUsd', NaN],
    ['a usefulness of 1 (passes everything)', 'usefulnessMean', 1], ['a usefulness above 5', 'usefulnessMean', 6],
  ])('rejects %s (a threshold every result would pass, or not a number in range)', (_n, key, value) => {
    expect(validateGateRecord(strip((g) => { g.thresholds[key as string] = value; })).join('\n')).toContain(`thresholds.${key}`);
  });

  it.each([[null], [undefined], ['gate'], [[]], [5]])('rejects a non-object record (%s)', (value) => {
    expect(validateGateRecord(value)).toEqual(['record is not an object']);
  });

  it('a registry with a duplicate id or an invalid entry fails', () => {
    expect(validateRegistry([testGate(), testGate()]).join('\n')).toContain('duplicate id');
    expect(validateRegistry([testGate(), { ...testGate('grounded_chat'), owner: '' }]).join('\n')).toContain('grounded_chat-v1: owner is missing');
    expect(validateRegistry([testGate(), testGate('grounded_chat')])).toEqual([]);
  });
});

describe('the shipped registry', () => {
  it('is valid: every entry passes validation and ids are unique', () => {
    expect(validateRegistry(LAUNCH_GATES)).toEqual([]);
  });

  it('every entry has its markdown record, marked APPROVED, and none points at a DRAFT file', () => {
    for (const gate of LAUNCH_GATES) {
      const file = path.join(ROOT, gateRecordPath(gate));
      expect(existsSync(file), `${gate.id} needs ${gateRecordPath(gate)}`).toBe(true);
      expect(readFileSync(file, 'utf8')).toMatch(/\*\*Status:\*\*\s*APPROVED/);
      expect(gate.id).not.toMatch(/DRAFT/i);
    }
  });

  it('acceptance 5: a draft, unapproved record exists for each live route, with blank threshold cells', () => {
    for (const route of LIVE_ROUTES) {
      const file = path.join(ROOT, `docs/ai-policy/launch-gates/${route}-v1-DRAFT.md`);
      expect(existsSync(file), `${route}-v1-DRAFT.md`).toBe(true);
      const text = readFileSync(file, 'utf8');
      expect(text).toMatch(/\*\*Status:\*\*\s*DRAFT/);
      expect(text).not.toMatch(/\*\*Status:\*\*\s*APPROVED/);
      const rows = text.split('\n').filter((line) => /^\|\s*(Grounded accuracy|Claim verification|Prohibited-output|False-rejection|Freshness handling|p95 latency|Cost per request|Usefulness)/.test(line));
      expect(rows).toHaveLength(8);
      for (const row of rows) expect(row.split('|')[2].trim(), row).toBe('');
    }
  });

  it('the launch-gate template and reviewer form exist', () => {
    for (const f of ['TEMPLATE.md', 'reviewer-form.md']) expect(existsSync(path.join(ROOT, 'docs/ai-policy/launch-gates', f))).toBe(true);
  });
});

describe('gate activity', () => {
  const t = (g: unknown, ms: number): boolean => isGateActive(g, ms);
  const gate = testGate('scan_summary', {}, NOW);

  it('is active from approval until expiry, and not before or after', () => {
    const approved = Date.parse(gate.approvedAt);
    const expires = Date.parse(gate.expiresAt);
    expect([t(gate, approved - 1), t(gate, approved), t(gate, expires - 1), t(gate, expires), t(gate, expires + DAY)]).toEqual([false, true, true, false, false]);
  });

  it('a revoked gate is never active once the revocation time has passed', () => {
    expect(t({ ...gate, revokedAt: new Date(NOW - 1000).toISOString() }, NOW)).toBe(false);
    expect(t({ ...gate, revokedAt: new Date(NOW + DAY).toISOString() }, NOW)).toBe(true);
    expect(t({ ...gate, revokedAt: null }, NOW)).toBe(true);
  });

  it('an invalid record is never active, however its dates look', () => {
    expect(t({ ...gate, holdPeriodDays: 0 }, NOW)).toBe(false);
    expect(t({ ...gate, rollbackTriggers: [] }, NOW)).toBe(false);
    expect(t({ ...gate, thresholds: { ...gate.thresholds, p95LatencyMs: undefined } }, NOW)).toBe(false);
    expect(t('gate', NOW)).toBe(false);
  });

  it('a gate applies only to its own route', () => {
    expect(findActiveGate('scan_summary', [gate], NOW)?.id).toBe('scan_summary-v1');
    expect(findActiveGate('grounded_chat', [gate], NOW)).toBeNull();
  });
});

describe('environment: what counts as Production, and the preview bypass', () => {
  it.each([
    [{ VERCEL_ENV: 'production' }, true], [{ VERCEL_ENV: 'production', NODE_ENV: 'development' }, true], [{ VERCEL_ENV: 'preview', NODE_ENV: 'production' }, false],
    [{ VERCEL_ENV: 'development' }, false], [{ NODE_ENV: 'production' }, true], [{ NODE_ENV: 'development' }, false], [{ NODE_ENV: 'test' }, false], [{}, false],
  ])('%j is production: %s', (env, expected) => expect(isProductionEnv(env)).toBe(expected));

  const bypass = { AI_POLICY_ALLOW_UNGATED_PREVIEW: 'true' };
  it('the bypass works in preview, dev and test, and only when set exactly to "true"', () => {
    for (const env of [{ VERCEL_ENV: 'preview', NODE_ENV: 'production' }, { VERCEL_ENV: 'development' }, { NODE_ENV: 'development' }, { NODE_ENV: 'test' }]) {
      expect(isUngatedPreviewAllowed({ ...env, ...bypass })).toBe(true);
      expect(isUngatedPreviewAllowed(env)).toBe(false);
      expect(isUngatedPreviewAllowed({ ...env, AI_POLICY_ALLOW_UNGATED_PREVIEW: 'TRUE' })).toBe(false);
      expect(isUngatedPreviewAllowed({ ...env, AI_POLICY_ALLOW_UNGATED_PREVIEW: '1' })).toBe(false);
    }
  });

  it('the bypass is IGNORED in Production, on Vercel or off it', () => {
    expect(isUngatedPreviewAllowed({ VERCEL_ENV: 'production', ...bypass })).toBe(false);
    expect(isUngatedPreviewAllowed({ NODE_ENV: 'production', ...bypass })).toBe(false);
    expect(hasLaunchGate('scan_summary', { VERCEL_ENV: 'production', ...bypass }, [], NOW)).toBe(false);
  });
});

describe('acceptance 1: with the registry empty every route is unavailable in Production, even with its flag on', () => {
  it.each(AI_ROUTE_IDS.map((r) => [r]))('%s', (route) => {
    const env = flagsOn(PROD_ENV);
    expect(isRouteEnabled(route, env, { gates: [], nowMs: NOW })).toBe(false);
    // Even the explicit bypass cannot enable it in Production.
    expect(isRouteEnabled(route, { ...env, AI_POLICY_ALLOW_UNGATED_PREVIEW: 'true' }, { gates: [], nowMs: NOW })).toBe(false);
    expect(isRouteEnabled(route, { ...env, VERCEL_ENV: undefined, NODE_ENV: 'production', AI_POLICY_ALLOW_UNGATED_PREVIEW: 'true' }, { gates: [], nowMs: NOW })).toBe(false);
  });

  it('through the gateway: FLAG_OFF, no Redis use and no provider call', async () => {
    const redis = new FakeRedis();
    redis.failAll = true; // any use would surface as KILL_SWITCH instead of FLAG_OFF
    const fetchImpl = vi.fn();
    for (const route of LIVE_ROUTES) {
      const result = await runAiRoute({ route, userId: USER, inputId: '11111111-1111-4111-8111-111111111111', idempotencyKey: 'prod-empty-registry-0001', userAction: 'click:x', question: 'q' }, { env: { ...flagsOn(PROD_ENV), AI_POLICY_ALLOW_UNGATED_PREVIEW: 'true' }, redis, fetchImpl: fetchImpl as unknown as typeof fetch, gates: [] });
      expect(result).toEqual({ status: 'unavailable', reason: 'FLAG_OFF', artifactId: null });
    }
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('freezing a snapshot and reading an artifact are unavailable too', async () => {
    const redis = new FakeRedis();
    expect(await freezeScanSession({ userId: USER, session: makeSession(), idempotencyKey: 'prod-freeze-key-000001' }, { env: PROD_ENV, redis, gates: [] })).toEqual({ status: 'unavailable', reason: 'FLAG_OFF' });
    expect(await readArtifactForUser(USER, '11111111-1111-4111-8111-111111111111', { env: PROD_ENV, redis, gates: [] })).toEqual({ status: 'unavailable', reason: 'FLAG_OFF' });
    expect(redis.store.size).toBe(0);
  });

  it('a gate alone does not enable a route whose flag is off', () => {
    const gate = testGate('scan_summary', {}, NOW);
    expect(isRouteEnabled('scan_summary', { ...PROD_ENV, AI_POLICY_SCAN_SUMMARY_ENABLED: undefined }, { gates: [gate], nowMs: NOW })).toBe(false);
    expect(isRouteEnabled('scan_summary', { ...PROD_ENV, AI_POLICY_ENABLED: undefined }, { gates: [gate], nowMs: NOW })).toBe(false);
    expect(isRouteEnabled('scan_summary', PROD_ENV, { gates: [gate], nowMs: NOW })).toBe(true);
  });

  it('a valid gate enables only its own route in Production', () => {
    const gate = testGate('scan_summary', {}, NOW);
    const enabled = AI_ROUTE_IDS.filter((r) => isRouteEnabled(r, flagsOn(PROD_ENV), { gates: [gate], nowMs: NOW }));
    expect(enabled).toEqual(['scan_summary']);
  });

  it('Preview without the bypass is gated too; with it, ungated', () => {
    const preview = { ...TEST_ENV, VERCEL_ENV: 'preview', NODE_ENV: 'production', AI_POLICY_ALLOW_UNGATED_PREVIEW: undefined };
    expect(isRouteEnabled('scan_summary', preview, { gates: [], nowMs: NOW })).toBe(false);
    expect(isRouteEnabled('scan_summary', { ...preview, AI_POLICY_ALLOW_UNGATED_PREVIEW: 'true' }, { gates: [], nowMs: NOW })).toBe(true);
  });
});

describe('acceptance 3: an expired or revoked gate makes the route unavailable, with no redeploy', () => {
  async function scenario(gate: LaunchGate) {
    const redis = new FakeRedis();
    const gates = [gate];
    const frozen = await freezeScanSession({ userId: USER, session: makeSession(), idempotencyKey: 'gate-freeze-key-000001' }, { env: PROD_ENV, redis, gates });
    if (frozen.status !== 'frozen') throw new Error(`freeze failed: ${JSON.stringify(frozen)}`);
    const fetchImpl = vi.fn(fakeFetch(scanOutputJson()));
    const run = (key: string, now?: () => number) =>
      runAiRoute({ route: 'scan_summary', userId: USER, inputId: frozen.analysisInputId, idempotencyKey: key, userAction: 'click:x' }, { env: PROD_ENV, redis, fetchImpl: fetchImpl as unknown as typeof fetch, gates, now });
    return { run, fetchImpl, redis };
  }

  it('works while the gate is valid, then stops when it expires (same code, same environment)', async () => {
    const s = await scenario(testGate('scan_summary', {}, NOW));
    expect((await s.run('gate-run-key-0000000001')).status).toBe('ready');
    const later = await s.run('gate-run-key-0000000002', () => Date.now() + 31 * DAY);
    expect(later).toEqual({ status: 'unavailable', reason: 'FLAG_OFF', artifactId: null });
    expect(s.fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('a revoked gate stops the route as soon as the revocation time passes', async () => {
    const revokeAt = Date.now() + 60_000;
    const s = await scenario(testGate('scan_summary', { revokedAt: new Date(revokeAt).toISOString() }, NOW));
    expect((await s.run('gate-run-key-0000000003')).status).toBe('ready');
    expect(await s.run('gate-run-key-0000000004', () => revokeAt + 1000)).toMatchObject({ status: 'unavailable', reason: 'FLAG_OFF' });
  });

  it('a gate that is not yet approved does not enable the route', async () => {
    const redis = new FakeRedis();
    const future = testGate('scan_summary', { approvedAt: new Date(NOW + DAY).toISOString(), expiresAt: new Date(NOW + 30 * DAY).toISOString() }, NOW);
    expect(await freezeScanSession({ userId: USER, session: makeSession(), idempotencyKey: 'gate-freeze-key-000002' }, { env: PROD_ENV, redis, gates: [future] })).toEqual({ status: 'unavailable', reason: 'FLAG_OFF' });
  });

  it('the kill switch still works on top of a valid gate', async () => {
    const s = await scenario(testGate('scan_summary', {}, NOW));
    await s.redis.set('ai-policy:kill:route:scan_summary', '1');
    expect(await s.run('gate-run-key-0000000005')).toMatchObject({ reason: 'KILL_SWITCH' });
  });
});
