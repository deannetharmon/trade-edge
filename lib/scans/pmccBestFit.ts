export type PmccBestFitProfile = 'balanced' | 'income' | 'upside';

export interface PmccBestFitInputs {
  shortDelta: number;
  shortDte: number;
  shortStrike: number;
  underlyingPrice: number;
  shortCredit: number;
  shortSpreadPct: number | null;
  shortOpenInterest: number | null;
}

const PROFILES: Record<PmccBestFitProfile, { targetDelta: number; weights: [number, number, number, number] }> = {
  balanced: { targetDelta: 0.30, weights: [40, 20, 20, 20] },
  // Income still values premium, but only after it is executable: a larger
  // theoretical credit on a wide/illiquid quote must not outrank a reliably
  // tradable alternative.
  income: { targetDelta: 0.35, weights: [15, 15, 15, 55] },
  upside: { targetDelta: 0.225, weights: [55, 15, 10, 20] },
};

const clamp01 = (value: number) => Math.max(0, Math.min(1, value));

function otmPct(input: PmccBestFitInputs): number | null {
  return input.underlyingPrice > 0 ? ((input.shortStrike - input.underlyingPrice) / input.underlyingPrice) * 100 : null;
}

/** Explains the concrete trade-offs behind an already-selected Best Fit.
 * This is descriptive only: it never changes eligibility or the score. */
export function describePmccBestFitComparison(
  profile: PmccBestFitProfile,
  winner: PmccBestFitInputs,
  runnerUp: PmccBestFitInputs,
): string | null {
  const { targetDelta } = PROFILES[profile];
  const advantages: string[] = [];
  const tradeoffs: string[] = [];
  const add = (text: string, advantage: boolean) => (advantage ? advantages : tradeoffs).push(text);
  const deltaDifference = Math.abs(winner.shortDelta - targetDelta) - Math.abs(runnerUp.shortDelta - targetDelta);
  if (Math.abs(deltaDifference) >= 0.005) add(`${Math.abs(winner.shortDelta - runnerUp.shortDelta).toFixed(2)} ${deltaDifference < 0 ? 'closer to' : 'farther from'} target delta`, deltaDifference < 0);
  const winnerOtm = otmPct(winner); const runnerOtm = otmPct(runnerUp);
  if (winnerOtm != null && runnerOtm != null && Math.abs(winnerOtm - runnerOtm) >= 0.05) add(`${Math.abs(winnerOtm - runnerOtm).toFixed(1)}% ${winnerOtm > runnerOtm ? 'farther OTM' : 'less OTM'}`, winnerOtm > runnerOtm);
  if (Math.abs(winner.shortCredit - runnerUp.shortCredit) >= 0.005) add(`$${Math.abs(winner.shortCredit - runnerUp.shortCredit).toFixed(2)} ${winner.shortCredit > runnerUp.shortCredit ? 'more' : 'less'} credit`, winner.shortCredit > runnerUp.shortCredit);
  if (winner.shortSpreadPct != null && runnerUp.shortSpreadPct != null && Math.abs(winner.shortSpreadPct - runnerUp.shortSpreadPct) >= 0.05) add(`${Math.abs(winner.shortSpreadPct - runnerUp.shortSpreadPct).toFixed(1)}% ${winner.shortSpreadPct < runnerUp.shortSpreadPct ? 'tighter' : 'wider'} spread`, winner.shortSpreadPct < runnerUp.shortSpreadPct);
  if (winner.shortOpenInterest != null && runnerUp.shortOpenInterest != null && winner.shortOpenInterest !== runnerUp.shortOpenInterest) add(`${Math.abs(winner.shortOpenInterest - runnerUp.shortOpenInterest).toLocaleString()} ${winner.shortOpenInterest > runnerUp.shortOpenInterest ? 'more' : 'less'} OI`, winner.shortOpenInterest > runnerUp.shortOpenInterest);
  const dteDifference = Math.abs(winner.shortDte - 31.5) - Math.abs(runnerUp.shortDte - 31.5);
  if (Math.abs(dteDifference) >= 1) add(`${Math.abs(winner.shortDte - runnerUp.shortDte)} days ${dteDifference < 0 ? 'closer to' : 'farther from'} 32 DTE`, dteDifference < 0);
  const ordered = profile === 'income'
    ? [...advantages.filter(x => /spread|OI/.test(x)), ...tradeoffs.filter(x => /credit/.test(x)), ...advantages.filter(x => !/spread|OI/.test(x)), ...tradeoffs.filter(x => !/credit/.test(x))]
    : [...tradeoffs, ...advantages];
  if (ordered.length === 0) return null;
  const shown = ordered.slice(0, 4);
  const shownTradeoffs = shown.filter(x => tradeoffs.includes(x));
  const shownAdvantages = shown.filter(x => advantages.includes(x));
  return shownTradeoffs.length > 0 && shownAdvantages.length > 0
    ? `${shownTradeoffs.join(', ')}, but ${shownAdvantages.join(', ')}.`
    : `${shown.join(', ')}.`;
}

/** A transparent recommendation score for comparing already-qualified held-PMCC shorts.
 * It deliberately does not replace the PMCC quality-health score. */
export function computePmccBestFit(profile: PmccBestFitProfile, input: PmccBestFitInputs): number {
  const { targetDelta, weights } = PROFILES[profile];
  const deltaFit = clamp01(1 - Math.abs(input.shortDelta - targetDelta) / 0.25);
  const cushion = clamp01((otmPct(input) ?? 0) / 12);
  const riskFit = 0.7 * deltaFit + 0.3 * cushion;
  const dteFit = clamp01(1 - Math.abs(input.shortDte - 31.5) / 14);
  const creditPerDayPct = input.underlyingPrice > 0 && input.shortDte > 0
    ? input.shortCredit / input.underlyingPrice / input.shortDte * 100
    : 0;
  const incomeFit = clamp01(creditPerDayPct / 0.10);
  const spreadFit = input.shortSpreadPct == null ? 0 : clamp01(1 - input.shortSpreadPct / 10);
  const oiFit = input.shortOpenInterest == null ? 0 : clamp01(input.shortOpenInterest / 500);
  const executionFit = 0.6 * spreadFit + 0.4 * oiFit;
  return Math.round(riskFit * weights[0] + dteFit * weights[1] + incomeFit * weights[2] + executionFit * weights[3]);
}
