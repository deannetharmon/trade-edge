// lib/leaps-position-intelligence/ledger.ts
//
// LEAPS-LEDGER-0001 -- the decision ledger for a held LEAPS: what the Positions card said, what you did, and how you changed your rules.
// Pure (client-safe): payload validation for client-attested events, the rule that keeps evaluation events from flooding the ledger, and
// the plain-English description of any event. Storage is the existing append-only ledger (persistence/repository.ts); writes go through
// /api/leaps-ledger and the order-capture path.
//
// Two kinds of evidence, and the ledger says which is which:
//   'server' -- written by the server after the broker accepted an order (an order you placed).
//   'client' -- reported by the Positions screen (what the card showed, that you opened the review). It is a personal log, not proof.

import { money } from '@/lib/leaps-analysis/dashboard';
import { parseOccSymbol } from '@/lib/optionSymbol';
import { describeIncomeRules } from './mandateGates';
import type { EntryRecordKind } from './entryRecords';
import type { LeapsLedgerEvent } from './persistence/repository';
import type { LeapsMandate } from './types';

export const LEDGER_TEXT_MAX = 200;
export const LEDGER_CALLOUTS_MAX = 6;
/** Minimum time between two recorded card evaluations for one LEAPS, so a live quote flickering across a rule cannot flood the ledger. */
export const EVALUATION_MIN_GAP_MS = 30 * 60 * 1000;
export const LEDGER_MAX_EVENTS = 1000;
/** Clicking "Review PMCC short calls" repeatedly within this time is recorded once. */
export const OPENED_REVIEW_MIN_GAP_MS = 5 * 60 * 1000;

export const EVALUATION_STATES = ['review-income-call', 'monitor', 'hold-uncovered', 'reassess-thesis'] as const;
export type EvaluationState = typeof EVALUATION_STATES[number];
export type CalloutTone = 'good' | 'watch' | 'bad' | 'neutral';
const TONES: ReadonlyArray<CalloutTone> = ['good', 'watch', 'bad', 'neutral'];

export interface EvaluationPayload {
  source: 'positions-card';
  attestation: 'client';
  state: EvaluationState;
  reasonCode: string | null;
  candidate: { strike: number; expiration: string; credit: number; delta: number; dte: number } | null;
  stockPrice: number | null;
  callouts: Array<{ tone: CalloutTone; text: string }>;
  /** The income rules in force, as the card described them. */
  rules: string;
}

export type DecisionAction = 'opened-review' | 'bought-leaps' | 'opened-pmcc' | 'sold-short-call';
export interface DecisionPayload {
  action: DecisionAction;
  attestation: 'client' | 'server';
  brokerOrderId?: string | null;
  quantity?: number;
  limitPrice?: number;
  priceEffect?: 'Debit' | 'Credit';
  shortOccSymbol?: string | null;
  entryRecordId?: string;
  underlyingPrice?: number | null;
}

export type ClientEvent =
  | { type: 'decision-evaluated'; payload: EvaluationPayload }
  | { type: 'user-decision'; payload: DecisionPayload };

export interface ClientEventValidation { ok: true; event: ClientEvent }
export interface ClientEventRejection { ok: false; errors: string[] }

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const text = (v: unknown, max = LEDGER_TEXT_MAX): string | null => (typeof v === 'string' && v.trim().length > 0 && v.trim().length <= max ? v.trim() : null);

/**
 * Validates an event the browser reports. Only two shapes are accepted from the client -- a card evaluation and "opened the review" --
 * everything else (orders, rule changes) is written by the server. Unknown fields are dropped and text is bounded.
 */
