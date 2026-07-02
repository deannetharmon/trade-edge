// lib/autopilot/models/paperAccount.ts

import type { PaperAccount } from '../types';

export function getPaperDrawdownPct(account: PaperAccount): number {
  if (account.peakBalance <= 0) return 0;
  return ((account.peakBalance - account.currentBalance) / account.peakBalance) * 100;
}

export function getOpenRisk(account: PaperAccount): number {
  return account.openPositions.reduce((sum, position) => sum + Math.max(0, position.theoreticalMaxLoss), 0);
}

export function getOpenRiskPct(account: PaperAccount): number {
  if (account.currentBalance <= 0) return 0;
  return (getOpenRisk(account) / account.currentBalance) * 100;
}
