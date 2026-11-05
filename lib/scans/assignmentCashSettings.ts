// lib/scans/assignmentCashSettings.ts

// ASSIGN-CASH-0001 -- the trader's reserve and margin-backed-assignment settings. localStorage only (UI state), read
// defensively: storage can be missing, blocked or hold stale values, and any bad value falls back to the safe default
// (5% reserve, margin-backed OFF per DR-0001).

import { DEFAULT_RESERVE, type ReserveSetting } from './assignmentCash';

export const LS_ASSIGNMENT_CASH_SETTINGS = 'hunter-assignment-cash-settings';

export interface AssignmentCashSettings {
  reserve: ReserveSetting;
  /** Off by default. Turning it on needs its own risk acknowledgment, and each over-limit order still needs a borrowing confirmation. */
  marginBackedEnabled: boolean;
}

export const DEFAULT_ASSIGNMENT_CASH_SETTINGS: AssignmentCashSettings = { reserve: DEFAULT_RESERVE, marginBackedEnabled: false };

export function decodeAssignmentCashSettings(raw: unknown): AssignmentCashSettings {
  if (!raw || typeof raw !== 'object') return DEFAULT_ASSIGNMENT_CASH_SETTINGS;
  const r = raw as Record<string, unknown>;
  const reserve = r.reserve as Record<string, unknown> | undefined;
  const kindOk = reserve?.kind === 'percent' || reserve?.kind === 'fixed';
  const valueOk = typeof reserve?.value === 'number' && Number.isFinite(reserve.value) && reserve.value >= 0
    && !(reserve.kind === 'percent' && reserve.value > 100);
  return {
    reserve: kindOk && valueOk ? { kind: reserve!.kind as 'percent' | 'fixed', value: reserve!.value as number } : DEFAULT_RESERVE,
    marginBackedEnabled: r.marginBackedEnabled === true,
  };
}

export function loadAssignmentCashSettings(): AssignmentCashSettings {
  try {
    if (typeof window === 'undefined') return DEFAULT_ASSIGNMENT_CASH_SETTINGS;
    const text = window.localStorage.getItem(LS_ASSIGNMENT_CASH_SETTINGS);
    return text ? decodeAssignmentCashSettings(JSON.parse(text)) : DEFAULT_ASSIGNMENT_CASH_SETTINGS;
  } catch {
    return DEFAULT_ASSIGNMENT_CASH_SETTINGS;
  }
}

export function saveAssignmentCashSettings(settings: AssignmentCashSettings): void {
  try {
    if (typeof window !== 'undefined') window.localStorage.setItem(LS_ASSIGNMENT_CASH_SETTINGS, JSON.stringify(settings));
  } catch {
    // Storage blocked: the setting simply does not persist; defaults apply next time.
  }
}
