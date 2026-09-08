import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { submitPmccOrder } from '@/lib/leaps-analysis/serverTradeReview';

// PMCC-ORDER-GATE-LIVE-FILTERS-0001: same fix as the LEAPS trade-review
// route -- the qualification gate blocking an order should reflect what
// the trader actually configured in PmccScanModal (short delta/OI/spread),
// not a fixed, invisible constant. Only numeric/shape-valid values are
// accepted; anything missing or out of a safe range falls back to
// submitPmccOrder's own SERVER_PMCC_CRITERIA default -- fail-closed, never
// fail-open.
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

export async function POST(request: NextRequest) {
  const session = await getServerSession(authOptions);
  const userId = (session?.user as { id?: string } | undefined)?.id;
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  try {
    const body = await request.json();
    const result = await submitPmccOrder(userId, {
      accountLocator: typeof body?.accountLocator === 'string' ? body.accountLocator : null,
      underlyingSymbol: String(body?.underlyingSymbol ?? '').trim().toUpperCase(),
      longOccSymbol: String(body?.longOccSymbol ?? ''),
      shortOccSymbol: String(body?.shortOccSymbol ?? ''),
      quantity: Number(body?.quantity),
      limitPrice: Number(body?.limitPrice),
      mode: body?.mode === 'submit' ? 'submit' : 'dry-run',
    }, resolveShortCriteriaOverride(body));
    return NextResponse.json(result, { status: result.decision.action === 'NEW_PMCC_REVIEW_ALLOWED' ? 200 : 409 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Unable to review PMCC order' }, { status: 400 });
  }
}
