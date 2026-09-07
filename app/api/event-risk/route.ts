import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { fetchEventCalendarBundle } from '@/lib/scans/eventCalendar';
import { normalizeFmpEventCalendar } from '@/lib/scans/eventCalendar';

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Diagnostic-first event calendar endpoint. The UI must treat any provider
 * error or unrecognized raw payload as unavailable until the deployed FMP
 * response is explicitly normalized and approved. */
export async function GET(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const symbol = request.nextUrl.searchParams.get('symbol')?.trim().toUpperCase();
  const from = request.nextUrl.searchParams.get('from');
  const to = request.nextUrl.searchParams.get('to');
  if (!symbol || !from || !to || !ISO_DATE.test(from) || !ISO_DATE.test(to) || from > to) {
    return NextResponse.json({ error: 'symbol, from, and to (YYYY-MM-DD) are required' }, { status: 400 });
  }
  try {
    const bundle = await fetchEventCalendarBundle(symbol, from, to);
    // Keep raw data available for the one-time provider review, but only
    // advertise normalized values when every calendar response is an array.
    const events = normalizeFmpEventCalendar(bundle);
    return NextResponse.json({ bundle, events, verified: events.complete });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Unable to fetch event data', verified: false }, { status: 502 });
  }
}
