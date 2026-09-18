import type { Position, PositionLeg, PositionSnapshot, TrendResult } from '@/lib/portfolio-data/types';

export type ThesisHealthSeverity = 'critical' | 'warning' | 'normal' | 'unavailable';

export interface LeapsThesisHealth {
  applicable: boolean;
  pairedPmcc: boolean;
  severity: ThesisHealthSeverity;
  currentItmPct: number | null;
  firstTrackedItmPct: number | null;
  erosionPp: number | null;
  entryDelta: number | null;
  currentDelta: number | null;
  trend: TrendResult['trend'] | null;
  mom60: number | null;
  higherLows: boolean | null;
  lowerHighs: boolean | null;
  reasons: string[];
}

function finite(value: number | null | undefined): number | null {
  return value != null && Number.isFinite(value) ? value : null;
}

export function singleLongOptionLeg(legs: readonly PositionLeg[]): PositionLeg | null {
  return legs.length === 1 && legs[0].direction === 'Long' ? legs[0] : null;
}

function pmccFoundationLeg(position: Position): PositionLeg | null {
  if (position.strategy !== 'PMCC') return null;
  const longCalls = position.legs.filter(leg => leg.direction === 'Long' && leg.optionType === 'C');
  const shortCalls = position.legs.filter(leg => leg.direction === 'Short' && leg.optionType === 'C');
  return longCalls.length === 1 && shortCalls.length === 1 ? longCalls[0] : null;
}

/** Percentage the underlying is in the money, using the option strike as the denominator. */
export function longOptionItmPct(leg: PositionLeg, stockPrice: number | null | undefined): number | null {
  const stock = finite(stockPrice);
  if (stock == null || stock <= 0 || !Number.isFinite(leg.strikePrice) || leg.strikePrice <= 0) return null;
  const gap = leg.optionType === 'C' ? stock - leg.strikePrice : leg.strikePrice - stock;
  return Math.max(0, (gap / leg.strikePrice) * 100);
}

function firstTrackedItmPct(leg: PositionLeg, history: readonly PositionSnapshot[] | undefined): number | null {
  if (!history?.length) return null;
  for (const snapshot of history) {
    const itm = longOptionItmPct(leg, snapshot.stockPrice);
    if (itm != null) return itm;
  }
  return null;
}

export function assessLeapsThesisHealth(position: Position, trend?: TrendResult | null): LeapsThesisHealth {
  const standaloneLeg = singleLongOptionLeg(position.legs);
  const pairedLeg = standaloneLeg == null ? pmccFoundationLeg(position) : null;
  const leg = standaloneLeg ?? pairedLeg;
  if (!leg) {
    return { applicable: false, pairedPmcc: false, severity: 'unavailable', currentItmPct: null, firstTrackedItmPct: null, erosionPp: null, entryDelta: null, currentDelta: null, trend: null, mom60: null, higherLows: null, lowerHighs: null, reasons: [] };
  }

  const currentItmPct = longOptionItmPct(leg, position.stockPrice);
  const firstItmPct = firstTrackedItmPct(leg, position.snapshotHistory);
  const erosionPp = standaloneLeg != null && currentItmPct != null && firstItmPct != null
    ? Math.max(0, firstItmPct - currentItmPct)
    : null;
  const critical = currentItmPct != null && currentItmPct < 5;
  const warning = erosionPp != null && erosionPp > 8;
  const reasons = [
    ...(critical ? ['Intrinsic value is below 5% of strike.'] : []),
    ...(warning ? [`ITM value has eroded ${erosionPp.toFixed(1)} percentage points since first tracked.`] : []),
  ];

  return {
    applicable: true,
    pairedPmcc: pairedLeg != null,
    severity: critical ? 'critical' : warning ? 'warning' : 'normal',
    currentItmPct,
    firstTrackedItmPct: firstItmPct,
    erosionPp,
    entryDelta: finite(position.snapshotHistory?.find(snapshot => finite(snapshot.netDelta) != null)?.netDelta ?? position.deltaAtEntry),
    currentDelta: finite(position.netDelta),
    trend: trend?.trend ?? null,
    mom60: trend?.mom60 ?? null,
    higherLows: trend?.higherLows ?? null,
    lowerHighs: trend?.lowerHighs ?? null,
    reasons,
  };
}
