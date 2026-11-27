// lib/scans/ccLotLoss.ts

// CC-LOTS-0001: what a covered call costs or earns on the shares FIFO would actually deliver. Pure; no I/O.
//
// A call is covered by all your shares, but when it is assigned the broker delivers the OLDEST lot first (Dean is on
// FIFO). The broker's average basis can sit below that lot, so the average understates the loss on a below-basis call.
// Two numbers come out, on purpose (Ian):
//   - the delivered shares' own gain or loss (the plain-words line in the order dialog), and
//   - the HIGHEST lot price across every open lot (the never-below-basis check), so a strike between the average and
//     the oldest lot cannot slip through.
// Lots come from lib/portfolio/entryFromTransactions.ts, which only returns lots that add up to the shares held now.

export interface CcLot {
  shares: number;
  price: number;
  /** YYYY-MM-DD (New York day the lot was acquired). */
  day: string;
}

export interface CcLotLossInput {
  lots: ReadonlyArray<CcLot>;
  strike: number;
  premiumPerShare: number;
  contracts: number;
}

export interface CcLotLoss {
  /** Shares delivered if the calls are assigned: contracts x 100. */
  sharesDelivered: number;
  /** Price of the lot FIFO delivers first. */
  oldestLotPrice: number;
  /** Share-weighted cost of the delivered shares (equals oldestLotPrice when one lot covers them). */
  deliveredAveragePrice: number;
  /** True when the delivered shares come from more than one lot. */
  spansLots: boolean;
  /** Strike plus premium per share: what the shares sell for if called. */
  sellAtPrice: number;
  /** Premium kept, in dollars, for the whole order. */
  premium: number;
  /** (strike - cost) x delivered shares, before premium. Negative is a loss. */
  gainBeforePremium: number;
  gainWithPremium: number;
  /** Highest price among ALL open lots: the yardstick for "below your cost". */
  highestLotPrice: number;
}

const r2 = (n: number) => Math.round(n * 100) / 100;

/** Null when the lots cannot prove the shares (none, bad numbers, or fewer shares than the calls need). */
export function computeCcLotLoss(i: CcLotLossInput): CcLotLoss | null {
  const contracts = Math.floor(i.contracts);
  if (!(contracts >= 1) || !Number.isFinite(i.strike) || i.strike <= 0 || !Number.isFinite(i.premiumPerShare) || i.premiumPerShare < 0) return null;
  const lots = i.lots
    .filter(l => l.shares > 0 && Number.isFinite(l.price) && l.price > 0)
    .map((l, idx) => ({ ...l, idx }))
    .sort((a, b) => (a.day === b.day ? a.idx - b.idx : a.day < b.day ? -1 : 1));
  if (lots.length === 0 || lots.length !== i.lots.length) return null;
  const need = contracts * 100;
  if (lots.reduce((s, l) => s + l.shares, 0) < need) return null;

  let left = need;
  let cost = 0;
  let usedLots = 0;
  for (const l of lots) {
    if (left <= 0) break;
    const take = Math.min(left, l.shares);
    cost += take * l.price;
    left -= take;
    usedLots += 1;
  }
  const premium = r2(i.premiumPerShare * need);
  const gain = r2(i.strike * need - cost);
  return {
    sharesDelivered: need,
    oldestLotPrice: lots[0].price,
    deliveredAveragePrice: r2(cost / need),
    spansLots: usedLots > 1,
    sellAtPrice: r2(i.strike + i.premiumPerShare),
    premium,
    gainBeforePremium: gain,
    gainWithPremium: r2(gain + premium),
    highestLotPrice: Math.max(...lots.map(l => l.price)),
  };
}

const usd0 = (n: number) => '$' + Math.round(Math.abs(n)).toLocaleString('en-US');
const usd2 = (n: number) => '$' + n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/**
 * One line, plain words (Diane): what you collect, what the shares sell for, and the result on your oldest shares with
 * and without the premium. Example:
 *   "You collect $91 · if called, you sell at $55.91 · you lose $2,609 on your oldest shares ($2,700 without the $91)"
 */
export function ccLotLossLine(l: CcLotLoss): string {
  const word = (n: number) => (n < 0 ? 'lose' : 'make');
  const same = (l.gainWithPremium < 0) === (l.gainBeforePremium < 0);
  const without = same
    ? `${usd0(l.gainBeforePremium)} without the ${usd0(l.premium)}`
    : `${l.gainBeforePremium < 0 ? 'a ' + usd0(l.gainBeforePremium) + ' loss' : 'a ' + usd0(l.gainBeforePremium) + ' gain'} without the ${usd0(l.premium)}`;
  return `You collect ${usd0(l.premium)} · if called, you sell at ${usd2(l.sellAtPrice)} · you ${word(l.gainWithPremium)} ${usd0(l.gainWithPremium)} on your oldest shares (${without})`;
}
