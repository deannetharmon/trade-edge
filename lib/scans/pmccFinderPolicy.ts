export const PMCC_FINDER_POLICY_VERSIONS = {
  workflows: 'pmcc-workflows-v2-shadow',
  cadence: 'short-call-cadence-v1-shadow',
  leaps: 'leaps-entry-v2-shadow',
  cushion: 'pmcc-cushion-v1-shadow',
  runway: 'held-leaps-runway-v1-shadow',
  ranking: 'pmcc-ranking-v1-shadow',
  earnings: 'pmcc-earnings-v1-shadow',
} as const;

export type PmccFinderWorkflow = 'leaps' | 'new-pmcc' | 'leaps-short-call';
export type ShortCallCadence = 'auto' | '7-day' | '14-day' | '30-45-day';

export interface NumericBand {
  min: number;
  max: number;
}

export interface CadencePolicy {
  id: Exclude<ShortCallCadence, 'auto'>;
  label: string;
  dte: NumericBand;
  preferredDelta: NumericBand;
}

export const SHORT_CALL_GLOBAL_DELTA_BOUNDARY: NumericBand = { min: 0.10, max: 0.35 };

export const SHORT_CALL_CADENCE_POLICIES: Record<Exclude<ShortCallCadence, 'auto'>, CadencePolicy> = {
  '7-day': { id: '7-day', label: '7 Day', dte: { min: 5, max: 9 }, preferredDelta: { min: 0.15, max: 0.22 } },
  '14-day': { id: '14-day', label: '14 Day', dte: { min: 10, max: 18 }, preferredDelta: { min: 0.18, max: 0.25 } },
  '30-45-day': { id: '30-45-day', label: '30–45 Day', dte: { min: 25, max: 45 }, preferredDelta: { min: 0.20, max: 0.30 } },
};

export const LEAPS_POLICY_V1 = {
  supportedDelta: { min: 0.65, max: 0.90 },
  primaryDelta: { min: 0.70, max: 0.90 },
  preferredDelta: { min: 0.75, max: 0.85 },
  supportedDte: { min: 180, max: 900 },
  primaryDte: { min: 365, max: 900 },
  preferredDte: { min: 540, max: 900 },
} as const;

const inBand = (value: number, band: NumericBand): boolean =>
  Number.isFinite(value) && value >= band.min && value <= band.max;

export interface CadenceEvaluation {
  policyVersion: typeof PMCC_FINDER_POLICY_VERSIONS.cadence;
  cadence: ShortCallCadence;
  supported: boolean;
  preferred: boolean;
  matchedCadence: Exclude<ShortCallCadence, 'auto'> | 'auto-gap' | null;
  reasons: string[];
}

export function evaluateShortCallCadence(
  dte: number,
  absoluteDelta: number,
  cadence: ShortCallCadence,
): CadenceEvaluation {
  const reasons: string[] = [];
  if (!Number.isFinite(dte) || dte < 0 || !Number.isFinite(absoluteDelta)) {
    return { policyVersion: PMCC_FINDER_POLICY_VERSIONS.cadence, cadence, supported: false, preferred: false, matchedCadence: null, reasons: ['DTE and delta must be finite.'] };
  }
  if (!inBand(absoluteDelta, SHORT_CALL_GLOBAL_DELTA_BOUNDARY)) {
    reasons.push(`Delta ${absoluteDelta.toFixed(2)} is outside the supported ${SHORT_CALL_GLOBAL_DELTA_BOUNDARY.min.toFixed(2)}–${SHORT_CALL_GLOBAL_DELTA_BOUNDARY.max.toFixed(2)} boundary.`);
  }

  const direct = (Object.values(SHORT_CALL_CADENCE_POLICIES) as CadencePolicy[])
    .find(policy => inBand(dte, policy.dte));
  const autoGap = cadence === 'auto' && dte >= 19 && dte <= 24;
  const selected = cadence === 'auto' ? direct : SHORT_CALL_CADENCE_POLICIES[cadence];
  const dteSupported = cadence === 'auto'
    ? Boolean(direct || autoGap)
    : selected != null && inBand(dte, selected.dte);

  if (!dteSupported) reasons.push(`DTE ${dte} is outside the ${cadence === 'auto' ? 'Auto supported' : selected?.label ?? cadence} range.`);
  const supported = reasons.length === 0;
  const preferred = supported && direct != null && inBand(absoluteDelta, direct.preferredDelta);
  if (supported && !preferred) {
    reasons.push(autoGap
      ? 'DTE is in the Auto 19–24 day gap-inspection range and receives no cadence preference bonus.'
      : `Delta ${absoluteDelta.toFixed(2)} is supported but outside the ${direct!.preferredDelta.min.toFixed(2)}–${direct!.preferredDelta.max.toFixed(2)} cadence preference.`);
  }
  return {
    policyVersion: PMCC_FINDER_POLICY_VERSIONS.cadence,
    cadence,
    supported,
    preferred,
    matchedCadence: direct?.id ?? (autoGap ? 'auto-gap' : null),
    reasons,
  };
}

