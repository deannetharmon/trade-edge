// lib/tradeLog/coachingNumberCheck.ts

// PERF-AI-0001 S1 (Quinn): every dollar amount and trade count in the AI's answer must appear in the coaching input
// (±$1 for rounding). The input carries every total and difference the AI may quote, so a figure that is not found
// was invented or miscalculated. Percentages are not dollars and are not checked here.

import type { CoachingInput } from './coachingInput';

export interface NumberCheckResult {
  ok: boolean;
  unverified: string[];
}

function collectNumbers(value: unknown, out: number[]): void {
  if (typeof value === 'number' && Number.isFinite(value)) { out.push(Math.abs(value)); return; }
  if (Array.isArray(value)) { value.forEach(v => collectNumbers(v, out)); return; }
  if (value && typeof value === 'object') Object.keys(value).forEach(k => collectNumbers((value as Record<string, unknown>)[k], out));
}

const DOLLARS = /[-−+]?\$\s?\d[\d,]*(?:\.\d+)?\s?[kK]?/g;
const TRADE_COUNTS = /\b(\d[\d,]*)\s+(?:trades?|positions?|spreads?|entries|losses|wins)\b/g;

function parseAmount(token: string): number {
  const k = /[kK]$/.test(token.trim());
  const n = Number(token.replace(/[^\d.]/g, ''));
  return k ? n * 1000 : n;
}

export function checkCoachingNumbers(answer: string, input: CoachingInput): NumberCheckResult {
  // Structured fields only, plus the money on each trade line (credit, pnl); dates, strikes and DTEs on the lines would
  // otherwise make almost any small number "verified".
  const allowed: number[] = [];
  collectNumbers({ ...input, tradeLines: [], period: {} }, allowed);
  input.tradeLines.forEach(line => (line.match(/(?:credit|pnl) (-?\d+(?:\.\d+)?)/g) ?? []).forEach(s => allowed.push(Math.abs(Number(s.split(' ')[1])))));
  const near = (n: number, tol: number) => allowed.some(a => Math.abs(a - n) <= tol);
  const unverified: string[] = [];

  (answer.match(DOLLARS) ?? []).forEach(token => {
    const n = parseAmount(token);
    const tol = /[kK]\s*$/.test(token.trim()) ? 50 : 1; // "$1.6k" rounds to the nearest $100
    if (!near(n, tol)) unverified.push(token.trim());
  });
  let m: RegExpExecArray | null;
  TRADE_COUNTS.lastIndex = 0;
  while ((m = TRADE_COUNTS.exec(answer)) !== null) {
    const n = Number(m[1].replace(/,/g, ''));
    if (!near(n, 0)) unverified.push(m[0]);
  }
  return { ok: unverified.length === 0, unverified: Array.from(new Set(unverified)) };
}
