// lib/autopilot/engine/frameworkRunner.ts

import { getAutopilotConfig } from '../persistence/configStore';
import { appendTelemetryEvent, createTelemetryEvent } from '../persistence/telemetryStore';
import { getPaperAccount, savePaperAccount } from '../persistence/paperAccountStore';
import { acquireAutopilotRunLock, releaseAutopilotRunLock } from '../scheduler/locking';
import { calculateDecisionConfidence } from '../scoring';
import type { AutopilotRunResult } from '../types';
import { createDecisionLogEntry } from '../models/decisionLog';
import { appendDecisionLog } from '../persistence/decisionLogStore';

export interface FrameworkRunOptions {
  source: 'manual' | 'cron';
}

export async function runAutopilotFrameworkDryRun(
  userId: string,
  options: FrameworkRunOptions,
): Promise<AutopilotRunResult> {
  const lock = await acquireAutopilotRunLock(userId);
  const timestamp = new Date().toISOString();

  if (!lock.acquired) {
    const config = await getAutopilotConfig(userId);
    const account = await getPaperAccount(userId);
    const entry = createDecisionLogEntry({
      config,
      action: 'no_action',
      reason: 'Autopilot framework dry run skipped because another run lock is active.',
      rulesTriggered: ['run_lock_active'],
      rulesBlocked: ['framework_run'],
      metadata: { source: options.source },
    });
    await appendDecisionLog(userId, entry);
    await appendTelemetryEvent(createTelemetryEvent({
      userId,
      eventType: options.source === 'cron' ? 'cron_probe' : 'manual_probe',
      status: 'blocked',
      message: 'Run lock already active; dry run skipped.',
      metadata: { lockKey: lock.key },
    }));

    return {
      runId: lock.lockId,
      timestamp,
      userId,
      scannedCandidates: 0,
      openedPositions: 0,
      suppressedCandidates: 0,
      decisions: [entry],
      account,
    };
  }

  try {
    const config = await getAutopilotConfig(userId);
    let account = await getPaperAccount(userId);

    const confidence = calculateDecisionConfidence({
      legs: [],
      now: new Date(),
    });

    const entry = createDecisionLogEntry({
      config,
      action: 'no_action',
      reason: 'Autopilot framework dry run completed. Candidate scanning and trading execution are not enabled in Sprint 1B.',
      decisionConfidence: confidence.total,
      rulesTriggered: ['framework_dry_run', options.source],
      rulesBlocked: ['candidate_scanning_not_enabled', 'paper_execution_not_enabled', 'live_trading_disabled'],
      metadata: { source: options.source, confidence, lockId: lock.lockId },
    });

    await appendDecisionLog(userId, entry);
    await appendTelemetryEvent(createTelemetryEvent({
      userId,
      eventType: options.source === 'cron' ? 'cron_probe' : 'manual_probe',
      status: 'ok',
      message: 'Framework dry run completed without trading.',
      metadata: { confidence, lockId: lock.lockId },
    }));

    account.lastRunAt = timestamp;
    account = await savePaperAccount(account);

    return {
      runId: lock.lockId,
      timestamp,
      userId,
      scannedCandidates: 0,
      openedPositions: 0,
      suppressedCandidates: 0,
      decisions: [entry],
      account,
    };
  } finally {
    await releaseAutopilotRunLock(userId, lock.lockId);
  }
}
