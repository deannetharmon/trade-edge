import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { ANALYSIS_OUTPUT_SCHEMA, buildSnapshot, claimAnalysis, deleteAnalysisRecord, getAnalysisRecord, listAnalysisRecords, markCurrent, redisForAnalysis, requestFingerprint, saveAnalysisRecord, validateAnalysisOutput, type AnalysisRecord, type LeapsIntent } from '@/lib/leaps-analysis/analysisService';
import { resolveLeapsContractEvidence } from '@/lib/leaps-analysis/serverTradeReview';

const intents = new Set<LeapsIntent>(['standalone', 'stock_replacement', 'future_pmcc', 'not_specified']);
const system = `Analyze only the immutable LEAPS snapshot supplied by the server. Separate observed evidence from bounded inference. Discuss contract mechanics and the balance among intrinsic/extrinsic value, capital, delta, DTE, liquidity/spread, IV, and breakeven. Lower extrinsic and higher intrinsic can support stock-replacement or future-PMCC mechanics, but do not treat either as sufficient. Never select a contract, direct a transaction, rank it against unseen candidates, predict returns or prices, size a position, approve qualification, or use authority language. Use only one posture from the schema.`;

async function user() { const session = await getServerSession(authOptions); return (session?.user as { id?: string } | undefined)?.id ?? null; }
function enabled() { return process.env.LEAPS_ANALYSIS_ENABLED === 'true'; }
function allowedModel() {
  const model = process.env.LEAPS_ANALYSIS_MODEL?.trim();
  const allowlist = (process.env.LEAPS_ANALYSIS_ALLOWED_MODELS ?? 'gpt-4o-mini,gpt-4o,gpt-5-mini,gpt-5').split(',').map(x => x.trim()).filter(Boolean);
  return model && allowlist.includes(model) ? model : null;
}
function errorMessage(error: unknown) { return error instanceof Error ? error.message : 'Unable to analyze LEAPS contract'; }

async function callModel(key: string, model: string, snapshot: unknown, repair: boolean) {
  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST', headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' }, cache: 'no-store',
    body: JSON.stringify({ model, max_tokens: 900, temperature: 0, response_format: { type: 'json_schema', json_schema: { name: 'leaps_mechanics_review', strict: true, schema: ANALYSIS_OUTPUT_SCHEMA } }, messages: [{ role: 'system', content: repair ? `${system}\nThe prior response failed validation. Return a corrected schema-compliant response only.` : system }, { role: 'user', content: JSON.stringify(snapshot) }] }),
  });
  const data = await response.json().catch(() => ({})); let parsed: unknown;
  try { parsed = JSON.parse(data?.choices?.[0]?.message?.content ?? ''); } catch { parsed = null; }
  return { ok: response.ok, data, checked: validateAnalysisOutput(parsed) };
}

