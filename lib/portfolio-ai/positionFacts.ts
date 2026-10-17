// lib/portfolio-ai/positionFacts.ts
//
// PORTFOLIO-AI-0002: the full per-position record the Positions Workspace shows, as text for the AI.
// Every value comes from the same view-model builders the screen uses (breakeven, value split, capital,
// recovery, P&L bases, moneyness, net edge), so the AI sees what the trader sees. Missing inputs print
// "not available" and are never estimated. $ and % figures are also returned so the figure check accepts them.

import type { Position } from '@/lib/portfolio-data/types';
import { netEdgeLive, netEdgePeak } from '@/lib/portfolio-data/acquisition';
import { buildBreakevenViewModel, priceBufferFor } from '@/features/portfolio/positions-workspace/model/breakeven';
import { buildValueSplit } from '@/features/portfolio/positions-workspace/model/extrinsic';
import { buildLongOptionRecovery } from '@/features/portfolio/positions-workspace/model/longOptionRecovery';
import { buildCapitalViewModel, buildMoneynessViewModel } from '@/features/portfolio/positions-workspace/model/presentation';
import { nextEarningsLine } from '@/features/portfolio/positions-workspace/model/nextEarnings';
import { buildPnlSecondLine, buildPositionPnlBases } from '@/features/portfolio/positions-workspace/model/pnlBases';
import { positionDayChangeDetail } from '@/features/portfolio/positions-workspace/model/portfolioSummary';

export interface PositionFacts { lines: string[]; figures: number[] }

const NA = 'not available';
const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

