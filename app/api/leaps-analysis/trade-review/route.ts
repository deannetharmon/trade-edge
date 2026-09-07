import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { submitLeapsOrder } from '@/lib/leaps-analysis/serverTradeReview';

export async function POST(request: NextRequest) {
  const session = await getServerSession(authOptions);
  const userId = (session?.user as { id?: string } | undefined)?.id;
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  try {
    const body = await request.json();
    const result = await submitLeapsOrder(userId, { accountLocator: typeof body?.accountLocator === 'string' ? body.accountLocator : null, underlyingSymbol: String(body?.underlyingSymbol ?? '').toUpperCase(), occSymbol: String(body?.occSymbol ?? ''), quantity: Number(body?.quantity), limitPrice: Number(body?.limitPrice), mode: body?.mode === 'submit' ? 'submit' : 'dry-run' });
    return NextResponse.json(result, { status: result.review.qualification.status === 'CONTRACT_QUALIFIED' ? 200 : 409 });
  } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : 'Unable to review LEAPS contract' }, { status: 400 }); }
}
