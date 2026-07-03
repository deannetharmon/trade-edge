// features/portfolio/recommendations/recommendation-rules.ts

import type {
  PortfolioRecommendation,
  PortfolioRecommendationInput,
  PortfolioRecommendationKind,
  PortfolioRecommendationUrgency,
} from './recommendation-types';

export function normalizeRecommendationPct(value: number | null | undefined): number | null {
  if (value == null || !Number.isFinite(value)) return null;
  return Math.abs(value) <= 1 ? value * 100 : value;
}

export function hasHealthFactor(input: PortfolioRecommendationInput, key: string): boolean {
  return Boolean(input.healthScore?.factors?.some(factor => factor.key === key));
}

export function daysUntil(dateString: string | null | undefined, now: Date = new Date()): number | null {
  if (!dateString) return null;
  const target = new Date(`${dateString}T00:00:00`);
  if (Number.isNaN(target.getTime())) return null;
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);
  target.setHours(0, 0, 0, 0);
  return Math.round((target.getTime() - today.getTime()) / 86_400_000);
}

export function isUpcomingBeforeExpiration(
  dateString: string | null | undefined,
  expDate: string | null | undefined,
  now: Date = new Date()
): boolean {
  const days = daysUntil(dateString, now);
  if (days == null || days < 0) return false;
  if (!expDate) return true;
  const date = new Date(`${dateString}T00:00:00`);
  const expiry = new Date(`${expDate}T23:59:59`);
  if (Number.isNaN(date.getTime()) || Number.isNaN(expiry.getTime())) return false;
  return date <= expiry;
}

export function isShortPremiumStrategy(strategy: string | null | undefined): boolean {
  const normalized = String(strategy ?? '').toUpperCase();
  return ['BPS', 'BCS', 'IC', 'PUT', 'CALL'].includes(normalized) ||
    normalized.includes('CSP') ||
    normalized.includes('SPREAD') ||
    normalized.includes('SHORT');
}

export function makeRecommendation(
  input: PortfolioRecommendationInput,
  kind: PortfolioRecommendationKind,
  label: string,
  urgency: PortfolioRecommendationUrgency,
  confidence: number,
  primaryReason: string,
  suggestedAction: string,
  supportingReasons: string[] = [],
  now: Date = new Date()
): PortfolioRecommendation {
  return {
    positionId: input.positionId ?? input.key ?? `${input.symbol}-${input.expDate ?? 'unknown'}`,
    symbol: input.symbol,
    kind,
    label,
    urgency,
    confidence: Math.max(0, Math.min(100, Math.round(confidence))),
    primaryReason,
    supportingReasons,
    suggestedAction,
    computedAt: now.toISOString(),
  };
}
