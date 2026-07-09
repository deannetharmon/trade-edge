import { NextRequest, NextResponse } from 'next/server';
import { getServerJob } from '@/lib/jobs/store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(_req: NextRequest, { params }: { params: { jobId: string } }) {
  try {
    const job = await getServerJob(params.jobId);
    if (!job) {
      return NextResponse.json({ error: 'Job not found' }, { status: 404 });
    }

    return NextResponse.json({ job });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to load job' },
      { status: 500 }
    );
  }
}