export function sanitizeClientEvent(raw: unknown): ClientEventValidation | ClientEventRejection {
  if (raw == null || typeof raw !== 'object' || Array.isArray(raw)) return { ok: false, errors: ['An event object is required.'] };
  const input = raw as { type?: unknown; payload?: unknown };
  const p = (input.payload ?? {}) as Record<string, unknown>;
  const errors: string[] = [];

  if (input.type === 'user-decision') {
    if (p.action !== 'opened-review') return { ok: false, errors: ['Only "opened-review" can be reported from the browser.'] };
    return { ok: true, event: { type: 'user-decision', payload: { action: 'opened-review', attestation: 'client' } } };
  }

  if (input.type !== 'decision-evaluated') return { ok: false, errors: ['Unsupported event type.'] };
  if (typeof p.state !== 'string' || !(EVALUATION_STATES as readonly string[]).includes(p.state)) errors.push('A valid state is required.');
  const rules = text(p.rules, 300);
  if (rules == null) errors.push('The rules in force are required (up to 300 characters).');
  const reasonCode = p.reasonCode == null ? null : text(p.reasonCode, 60);
  if (p.reasonCode != null && reasonCode == null) errors.push('The reason code must be short text.');

  let candidate: EvaluationPayload['candidate'] = null;
  if (p.candidate != null) {
    const c = p.candidate as Record<string, unknown>;
    const strike = num(c.strike); const credit = num(c.credit); const delta = num(c.delta); const dte = num(c.dte);
    const expiration = typeof c.expiration === 'string' && ISO_DATE.test(c.expiration) ? c.expiration : null;
    if (strike == null || strike <= 0 || credit == null || credit < 0 || delta == null || dte == null || dte < 0 || expiration == null) errors.push('The candidate is not valid.');
    else candidate = { strike, expiration, credit, delta, dte };
  }

  const callouts: EvaluationPayload['callouts'] = [];
  if (p.callouts != null) {
    if (!Array.isArray(p.callouts) || p.callouts.length > LEDGER_CALLOUTS_MAX) errors.push(`At most ${LEDGER_CALLOUTS_MAX} callouts are allowed.`);
    else for (const item of p.callouts as Array<Record<string, unknown>>) {
      const t = text(item?.text);
      if (t == null || typeof item?.tone !== 'string' || !TONES.includes(item.tone as CalloutTone)) { errors.push('A callout is not valid.'); break; }
      callouts.push({ tone: item.tone as CalloutTone, text: t });
    }
  }
  const stockPrice = p.stockPrice == null ? null : num(p.stockPrice);
  if (p.stockPrice != null && (stockPrice == null || stockPrice <= 0)) errors.push('The stock price must be a positive number.');
  if (errors.length > 0) return { ok: false, errors };
  return { ok: true, event: { type: 'decision-evaluated', payload: { source: 'positions-card', attestation: 'client', state: p.state as EvaluationState, reasonCode, candidate, stockPrice, callouts, rules: rules as string } } };
}

/** Whether a new card evaluation should be written, given the last one recorded for this LEAPS. Only a change of state or reason counts, and not more often than the minimum gap. */
export function shouldRecordEvaluation(
  last: { at: string; state: string; reasonCode: string | null } | null,
  next: { state: string; reasonCode: string | null },
  nowMs: number,
  minGapMs = EVALUATION_MIN_GAP_MS,
): boolean {
  if (!last) return true;
  if (last.state === next.state && (last.reasonCode ?? null) === (next.reasonCode ?? null)) return false;
  const lastMs = Date.parse(last.at);
  if (Number.isFinite(lastMs) && nowMs - lastMs < minGapMs) return false;
  return true;
}

export function shouldRecordOpenedReview(lastOpenedReviewAt: string | null, nowMs: number, minGapMs = OPENED_REVIEW_MIN_GAP_MS): boolean {
  if (!lastOpenedReviewAt) return true;
  const last = Date.parse(lastOpenedReviewAt);
  return !Number.isFinite(last) || nowMs - last >= minGapMs;
}

const ORDER_ACTION: Record<EntryRecordKind, DecisionAction> = { 'leaps-entry': 'bought-leaps', 'pmcc-entry': 'opened-pmcc', 'short-call-sold': 'sold-short-call' };

/**
 * The ledger event for an order the broker accepted (server-attested). The request id is derived from the broker order id, so recording
 * the same order twice is a no-op in the append-only ledger.
 */
export function buildOrderDecisionEvent(input: {
  id: string; at: string; kind: EntryRecordKind; entryRecordId: string; brokerOrderId: string | null; quantity: number; limitPrice: number;
  priceEffect: 'Debit' | 'Credit'; shortOccSymbol: string | null; underlyingPrice: number | null;
}): LeapsLedgerEvent {
  const payload: DecisionPayload = {
    action: ORDER_ACTION[input.kind], attestation: 'server', brokerOrderId: input.brokerOrderId, quantity: input.quantity, limitPrice: input.limitPrice,
    priceEffect: input.priceEffect, shortOccSymbol: input.shortOccSymbol, entryRecordId: input.entryRecordId, underlyingPrice: input.underlyingPrice,
  };
  return {
    id: input.id, at: input.at, policyVersion: 'LEAPS-PI-1.1', type: 'user-decision', actor: 'trader',
    requestId: input.brokerOrderId ? `order-${input.brokerOrderId}` : `entry-${input.entryRecordId}`,
    retention: 'append-only', recovery: 'rebuild-from-ledger', payload: payload as unknown as Record<string, unknown>,
  };
}

