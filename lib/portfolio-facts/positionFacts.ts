// lib/portfolio-facts/positionFacts.ts
//
// RECO-UNIFY-0001A: PositionFacts, one object per position built once per refresh and read by every consumer (the deterministic verdict,
// the Analyze panel, the Advisor report). Every field is a value or null ("not available"): nothing is estimated or defaulted here.
// No behavior change in this phase: the verdict inputs (`engineInput`) come from the same exported builder the live recommendation uses
// (buildPositionObjectiveInput), so the facts and the verdict cannot drift apart. The parity test proves it.
//
// Pure: no React, no fetch. Daily closes, the trend and portfolio concentration are supplied by the caller (they are fetched elsewhere);
// when absent the fact reads "not available".

import type { Position, PositionIntent } from '@/lib/portfolio-data/types';
import { buildPositionObjectiveInput } from '@/lib/portfolio-data/acquisition';
import type { PositionObjectiveInput } from '@/lib/portfolio-intelligence';
import { classifyRsiTurn, type RsiTurnState } from '@/lib/indicators/rsiTurn';
import { classifyEarningsVsExpiry, type EarningsExpiryResult } from '@/lib/scans/earningsExpiryZone';
import type { TrendDirection } from '@/lib/portfolio/trendClassification';

export type FactGroup = 'identity' | 'economics' | 'time' | 'greeks' | 'volatility' | 'technicals' | 'events' | 'risk' | 'orders';

export interface PositionFactsContext {
  now?: Date;
  /** Daily closes for the underlying, oldest first (completed bars only). */
  dailyCloses?: number[] | null;
  trendDirection?: TrendDirection;
  /** This position's share of the portfolio (0-100) and its tier, from the portfolio-level concentration calculation. */
  concentration?: { sharePct: number; tier: 'none' | 'amber' | 'red' } | null;
  /** The position note and when it was saved. */
  note?: { text: string; savedAt: string | null } | null;
  /** Whether the intent was chosen by the trader (true) or defaulted by the app (false). Unknown when omitted. */
  intentWasSet?: boolean | null;
  priorPricingVerificationUnresolved?: boolean;
}

export interface PositionFacts {
  /** One id per snapshot; every consumer of the same snapshot carries it, so parity can be proven. */
  snapshotId: string;
  asOf: string;
  positionKey: string;
  identity: { symbol: string; strategy: string; legs: Array<{ symbol: string; direction: string; optionType: string | null; strike: number }>; quantity: number; intent: PositionIntent; intentWasSet: boolean | null; note: string | null; noteSavedAt: string | null };
  economics: { entryCredit: number | null; entryPriceEffect: Position['entryPriceEffect']; pnl: number | null; pnlPct: number | null; closeNowPnl: number | null; pctOfCreditCaptured: number | null; profitTargetFraction: number | null; targetProfitDollars: number | null; currentValue: number | null; closeValue: number | null; quoteCapturedAt: string | null };
  time: { dte: number; expDate: string; entryDte: number | null; entryDate: string | null };
  /** Position-level values exactly as the app holds them today; per-share raw values plus multiplier are not on Position (open item for 0001B). */
  greeks: { netDelta: number | null; theta: number | null; gamma: number | null; netVega: number | null };
  volatility: { ivr: number | null; iv: number | null; hv30: number | null };
  technicals: { rsi: number | null; rsiPrevious: number | null; rsiTurn: RsiTurnState | null; trend: TrendDirection | null };
  events: { earningsBeforeExpiry: string | null; nextEarnings: string | null; earningsZone: EarningsExpiryResult['zone'] | null };
  risk: { stockPrice: number | null; bufferPct: number | null; popBreakeven: number | null; popVsStrike: number | null; concentrationSharePct: number | null; concentrationTier: 'none' | 'amber' | 'red' | null };
  orders: { hasGtc: boolean; gtcPrice: number | null; stopStatus: Position['stopLossStatus']; stopPrice: number | null };
  /** Per group: true when every field the group lists is present. A false group names what the verdict is missing. */
  complete: Record<FactGroup, boolean>;
  /** The exact input the live deterministic engine receives for this position. */
  engineInput: PositionObjectiveInput;
}

const fin = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const allPresent = (...values: unknown[]) => values.every(v => v !== null && v !== undefined);

