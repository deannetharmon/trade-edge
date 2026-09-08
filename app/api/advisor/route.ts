// app/api/advisor/route.ts
//
// ADVISOR-PARITY-0001 -- shared backend for the PMCC and CC Advisor
// panels. One route, parameterized by `strategy` in the request body,
// since the infrastructure (auth, model call, schema validation,
// disclosure enforcement, chat history) is identical between them; only
// the reasoning frame differs. LEAPS Advisor keeps its own separate route
// (app/api/leaps-advisor/route.ts), built first, not migrated here.

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';

type AdvisorStrategy = 'pmcc' | 'cc';

const PMCC_DISCLOSURE = "These are short-call candidates against your own held LEAPS positions, scanned with your configured delta/OI/spread filters -- this is not independent research on the underlying company.";
const CC_DISCLOSURE = "These are covered-call candidates against shares you actually own, scanned with your configured delta/DTE/OI filters -- this is not independent research on the underlying company.";

const PMCC_SYSTEM_PROMPT = `You are reviewing short-call candidates a trader could sell against LEAPS positions they already hold (a PMCC -- poor man's covered call). You do not select a contract or direct a transaction. You reason in this order, every time, regardless of how many turns into the conversation this is:

1. DISCLOSURE (state this first, every response): these are short-call candidates against the trader's own held LEAPS, scanned with their configured filters -- not independent research on the company. Say so plainly.

2. HELD-LEAPS FIT: for each candidate, does the short call's DTE/delta make sense against ITS SPECIFIC held LEAPS' remaining runway? A short call that could realistically get assigned or rolled in a way that outruns the long leg's remaining time is a structural problem, not just a preference -- flag this explicitly if it applies. Do not evaluate credit/liquidity before this.

3. MECHANICS: credit collected, delta (assignment risk), liquidity -- explain what the numbers MEAN. Never restate a number already visible on the candidate's row. If you catch yourself about to write a number the trader can already see, describe the implication instead.

4. SIZING: only if 2+ candidates remain after step 2. Sizing commentary is QUALITATIVE ONLY -- describe concentration or runway risk in words. NEVER state a percentage of portfolio, a dollar amount, or a position size. You do not know the trader's total account size or other holdings.

You are not a financial advisor. Flag genuine uncertainty rather than resolving it for the trader. If asked a follow-up, answer it, but re-run this same frame even if you don't repeat every section verbatim in a short reply.

Respond ONLY as JSON matching this exact shape, no other text: {"disclosure": string, "gatedOut": [{"symbol": string, "reason": string}], "recommendation": [{"symbol": string, "identifier": string, "reasoning": string}] | null, "sizingNote": string | null, "reply": string}`;

const CC_SYSTEM_PROMPT = `You are reviewing covered-call candidates a trader could sell against stock they already own. You do not select a contract or direct a transaction. This is a different question shape than picking "which one is best" -- for covered calls the real question is usually "is giving up upside above this strike worth this premium, on shares I already own." You reason in this order, every time, regardless of how many turns into the conversation this is:

1. DISCLOSURE (state this first, every response): these are covered-call candidates against the trader's own owned shares, scanned with their configured filters -- not independent research on the company. Say so plainly.

2. OPPORTUNITY-COST FIT: for each candidate, does the strike leave the trader acceptable upside room, or would assignment cap them well below where the stock could plausibly go? This is the primary question for a covered call -- evaluate it before mechanics. If the trader's objective suggests they want to keep the shares long-term, flag any strike that risks assignment as a real tradeoff, not just a technical detail.

3. MECHANICS: premium collected, strike distance from cost basis, distance from current price, liquidity -- explain what the numbers MEAN. Never restate a number already visible on the candidate's row. If you catch yourself about to write a number the trader can already see, describe the implication instead.

4. SIZING: only if 2+ candidates remain after step 2. Sizing commentary is QUALITATIVE ONLY -- describe concentration or opportunity-cost risk in words (e.g. "writing calls against most of your position here limits upside across a large share of your holding"). NEVER state a percentage of portfolio, a dollar amount, or a position size. You do not know the trader's total account size or other holdings.

You are not a financial advisor. Flag genuine uncertainty rather than resolving it for the trader. If asked a follow-up, answer it, but re-run this same frame even if you don't repeat every section verbatim in a short reply.

Respond ONLY as JSON matching this exact shape, no other text: {"disclosure": string, "gatedOut": [{"symbol": string, "reason": string}], "recommendation": [{"symbol": string, "identifier": string, "reasoning": string}] | null, "sizingNote": string | null, "reply": string}`;

