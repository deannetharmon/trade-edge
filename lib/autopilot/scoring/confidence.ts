// lib/autopilot/scoring/confidence.ts

import type { DecisionConfidenceBreakdown, DecisionConfidenceInput } from '../types';

function clamp(value: number, min = 0, max = 100): number {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, value));
}

function hoursBetween(a: Date, b: Date): number {
  return Math.abs(a.getTime() - b.getTime()) / 36e5;
}

function scoreLiquidity(input: DecisionConfidenceInput, notes: string[]): number {
  if (!input.legs.length) {
    notes.push('Liquidity: no legs supplied; score 0/40.');
    return 0;
  }

  const worstRatio = Math.max(...input.legs.map((leg) => {
    const avg = leg.averageBidAskSpread20 > 0 ? leg.averageBidAskSpread20 : leg.bidAskSpread;
    return avg > 0 ? leg.bidAskSpread / avg : 99;
  }));

  if (worstRatio <= 1.1) return 40;
  if (worstRatio <= 1.25) return 32;
  if (worstRatio <= 1.5) return 24;
  if (worstRatio <= 2.0) return 12;

  notes.push(`Liquidity: bid/ask spread ratio ${worstRatio.toFixed(2)}x exceeds stress threshold.`);
  return 0;
}

function scoreLatency(input: DecisionConfidenceInput, now: Date, notes: string[]): number {
  const quoteTimes = input.legs
    .map((leg) => leg.quoteTimestamp ? new Date(leg.quoteTimestamp) : null)
    .filter((d): d is Date => Boolean(d) && Number.isFinite(d.getTime()));

  if (!quoteTimes.length) {
    notes.push('Latency: missing quote timestamps; score 0/20.');
    return 0;
  }

  const stalestSeconds = Math.max(...quoteTimes.map((d) => Math.abs(now.getTime() - d.getTime()) / 1000));
  if (stalestSeconds <= 15) return 20;
  if (stalestSeconds <= 60) return 16;
  if (stalestSeconds <= 180) return 10;
  if (stalestSeconds <= 300) return 5;

  notes.push(`Latency: stalest quote ${Math.round(stalestSeconds)}s old.`);
  return 0;
}

function scoreMacro(input: DecisionConfidenceInput, now: Date, notes: string[]): number {
  if (!input.nextMacroEventAt) return 20;

  const eventTime = new Date(input.nextMacroEventAt);
  if (!Number.isFinite(eventTime.getTime())) return 20;

  const hardGate = input.hardMacroGateHours ?? 24;
  const hours = hoursBetween(now, eventTime);
  if (hours <= hardGate) {
    notes.push(`Macro: event inside hard gate (${hours.toFixed(1)}h away).`);
    return 0;
  }
  if (hours <= hardGate + 12) return 8;
  if (hours <= hardGate + 24) return 14;
  return 20;
}

function scoreVolatility(input: DecisionConfidenceInput, notes: string[]): number {
  const now = input.vixNow ?? input.underlyingIvNow;
  const then = input.vixThirtyMinutesAgo ?? input.underlyingIvThirtyMinutesAgo;
  if (!Number.isFinite(now ?? NaN) || !Number.isFinite(then ?? NaN) || !then) return 12;

  const pctChange = Math.abs(((now as number) - (then as number)) / (then as number)) * 100;
  if (pctChange <= 2) return 20;
  if (pctChange <= 5) return 15;
  if (pctChange <= 10) return 8;

  notes.push(`Volatility: 30-minute volatility change ${pctChange.toFixed(1)}%.`);
  return 0;
}

export function calculateDecisionConfidence(input: DecisionConfidenceInput): DecisionConfidenceBreakdown {
  const notes: string[] = [];
  const now = input.now ?? new Date();

  const liquidityScore = scoreLiquidity(input, notes);
  const latencyScore = scoreLatency(input, now, notes);
  const macroProximityScore = scoreMacro(input, now, notes);
  const volatilityStabilityScore = scoreVolatility(input, notes);

  const total = clamp(
    liquidityScore + latencyScore + macroProximityScore + volatilityStabilityScore,
    0,
    100,
  );

  if (!notes.length) notes.push('Decision conditions are clean enough for framework evaluation.');

  return {
    total,
    liquidityScore,
    latencyScore,
    macroProximityScore,
    volatilityStabilityScore,
    notes,
  };
}