export function buildPositionFacts(pos: Position, ctx: PositionFactsContext = {}, snapshotId?: string): PositionFacts {
  const now = ctx.now ?? new Date();
  const { input } = buildPositionObjectiveInput(pos, now, ctx.priorPricingVerificationUnresolved ?? false, ctx.trendDirection);

  const rsi = ctx.dailyCloses ? classifyRsiTurn(ctx.dailyCloses) : null;
  const rsiPrevious = rsi && rsi.series.length >= 2 ? rsi.series[rsi.series.length - 2] : null;
  const zone = classifyEarningsVsExpiry(pos.nextEarningsDate ?? pos.earningsDate ?? null, pos.expDate, now);

  const entryCredit = pos.entryEconomicsComplete === false ? null : fin(pos.entryCredit);
  const targetOk = pos.entryPriceEffect === 'Credit' && pos.entryEconomicsComplete === true && fin(pos.targetPrice) !== null && pos.targetPrice > 0;
  const pnl = fin(pos.closeNowPnl) ?? fin(pos.pnl);

  const facts: Omit<PositionFacts, 'complete'> = {
    snapshotId: snapshotId ?? `${now.toISOString()}`,
    asOf: now.toISOString(),
    positionKey: pos.key,
    identity: {
      symbol: pos.symbol, strategy: pos.strategy,
      legs: pos.legs.map(l => ({ symbol: l.symbol, direction: l.direction, optionType: l.optionType ?? null, strike: l.strikePrice })),
      quantity: pos.quantity, intent: pos.intent, intentWasSet: ctx.intentWasSet ?? null,
      note: ctx.note?.text?.trim() ? ctx.note.text.trim() : null, noteSavedAt: ctx.note?.savedAt ?? null,
    },
    economics: {
      entryCredit, entryPriceEffect: pos.entryPriceEffect, pnl, pnlPct: fin(pos.pnlPct), closeNowPnl: fin(pos.closeNowPnl),
      pctOfCreditCaptured: entryCredit != null && entryCredit > 0 && pnl != null ? (pnl / entryCredit) * 100 : null,
      profitTargetFraction: targetOk ? fin(pos.profitTarget) : null, targetProfitDollars: targetOk ? pos.targetPrice : null,
      currentValue: fin(pos.currentValue), closeValue: fin(pos.closeValue), quoteCapturedAt: pos.quoteCapturedAt ?? null,
    },
    time: { dte: pos.dte, expDate: pos.expDate, entryDte: fin(pos.entryDte), entryDate: pos.entryDate ?? null },
    greeks: { netDelta: fin(pos.netDelta), theta: fin(pos.theta), gamma: fin(pos.gamma), netVega: fin(pos.netVega) },
    volatility: { ivr: fin(pos.ivr), iv: fin(pos.iv), hv30: fin(pos.hv30) },
    technicals: { rsi: rsi ? rsi.latest : null, rsiPrevious, rsiTurn: rsi ? rsi.state : null, trend: ctx.trendDirection ?? null },
    events: { earningsBeforeExpiry: pos.earningsDate ?? null, nextEarnings: pos.nextEarningsDate ?? null, earningsZone: zone.zone },
    risk: {
      stockPrice: fin(pos.stockPrice), bufferPct: fin(pos.buffer), popBreakeven: fin(pos.pop), popVsStrike: fin(pos.popVsStrike),
      concentrationSharePct: ctx.concentration ? fin(ctx.concentration.sharePct) : null, concentrationTier: ctx.concentration?.tier ?? null,
    },
    orders: { hasGtc: pos.hasGtc, gtcPrice: fin(pos.gtcOrderPrice), stopStatus: pos.stopLossStatus, stopPrice: fin(pos.stopLossPrice) },
    engineInput: input,
  };

  const f = facts;
  const complete: Record<FactGroup, boolean> = {
    identity: f.identity.legs.length > 0 && f.identity.intentWasSet !== null,
    economics: allPresent(f.economics.entryCredit, f.economics.pnl, f.economics.currentValue, f.economics.closeValue),
    time: allPresent(f.time.entryDte),
    greeks: allPresent(f.greeks.netDelta, f.greeks.theta, f.greeks.gamma, f.greeks.netVega),
    volatility: allPresent(f.volatility.ivr, f.volatility.iv, f.volatility.hv30),
    technicals: allPresent(f.technicals.rsi, f.technicals.rsiPrevious, f.technicals.rsiTurn, f.technicals.trend),
    events: f.events.earningsZone !== 'no-date',
    risk: allPresent(f.risk.stockPrice, f.risk.bufferPct, f.risk.popBreakeven, f.risk.concentrationSharePct),
    orders: true,
  };
  return { ...facts, complete };
}
