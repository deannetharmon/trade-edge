import { parseOccSymbol, resolveOptionType, resolveUnderlyingSymbol } from '@/lib/optionSymbol';
import {
  normalizeShortCallExposure,
  normalizeWorkingCallReservations,
  type RawOrderLike,
  type RawPositionLike,
  UNATTRIBUTABLE_EXPOSURE_REASON,
} from './covered-call-capacity';

export interface PmccFoundation {
  foundationId: string;
  accountId: string;
  underlyingSymbol: string;
  occSymbol: string;
  strike: number;
  expiration: string;
  contracts: number;
  multiplier: number;
}

export interface PmccFoundationCapacity extends PmccFoundation {
  availableShortCallContracts: number;
  existingShortCallContracts: number;
  workingShortCallContracts: number;
}

export interface PmccFoundationReport {
  status: 'ok' | 'unavailable';
  foundations: PmccFoundationCapacity[];
  warnings: string[];
  unavailableReason?: string;
}

/**
 * Produces broker-authoritative PMCC foundations. A short call cannot be
 * reliably attributed to one of several same-underlying LEAPS by a typical
 * broker position payload, so that ambiguity blocks new orders rather than
 * silently pooling collateral across LEAPS.
 */
export function buildPmccFoundationReport(
  accountId: string,
  rawPositions: RawPositionLike[] | null,
  rawOrders: RawOrderLike[] | null,
): PmccFoundationReport {
  if (!accountId || rawPositions == null || rawOrders == null) return { status: 'unavailable', foundations: [], warnings: [] };
  const existing = normalizeShortCallExposure(rawPositions);
  const working = normalizeWorkingCallReservations(rawOrders);
  if (existing.hasUnattributableExposure || working.hasUnattributableExposure) {
    return { status: 'unavailable', foundations: [], warnings: [...existing.warnings, ...working.warnings], unavailableReason: UNATTRIBUTABLE_EXPOSURE_REASON };
  }

  const foundations: PmccFoundation[] = [];
  for (const position of rawPositions) {
    if (position['instrument-type'] !== 'Equity Option' && position['instrument-type'] !== 'Index Option') continue;
    if (position['quantity-direction'] !== 'Long' || !(Number(position.quantity ?? 0) > 0)) continue;
    if (resolveOptionType(position['option-type'], position.symbol) !== 'C') continue;
    const parsed = parseOccSymbol(position.symbol);
    const underlyingSymbol = resolveUnderlyingSymbol(position['underlying-symbol'], position.symbol);
    if (!position.symbol || !underlyingSymbol || parsed.strikePrice == null || !parsed.expiry) continue;
    const multiplier = Number((position as RawPositionLike & { multiplier?: number | string }).multiplier ?? 100);
    if (!(multiplier > 0)) continue;
    foundations.push({
      foundationId: `${accountId}:${position.symbol.trim()}`,
      accountId, underlyingSymbol, occSymbol: position.symbol, strike: parsed.strikePrice,
      expiration: parsed.expiry, contracts: Number(position.quantity), multiplier,
    });
  }

  const byUnderlying = new Map<string, PmccFoundation[]>();
  for (const foundation of foundations) byUnderlying.set(foundation.underlyingSymbol, [...(byUnderlying.get(foundation.underlyingSymbol) ?? []), foundation]);
  const warnings: string[] = [...existing.warnings, ...working.warnings];
  const capacityFoundations: PmccFoundationCapacity[] = [];
  for (const [underlyingSymbol, entries] of Array.from(byUnderlying.entries())) {
    const reserved = (existing.bySymbol[underlyingSymbol] ?? 0) + (working.bySymbol[underlyingSymbol] ?? 0);
    if (entries.length > 1 && reserved > 0) {
      warnings.push(`${underlyingSymbol}: ${reserved} short-call contract(s) cannot be attributed to one of ${entries.length} long-call foundations; PMCC capacity is blocked.`);
      for (const foundation of entries) capacityFoundations.push({ ...foundation, availableShortCallContracts: 0, existingShortCallContracts: existing.bySymbol[underlyingSymbol] ?? 0, workingShortCallContracts: working.bySymbol[underlyingSymbol] ?? 0 });
      continue;
    }
    const foundation = entries[0];
    capacityFoundations.push({ ...foundation, availableShortCallContracts: Math.max(0, foundation.contracts - reserved), existingShortCallContracts: existing.bySymbol[underlyingSymbol] ?? 0, workingShortCallContracts: working.bySymbol[underlyingSymbol] ?? 0 });
  }
  return { status: 'ok', foundations: capacityFoundations, warnings };
}
