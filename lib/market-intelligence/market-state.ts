import { calculateMarketFeatures } from './features';
import type {
  MarketDirection,
  MarketRegime,
  MarketStateEvidence,
  PointInTimeBar,
  TrendMaturity,
} from './types';

const clamp01 = (value: number): number => Math.max(0, Math.min(1, value));

function available(values: readonly (number | null)[]): number[] {
  return values.filter((value): value is number => value != null && Number.isFinite(value));
}

/**
 * Foundation-only evidence builder.
 *
 * This deliberately does NOT choose a strategy, eligibility state, production
 * score, probability, or calibrated threshold. It converts pure OHLC features
 * into a deterministic evidence envelope that can be replayed and replaced by
 * empirically validated classification logic later.
 */
export function buildMarketStateEvidence(bars: readonly PointInTimeBar[]): MarketStateEvidence {
  const features = calculateMarketFeatures(bars);
  const returns = available([
    features.returns[10],
    features.returns[20],
    features.returns[40],
    features.returns[60],
    features.returns[90],
  ]);

  const positive = returns.filter(value => value > 0).length;
  const negative = returns.filter(value => value < 0).length;
  const directionalVotes = positive + negative;

  let direction: MarketDirection = 'UNCERTAIN';
  if (directionalVotes >= 2) {
    if (positive === directionalVotes) direction = 'BULLISH';
    else if (negative === directionalVotes) direction = 'BEARISH';
    else if (Math.abs(positive - negative) <= 1) direction = 'NEUTRAL';
  }

  const persistence = directionalVotes
    ? Math.max(positive, negative) / directionalVotes
    : null;

  const absReturns = returns.map(Math.abs);
  const strength = absReturns.length
    ? clamp01(absReturns.reduce((sum, value) => sum + value, 0) / absReturns.length / 0.2)
    : null;

  const maSlopes = available([features.ma20.slope, features.ma50.slope, features.ma200.slope]);
  const slopeSigns = maSlopes.map(value => Math.sign(value)).filter(value => value !== 0);
  const slopesAgree = slopeSigns.length >= 2 && slopeSigns.every(value => value === slopeSigns[0]);

  let regime: MarketRegime = 'TRANSITION';
  if (direction === 'NEUTRAL' && (persistence == null || persistence < 0.7)) regime = 'RANGE';
  else if ((direction === 'BULLISH' || direction === 'BEARISH') && slopesAgree && (persistence ?? 0) >= 0.75) regime = 'TREND';
  else if ((features.range60WidthPct ?? 0) >= 0.5 && (persistence ?? 0) < 0.7) regime = 'CHAOTIC';

  let maturity: TrendMaturity = 'EMERGING';
  const ma20Slope = features.ma20.slope;
  const ma50Slope = features.ma50.slope;
  if (regime === 'TREND' && ma20Slope != null && ma50Slope != null) {
    const sameSign = Math.sign(ma20Slope) === Math.sign(ma50Slope);
    const accelerating = Math.abs(ma20Slope) > Math.abs(ma50Slope);
    maturity = sameSign ? (accelerating ? 'ESTABLISHED' : 'DETERIORATING') : 'DETERIORATING';
  } else if (regime === 'RANGE') {
    maturity = 'ESTABLISHED';
  }

  const uncertainty = persistence == null ? null : clamp01(1 - persistence);
  const supportingEvidence: string[] = [];
  const contradictingEvidence: string[] = [];

  if (direction === 'BULLISH') supportingEvidence.push('Available return horizons are directionally bullish.');
  if (direction === 'BEARISH') supportingEvidence.push('Available return horizons are directionally bearish.');
  if (slopesAgree) supportingEvidence.push('Available moving-average slopes agree directionally.');
  if (direction === 'NEUTRAL') contradictingEvidence.push('Return horizons contain conflicting directional evidence.');
  if (direction === 'UNCERTAIN') contradictingEvidence.push('Insufficient directional return evidence is available.');
  if (!slopesAgree && slopeSigns.length >= 2) contradictingEvidence.push('Moving-average slopes conflict.');

  return {
    direction,
    strength,
    persistence,
    regime,
    maturity,
    uncertainty,
    features,
    supportingEvidence,
    contradictingEvidence,
  };
}