export interface LeapsWindowEvaluation {
  policyVersion: typeof PMCC_FINDER_POLICY_VERSIONS.leaps;
  acquisition: 'new' | 'held';
  supported: boolean;
  primaryRecommendationEligible: boolean;
  preferred: boolean;
  warnings: string[];
}

export function evaluateLeapsWindow(dte: number, absoluteDelta: number, acquisition: 'new' | 'held'): LeapsWindowEvaluation {
  const supported = inBand(dte, LEAPS_POLICY_V1.supportedDte) && inBand(absoluteDelta, LEAPS_POLICY_V1.supportedDelta);
  const primary = inBand(dte, LEAPS_POLICY_V1.primaryDte) && inBand(absoluteDelta, LEAPS_POLICY_V1.primaryDelta);
  const preferred = inBand(dte, LEAPS_POLICY_V1.preferredDte) && inBand(absoluteDelta, LEAPS_POLICY_V1.preferredDelta);
  const warnings: string[] = [];
  if (!supported) warnings.push(acquisition === 'held'
    ? 'Held long call is outside new-entry support boundaries; disclose it without pretending it is being repurchased.'
    : 'New long call is outside supported LEAPS boundaries.');
  else if (!primary) warnings.push('Contract is visible for comparison but is outside the primary recommendation band.');
  else if (!preferred) warnings.push('Contract qualifies for primary ranking but is outside the preferred LEAPS target.');
  return {
    policyVersion: PMCC_FINDER_POLICY_VERSIONS.leaps,
    acquisition,
    supported: acquisition === 'held' ? true : supported,
    primaryRecommendationEligible: acquisition === 'held' ? true : primary,
    preferred,
    warnings,
  };
}

export interface CushionEvaluation {
  policyVersion: typeof PMCC_FINDER_POLICY_VERSIONS.cushion;
  structurallyValid: boolean;
  recommendationEligible: boolean;
  netDebitPerShare: number;
  strikeWidth: number;
  cushionPerShare: number;
  cushionPctOfDebit: number | null;
  minimumRecommendationCushionPerShare: number | null;
}

export function evaluatePmccCushion(netDebitPerShare: number, strikeWidth: number): CushionEvaluation {
  const validInputs = Number.isFinite(netDebitPerShare) && Number.isFinite(strikeWidth) && netDebitPerShare > 0 && strikeWidth > 0;
  const cushionPerShare = validInputs ? strikeWidth - netDebitPerShare : Number.NaN;
  const minimum = validInputs ? Math.max(1, netDebitPerShare * 0.03) : null;
  const structurallyValid = validInputs && cushionPerShare > 0;
  return {
    policyVersion: PMCC_FINDER_POLICY_VERSIONS.cushion,
    structurallyValid,
    recommendationEligible: structurallyValid && minimum != null && cushionPerShare >= minimum,
    netDebitPerShare,
    strikeWidth,
    cushionPerShare,
    cushionPctOfDebit: validInputs ? (cushionPerShare / netDebitPerShare) * 100 : null,
    minimumRecommendationCushionPerShare: minimum,
  };
}

export type HeldLeapsRunwayStatus = 'preferred' | 'caution' | 'fail' | 'unavailable';

export function evaluateHeldLeapsRunway(daysBeyondShortExpiration: number): {
  policyVersion: typeof PMCC_FINDER_POLICY_VERSIONS.runway;
  status: HeldLeapsRunwayStatus;
} {
  if (!Number.isFinite(daysBeyondShortExpiration)) return { policyVersion: PMCC_FINDER_POLICY_VERSIONS.runway, status: 'unavailable' };
  if (daysBeyondShortExpiration < 30) return { policyVersion: PMCC_FINDER_POLICY_VERSIONS.runway, status: 'fail' };
  if (daysBeyondShortExpiration < 90) return { policyVersion: PMCC_FINDER_POLICY_VERSIONS.runway, status: 'caution' };
  return { policyVersion: PMCC_FINDER_POLICY_VERSIONS.runway, status: 'preferred' };
}
