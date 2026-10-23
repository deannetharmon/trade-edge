// lib/portfolio/reserveStatus.ts
//
// RESERVE-0001: option buying power as a share of the account (net liquidating value), judged against Dean's reserve rule: never below 10%
// (his floor); 20% and up meets the 20-30% guidance. Display only; it never blocks an order.

export const RESERVE_FLOOR_PCT = 10;
export const RESERVE_GUIDANCE_PCT = 20;

export type ReserveTone = 'good' | 'watch' | 'bad';

export interface ReserveStatus {
  pct: number;
  tone: ReserveTone;
  label: string;
  /** Dollars of buying power to free (positive) before the account is back at the floor; 0 when at or above it. */
  shortfallToFloor: number;
}

export function buildReserveStatus(optionBuyingPower: number | null | undefined, netLiq: number | null | undefined): ReserveStatus | null {
  if (typeof optionBuyingPower !== 'number' || !Number.isFinite(optionBuyingPower)) return null;
  if (typeof netLiq !== 'number' || !Number.isFinite(netLiq) || netLiq <= 0) return null;
  const pct = (optionBuyingPower / netLiq) * 100;
  const shortfallToFloor = Math.max(0, Math.ceil((RESERVE_FLOOR_PCT / 100) * netLiq - optionBuyingPower));
  if (pct < RESERVE_FLOOR_PCT) return { pct, tone: 'bad', label: `Below your ${RESERVE_FLOOR_PCT}% reserve`, shortfallToFloor };
  if (pct < RESERVE_GUIDANCE_PCT) return { pct, tone: 'watch', label: `Above your ${RESERVE_FLOOR_PCT}% floor, under ${RESERVE_GUIDANCE_PCT}%`, shortfallToFloor };
  return { pct, tone: 'good', label: `${RESERVE_GUIDANCE_PCT}%+ in reserve`, shortfallToFloor };
}
