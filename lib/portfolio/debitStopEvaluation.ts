import type { GtcOrder, Position } from '@/lib/portfolio-data/types';
import type {
  DebitStopPolicy,
  StopAssessment,
  StopClassification,
  StopEvidenceSource,
} from './stopLossPolicy';

export const DEBIT_STOP_QUOTE_MAX_AGE_MS = 120_000;
export const DEBIT_STOP_OBSERVE_ENABLED = process.env.NEXT_PUBLIC_DEBIT_STOP_OBSERVE_ENABLED === 'true';
const PRICE_EPS = 0.02;
const MATERIALITY_BAND = 0.10;

export interface StopAcquisitionCompleteness {
  liveOrdersAvailable: boolean;
  complexOrdersAvailable: boolean;
}

export interface DebitQuoteEvidence {
  executableBid: number | null;
  ask: number | null;
  quoteTime: string | null;
  now?: Date;
}

type PositionInput = Pick<Position,
  'accountNumber' | 'legs' | 'quantity' | 'identity' | 'structureAmbiguous' |
  'entryPriceEffect' | 'entryEconomicsComplete' | 'entryCredit'>;

function sources(completeness: StopAcquisitionCompleteness): StopEvidenceSource[] {
  return [
    { endpoint: '/orders/live', available: completeness.liveOrdersAvailable },
    { endpoint: '/complex-orders', available: completeness.complexOrdersAvailable },
  ];
}

function orderEvidence(order: GtcOrder) {
  const limit = Number(order.price);
  const trigger = Number(order.stopPrice);
  return {
    accountNumber: order.accountNumber ?? null,
    orderId: order.id,
    complexOrderId: order.complexOrderId ?? null,
    sourceEndpoint: order.sourceEndpoint ?? 'unknown' as const,
    status: order.status ?? null,
    orderType: order.orderType,
    timeInForce: order.timeInForce,
    priceEffect: order.priceEffect ?? null,
    triggerPrice: Number.isFinite(trigger) ? trigger : null,
    limitPrice: Number.isFinite(limit) ? limit : null,
    legs: order.legs.map(leg => ({ symbol: leg.symbol, action: leg.action, quantity: leg.quantity ?? null, ratio: leg.ratio ?? null })),
  };
}

function positionEvidence(position: PositionInput) {
  const leg = position.legs.length === 1 ? position.legs[0] : null;
  return {
    accountNumber: position.accountNumber,
    occSymbol: leg?.symbol ?? null,
    side: leg?.direction ?? (position.legs.length > 1 ? 'Mixed' as const : 'Unknown' as const),
    optionType: leg?.optionType ?? null,
    quantity: Number.isInteger(position.quantity) && position.quantity > 0 ? position.quantity : null,
  };
}

function assessment(
  position: PositionInput,
  orders: GtcOrder[],
  completeness: StopAcquisitionCompleteness,
  quote: DebitQuoteEvidence,
  result: Omit<StopAssessment, 'rawEvidence'>,
): StopAssessment {
  const parsedQuoteTime = quote.quoteTime ? Date.parse(quote.quoteTime) : NaN;
  const age = Number.isFinite(parsedQuoteTime) ? (quote.now ?? new Date()).getTime() - parsedQuoteTime : NaN;
  const quoteFresh = Number.isFinite(age) && age >= 0 ? age <= DEBIT_STOP_QUOTE_MAX_AGE_MS : null;
  return {
    ...result,
    rawEvidence: {
      position: positionEvidence(position),
      sources: sources(completeness),
      orders: orders.map(orderEvidence),
      executableBid: quote.executableBid,
      quoteTime: quote.quoteTime,
      quoteFresh,
    },
  };
}

function terminal(status: string | null | undefined): boolean {
  return ['filled', 'cancelled', 'canceled', 'rejected', 'expired', 'removed'].includes(String(status ?? '').trim().toLowerCase());
}
function active(status: string | null | undefined): boolean {
  return ['live', 'working', 'received', 'queued', 'routed', 'pending', 'contingent'].includes(String(status ?? '').trim().toLowerCase());
}

function normalizeOcc(value: string): string { return value.replace(/\s+/g, '').toUpperCase(); }
function isStandardOcc(value: string): boolean { return /^[A-Z]{1,6}\d{6}[CP]\d{8}$/.test(normalizeOcc(value)); }

function baseDerived(classification: StopClassification, explanation: string): StopAssessment['derivedAssessment'] {
  return {
    matchResult: classification === 'NO_STOP' ? 'NO_MATCH' : classification === 'UNSUPPORTED' ? 'NOT_APPLICABLE' : classification === 'INVALID' ? 'INVALID' : 'NO_MATCH',
    policySource: 'NONE', policyAnchor: null, expectedTrigger: null, actualTrigger: null,
    variance: null, blockingExplanation: explanation,
  };
}

