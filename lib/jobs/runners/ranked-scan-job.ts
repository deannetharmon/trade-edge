import { runRankedScan } from '@/lib/scans/ranked-scan-runner';
import type { RankedScanInput, RankedScanResult } from '@/lib/scans/ranked-scan-runner';
import { markServerJobStatus, patchServerJob } from '../store';

export async function runRankedScanServerJob(jobId: string, input: RankedScanInput): Promise<void> {
  try {
    await markServerJobStatus(jobId, 'running', {
      progressPct: 0,
      progressLabel: 'Starting ranked scan...',
    });

    const result: RankedScanResult = await runRankedScan(input, async (progress) => {
      const progressPct = progress.total > 0 ? Math.round((progress.completed / progress.total) * 100) : 0;
      await patchServerJob(jobId, {
        progressPct,
        progressLabel: progress.label,
      });
    });

    await markServerJobStatus<RankedScanResult>(jobId, 'completed', {
      progressPct: 100,
      progressLabel: `${result.results.length} ranked result${result.results.length === 1 ? '' : 's'} ready`,
      result,
    });
  } catch (err) {
    await markServerJobStatus(jobId, 'failed', {
      progressLabel: 'Ranked scan failed',
      error: err instanceof Error ? err.message : 'Ranked scan failed',
    });
  }
}
