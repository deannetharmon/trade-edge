// lib/ai-policy/fixtures/testGate.ts
//
// A structurally valid launch-gate record for TESTS ONLY. The numbers are synthetic values that make the validation and
// comparison logic testable; they are not proposed thresholds and no code path uses them outside tests.

import type { LaunchGate } from '../launchGates';
import type { AiRouteId } from '../types';

const DAY = 86_400_000;

export function testGate(route: AiRouteId = 'scan_summary', over: Partial<LaunchGate> = {}, nowMs: number = Date.now()): LaunchGate {
  const version = over.version ?? 1;
  return {
    id: `${route}-v${version}`,
    route,
    version,
    owner: 'Test Owner',
    approver: 'Test Approver',
    approvedAt: new Date(nowMs - DAY).toISOString(),
    expiresAt: new Date(nowMs + 30 * DAY).toISOString(),
    thresholds: {
      groundedAccuracy: 0.9, claimVerificationRate: 0.95, prohibitedOutputRejectionRate: 0.99, falseRejectionRate: 0.1,
      freshnessHandlingRate: 0.9, p95LatencyMs: 20_000, p95CostPerRequestUsd: 0.05, userMonthlyBudgetUsd: 5, usefulnessMean: 3.5,
    },
    minSample: { syntheticFixtures: 3, consentedSnapshots: 0, humanAuditedOutputs: 10 },
    holdPeriodDays: 7,
    rollbackTriggers: [{ id: 'rt-1', description: 'An accepted output contains an invented number', measurement: 'Audit sample review', action: 'kill_switch' }],
    ...over,
  };
}
