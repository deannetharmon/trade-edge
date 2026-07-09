import { NextRequest, NextResponse } from 'next/server';
import { createServerJob } from '@/lib/jobs/store';
import { runRankedScanServerJob } from '@/lib/jobs/runners/ranked-scan-job';
import type { RankedScanInput } from '@/lib/scans/ranked-scan-runner';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const type = body?.type;

    if (type !== 'ranked-scan') {
      return NextResponse.json({ error: `Unsupported job type: ${String(type)}` }, { status: 400 });
    }

    const input = body?.input as RankedScanInput | undefined;
    if (!input || !Array.isArray(input.activeSymbols) || input.activeSymbols.length === 0) {
      return NextResponse.json({ error: 'ranked-scan requires input.activeSymbols' }, { status: 400 });
    }

    const job = await createServerJob<RankedScanInput>({
      type: 'ranked-scan',
      title: 'Ranked Scan',
      input,
    });

    // Fire-and-forget from the API route. The job owns progress/result state in Redis.
    // This moves the expensive scan off the Screener page lifecycle and out of the
    // inactive browser tab throttling path.
    void runRankedScanServerJob(job.id, input);

    return NextResponse.json({ jobId: job.id });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to start job' },
      { status: 500 }
    );
  }
}