async function user() {
  const session = await getServerSession(authOptions);
  return (session?.user as { id?: string } | undefined)?.id ?? null;
}

// ADVISOR-PARITY-0001: single source of truth per strategy, read ONLY
// server-side -- same posture as LEAPS Advisor's own enabled() function,
// avoiding the earlier client/server default-polarity bug from tonight's
// separate LEAPS analysis fix.
function enabled(strategy: AdvisorStrategy) {
  return strategy === 'pmcc'
    ? process.env.PMCC_ADVISOR_ENABLED === 'true'
    : process.env.CC_ADVISOR_ENABLED === 'true';
}

function allowedModel() {
  const model = process.env.LEAPS_ANALYSIS_MODEL?.trim();
  const allowlist = (process.env.LEAPS_ANALYSIS_ALLOWED_MODELS ?? 'gpt-4o-mini,gpt-4o,gpt-5-mini,gpt-5').split(',').map(x => x.trim()).filter(Boolean);
  return model && allowlist.includes(model) ? model : null;
}

interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

interface AdvisorOutput {
  disclosure: string;
  gatedOut: Array<{ symbol: string; reason: string }>;
  recommendation: Array<{ symbol: string; identifier: string; reasoning: string }> | null;
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

async function callModel(key: string, model: string, systemPrompt: string, payload: unknown, history: ChatMessage[], repair: boolean) {
  const messages = [
    { role: 'system', content: repair ? `${systemPrompt}\nThe prior response failed validation or was missing the disclosure field. Return a corrected response that strictly matches the required JSON shape and includes the disclosure.` : systemPrompt },
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

  try {
    const body = await request.json();
    const strategy: AdvisorStrategy = body?.strategy === 'cc' ? 'cc' : body?.strategy === 'pmcc' ? 'pmcc' : (() => { throw new Error('A valid strategy (pmcc or cc) is required.'); })();
    if (!enabled(strategy)) return NextResponse.json({ error: `${strategy.toUpperCase()} Advisor is not enabled.` }, { status: 503 });

    const candidates = Array.isArray(body?.candidates) ? body.candidates : [];
    if (!candidates.length) throw new Error('At least one candidate is required.');
    const objective = typeof body?.objective === 'string' ? body.objective.trim().slice(0, 500) : '';
    const scanFilters = body?.scanFilters && typeof body.scanFilters === 'object' ? body.scanFilters : null;
    const history: ChatMessage[] = Array.isArray(body?.messages)
      ? body.messages
          .filter((m: any) => (m?.role === 'user' || m?.role === 'assistant') && typeof m?.content === 'string')
          .map((m: any) => ({ role: m.role, content: String(m.content).slice(0, 2000) }))
          .slice(-20)
      : [];

    const key = process.env.OPENAI_API_KEY;
    const model = allowedModel();
    if (!key || !model) return NextResponse.json({ error: `${strategy.toUpperCase()} Advisor model is not configured or allowlisted.` }, { status: 503 });

    const disclosure = strategy === 'pmcc' ? PMCC_DISCLOSURE : CC_DISCLOSURE;
    const systemPrompt = strategy === 'pmcc' ? PMCC_SYSTEM_PROMPT : CC_SYSTEM_PROMPT;
    const payload = { candidates, objective, scanFilters, disclosureRequired: disclosure };

    let result = await callModel(key, model, systemPrompt, payload, history, false);
    let attempts = 1;
    if (!result.ok || !result.checked.valid || !result.checked.output?.disclosure) {
      result = await callModel(key, model, systemPrompt, payload, history, true);
      attempts = 2;
    }
    if (!result.ok || !result.checked.valid || !result.checked.output) {
      return NextResponse.json({ error: `${strategy.toUpperCase()} Advisor output did not meet the required schema.` }, { status: 502 });
    }

    const output: AdvisorOutput = { ...result.checked.output, disclosure };
    return NextResponse.json({ ...output, model: String(result.data?.model ?? model), attempts });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Unable to generate a recommendation.' }, { status: 400 });
  }
}
