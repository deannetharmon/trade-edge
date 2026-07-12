// lib/portfolio-intelligence/health/factors.ts

import type { PositionHealthFactor, PositionHealthSeverity } from './types';

export function clampScore(score: number): number {
  if (!Number.isFinite(score)) return 50;
  return Math.max(0, Math.min(100, Math.round(score)));
}

export function normalizePercent(value: number | null | undefined): number | null {
  if (value == null || !Number.isFinite(value)) return null;
  return Math.abs(value) <= 1 ? value * 100 : value;
}

export function factor(
  key: string,
  label: string,
  scoreImpact: number,
  severity: PositionHealthSeverity,
  message: string
): PositionHealthFactor {
  return { key, label, scoreImpact, severity, message };
}

export function daysBetween(today: Date, dateString: string | null | undefined): number | null {
  if (!dateString) return null;
  const date = new Date(`${dateString}T00:00:00`);
  if (Number.isNaN(date.getTime())) return null;
  const a = new Date(today);
  a.setHours(0, 0, 0, 0);
  const b = new Date(date);
  b.setHours(0, 0, 0, 0);
  return Math.round((b.getTime() - a.getTime()) / 86_400_000);
}

export function isDateOnOrBeforeExpiration(dateString: string | null | undefined, expDate: string | null | undefined): boolean {
  if (!dateString || !expDate) return false;
  const date = new Date(`${dateString}T00:00:00`);
  const expiry = new Date(`${expDate}T23:59:59`);
  if (Number.isNaN(date.getTime()) || Number.isNaN(expiry.getTime())) return false;
  return date <= expiry;
}
