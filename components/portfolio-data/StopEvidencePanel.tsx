'use client';

import type { Position } from '@/lib/portfolio-data/types';
import type { StopAssessment, StopClassification } from '@/lib/portfolio/stopLossPolicy';

export const STOP_CLASSIFICATION_COPY: Record<StopClassification, string> = {
  NOT_EVALUATED: 'Stop not evaluated — required broker evidence is unavailable or ambiguous.',
  UNSUPPORTED: 'Stop evaluation is not supported for this position structure.',
  NO_STOP: 'No matching protective stop found.',
  ALIGNED: 'The working protective stop is aligned with its verified policy.',
  TOO_TIGHT: 'The working protective stop is tighter than its verified policy target.',
  TOO_LOOSE: 'The working protective stop is looser than its verified policy target.',
  UNKNOWN_PROVENANCE: 'A valid protective stop exists, but its policy provenance is not verified.',
  INVALID: 'A candidate stop exists, but its fields are malformed, contradictory, or unsafe.',
};

export const STOP_CONTROL_LABELS: Record<StopClassification, string> = {
  NO_STOP: 'Add Stop',
  ALIGNED: 'Edit Stop',
  TOO_TIGHT: 'Verify/Adjust Stop',
  TOO_LOOSE: 'Adjust Stop',
  UNKNOWN_PROVENANCE: 'Verify Stop',
  INVALID: 'Repair Stop',
  NOT_EVALUATED: 'Retry Stop Check',
  UNSUPPORTED: 'Stop Workflow Unavailable',
};

function money(value: number | null): string { return value == null ? 'Unavailable' : `$${value.toFixed(2)}`; }

export function StopEvidencePanel({ assessment, expanded = false }: { assessment: StopAssessment | null | undefined; expanded?: boolean }) {
  if (!assessment) return <p className="text-[10px] text-white/50">Stop not evaluated — required broker evidence is unavailable or ambiguous.</p>;
  const raw = assessment.rawEvidence;
  const derived = assessment.derivedAssessment;
  return (
    <details open={expanded} className="mt-2 rounded border border-white/10 bg-black/20 p-2 text-[10px] text-white/65">
      <summary className="cursor-pointer font-semibold text-sky-300">Stop Evidence</summary>
      <p className="mt-2 font-semibold text-white">{STOP_CLASSIFICATION_COPY[assessment.classification]}</p>
      <div className="mt-2 grid gap-3 md:grid-cols-2">
        <section aria-label="Raw broker stop evidence">
          <h4 className="font-bold uppercase tracking-wider text-white/50">Raw broker facts</h4>
          <p>Position: account {raw.position.accountNumber || 'Unavailable'} · OCC {raw.position.occSymbol ?? 'Unavailable'} · {raw.position.side} {raw.position.optionType ?? 'option'} · quantity {raw.position.quantity ?? 'Unavailable'}</p>
          <p>Acquisition: {raw.sources.map(source => `${source.endpoint} ${source.available ? 'available' : 'unavailable'}`).join(' · ')}</p>
          <p>Executable bid {money(raw.executableBid)} · quote {raw.quoteTime ?? 'Unavailable'} · freshness {raw.quoteFresh == null ? 'unknown' : raw.quoteFresh ? 'fresh' : 'stale'}</p>
          {raw.orders.length === 0 ? <p>No candidate broker orders returned.</p> : raw.orders.map(order => (
            <div key={`${order.sourceEndpoint}-${order.orderId}`} className="mt-2 border-t border-white/10 pt-2">
              <p>Order {order.orderId || 'Unavailable'} · complex {order.complexOrderId ?? 'None'} · {order.sourceEndpoint}</p>
              <p>{order.status ?? 'Unknown status'} · {order.orderType || 'Unknown type'} · TIF {order.timeInForce || 'Unknown'} · {order.priceEffect ?? 'Unknown price effect'} · trigger {money(order.triggerPrice)} · limit {money(order.limitPrice)}</p>
              {order.legs.map((leg, index) => <p key={`${order.orderId}-${index}`}>Leg {index + 1}: {leg.action || 'Unknown action'} {leg.symbol || 'Unknown OCC'} · quantity {leg.quantity ?? 'Unavailable'} · ratio {leg.ratio ?? 'Unavailable'}</p>)}
            </div>
          ))}
        </section>
        <section aria-label="TradeEdge stop assessment">
          <h4 className="font-bold uppercase tracking-wider text-white/50">TradeEdge assessment</h4>
          <p>Applicability {assessment.applicability} · match {derived.matchResult} · classification {assessment.classification}</p>
          <p>Matched order {assessment.matchedOrderId ?? 'None'}{assessment.ambiguousOrderIds.length ? ` · ambiguous ${assessment.ambiguousOrderIds.join(', ')}` : ''}</p>
          <p>Policy {derived.policySource} · anchor {derived.policyAnchor ?? 'Unavailable'}</p>
          <p>Expected trigger {money(derived.expectedTrigger)} · actual {money(derived.actualTrigger)} · variance {money(derived.variance)}</p>
          <p>Reason {assessment.reasonCode}: {assessment.explanation}</p>
          {derived.blockingExplanation && <p className="text-amber-300">Blocked: {derived.blockingExplanation}</p>}
        </section>
      </div>
    </details>
  );
}

/** Observation only by construction: no callbacks, broker client, or mutation
 * controls are accepted by this component. */
export function DebitStopObservation({ position }: { position: Position }) {
  return (
    <div className="max-w-md">
      <span className="text-[10px] text-white/50">Debit stop observation only — create, replace, cancel, and submit are unavailable in V1.</span>
      <StopEvidencePanel assessment={position.stopAssessment} />
    </div>
  );
}