// ---- describing an event in plain English -------------------------------------------------------------------------------------

export interface LedgerEventLike { id: string; at: string; type: string; actor: string; payload: Record<string, unknown> }
export interface LedgerLine { id: string; at: string; title: string; detail: string | null; tone: CalloutTone; evidence: 'server' | 'client' | 'rules' }

const STATE_LABEL: Record<EvaluationState, string> = { 'review-income-call': 'Review income call', monitor: 'Monitor', 'hold-uncovered': 'Hold uncovered', 'reassess-thesis': 'Reassess thesis' };
const STATE_TONE: Record<EvaluationState, CalloutTone> = { 'review-income-call': 'good', monitor: 'watch', 'hold-uncovered': 'watch', 'reassess-thesis': 'bad' };

function contractText(occ: unknown): string | null {
  if (typeof occ !== 'string') return null;
  const parsed = parseOccSymbol(occ);
  return parsed.strikePrice != null && parsed.expiry != null ? `${money(parsed.strikePrice)} C ${parsed.expiry}` : occ;
}

export function describeLedgerEvent(event: LedgerEventLike): LedgerLine {
  const p = event.payload ?? {};
  const base = { id: event.id, at: event.at };

  if (event.type === 'decision-evaluated') {
    const state = p.state as EvaluationState;
    if (!(EVALUATION_STATES as readonly string[]).includes(state)) return { ...base, title: 'The card was evaluated', detail: null, tone: 'neutral', evidence: 'client' };
    const c = p.candidate as EvaluationPayload['candidate'] | null | undefined;
    const callouts = Array.isArray(p.callouts) ? p.callouts as Array<{ tone?: string; text?: string }> : [];
    const why = callouts.find(x => x.tone === 'bad')?.text ?? callouts.find(x => x.tone === 'watch')?.text ?? null;
    const parts = [c ? `Candidate ${money(c.strike)} C ${c.expiration}, credit ${money(c.credit)}, delta ${c.delta.toFixed(2)}` : null, why].filter(Boolean);
    return { ...base, title: `Card said: ${STATE_LABEL[state]}`, detail: parts.length > 0 ? parts.join(' · ') : null, tone: STATE_TONE[state], evidence: 'client' };
  }

  if (event.type === 'user-decision') {
    const evidence: LedgerLine['evidence'] = p.attestation === 'server' ? 'server' : 'client';
    const qty = typeof p.quantity === 'number' ? `${p.quantity}×` : '';
    const price = typeof p.limitPrice === 'number' ? `${money(p.limitPrice)} ${p.priceEffect === 'Credit' ? 'credit' : 'debit'}` : '';
    const short = contractText(p.shortOccSymbol);
    switch (p.action) {
      case 'opened-review': return { ...base, title: 'You opened the PMCC review', detail: null, tone: 'neutral', evidence };
      case 'bought-leaps': return { ...base, title: 'You bought this LEAPS', detail: [qty, price ? `at ${price}` : ''].filter(Boolean).join(' ') || null, tone: 'neutral', evidence };
      case 'opened-pmcc': return { ...base, title: 'You opened a PMCC pair', detail: [qty, short ? `short ${short}` : '', price ? `net ${price}` : ''].filter(Boolean).join(' · ') || null, tone: 'neutral', evidence };
      case 'sold-short-call': return { ...base, title: 'You sold a short call', detail: [qty, short, price ? `for ${price}` : ''].filter(Boolean).join(' ') || null, tone: 'neutral', evidence };
      default: return { ...base, title: 'You acted on this LEAPS', detail: null, tone: 'neutral', evidence };
    }
  }

  if (event.type === 'mandate-changed') {
    const mandate = p.mandate as LeapsMandate | undefined;
    return { ...base, title: 'You changed your income rules', detail: mandate ? describeIncomeRules(mandate, null).replace(/^Your rules: /, '') : null, tone: 'neutral', evidence: 'rules' };
  }

  return { ...base, title: 'Recorded event', detail: null, tone: 'neutral', evidence: 'client' };
}

/** Only these event types belong on the Decision history list (outcomes are shown in the Income history). */
export function isDecisionHistoryEvent(event: { type: string }): boolean {
  return event.type === 'decision-evaluated' || event.type === 'user-decision' || event.type === 'mandate-changed';
}
