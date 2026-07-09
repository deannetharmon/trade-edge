// lib/autopilot/models/paperPosition.ts

import type { PaperPosition } from '../types';

export function isOpenPaperPosition(position: PaperPosition): boolean {
  return position.status === 'open';
}

export function getPaperPositionDaysOpen(position: PaperPosition, now = new Date()): number {
  const entry = new Date(position.entryDate).getTime();
  if (!Number.isFinite(entry)) return 0;
  return Math.max(0, Math.floor((now.getTime() - entry) / 86400000));
}

export function getPaperPositionNetCredit(position: PaperPosition): number {
  const closeCredit = position.closeCredit ?? 0;
  return position.entryCredit - closeCredit;
}
