import type { ModelIdentity } from '../decision/types';
import type { PointInTimeMarketData } from '../market-intelligence/types';
import type { ReplayOptionLegInput, ReplaySnapshot } from './types';

export interface SnapshotEventKnowledge {
  eventType: string;
  effectiveAt: string;
  knownAt: string;
  source: string;
}

export interface BuildReplaySnapshotInput extends ModelIdentity {
  snapshotId: string;
  capturedAt: string;
  marketData: PointInTimeMarketData;
  eventKnowledge?: readonly SnapshotEventKnowledge[];
  optionLegs?: readonly ReplayOptionLegInput[];
  ivRank?: number;
}

function assertIsoDate(label: string, value: string): void {
  if (!value || Number.isNaN(Date.parse(value))) throw new Error(`${label} must be a valid timestamp`);
}

/**
 * Builds an immutable T0 snapshot envelope for shadow capture/replay.
 * Raw provider inputs belong here; later outcome enrichment must create a
 * separate record rather than mutate this snapshot.
 */
export function buildReplaySnapshot(input: BuildReplaySnapshotInput): ReplaySnapshot {
  assertIsoDate('capturedAt', input.capturedAt);
  assertIsoDate('marketData.asOf', input.marketData.asOf);

  const capturedAt = Date.parse(input.capturedAt);
  const marketAsOf = Date.parse(input.marketData.asOf);
  if (marketAsOf > capturedAt) throw new Error('Market data cannot be newer than snapshot capture time');

  const eventKnowledge = (input.eventKnowledge ?? []).map(event => {
    assertIsoDate('event.effectiveAt', event.effectiveAt);
    assertIsoDate('event.knownAt', event.knownAt);
    if (Date.parse(event.knownAt) > capturedAt) throw new Error('Snapshot cannot contain future event knowledge');
    return Object.freeze({ ...event });
  });

  const optionLegs = (input.optionLegs ?? []).map(leg => Object.freeze({ ...leg }));
  const marketData = Object.freeze({
    ...input.marketData,
    bars: Object.freeze(input.marketData.bars.map(bar => Object.freeze({ ...bar }))),
  });

  return Object.freeze({
    snapshotId: input.snapshotId,
    capturedAt: input.capturedAt,
    marketData,
    eventKnowledge: Object.freeze(eventKnowledge),
    optionLegs: Object.freeze(optionLegs),
    ivRank: input.ivRank,
    modelVersion: input.modelVersion,
    configVersion: input.configVersion,
  });
}
