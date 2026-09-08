// app/api/leaps-advisor/route.ts
//
// LEAPS-ADVISOR-0001B -- cross-ticker LEAPS recommendation + chat.
// Mirrors app/api/leaps-analysis/route.ts's auth/enabled/model-allowlist
// pattern, but takes the full filtered candidate array + a persistent
// chat history instead of one contract. No fundamentals join (Paul: the
// trader's own Finviz pre-screen is the business-quality gate, per the
// revised scope after FUNDAMENTALS-0002 was confirmed reverted).
//
// Every response is required to carry the disclosure line -- the server
// regenerates it itself rather than trusting the model's memory of it,
// same defensive posture as leaps-analysis/route.ts's schema-repair
// retry, applied here to constraint drift instead of format drift.

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';

const DISCLOSURE = "These candidates come from your own Finviz pre-screen (market cap, price, volume, P/E) -- this reflects that pre-screen, not independent fundamentals verification.";

const SYSTEM_PROMPT = `You are reviewing a set of LEAPS (long-dated call option) candidates the trader has already screened and filtered on TradeEdge. You do not select a contract, direct a transaction, or give a portfolio-level allocation recommendation. You reason in this order, every time, regardless of how many turns into the conversation this is:

1. DISCLOSURE (state this first, every response, even mid-conversation): these candidates come from the trader's own Finviz pre-screen (market cap, price, volume, P/E) -- you have not independently verified any company's fundamentals. Say so plainly.

2. HORIZON FIT: the payload includes scanFilters.dteMin/dteMax -- the ACTUAL DTE window the trader configured. Always refer to this exact window by name when discussing DTE (e.g. "within your 180-730 day window"). Never assert or imply a different window than what scanFilters states, and never claim candidates fall outside a range you were not told. If every candidate's individual dte clusters at one end of that window, say so as a fact about which candidates survived the trader's OTHER filters (delta, extrinsic, OI, tickers) -- not as a contradiction of the window itself.

3. MECHANICS: delta, extrinsic %, liquidity -- explain what the numbers MEAN for the trader's stated objective. Never restate a number that is already visible on the candidate's row (cost, breakeven, extrinsic $, delta, DTE, OI). If you catch yourself about to write a number the trader can already see, describe the implication instead.

4. SIZING: only if 2+ candidates remain after step 2. Sizing commentary is QUALITATIVE ONLY -- describe concentration risk in words ("putting most of your capital in one name here means..."). NEVER state a percentage of portfolio, a dollar amount, or a position size. You do not know the trader's total account size or other holdings.

You are not a financial advisor. Flag genuine uncertainty rather than resolving it for the trader. If asked a follow-up question, answer it, but re-run this same four-step frame in your reasoning even if you don't repeat all four sections verbatim in a short reply.

Respond ONLY as JSON matching this exact shape, no other text: {"disclosure": string, "gatedOut": [{"symbol": string, "reason": string}], "recommendation": [{"symbol": string, "occSymbol": string, "reasoning": string}] | null, "sizingNote": string | null, "reply": string}`;

async function user() {
  const session = await getServerSession(authOptions);
  return (session?.user as { id?: string } | undefined)?.id ?? null;
}

// LEAPS-ADVISOR-0001B: single source of truth for the enabled flag, read
// ONLY here on the server. The client never independently re-derives its
// own guess at this value -- that mismatch (client defaulting to enabled,
// server defaulting to disabled) was a real bug found earlier tonight in
// the separate LEAPS analysis flow, and this route deliberately avoids
// repeating it: the client always shows the button, and a 503 here is
// surfaced as its own explicit "not enabled" state in the panel.
function enabled() {
  return process.env.LEAPS_ADVISOR_ENABLED === 'true';
}

function allowedModel() {
  const model = process.env.LEAPS_ANALYSIS_MODEL?.trim();
  const allowlist = (process.env.LEAPS_ANALYSIS_ALLOWED_MODELS ?? 'gpt-4o-mini,gpt-4o,gpt-5-mini,gpt-5').split(',').map(x => x.trim()).filter(Boolean);
  return model && allowlist.includes(model) ? model : null;
}

