// lib/suggested-actions/pmccShortCallSuggestion.ts
//
// SUGGESTED-ACTIONS-0001 slice 1: pure rule deciding which held LEAPS get a dashboard
// "Sell PMCC short call" card. Suggestion only: never places, gates or changes an order.
// The structural checks (current broker evidence, account match, ambiguity, 180-730 DTE,
// paired short call, working short order) all live in buildIncomeOpportunities; a card is
// only an opportunity in status 'review-income-call' plus the gain and intent tests here.

import type { ExistingIncomeOpportunity } from '@/features/portfolio/positions-workspace/model/types';
import { normalizeIntentForFamily } from '@/lib/positionIntent/vocabulary';
import {
  PMCC_SHORT_DELTA_MAX, PMCC_SHORT_DELTA_MIN, PMCC_SHORT_DTE_MAX, PMCC_SHORT_DTE_MIN, QUOTE_MAX_AGE_MS,
} from '@/lib/leaps-position-intelligence/policy';

/** A LEAP shows a card once it is up at least this much (1 = +100%). */
export const SUGGEST_ARM_GAIN = 1;
/** An armed card stays until the gain falls below this (hysteresis, stops flicker at the line). */
export const SUGGEST_RELEASE_GAIN = 0.9;
export const SUGGEST_MAX_CARDS = 3;
export const PMCC_SHORT_CALL_BADGE = 'Sell PMCC short call';

const GAIN_EPSILON = 1e-9; // 1.9 vs 1.0 entry is 0.8999999999999999 in floating point

/** Policy window shown under the badge. Built from the shared policy constants; never typed into the UI. */
export function pmccShortCallWindowText(): string {
  return `${PMCC_SHORT_DTE_MIN}–${PMCC_SHORT_DTE_MAX} DTE · delta ${PMCC_SHORT_DELTA_MIN.toFixed(2)}–${PMCC_SHORT_DELTA_MAX.toFixed(2)}`;
}

export interface PmccShortCallCard {
  positionKey: string;
  symbol: string;
  accountNumber: string | null;
  exactContract: string | null;
  strike: number;
  expiration: string;
  dte: number;
  quantity: number;
  spot: number | null;
  entryPerShare: number;
  markPerShare: number;
  /** Fraction: 1 = +100%. */
  gain: number;
  /** (mark - entry) x 100 x contracts, mid basis, display only. */
  gainDollars: number;
  badge: string;
  windowText: string;
  /** The underlying opportunity, passed to the shared hand-off when the card is tapped. */
  opportunity: ExistingIncomeOpportunity;
}

export interface PmccSuggestionInput {
  opportunities: ExistingIncomeOpportunity[];
  /** position.key -> stored intent. Anything outside the LEAP vocabulary reads as 'undecided'. */
  intentByKey: Record<string, string | null | undefined>;
  /** position.key -> ISO time the card was first shown (saved state). */
  armedKeys: Record<string, string>;
  /** Broker evidence is current (snapshot freshness 'current' and data quality ok). */
  evidenceCurrent: boolean;
  lastRefresh: Date | null;
  now: Date;
}

export interface PmccSuggestionResult {
  cards: PmccShortCallCard[];
  /** Cards that qualified beyond the cap. */
  overflow: number;
  /** Armed state to save. Equal to the input when nothing may change (stale or no current evidence). */
  armedKeys: Record<string, string>;
  /** Quotes older than QUOTE_MAX_AGE_MS or never refreshed: cards render greyed and not tappable. */
  stale: boolean;
  asOf: Date | null;
}

function finite(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

export function pmccGain(entry: number | null | undefined, mark: number | null | undefined): number | null {
  if (!finite(entry) || entry <= 0 || !finite(mark) || mark < 0) return null; // never guess a basis
  return (mark - entry) / entry;
}

export function buildPmccShortCallSuggestions(input: PmccSuggestionInput): PmccSuggestionResult {
  const { opportunities, intentByKey, armedKeys, evidenceCurrent, lastRefresh, now } = input;
  const stale = lastRefresh == null || now.getTime() - lastRefresh.getTime() > QUOTE_MAX_AGE_MS;
  const base = { stale, asOf: lastRefresh };

  // Without current broker evidence nothing is a candidate and nothing may arm or release.
  if (!evidenceCurrent) return { cards: [], overflow: 0, armedKeys, ...base };

  const qualified: PmccShortCallCard[] = [];
  const nextArmed: Record<string, string> = {};

  for (const opp of opportunities) {
    const held = opp.heldPmccLong;
    if (opp.kind !== 'pmcc-short-call' || opp.status !== 'review-income-call' || !opp.positionKey || !held) continue;
    const intent = normalizeIntentForFamily(intentByKey[opp.positionKey], 'LEAP');
    if (intent !== 'pmcc' && intent !== 'undecided') continue;

    const gain = pmccGain(held.entryDebitPerShare, held.markPerShare);
    if (gain == null) continue;
    const wasArmed = opp.positionKey in armedKeys;
    const threshold = wasArmed ? SUGGEST_RELEASE_GAIN : SUGGEST_ARM_GAIN;
    if (gain + GAIN_EPSILON < threshold) continue;

    const entry = held.entryDebitPerShare as number;
    const mark = held.markPerShare as number;
    nextArmed[opp.positionKey] = armedKeys[opp.positionKey] ?? now.toISOString();
    qualified.push({
      positionKey: opp.positionKey,
      symbol: opp.symbol,
      accountNumber: opp.accountNumber,
      exactContract: opp.exactContract,
      strike: held.strike,
      expiration: held.expiration,
      dte: held.dte,
      quantity: Math.abs(held.quantity),
      spot: finite(held.stockPrice) ? held.stockPrice : null,
      entryPerShare: entry,
      markPerShare: mark,
      gain,
      gainDollars: (mark - entry) * 100 * Math.abs(held.quantity),
      badge: PMCC_SHORT_CALL_BADGE,
      windowText: pmccShortCallWindowText(),
      opportunity: opp,
    });
  }

  qualified.sort((a, b) => b.gain - a.gain || a.symbol.localeCompare(b.symbol) || a.positionKey.localeCompare(b.positionKey));
  const cards = qualified.slice(0, SUGGEST_MAX_CARDS);

  // Quotes that old must not arm or release anything; show what qualifies, change no saved state.
  return { cards, overflow: qualified.length - cards.length, armedKeys: stale ? armedKeys : nextArmed, ...base };
}
