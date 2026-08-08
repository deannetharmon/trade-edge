import type { EventRiskEvidence } from './types';

export interface KnownMarketEvent {
  eventType: string;
  effectiveAt: string;
  knownAt: string;
  source: string;
}

export interface EvaluateEventRiskInput {
  evaluatedAt: string;
  horizonEnd: string;
  events: readonly KnownMarketEvent[];
}

const parse = (label: string, value: string): number => {
  const parsed = Date.parse(value);
  if (Number.isNaN(parsed)) throw new Error(`${label} must be a valid timestamp`);
  return parsed;
};

/**
 * Returns only binary-event knowledge that was actually known by T0 and whose
 * effective time falls inside the decision horizon. Later revisions are not
 * allowed to leak backward into the decision.
 */
export function evaluateEventRisk(input: EvaluateEventRiskInput): EventRiskEvidence {
  const evaluatedAt = parse('evaluatedAt', input.evaluatedAt);
  const horizonEnd = parse('horizonEnd', input.horizonEnd);
  if (horizonEnd < evaluatedAt) throw new Error('horizonEnd cannot precede evaluatedAt');

  const relevant = input.events
    .filter(event => {
      const knownAt = parse('event.knownAt', event.knownAt);
      const effectiveAt = parse('event.effectiveAt', event.effectiveAt);
      return knownAt <= evaluatedAt && effectiveAt >= evaluatedAt && effectiveAt <= horizonEnd;
    })
    .sort((a, b) => Date.parse(a.effectiveAt) - Date.parse(b.effectiveAt));

  const first = relevant[0];
  if (!first) return { hasKnownBinaryEvent: false };

  return {
    hasKnownBinaryEvent: true,
    eventType: first.eventType,
    effectiveAt: first.effectiveAt,
    knownAt: first.knownAt,
    source: first.source,
  };
}