interface CandidateSummary {
  symbol: string;
  occSymbol: string | null;
  strike: number;
  expiration: string;
  dte: number;
  delta: number | null;
  underlyingPrice: number | null;
  extrinsicValue: number | null;
  totalCost: number | null;
  breakeven: number | null;
  score: number | null;
}

interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

interface AdvisorOutput {
  disclosure: string;
  gatedOut: Array<{ symbol: string; reason: string }>;
  recommendation: Array<{ symbol: string; occSymbol: string; reasoning: string }> | null;
  sizingNote: string | null;
  reply: string;
}

function validateOutput(value: unknown): { valid: boolean; output?: AdvisorOutput } {
  if (typeof value !== 'object' || value == null) return { valid: false };
  const v = value as Record<string, unknown>;
  if (typeof v.disclosure !== 'string') return { valid: false };
  if (!Array.isArray(v.gatedOut)) return { valid: false };
  if (v.recommendation !== null && !Array.isArray(v.recommendation)) return { valid: false };
  if (v.sizingNote !== null && typeof v.sizingNote !== 'string') return { valid: false };
  if (typeof v.reply !== 'string') return { valid: false };
  return { valid: true, output: v as unknown as AdvisorOutput };
}

async function callModel(key: string, model: string, payload: unknown, history: ChatMessage[], repair: boolean) {
  const messages = [
    { role: 'system', content: repair ? `${SYSTEM_PROMPT}\nThe prior response failed validation or was missing the disclosure field. Return a corrected response that strictly matches the required JSON shape and includes the disclosure.` : SYSTEM_PROMPT },
    { role: 'user', content: JSON.stringify(payload) },
    ...history,
  ];
  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    cache: 'no-store',
    body: JSON.stringify({ model, max_tokens: 1200, temperature: 0.2, response_format: { type: 'json_object' }, messages }),
  });
  const data = await response.json().catch(() => ({}));
  let parsed: unknown;
  try { parsed = JSON.parse(data?.choices?.[0]?.message?.content ?? ''); } catch { parsed = null; }
  return { ok: response.ok, data, checked: validateOutput(parsed) };
}

export async function POST(request: NextRequest) {
  const userId = await user();
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!enabled()) return NextResponse.json({ error: 'LEAPS Advisor is not enabled.' }, { status: 503 });

  try {
    const body = await request.json();
    const candidates: CandidateSummary[] = Array.isArray(body?.candidates) ? body.candidates : [];
    if (!candidates.length) throw new Error('At least one candidate is required.');
    const scanFilters = body?.scanFilters && typeof body.scanFilters === 'object' ? body.scanFilters : null;
    const objective = typeof body?.objective === 'string' ? body.objective.trim().slice(0, 500) : '';
    const history: ChatMessage[] = Array.isArray(body?.messages)
      ? body.messages
          .filter((m: any) => (m?.role === 'user' || m?.role === 'assistant') && typeof m?.content === 'string')
          .map((m: any) => ({ role: m.role, content: String(m.content).slice(0, 2000) }))
          .slice(-20)
      : [];

    const key = process.env.OPENAI_API_KEY;
    const model = allowedModel();
    if (!key || !model) return NextResponse.json({ error: 'LEAPS Advisor model is not configured or allowlisted.' }, { status: 503 });

    const payload = { candidates, objective, scanFilters, disclosureRequired: DISCLOSURE };
    let result = await callModel(key, model, payload, history, false);
    let attempts = 1;
    if (!result.ok || !result.checked.valid || !result.checked.output?.disclosure) {
      result = await callModel(key, model, payload, history, true);
      attempts = 2;
    }
    if (!result.ok || !result.checked.valid || !result.checked.output) {
      return NextResponse.json({ error: 'LEAPS Advisor output did not meet the required schema.' }, { status: 502 });
    }

    // Server-owned disclosure, always -- never trust the model's own
    // rendering of it, even after a successful validation pass.
    const output: AdvisorOutput = { ...result.checked.output, disclosure: DISCLOSURE };
    return NextResponse.json({ ...output, model: String(result.data?.model ?? model), attempts });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Unable to generate a LEAPS recommendation.' }, { status: 400 });
  }
}
