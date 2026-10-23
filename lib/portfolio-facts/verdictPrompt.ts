// lib/portfolio-facts/verdictPrompt.ts
//
// RECO-UNIFY-0001B: the text block that tells the AI what the app's official verdict is, so the Analyze panel (and later the Advisor report)
// start from the same verdict and reasons the Position Analysis screen shows. The AI may disagree, but only openly and by naming the data
// point; it never restates a different verdict as official.

import type { PositionFacts, FactGroup } from './positionFacts';
import type { Verdict } from './verdict';

const GROUP_LABEL: Record<FactGroup, string> = {
  identity: 'identity', economics: 'economics (entry credit, P/L, close value)', time: 'time', greeks: 'Greeks', volatility: 'volatility (IV, IVR, HV)',
  technicals: 'technicals (RSI, trend)', events: 'events (earnings)', risk: 'risk (price, buffer, POP, concentration)', orders: 'orders',
};

export interface VerdictPromptOptions {
  /** The label the Portfolio screen shows for this position, which wins over a recomputed label (the screen carries state this builder cannot see). */
  onScreenLabel?: string | null;
  /** Fact groups the caller did not supply data for (not the same as missing from the broker); they are left out of the "not available" line. */
  notSupplied?: FactGroup[];
}

export function buildVerdictPromptBlock(verdict: Verdict | null, facts: PositionFacts, options: VerdictPromptOptions = {}): string {
  const skip = new Set(options.notSupplied ?? []);
  const missing = (Object.keys(facts.complete) as FactGroup[]).filter(g => !facts.complete[g] && !skip.has(g)).map(g => GROUP_LABEL[g]);
  const label = options.onScreenLabel && verdict && options.onScreenLabel !== verdict.label ? options.onScreenLabel : verdict?.label;
  const lines = [
    '',
    'OFFICIAL VERDICT (set by the app\'s rules; you cannot change it):',
    verdict
      ? `${verdict.bucket} — ${label}${verdict.hardRule ? ` (hard rule: ${verdict.hardRule.label})` : ''}. App confidence: ${verdict.confidence.level} (${verdict.confidence.basis.join('; ')}).`
      : 'No position verdict is available for this position.',
    ...(verdict && verdict.reasons.length > 0 ? ['Rules that fired:', ...verdict.reasons.map(r => `- ${r.ruleId}: ${r.text}${r.dataPoint ? ` [${r.dataPoint}${r.value != null ? ` = ${r.value}` : ''}]` : ''}`)] : []),
    missing.length > 0 ? `Data not available to the rules: ${missing.join('; ')}. Say so rather than guessing these.` : 'All fact groups are complete.',
    'If your own read differs from the official verdict, say so openly and name the data point behind it. Never present a different verdict as the official one.',
  ];
  return lines.join('\n');
}
