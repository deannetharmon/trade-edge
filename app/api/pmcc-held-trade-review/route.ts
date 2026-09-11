import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { fetchHeldPmccPositionSnapshot, submitHeldPmccShortCallOrder } from '@/lib/leaps-analysis/serverTradeReview';

// PMCC-COMPARE-HELD-0001 — a dedicated route for the held-LEAPS single-leg
// sell-to-open order, deliberately NOT a new mode bolted onto
// /api/pmcc-trade-review. That route's Debit, two-leg order-building
// logic is a different risk profile from this Credit, single-leg order;
// mixing them in one handler risks exactly the class of bug
// buildNewPmccEntryOrderLegs's held-leaps guard-throw already exists to
// prevent on the client side. GET returns a display-only position
// snapshot for the order-review modal; POST dry-runs/submits the order,
// re-verifying the held position itself, not just trusting GET's result.

function finiteInRange(value: unknown, min: number, max: number): number | null {
  const n = Number(value);
  return Number.isFinite(n) && n >= min && n <= max ? n : null;
}

function resolveShortCriteriaOverride(body: any) {
  const shortDeltaMin = finiteInRange(body?.shortDeltaMin, 0, 1);
  const shortDeltaMax = finiteInRange(body?.shortDeltaMax, 0, 1);
  const shortOiMin = finiteInRange(body?.shortOiMin, 0, 1_000_000);
  const maxSpreadPct = finiteInRange(body?.maxSpreadPct, 0, 100);
  const override: { shortDelta?: { min: number; max: number }; shortOiMin?: number; qualifyingSpreadPctMax?: number } = {};
  if (shortDeltaMin != null && shortDeltaMax != null && shortDeltaMax >= shortDeltaMin) {
    override.shortDelta = { min: shortDeltaMin, max: shortDeltaMax };
  }
  if (shortOiMin != null) override.shortOiMin = shortOiMin;
  if (maxSpreadPct != null) override.qualifyingSpreadPctMax = maxSpreadPct;
  return override;
}

export async function GET(request: NextRequest) {
  const session = await getServerSession(authOptions);
  const userId = (session?.user as { id?: string } | undefined)?.id;
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  try {
    const { searchParams } = new URL(request.url);
    const underlyingSymbol = String(searchParams.get('underlyingSymbol') ?? '').trim().toUpperCase();
    const longOccSymbol = String(searchParams.get('longOccSymbol') ?? '');
    const accountLocator = searchParams.get('accountLocator');
    if (!underlyingSymbol || !longOccSymbol) return NextResponse.json({ error: 'underlyingSymbol and longOccSymbol are required' }, { status: 400 });
    const { snapshot } = await fetchHeldPmccPositionSnapshot(userId, { accountLocator, underlyingSymbol, longOccSymbol });
    return NextResponse.json({ snapshot });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Unable to verify the held position' }, { status: 400 });
  }
}

export async function POST(request: NextRequest) {
  const session = await getServerSession(authOptions);
  const userId = (session?.user as { id?: string } | undefined)?.id;
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  try {
    const body = await request.json();
    const result = await submitHeldPmccShortCallOrder(userId, {
      accountLocator: typeof body?.accountLocator === 'string' ? body.accountLocator : null,
      underlyingSymbol: String(body?.underlyingSymbol ?? '').trim().toUpperCase(),
      longOccSymbol: String(body?.longOccSymbol ?? ''),
      shortOccSymbol: String(body?.shortOccSymbol ?? ''),
      quantity: Number(body?.quantity),
      limitPrice: Number(body?.limitPrice),
      mode: body?.mode === 'submit' ? 'submit' : 'dry-run',
    }, resolveShortCriteriaOverride(body));
    return NextResponse.json(result, { status: result.decision.action === 'HELD_PMCC_REVIEW_ONLY' ? 200 : 409 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Unable to review the held PMCC order' }, { status: 400 });
  }
}