export async function POST(request: NextRequest) {
  const userId = await user(); if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!enabled()) return NextResponse.json({ status: 'ANALYSIS_UNAVAILABLE', error: 'LEAPS analysis is not enabled.' }, { status: 503 });
  let redis;
  try {
    const body = await request.json(); const intent: LeapsIntent = intents.has(body?.intent) ? body.intent : 'not_specified'; const quantity = Number(body?.quantity); const objective = typeof body?.objective === 'string' ? body.objective.trim() : '';
    const underlyingSymbol = String(body?.underlyingSymbol ?? '').trim().toUpperCase(); const occSymbol = String(body?.occSymbol ?? '').trim();
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > 100 || objective.length > 240 || !underlyingSymbol || !occSymbol) throw new Error('A valid contract, quantity, and objective are required.');
    const idempotencyKey = typeof body?.idempotencyKey === 'string' ? body.idempotencyKey.trim() : '';
    if (!/^[A-Za-z0-9_-]{16,100}$/.test(idempotencyKey)) throw new Error('A valid idempotency key is required.');
    const fingerprint = requestFingerprint({ userId, idempotencyKey }); redis = redisForAnalysis();
    const proposedId = crypto.randomUUID(); const claim = await claimAnalysis(redis, userId, fingerprint, proposedId);
    if (claim.cachedId) { const cached = await getAnalysisRecord(redis, userId, claim.cachedId); if (cached) return NextResponse.json(await markCurrent(redis, userId, cached)); }

    const review = await resolveLeapsContractEvidence(userId, { underlyingSymbol, occSymbol });
    const snapshot = buildSnapshot(review, intent, quantity, objective); snapshot.id = proposedId;
    const base = { id: snapshot.id, requestHash: fingerprint, snapshot, model: null, attempts: 0, createdAt: snapshot.createdAt, expiresAt: snapshot.expiresAt, current: true, usage: null };
    if (snapshot.qualification.status !== 'CONTRACT_QUALIFIED' || snapshot.unavailable.length) {
      const record: AnalysisRecord = { ...base, status: 'MORE_INFORMATION_NEEDED', output: null };
      await saveAnalysisRecord(redis, userId, record, fingerprint); return NextResponse.json(record);
    }

    const key = process.env.OPENAI_API_KEY; const model = allowedModel();
    if (!key || !model) { const record: AnalysisRecord = { ...base, status: 'ANALYSIS_UNAVAILABLE', output: null }; await saveAnalysisRecord(redis, userId, record, fingerprint); return NextResponse.json({ ...record, error: 'LEAPS analysis model is not configured or allowlisted.' }, { status: 503 }); }
    let result = await callModel(key, model, snapshot, false); let attempts = 1;
    if (!result.ok || !result.checked.valid) { result = await callModel(key, model, snapshot, true); attempts = 2; }
    if (!result.ok || !result.checked.valid || !result.checked.output) {
      const record: AnalysisRecord = { ...base, status: 'ANALYSIS_UNAVAILABLE', output: null, model, attempts };
      await saveAnalysisRecord(redis, userId, record, fingerprint); return NextResponse.json({ ...record, error: 'Analysis output did not meet the safety schema.' }, { status: 502 });
    }
    const usage = result.data?.usage ? { promptTokens: Number(result.data.usage.prompt_tokens) || null, completionTokens: Number(result.data.usage.completion_tokens) || null } : null;
    const record: AnalysisRecord = { ...base, status: result.checked.output.posture === 'WAIT_MONITOR' ? 'REVIEW_RISK_FACTORS' : 'MECHANICS_REVIEWED', output: result.checked.output, model: String(result.data?.model ?? model), attempts, usage };
    await saveAnalysisRecord(redis, userId, record, fingerprint); return NextResponse.json(record);
  } catch (error) {
    const message = errorMessage(error); const status = message.startsWith('Analysis limit reached') ? 429 : 400;
    return NextResponse.json({ status: 'ANALYSIS_UNAVAILABLE', error: message }, { status });
  } finally { redis?.disconnect(); }
}

export async function GET(request: NextRequest) {
  const userId = await user(); if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const redis = redisForAnalysis();
  try {
    const id = request.nextUrl.searchParams.get('id');
    if (id) { const record = await getAnalysisRecord(redis, userId, id); return record ? NextResponse.json(await markCurrent(redis, userId, record)) : NextResponse.json({ error: 'Analysis not found' }, { status: 404 }); }
    const records = await listAnalysisRecords(redis, userId, Number(request.nextUrl.searchParams.get('limit') ?? 25));
    const current = await Promise.all(records.map(record => markCurrent(redis, userId, record)));
    if (request.nextUrl.searchParams.get('export') === 'true') return new NextResponse(JSON.stringify({ exportedAt: new Date().toISOString(), records: current }, null, 2), { headers: { 'Content-Type': 'application/json', 'Content-Disposition': 'attachment; filename="leaps-analysis-export.json"' } });
    return NextResponse.json({ records: current });
  } finally { redis.disconnect(); }
}

export async function DELETE(request: NextRequest) {
  const userId = await user(); if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const id = request.nextUrl.searchParams.get('id'); if (!id) return NextResponse.json({ error: 'Analysis id is required' }, { status: 400 });
  const redis = redisForAnalysis(); try { return await deleteAnalysisRecord(redis, userId, id) ? NextResponse.json({ deleted: true }) : NextResponse.json({ error: 'Analysis not found' }, { status: 404 }); } finally { redis.disconnect(); }
}