export function evaluateDebitStop(input: {
  position: PositionInput;
  orders: GtcOrder[];
  completeness: StopAcquisitionCompleteness;
  quote: DebitQuoteEvidence;
  policy?: DebitStopPolicy | null;
  enabled: boolean;
}): StopAssessment {
  const { position, orders, completeness, quote, policy } = input;
  const unsupported = !input.enabled || position.structureAmbiguous || !position.identity ||
    position.identity.structureType !== 'NAKED' || position.identity.contractMultiplier !== 100 ||
    position.entryPriceEffect !== 'Debit' || position.entryEconomicsComplete !== true ||
    position.entryCredit == null || !Number.isFinite(position.entryCredit) || position.entryCredit <= 0 ||
    position.legs.length !== 1 || position.legs[0].direction !== 'Long' ||
    !isStandardOcc(position.legs[0].symbol) ||
    !Number.isInteger(position.quantity) || position.quantity <= 0;
  if (unsupported) {
    const explanation = 'Stop evaluation is not supported for this position structure.';
    return assessment(position, orders, completeness, quote, {
      classification: 'UNSUPPORTED', applicability: 'UNSUPPORTED', reasonCode: input.enabled ? 'DEBIT_STRUCTURE_UNSUPPORTED' : 'DEBIT_OBSERVATION_DISABLED', explanation,
      evidenceComplete: completeness.liveOrdersAvailable && completeness.complexOrdersAvailable,
      matchedOrderId: null, ambiguousOrderIds: [], derivedAssessment: baseDerived('UNSUPPORTED', explanation),
    });
  }

  const evidenceComplete = completeness.liveOrdersAvailable && completeness.complexOrdersAvailable;
  const occ = normalizeOcc(position.legs[0].symbol);
  const activeStopOrders = orders.filter(order => !terminal(order.status) && order.orderType.toLowerCase().includes('stop'));
  const candidates = activeStopOrders.filter(order =>
    order.legs.some(leg => normalizeOcc(leg.symbol) === occ) ||
    (policy?.brokerOrderId != null && order.id === policy.brokerOrderId) ||
    (policy?.complexOrderId != null && order.complexOrderId === policy.complexOrderId));

  if (candidates.length === 0) {
    const classification: StopClassification = evidenceComplete ? 'NO_STOP' : 'NOT_EVALUATED';
    const explanation = evidenceComplete
      ? 'No matching protective stop found.'
      : 'Stop not evaluated — required broker evidence is unavailable or ambiguous.';
    return assessment(position, orders, completeness, quote, {
      classification, applicability: evidenceComplete ? 'SINGLE_LONG_DEBIT' : 'NOT_EVALUATED',
      reasonCode: evidenceComplete ? 'NO_MATCHING_PROTECTIVE_STOP' : 'ORDER_FEED_INCOMPLETE', explanation,
      evidenceComplete, matchedOrderId: null, ambiguousOrderIds: [], derivedAssessment: baseDerived(classification, explanation),
    });
  }
  if (candidates.length > 1) {
    const explanation = 'Stop not evaluated — required broker evidence is unavailable or ambiguous.';
    return assessment(position, orders, completeness, quote, {
      classification: 'NOT_EVALUATED', applicability: 'NOT_EVALUATED', reasonCode: 'AMBIGUOUS_PROTECTIVE_STOPS', explanation,
      evidenceComplete, matchedOrderId: null, ambiguousOrderIds: candidates.map(order => order.id),
      derivedAssessment: { ...baseDerived('NOT_EVALUATED', explanation), matchResult: 'AMBIGUOUS' },
    });
  }

  const match = candidates[0];
  const leg = match.legs[0];
  const trigger = Number(match.stopPrice);
  const limit = Number(match.price);
  const isStopLimit = match.orderType.toLowerCase().includes('limit');
  const wrong =
    match.accountNumber != null && match.accountNumber !== position.accountNumber ? 'ORDER_ACCOUNT_MISMATCH' :
    !active(match.status) ? 'ORDER_STATUS_NOT_ACTIVE' :
    match.legs.length !== 1 ? 'ORDER_LEG_COUNT_INVALID' :
    !leg || normalizeOcc(leg.symbol) !== occ ? 'ORDER_OCC_MISMATCH' :
    leg.action.trim().toLowerCase() !== 'sell to close' ? 'ORDER_ACTION_INVALID' :
    leg.quantity !== position.quantity ? 'ORDER_QUANTITY_INVALID' :
    leg.ratio !== 1 ? 'ORDER_RATIO_INVALID' :
    String(match.priceEffect ?? '').toLowerCase() !== 'credit' ? 'ORDER_PRICE_EFFECT_INVALID' :
    !Number.isFinite(trigger) || trigger <= 0 ? 'ORDER_TRIGGER_INVALID' :
    isStopLimit && (!Number.isFinite(limit) || limit <= 0) ? 'ORDER_LIMIT_INVALID' :
    isStopLimit && limit > trigger ? 'STOP_LIMIT_ABOVE_TRIGGER' : null;
  if (wrong) {
    const explanation = 'A candidate protective stop was found, but its identity or order fields are malformed, contradictory, or unsafe.';
    return assessment(position, orders, completeness, quote, {
      classification: 'INVALID', applicability: 'SINGLE_LONG_DEBIT', reasonCode: wrong, explanation,
      evidenceComplete, matchedOrderId: match.id, ambiguousOrderIds: [],
      derivedAssessment: { ...baseDerived('INVALID', explanation), actualTrigger: Number.isFinite(trigger) ? trigger : null },
    });
  }

  const quoteTime = quote.quoteTime ? Date.parse(quote.quoteTime) : NaN;
  const quoteAge = Number.isFinite(quoteTime) ? (quote.now ?? new Date()).getTime() - quoteTime : NaN;
  const quoteInvalid = quote.executableBid == null || !Number.isFinite(quote.executableBid) || quote.executableBid <= 0 ||
    quote.ask == null || !Number.isFinite(quote.ask) || quote.ask <= 0 || quote.ask < quote.executableBid ||
    !Number.isFinite(quoteAge) || quoteAge < 0 || quoteAge > DEBIT_STOP_QUOTE_MAX_AGE_MS;
  if (quoteInvalid) {
    const explanation = 'Stop not evaluated — required broker evidence is unavailable or ambiguous.';
    return assessment(position, orders, completeness, quote, {
      classification: 'NOT_EVALUATED', applicability: 'NOT_EVALUATED', reasonCode: 'EXECUTABLE_QUOTE_UNAVAILABLE', explanation,
      evidenceComplete: false, matchedOrderId: match.id, ambiguousOrderIds: [],
      derivedAssessment: { ...baseDerived('NOT_EVALUATED', explanation), matchResult: 'MATCHED', actualTrigger: trigger },
    });
  }
  const executableBid = quote.executableBid as number;
  if (trigger >= executableBid) {
    const explanation = 'Protective stop trigger must be strictly below the fresh executable bid.';
    return assessment(position, orders, completeness, quote, {
      classification: 'INVALID', applicability: 'SINGLE_LONG_DEBIT', reasonCode: 'TRIGGER_NOT_BELOW_EXECUTABLE_BID', explanation,
      evidenceComplete, matchedOrderId: match.id, ambiguousOrderIds: [],
      derivedAssessment: { ...baseDerived('INVALID', explanation), matchResult: 'INVALID', actualTrigger: trigger },
    });
  }

  const identityMatchesPolicy = policy != null &&
    ((policy.brokerOrderId != null && policy.brokerOrderId === match.id) ||
      (policy.complexOrderId != null && policy.complexOrderId === match.complexOrderId));
  if (!identityMatchesPolicy || !policy) {
    const explanation = 'A valid protective stop exists, but no approved debit policy is linked to this broker order.';
    return assessment(position, orders, completeness, quote, {
      classification: 'UNKNOWN_PROVENANCE', applicability: 'SINGLE_LONG_DEBIT', reasonCode: 'DEBIT_POLICY_NOT_LINKED', explanation,
      evidenceComplete, matchedOrderId: match.id, ambiguousOrderIds: [],
      derivedAssessment: { matchResult: 'MATCHED', policySource: 'NONE', policyAnchor: null, expectedTrigger: null, actualTrigger: trigger, variance: null, blockingExplanation: explanation },
    });
  }

  const expected = policy.triggerPrice;
  const variance = trigger - expected;
  const tolerance = Math.max(PRICE_EPS, expected * MATERIALITY_BAND);
  const classification: StopClassification = variance > tolerance ? 'TOO_TIGHT' : variance < -tolerance ? 'TOO_LOOSE' : 'ALIGNED';
  return assessment(position, orders, completeness, quote, {
    classification, applicability: 'SINGLE_LONG_DEBIT', reasonCode: `DEBIT_STOP_${classification}`, explanation: `Debit stop is ${classification.toLowerCase().replace('_', ' ')} against the explicitly selected maximum-loss policy.`,
    evidenceComplete, matchedOrderId: match.id, ambiguousOrderIds: [],
    derivedAssessment: {
      matchResult: 'MATCHED', policySource: 'DEBIT_POLICY',
      policyAnchor: `${(policy.maximumLossPct * 100).toFixed(1)}% maximum loss on ${policy.originalDebitPerContract.toFixed(2)} original debit`,
      expectedTrigger: expected, actualTrigger: trigger, variance, blockingExplanation: null,
    },
  });
}
