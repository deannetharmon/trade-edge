import type { Position } from '@/lib/portfolio-data/types';
import type { EquityHolding } from '@/lib/portfolio-snapshot/types';
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
 * Gate 8 portfolio adapter.
 *
 * A group becomes relevant only when the held portfolio contains an
 * issuer-catalog-confirmed leveraged/inverse product. Direct option and
 * equity positions on that product's economic underlying are then rolled
 * into the same group. No leverage relationship is inferred from ticker
 * naming.
 *
 * Option exposure uses broker-sourced net delta -> whole-position delta
 * shares -> product delta dollars. Equity exposure uses current market value
 * with explicit long/short direction. Validated issuer leverage maps either
 * product exposure to first-order economic-underlying sensitivity.
 *
 * equityCoverageComplete must only be true when the canonical portfolio
 * snapshot has successfully acquired equities. When false, group totals fail
 * closed because an unseen direct stock holding could materially change gross
 * and net exposure.
 */
export function buildLeveragedPositionExposureGroups(input: {
  positions: Position[];
  equities?: EquityHolding[];
  equityCoverageComplete?: boolean;
}): LeveragedPositionExposureGroup[] {
  const { positions, equities = [], equityCoverageComplete = false } = input;
  const heldSymbols = [
    ...positions.map(position => position.symbol),
    ...equities.map(holding => holding.symbol),
  ];

  const leveragedBySymbol = new Map(
    heldSymbols
      .map(rawSymbol => [rawSymbol.toUpperCase(), resolveCatalogInstrumentMetadata(DIREXION_GATE1_BOOTSTRAP, rawSymbol)] as const)
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

  for (const holding of equities) {
    const symbol = holding.symbol.toUpperCase();
    const leveragedMetadata = leveragedBySymbol.get(symbol);
    const directUnderlying = targetUnderlyings.has(symbol);
    if (!leveragedMetadata && !directUnderlying) continue;

    const economicUnderlying = (
      leveragedMetadata?.economicUnderlyingSymbol
      ?? leveragedMetadata?.benchmark
      ?? symbol
    ).toUpperCase();
    const leverageMultiplier = leveragedMetadata?.signedLeverageMultiplier ?? 1;
    const price = holding.currentPrice;
    const quantity = Math.abs(holding.quantity);
    const direction = holding.direction === 'Short' ? -1 : 1;
    const exposureComplete = (
      price != null
      && Number.isFinite(price)
      && price > 0
      && Number.isFinite(quantity)
      && Number.isFinite(leverageMultiplier)
      && leverageMultiplier !== 0
      && !holding.staleQuote
    );
    const marketValue = exposureComplete ? quantity * (price as number) : null;

    members.push({
      positionKey: `equity::${holding.accountNumber}::${symbol}::${holding.direction}`,
      symbol,
      strategy: holding.direction === 'Short' ? 'SHORT SHARES' : 'SHARES',
      economicUnderlying,
      leverageMultiplier,
      signedEffectiveExposure: marketValue == null
        ? null
        : direction * marketValue * leverageMultiplier,
      // A long equity/ETP position cannot lose more than its market value.
      // Short stock has no finite maximum loss and therefore stays unavailable.
      maxCapitalLoss: holding.direction === 'Long' && marketValue != null ? marketValue : null,
      normalizationAuthoritative: exposureComplete,
      reason: exposureComplete
        ? null
        : 'Current, non-stale equity price and quantity are required for authoritative effective exposure.',
    });
  }

  const grouped = new Map<string, LeveragedPositionExposureMember[]>();
  for (const member of members) {
    const group = grouped.get(member.economicUnderlying) ?? [];
    group.push(member);
    grouped.set(member.economicUnderlying, group);
  }

  return Array.from(grouped.entries()).map(([economicUnderlying, groupMembers]) => {
    const memberEvidenceComplete = groupMembers.every(member => member.normalizationAuthoritative);
    const normalizationAuthoritative = memberEvidenceComplete && equityCoverageComplete;
    const capitalRiskComplete = groupMembers.every(member => member.maxCapitalLoss != null);
    const maxCapitalLoss = capitalRiskComplete
      ? groupMembers.reduce((sum, member) => sum + (member.maxCapitalLoss as number), 0)
      : null;

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
        maxCapitalLoss,
      };
    }

    const exposures = groupMembers.map(member => member.signedEffectiveExposure as number);
    return {
      economicUnderlying,
      members: groupMembers,
      normalizationAuthoritative: true,
      capitalRiskComplete,
      grossBullishExposure: exposures.filter(value => value >= 0).reduce((sum, value) => sum + value, 0),
      grossBearishExposure: exposures.filter(value => value < 0).reduce((sum, value) => sum + Math.abs(value), 0),
      grossExposure: exposures.reduce((sum, value) => sum + Math.abs(value), 0),
      netDirectionalExposure: exposures.reduce((sum, value) => sum + value, 0),
      maxCapitalLoss,
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
      const subjectId = incompleteMembers.length === 1 ? incompleteMembers[0].positionKey : null;
      const detail = incompleteMembers.length > 0
        ? incompleteMembers.length === 1
          ? `${incompleteMembers[0].symbol} lacks required delta/price evidence; authoritative gross/net economic-underlying totals are unavailable.`
          : `${incompleteMembers.length} related positions lack required delta/price evidence; authoritative gross/net economic-underlying totals are unavailable.`
        : 'Equity coverage is unavailable, so direct share exposure cannot be ruled out and authoritative gross/net economic-underlying totals are unavailable.';

      return {
        id: `lev-normalization::${group.economicUnderlying}`,
        economicUnderlying: group.economicUnderlying,
        subjectId,
        headline: `${group.economicUnderlying} — Leverage normalization incomplete`,
        detail,
      };
    });
}
