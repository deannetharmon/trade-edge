// lib/scans/ccDecide.ts
//
// CC-DECIDE-0001 slice A (Ian, Diane, Paul; Dean 2026-11-09): for a covered call on shares you own, two plain boxes: what to
// do and what you collect, and "the catch" in dollars. Pure and display-only: no gate, rank or order reads this.
//
// Rules: the chance you keep your shares is 1 - |delta| (a model estimate, the same delta the card already shows). The
// "typical move" is the stock's implied-volatility move over the call's days (computeExpectedMove); with no IV the
// rally figure is left out rather than guessed. The sale result always includes the credit collected. A strike below
// your cost is stated as a loss in dollars.

import { computeExpectedMove } from './expectedMove';

export interface CcDecideInput {
  symbol: string;
  spot: number | null | undefined;
  strike: number;
  delta: number;
  dte: number;
  /** ISO date, e.g. "2026-11-16". */
  expiration: string;
  /** Credit for one contract, in dollars. */
  premiumPerContract: number | null | undefined;
  contracts: number | null | undefined;
  costBasis: number | null | undefined;
  /** Expiration IVx in percent (e.g. 91 for 91%). */
  ivxPct?: number | null;
}

export interface CcDecide {
  headline: string;
  keepLine: string;
  catchKind: 'normal' | 'below-cost';
  catchLabel: string;
  catchText: string;
}

const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const usd = (n: number) => `$${Math.round(Math.abs(n)).toLocaleString('en-US')}`;
const price = (n: number) => (Number.isInteger(n) ? `$${n}` : `$${n.toFixed(2)}`);
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export function ccExpirationLabel(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!m) return iso;
  const month = MONTHS[Number(m[2]) - 1];
  return month ? `${month} ${Number(m[3])}` : iso;
}

export function buildCcDecide(i: CcDecideInput): CcDecide | null {
  const n = i.contracts;
  const premium = i.premiumPerContract;
  const spot = i.spot;
  if (!finite(n) || n < 1 || !Number.isInteger(n)) return null;
  if (!finite(premium) || premium <= 0) return null;
  if (!finite(spot) || spot <= 0) return null;
  if (!finite(i.strike) || i.strike <= 0 || !finite(i.delta) || !finite(i.dte) || i.dte <= 0) return null;

  const shares = n * 100;
  const collect = premium * n;
  const strikeText = price(i.strike);
  const keepPct = Math.round((1 - Math.min(1, Math.max(0, Math.abs(i.delta)))) * 100);
  const headline = `Sell ${n} ${strikeText} ${n === 1 ? 'call' : 'calls'} expiring ${ccExpirationLabel(i.expiration)} for ${usd(collect)}.`;
  const keepLine = `You keep all gains up to ${strikeText}. Model odds: about a ${keepPct}% chance you keep your shares.`;

  const basis = finite(i.costBasis) && i.costBasis > 0 ? i.costBasis : null;
  if (basis != null && i.strike < basis) {
    return {
      headline, keepLine, catchKind: 'below-cost', catchLabel: 'THE CATCH · BELOW YOUR COST',
      catchText: `${strikeText} is below your ${price(basis)} cost. If ${i.symbol} finishes above ${strikeText}, your shares are sold for a ${usd((basis - i.strike) * shares)} loss on your cost, before the ${usd(collect)} you collected.`,
    };
  }

  const move = computeExpectedMove(spot, finite(i.ivxPct) ? i.ivxPct : null, i.dte);
  const sale = basis != null ? ` Your shares would be sold at ${strikeText} for a ${usd((i.strike - basis) * shares)} gain on your ${price(basis)} cost, plus the ${usd(collect)} you collected.` : '';
  let text: string;
  if (move == null) {
    text = `The calls only cost you if ${i.symbol} finishes above ${strikeText}.${sale}`;
  } else {
    const rally = spot + move;
    const missed = (rally - i.strike) * shares - collect;
    if (rally > i.strike && missed > 0) {
      text = `If ${i.symbol} rallies to ${price(Math.round(rally * 100) / 100)} (a typical ${i.dte}-day move up, model estimate), you would miss ${usd(missed)} of gain.${sale}`;
    } else {
      text = `The calls only cost you if ${i.symbol} finishes above ${strikeText}. A typical ${i.dte}-day move up (model estimate) reaches about ${price(Math.round(rally * 100) / 100)}, which does not cost you more than the ${usd(collect)} you collect.${sale}`;
    }
  }
  return { headline, keepLine, catchKind: 'normal', catchLabel: 'THE CATCH', catchText: text };
}
