// lib/portfolio/pmccLegQuote.ts
//
// PMCC short-leg profit-target/stop-loss ticket, prerequisite for
// checkpoint 3. buildPmccShortLegStopGtcPrompt (pmccStopGtcPrompt.ts) has
// hardcoded currentValuePerContract to null, with a comment noting no live
// short-leg quote source existed. This closes that gap.
//
// Deliberately NOT a new capability -- reuses the exact market-data
// endpoint pattern already proven correct in lib/portfolio-data/
// acquisition.ts's loadPositions() (`/market-data/by-type?equity-option=
// <symbol>`), just scoped to a single OCC symbol instead of a batch, and
// reuses resolveOptionLegPrice (positionMetrics.ts) rather than
// reimplementing its fail-closed bid/ask/mark resolution logic a second
// time. ttFetch is imported from lib/scans/tastytrade-client.ts (a thin,
// generic HTTP wrapper, not domain logic, so that import direction is
// fine); resolveOptionLegPrice stays a purely local import since it
// belongs to lib/portfolio/, not lib/scans/ -- same reasoning
// pmccStopGtcPrompt.ts already applied when it duplicated
// isUpcomingEarningsRisk rather than reaching across that boundary.
//
// Never fabricates a value: an unparseable/missing quote item returns
// null, exactly like resolveOptionLegPrice's own contract for a genuinely
// unavailable price -- callers must treat null as "no reliable price,"
// same convention as every other quote-resolution function in this app.

import { ttFetch } from '@/lib/scans/tastytrade-client';
import { resolveOptionLegPrice } from './positionMetrics';

/**
 * Live mid/mark price for a single option leg, by its OCC symbol.
 * Returns null on any missing, unparseable, or unavailable quote --
 * never a fabricated 0 or stale fallback.
 */
export async function getOptionLegQuote(occSymbol: string, token: string): Promise<number | null> {
  if (!occSymbol) return null;
  try {
    const data = await ttFetch(`/market-data/by-type?equity-option=${encodeURIComponent(occSymbol)}`, token);
    const item = data?.data?.items?.[0];
    if (!item) return null;
    const bid = item.bid != null ? parseFloat(item.bid) : 0;
    const ask = item.ask != null ? parseFloat(item.ask) : 0;
    const mark = item.mark != null ? parseFloat(item.mark) : 0;
    return resolveOptionLegPrice(bid, ask, mark);
  } catch {
    return null;
  }
}

