import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { submitLeapsOrder } from '@/lib/leaps-analysis/serverTradeReview';
import { resolveLeapsCriteria } from '@/lib/leaps-analysis/criteria';

// Dean: the qualification gate blocking an order previously checked
// against SERVER_LEAPS_POLICY -- a fixed constant with no UI, no chips,
// nothing on screen to tell you it existed or let you change it. That's
// a real problem: the badge you see on the candidate row reflects YOUR
// live Delta/DTE/Extrinsic filters, but the actual order-blocking check
// used different, invisible numbers. This now accepts those same live
// filter values from the request body -- same fields the LEAPS results
// screen already tracks -- so the gate you see and the gate that blocks
// your order are the same gate. Anything not supplied (or out of the
// safe numeric bounds below) falls back to SERVER_LEAPS_POLICY's value,
// never to a looser one -- fail-closed, not fail-open. spreadPctMax and
// the quote-freshness requirement stay fixed; those were never exposed
// as user-adjustable filters and are data-integrity/safety checks, not
// screening preferences.
// LEAPS-AI-0003: that criteria rule now lives in lib/leaps-analysis/criteria.ts
// (resolveLeapsCriteria) so Analyze with AI uses the identical gate.

export async function POST(request: NextRequest) {
  const session = await getServerSession(authOptions);
  const userId = (session?.user as { id?: string } | undefined)?.id;
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  try {
    const body = await request.json();
    const criteria = resolveLeapsCriteria(body);
    const result = await submitLeapsOrder(userId, { accountLocator: typeof body?.accountLocator === 'string' ? body.accountLocator : null, underlyingSymbol: String(body?.underlyingSymbol ?? '').toUpperCase(), occSymbol: String(body?.occSymbol ?? ''), quantity: Number(body?.quantity), limitPrice: Number(body?.limitPrice), mode: body?.mode === 'submit' ? 'submit' : 'dry-run' }, criteria);
    return NextResponse.json(result, { status: result.review.qualification.status === 'CONTRACT_QUALIFIED' ? 200 : 409 });
  } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : 'Unable to review LEAPS contract' }, { status: 400 }); }
}
