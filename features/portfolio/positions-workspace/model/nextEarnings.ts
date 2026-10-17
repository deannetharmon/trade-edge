// features/portfolio/positions-workspace/model/nextEarnings.ts
//
// The "next earnings" line under the chart link in the Position column: the date if known (marked "est." when the provider
// says it is a projection), how far away it is, and whether it falls before this position expires. Display only.

import { daysUntilNy } from '@/lib/scans/earningsPrecheck';

export interface NextEarningsLine {
  text: string;
  daysAway: number;
  /** Earnings land on or before this position's expiration. */
  beforeExpiry: boolean;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** Returns null when there is no usable future date (unknown, unparseable, or already past). */
export function nextEarningsLine(
  date: string | null | undefined,
  estimated: boolean | null | undefined,
  expiration: string | null | undefined,
  asOf?: unknown,
  /** The stock whose date this is, for a leveraged single-stock fund (METU shows META's). */
  underlying?: string | null,
): NextEarningsLine | null {
  const daysAway = daysUntilNy(date, asOf);
  if (daysAway == null || daysAway < 0 || typeof date !== 'string') return null;
  const [year, month, day] = date.slice(0, 10).split('-').map(Number);
  if (!year || !month || !day || month < 1 || month > 12) return null;
  const when = daysAway === 0 ? 'today' : daysAway === 1 ? '1 day' : `${daysAway} days`;
  const beforeExpiry = typeof expiration === 'string' && expiration.length >= 10 && date.slice(0, 10) <= expiration.slice(0, 10);
  return { text: `${underlying ? `${underlying} earnings` : 'Earnings'} ${MONTHS[month - 1]} ${day}${estimated ? ' est.' : ''} (${when})`, daysAway, beforeExpiry };
}
