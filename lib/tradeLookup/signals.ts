// lib/tradeLookup/signals.ts

// TRADE-LOOKUP-0001F: two information-only signals next to the chain, both built from the app's existing shared code,
// with no new thresholds:
//   RSI(14)   classifyRsiTurn on daily closes (RSI-TURN-0001: Alan's validated spec, provisional thresholds, never a gate)
//   earnings  classifyEarningsVsExpiry (SCAN-ALIGN-0001D: the one shared earnings-versus-expiry classifier),
//             single stocks only. ETFs and indices are never flagged; a missing date is silent (EARNINGS-NO-DATE-0001).
// Neither value gates a row, scores it or disables SELECT. Pure: no network.

import { classifyRsiTurn, RSI_STATE_LABEL, type RsiTurnState } from '@/lib/indicators/rsiTurn';
import { classifyEarningsVsExpiry, earningsAfterExpiryTag } from '@/lib/scans/earningsExpiryZone';
import { normalizeEarningsDate } from '@/lib/scans/pmccEarningsDates';

export interface RsiSignal {
  /** RSI(14), rounded to a whole number. */
  value: number;
  state: Exclude<RsiTurnState, 'INSUFFICIENT'>;
  label: string;
  /** Same tones as the quick-chart RSI strip: teal turning up, amber turning down, otherwise neutral. */
  tone: 'up' | 'down' | 'neutral';
}

export interface EarningsExpirySignal {
  /** Earnings fall on or before this expiration, or just after it (the shared 5-business-day window). */
  highlight: boolean;
  text: string;
}

export interface LookupSignals {
  /** Null when there were too few daily closes or the bars could not be read. */
  rsi: RsiSignal | null;
  earnings: {
    /** Single stocks only. */
    applies: boolean;
    date: string | null;
    /** Calendar days from today to the earnings date; negative when it has passed. */
    daysOut: number | null;
    forExpiration: Record<string, EarningsExpirySignal>;
  };
}

export interface SignalInput {
  closes: number[] | null;
  earningsDate: string | null;
  classification: 'index' | 'etf' | 'stock' | null;
  expirations: string[];
  /** A zoned ISO timestamp for "now" (the shared classifier derives the New York date from it). */
  asOf: string;
}

function daysBetween(fromIso: string, toIso: string): number {
  const a = Date.UTC(+fromIso.slice(0, 4), +fromIso.slice(5, 7) - 1, +fromIso.slice(8, 10));
  const b = Date.UTC(+toIso.slice(0, 4), +toIso.slice(5, 7) - 1, +toIso.slice(8, 10));
  return Math.round((b - a) / 86400000);
}

export function buildSignals(input: SignalInput): LookupSignals {
  const turn = input.closes ? classifyRsiTurn(input.closes) : null;
  const rsi: RsiSignal | null = turn && turn.state !== 'INSUFFICIENT'
    ? {
        value: Math.round(turn.latest),
        state: turn.state,
        label: RSI_STATE_LABEL[turn.state],
        tone: turn.state === 'TURNING_UP' ? 'up' : turn.state === 'TURNING_DOWN' ? 'down' : 'neutral',
      }
    : null;

  const applies = input.classification === 'stock';
  const date = applies ? normalizeEarningsDate(input.earningsDate) : null;
  const forExpiration: Record<string, EarningsExpirySignal> = {};
  let daysOut: number | null = null;
  if (applies && date) {
    for (let i = 0; i < input.expirations.length; i++) {
      const expiration = input.expirations[i];
      const r = classifyEarningsVsExpiry(date, expiration, input.asOf);
      if (daysOut === null && r.today) daysOut = daysBetween(r.today, date);
      if (r.zone === 'exclude') {
        forExpiration[expiration] = { highlight: true, text: 'Earnings ' + date + ' is on or before this expiration' };
      } else if (r.zone === 'warn-after') {
        forExpiration[expiration] = { highlight: true, text: earningsAfterExpiryTag(r.businessDaysAfter) + ' (' + date + ')' };
      } else {
        forExpiration[expiration] = { highlight: false, text: '' };
      }
    }
  }
  return { rsi, earnings: { applies, date, daysOut, forExpiration } };
}
