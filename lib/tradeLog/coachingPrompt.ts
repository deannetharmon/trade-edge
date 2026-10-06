// lib/tradeLog/coachingPrompt.ts

// PERF-AI-0001 S2: the coaching prompt and the answer contract. The app renders every number on the cards from the
// CoachingInput; the AI writes the words (summary, one note per habit, strategy and ticker notes, three changes chosen
// from habit keys). The app supplies each change's dollars from the input, never from the AI.

import { COACHING_PROMPT_VERSION, type CoachingInput } from './coachingInput';

export const HABIT_KEYS = ['beyondStop', 'openedInside21Dte', 'spreadsHeldPast21Dte', 'target', 'creditToWidth', 'positionSize', 'reentryAfterLoss', 'lossConcentration', 'firstThirtyMinutes', 'assigned'] as const;
export type HabitKey = typeof HABIT_KEYS[number];

export interface CoachingChange { title: string; habit: HabitKey; detail: string }
export interface CoachingAnswer {
  summary: string;
  habits: Partial<Record<HabitKey, string>>;
  strategies: Record<string, string>;
  tickers: string;
  changes: CoachingChange[];
}

export const COACHING_SYSTEM_PROMPT = `You coach one options trader on their own closed trades for one period. Version ${COACHING_PROMPT_VERSION}.
The trader sells premium: BPS, BCS, IC, CSP, CC. Their rules: close at 50% of credit; stop at 2x credit (loss capped at 1x credit); manage spreads at 21 DTE (CSP and CC exempt, assignment is acceptable); credit at least 1/3 of spread width; no position over 25% of net liq unless they marked it deliberate.

Precision rules (mandatory):
- Use only numbers that appear in the DATA JSON. Never calculate, add, subtract or estimate a number yourself. Every total, difference and what-if you may need is already in DATA.
- Every claim names its trade count and dollars from DATA.
- Respect each item's "tier": RULE_BREAK = a fact; FINDING = a pattern you may state plainly; EARLY_SIGNAL = say it is early and worth watching; NOT_ENOUGH_DATA = do not present it as a pattern; INFORMATION = describe, no verdict.
- Report what the data shows even when it goes against a rule, but never advise breaking a rule because of an EARLY_SIGNAL. Credit-to-width: if trades at or above 1/3 did worse, say so and suggest what to check; never advise skipping trades below 1/3 without a FINDING.
- No market predictions, no generic disclaimers, no advice on open positions.
- Be direct and specific, like a mentor who respects the trader. Short sentences.`;

const ANSWER_SHAPE = `Answer with ONE JSON object and nothing else:
{
  "summary": "two sentences: the period's result and the single biggest driver",
  "habits": { "<habit key>": "one or two sentences" },   // only habits with something to say; keys: ${HABIT_KEYS.join(', ')}
  "strategies": { "<strategy>": "one sentence" },        // strategies present in DATA.strategies
  "tickers": "one or two sentences on best and worst tickers",
  "changes": [ { "title": "imperative, under 12 words", "habit": "<habit key>", "detail": "one sentence" } ]  // exactly 3, most valuable first
}`;

export function buildCoachingUserMessage(input: CoachingInput): string {
  return `${ANSWER_SHAPE}\n\nDATA:\n${JSON.stringify(input)}`;
}

/** Follow-up chat turns: same DATA, plain-text answers under the same precision rules. */
export function buildFollowUpSystemPrompt(input: CoachingInput): string {
  return `${COACHING_SYSTEM_PROMPT}\n\nAnswer follow-up questions in plain text, at most 150 words, using only DATA.\n\nDATA:\n${JSON.stringify(input)}`;
}

/** Lenient parse: the first JSON object in the reply, validated to the contract. Null when unusable. */
export function parseCoachingAnswer(reply: string): CoachingAnswer | null {
  const start = reply.indexOf('{');
  const end = reply.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  let raw: unknown;
  try { raw = JSON.parse(reply.slice(start, end + 1)); } catch { return null; }
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  if (typeof o.summary !== 'string' || !o.summary.trim()) return null;
  const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '');
  const habits: Partial<Record<HabitKey, string>> = {};
  const h = (o.habits && typeof o.habits === 'object' ? o.habits : {}) as Record<string, unknown>;
  HABIT_KEYS.forEach(k => { const v = str(h[k]); if (v) habits[k] = v; });
  const strategies: Record<string, string> = {};
  const s = (o.strategies && typeof o.strategies === 'object' ? o.strategies : {}) as Record<string, unknown>;
  Object.keys(s).forEach(k => { const v = str(s[k]); if (v) strategies[k] = v; });
  const changes = (Array.isArray(o.changes) ? o.changes : [])
    .map(c => (c && typeof c === 'object' ? c as Record<string, unknown> : {}))
    .filter(c => (HABIT_KEYS as readonly string[]).indexOf(str(c.habit)) >= 0 && str(c.title))
    .slice(0, 3)
    .map(c => ({ title: str(c.title), habit: str(c.habit) as HabitKey, detail: str(c.detail) }));
  return { summary: o.summary.trim(), habits, strategies, tickers: str(o.tickers), changes };
}

/** All AI-written text, for the number check. */
export function answerText(a: CoachingAnswer): string {
  return [a.summary, ...Object.values(a.habits), ...Object.values(a.strategies), a.tickers, ...a.changes.map(c => `${c.title}. ${c.detail}`)].join('\n');
}

/** The app's own dollar figure for a change, from the input (Alan: computed, never the AI's). */
export function changeImpact(input: CoachingInput, habit: HabitKey): { text: string; dollars: number | null } {
  const h = input.habits;
  switch (habit) {
    case 'beyondStop': return { text: 'saved by closing at the stop', dollars: h.beyondStop.savedClosingAtStop };
    case 'openedInside21Dte': return { text: 'added by skipping these entries', dollars: h.openedInside21Dte.savedBySkipping };
    case 'reentryAfterLoss': return { text: 'added by skipping these re-entries', dollars: h.reentryAfterLoss.savedBySkipping };
    case 'positionSize': return { text: 'risk, not P/L', dollars: null };
    default: return { text: '', dollars: null };
  }
}
