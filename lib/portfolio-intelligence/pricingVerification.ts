export interface PricingVerificationGroundedAnalysis {
  recommendation: 'MANAGE';
  confidence: 'LOW';
  summary: string;
  reasoning: string;
  risks: string[];
  catalysts: string[];
  deviatesFromRules: false;
  deviationNote: null;
}

// Deterministic trust boundary for AI presentation. Deliberately accepts no
// model-authored prose: a model cannot smuggle CLOSE/ROLL/CUT language into
// the visible summary while structured output is forced to MANAGE.
export function buildPricingVerificationGrounding(_modelAnalysis: unknown): PricingVerificationGroundedAnalysis {
  return {
    recommendation: 'MANAGE',
    confidence: 'LOW',
    summary: 'Verify a fresh executable quote before choosing Hold, Close, Roll, or Cut Losses.',
    reasoning: 'Marketable pricing is observational because quote quality or freshness is not decision-eligible. Midpoint remains the controlling valuation basis until fresh, reliable quotes are available for every leg.',
    risks: [],
    catalysts: [],
    deviatesFromRules: false,
    deviationNote: null,
  };
}
