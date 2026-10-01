import type { Position } from '@/lib/portfolio-data/types';
import { toWholePositionDeltaShares } from '@/lib/portfolio/positionMetrics';
import { DIREXION_GATE1_BOOTSTRAP, resolveCatalogInstrumentMetadata } from '@/lib/instrument-metadata';

export interface LeveragedPositionExposureMember {
  positionKey: string;
  symbol: string;
  strategy: string;
  economicUnderlying: string;
  leverageMultiplier: number;
  signedEffectiveExposure: number | null;
  maxCapitalLoss: number | null;
  normalizationAuthoritative: boolean;
  reason: string | null;
}

export interface LeveragedPositionExposureException {
  id: string;
  economicUnderlying: string;
  subjectId: string | null;
  headline: string;
  detail: string;
}

export interface LeveragedPositionExposureGroup {
  economicUnderlying: string;
  members: LeveragedPositionExposureMember[];
  normalizationAuthoritative: boolean;
  capitalRiskComplete: boolean;
  grossBullishExposure: number | null;
  grossBearishExposure: number | null;
  grossExposure: number | null;
  netDirectionalExposure: number | null;
  maxCapitalLoss: number | null;
}

/**
 * Gate 8 portfolio adapter. It intentionally starts from issuer-catalog-
 * confirmed leveraged products and then pulls in direct positions on the
 * same economic underlying. It never infers leverage from ticker naming.
 *
 * Option exposure uses the portfolio pipeline's broker-sourced net delta,
 * converted to whole-position delta shares, then to product delta dollars.
 * A validated issuer multiplier maps leveraged products to first-order
 * economic-underlying-equivalent sensitivity.
 */
export function buildLeveragedPositionExposureGroups(
  positions: Position[],
): LeveragedPositionExposureGroup[] {
  const leveragedBySymbol = new Map(
    positions
      .map(position => [position.symbol.toUpperCase(), resolveCatalogInstrumentMetadata(DIREXION_GATE1_BOOTSTRAP, position.symbol)] as const)
      .filter((entry): entry is readonly [string, NonNullable<ReturnType<typeof resolveCatalogInstrumentMetadata>>] => entry[1] != null),
  );

  if (leveragedBySymbol.size === 0) return [];

  const targetUnderlyings = new Set(
    Array.from(leveragedBySymbol.values())
      .map(metadata => metadata.economicUnderlyingSymbol ?? metadata.benchmark)
      .filter((symbol): symbol is string => Boolean(symbol))
      .map(symbol => symbol.toUpperCase()),
  );

  const members: LeveragedPositionExposureMember[] = [];
  for (const position of positions) {
    const symbol = position.symbol.toUpperCase();
    const leveragedMetadata = leveragedBySymbol.get(symbol);
    const directUnderlying = targetUnderlyings.has(symbol);
    if (!leveragedMetadata && !directUnderlying) continue;

    const economicUnderlying = (
      leveragedMetadata?.economicUnderlyingSymbol
      ?? leveragedMetadata?.benchmark
      ?? symbol
    ).toUpperCase();
    const leverageMultiplier = leveragedMetadata?.signedLeverageMultiplier ?? 1;
    const deltaShares = toWholePositionDeltaShares(position.netDelta);
    const price = position.stockPrice;
    const exposureComplete = (
      deltaShares != null
      && price != null
      && Number.isFinite(price)
      && price > 0
      && Number.isFinite(leverageMultiplier)
      && leverageMultiplier !== 0
    );
    const capitalComplete = position.maxRiskReliable !== false && Number.isFinite(position.maxRisk);

    members.push({
      positionKey: position.key,
      symbol,
      strategy: position.strategy,
      economicUnderlying,
      leverageMultiplier,
      signedEffectiveExposure: exposureComplete
        ? deltaShares * (price as number) * leverageMultiplier
        : null,
      maxCapitalLoss: capitalComplete ? Math.abs(position.maxRisk) : null,
      normalizationAuthoritative: exposureComplete,
      reason: exposureComplete
        ? null
        : 'Broker-sourced net delta and current product price are required for authoritative effective exposure.',
    });
  }

  const grouped = new Map<string, LeveragedPositionExposureMember[]>();
  for (const member of members) {
    const group = grouped.get(member.economicUnderlying) ?? [];
    group.push(member);
    grouped.set(member.economicUnderlying, group);
  }

  return Array.from(grouped.entries()).map(([economicUnderlying, groupMembers]) => {
    const normalizationAuthoritative = groupMembers.every(member => member.normalizationAuthoritative);
    const capitalRiskComplete = groupMembers.every(member => member.maxCapitalLoss != null);
    if (!normalizationAuthoritative) {
      return {
        economicUnderlying,
        members: groupMembers,
        normalizationAuthoritative: false,
        capitalRiskComplete,
        grossBullishExposure: null,
        grossBearishExposure: null,
        grossExposure: null,
        netDirectionalExposure: null,
        maxCapitalLoss: capitalRiskComplete ? groupMembers.reduce((sum, member) => sum + (member.maxCapitalLoss as number), 0) : null,
      };
    }

    const exposures = groupMembers.map(member => member.signedEffectiveExposure as number);
    const capitals = groupMembers.map(member => member.maxCapitalLoss).filter((value): value is number => value != null);
    return {
      economicUnderlying,
      members: groupMembers,
      normalizationAuthoritative: true,
      capitalRiskComplete,
      grossBullishExposure: exposures.filter(value => value >= 0).reduce((sum, value) => sum + value, 0),
      grossBearishExposure: exposures.filter(value => value < 0).reduce((sum, value) => sum + Math.abs(value), 0),
      grossExposure: exposures.reduce((sum, value) => sum + Math.abs(value), 0),
      netDirectionalExposure: exposures.reduce((sum, value) => sum + value, 0),
      maxCapitalLoss: capitalRiskComplete ? capitals.reduce((sum, value) => sum + value, 0) : null,
    };
  });
}

export function buildLeveragedPositionExposureExceptions(
  groups: LeveragedPositionExposureGroup[],
): LeveragedPositionExposureException[] {
  return groups
    .filter(group => !group.normalizationAuthoritative)
    .map(group => {
      const incompleteMembers = group.members.filter(member => !member.normalizationAuthoritative);
      return {
        id: `lev-normalization::${group.economicUnderlying}`,
        economicUnderlying: group.economicUnderlying,
        subjectId: incompleteMembers.length === 1 ? incompleteMembers[0].positionKey : null,
        headline: `${group.economicUnderlying} — Leverage normalization incomplete`,
        detail: incompleteMembers.length === 1
          ? `${incompleteMembers[0].symbol} lacks required delta/price evidence; authoritative gross/net economic-underlying totals are unavailable.`
          : `${incompleteMembers.length} related positions lack required delta/price evidence; authoritative gross/net economic-underlying totals are unavailable.`,
      };
    });
}