export function buildPositionFacts(pos: Position, nowMs: number): PositionFacts {
  const lines: string[] = [];
  const figures: number[] = [];
  const dollars = (v: number | null | undefined, digits = 2): string => {
    if (!finite(v)) return NA;
    figures.push(v, Math.abs(v), Math.round(v), Math.round(Math.abs(v)));
    return `${v < 0 ? '-' : ''}$${Math.abs(v).toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits })}`;
  };
  const percent = (v: number | null | undefined, digits = 1): string => {
    if (!finite(v)) return NA;
    figures.push(v, Math.abs(v), Math.round(v), Math.round(Math.abs(v)));
    return `${v.toFixed(digits)}%`;
  };
  const num = (v: number | null | undefined, digits = 3): string => (finite(v) ? v.toFixed(digits) : NA);
  const move = (label: string, entry: number | null | undefined, now: number | null | undefined, digits = 3) =>
    `${label}: ${finite(entry) ? entry.toFixed(digits) : NA} at first tracking, ${finite(now) ? now.toFixed(digits) : NA} now`;
  const add = (label: string, text: string) => lines.push(`${label}: ${text}`);

  // Structure
  add('Contracts', finite(pos.quantity) ? `${pos.quantity}` : NA);
  add('Legs', pos.legs.length === 0 ? NA : pos.legs.map(l =>
    `${l.direction} ${l.strikePrice}${l.optionType} x${l.quantity} (avg open ${finite(l.avgOpenPrice) ? l.avgOpenPrice.toFixed(2) : NA}, now ${finite(l.currentPrice) ? l.currentPrice.toFixed(2) : NA}, delta ${num(l.currentDelta)})`).join('; '));
  add('Expiration', `${pos.expDate ?? NA}; DTE ${pos.dteAtEntry ?? pos.snapshotHistory?.[0]?.dte ?? NA} at first tracking, ${pos.dte} now`);
  add('Opened', pos.entryDate ?? NA);
  add('Intent', pos.intent ?? NA);

  // Underlying and moneyness
  const m = buildMoneynessViewModel(pos.stockPrice, pos.legs);
  add('Underlying', `${finite(pos.stockPriceAtEntry) ? `$${pos.stockPriceAtEntry.toFixed(2)}` : NA} at first tracking, ${finite(pos.stockPrice) ? `$${pos.stockPrice.toFixed(2)}` : NA} now${m ? `; ${m.state} by ${percent(m.distancePct)} (${m.leg.direction} ${m.leg.strikePrice}${m.leg.optionType})` : ''}`);
  if (finite(pos.stockPrice)) figures.push(pos.stockPrice);
  if (finite(pos.stockPriceAtEntry)) figures.push(pos.stockPriceAtEntry);

  // Entry, capital, value
  const capital = buildCapitalViewModel(pos);
  add('Entry', `${pos.entryPriceEffect} ${pos.entryEconomicsComplete === false ? NA : dollars(pos.entryCredit ?? pos.creditReceived)}`);
  add('Capital', capital.value == null ? `${capital.label} (${capital.reason ?? NA})` : `${capital.label} ${capital.suffix ? `${capital.value}${capital.suffix}` : dollars(capital.value, 0)}`);
  const recovery = buildLongOptionRecovery(pos);
  if (recovery) {
    add('Value', `close now ${dollars(recovery.closeNow, 0)} of ${dollars(recovery.paid, 0)} paid (${percent(recovery.remainingPct, 0)} ${recovery.atOrAbovePaid ? 'of paid' : 'left'})`);
  } else {
    add('Value', `${pos.entryPriceEffect === 'Debit' ? 'liquidation' : 'buyback'} ${dollars(pos.equityEffectClose)}, mid ${dollars(pos.equityEffectMid)}`);
  }

  // P&L
  const bases = buildPositionPnlBases(pos);
  const second = buildPnlSecondLine(bases);
  const primary = pos.closeNowPnl ?? pos.pnl;
  add('P&L', `${dollars(primary)} (${bases.primary === 'close-now' ? 'close-now basis' : 'mid basis'})${second ? `; ${second.text}` : ''}`);
  if (second) for (const hit of second.text.match(/-?\d+(?:\.\d+)?/g) ?? []) figures.push(Number(hit));
  const day = positionDayChangeDetail(pos, nowMs);
  add('1-day change', day.value == null ? `${NA} (${day.reason ?? 'no data'})` : `${dollars(day.value)}${day.sinceOpen ? ' since open' : ''}`);

  // Break-even and buffer
  const be = buildBreakevenViewModel(pos);
  add('Break-even at expiration', be.values.length ? be.values.map(v => dollars(v)).join(' / ') : `${NA} (${be.unavailableReason ?? 'unavailable'})`);
  const buffer = priceBufferFor(be, pos.stockPrice);
  add('Price buffer', buffer ? `${dollars(buffer.dollars)}${buffer.pct != null ? ` (${percent(buffer.pct)})` : ''}` : NA);

  // Intrinsic / extrinsic
  const split = buildValueSplit(pos);
  if (split) {
    add('Intrinsic per share', `${dollars(split.intrinsic.atEntry)} at entry, ${dollars(split.intrinsic.now)} now`);
    add('Extrinsic per share', `${dollars(split.extrinsic.atEntry)} at entry, ${dollars(split.extrinsic.now)} now${split.extrinsicPctOfValue != null ? ` (${percent(split.extrinsicPctOfValue, 0)} of option value)` : ''}`);
  } else add('Intrinsic / extrinsic', NA);

  // Greeks and volatility, as the screen shows them (per share, raw)
  add('Greeks (per share)', [
    move('delta', pos.deltaAtEntry, pos.netDelta),
    move('theta', pos.thetaAtEntry, pos.theta),
    move('gamma', pos.gammaAtEntry, pos.gamma),
    move('vega', pos.vegaAtEntry, pos.netVega),
  ].join('; '));
  add('Volatility', `IV ${percent(pos.ivAtEntry)} at entry, ${percent(pos.iv)} now; IVR ${num(pos.ivrAtEntry, 1)} at entry, ${num(pos.ivr, 1)} now`);

  // Probability and net edge
  add('Probability of profit', `at break-even ${percent(pos.pop)}; past strike ${percent(pos.popVsStrike)}`);
  const live = netEdgeLive(pos);
  const peak = netEdgePeak(pos);
  add('Net edge (theta less gamma drag)', live == null ? NA : `${dollars(live, 0)}/day now${peak != null ? `, peak ${dollars(peak, 0)}/day` : ''}`);

  // Events, orders
  const earn = nextEarningsLine(pos.nextEarningsDate ?? pos.earningsDate, pos.nextEarningsEstimated, pos.expDate, undefined, pos.nextEarningsUnderlying);
  add('Next earnings', earn ? `${earn.text}${earn.beforeExpiry ? ' (before expiration)' : ' (after expiration)'}` : NA);
  add('Profit-target GTC', pos.hasGtc ? `working${finite(pos.gtcOrderPrice) ? ` at ${dollars(pos.gtcOrderPrice)}` : ''}` : 'none');
  add('Stop', `${pos.stopLossClassification ?? NA}${finite(pos.stopLossPrice) ? ` at ${dollars(pos.stopLossPrice)}` : ''}`);

  return { lines, figures: figures.filter(finite) };
}
