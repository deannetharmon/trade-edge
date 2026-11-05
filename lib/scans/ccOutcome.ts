// lib/scans/ccOutcome.ts

// SELL-CC-0001 slice A: the plain-language numbers for one covered-call order. Pure; no I/O.
// Fees are an ESTIMATE (commission plus regulatory fees per contract), labeled as such wherever shown.

/** Estimated all-in fee to sell one option contract to open, in dollars. An estimate, not the broker's figure. */
export const CC_EST_FEE_PER_CONTRACT = 1.13;

export interface CcOutcomeInput {
  strike: number;
  premiumPerShare: number;
  contracts: number;
  /** Current stock price, when known (used only for the in-the-money flag). */
  stockPrice?: number | null;
}

export interface CcOutcome {
  premiumPerContract: number;
  grossCredit: number;
  estFees: number;
  netCredit: number;
  /** Strike plus premium per share, before fees: the price per share if the shares are called away. */
  effectiveSalePrice: number;
  /** Premium per share: the stock can fall this far from today's price before the position is worse off than not selling. */
  downsideBufferPerShare: number;
  /** True when the strike is below the current stock price: assignment is likely. Null when the price is unknown. */
  inTheMoney: boolean | null;
}

const r2 = (n: number) => Math.round(n * 100) / 100;

export function computeCcOutcome(i: CcOutcomeInput): CcOutcome {
  const contracts = Math.max(0, Math.floor(i.contracts));
  const perContract = r2(i.premiumPerShare * 100);
  const gross = r2(perContract * contracts);
  const fees = r2(CC_EST_FEE_PER_CONTRACT * contracts);
  return {
    premiumPerContract: perContract,
    grossCredit: gross,
    estFees: fees,
    netCredit: r2(gross - fees),
    effectiveSalePrice: r2(i.strike + i.premiumPerShare),
    downsideBufferPerShare: r2(i.premiumPerShare),
    inTheMoney: typeof i.stockPrice === 'number' && Number.isFinite(i.stockPrice) && i.stockPrice > 0 ? i.strike < i.stockPrice : null,
  };
}

export function ccOutcomeLines(i: CcOutcomeInput, symbol: string, shares: number | null): string[] {
  const o = computeCcOutcome(i);
  const usd = (n: number) => '$' + n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const lines = [
    `${usd(i.premiumPerShare)}/share = ${usd(o.premiumPerContract)} per contract.`,
    `Estimated net credit ${usd(o.netCredit)} (${usd(o.grossCredit)} less about ${usd(o.estFees)} in fees).`,
    `If ${symbol} finishes below ${usd(i.strike)}: you keep the shares and the premium.`,
    `If ${symbol} finishes at or above ${usd(i.strike)}: your shares may be sold at ${usd(i.strike)}; you keep the premium (${usd(o.effectiveSalePrice)}/share before fees).`,
    `Upside is capped at ${usd(o.effectiveSalePrice)}/share. Downside buffer: ${usd(o.downsideBufferPerShare)}/share.`,
  ];
  if (shares !== null) lines.unshift(`Covered by ${shares} ${symbol} share${shares === 1 ? '' : 's'} in this account.`);
  return lines;
}
