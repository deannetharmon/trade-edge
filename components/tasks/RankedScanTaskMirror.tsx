'use client';

import { useEffect } from 'react';
import { useTaskManager } from '@/hooks/useTaskManager';
import {
  completeScreenerJob,
  failScreenerJob,
  stopScreenerJob,
  updateScreenerJob,
} from '@/lib/screener/screenerJobStore';
import type { RankedScanResult } from '@/lib/scans/ranked-scan-runner';

/**
 * Keeps the global scan toast synchronized with the app-level TaskManager even
 * when /screener is unmounted. This does not move execution to the server and
 * does not change the scan runner; it only removes the page-local dependency
 * for progress/completion visibility during in-app navigation.
 */
export function RankedScanTaskMirror() {
  const { tasks } = useTaskManager();

  useEffect(() => {
    const rankedTasks = tasks.filter(t => t.kind === 'ranked-scan');
    if (rankedTasks.length === 0) return;

    const latest = rankedTasks.reduce((a, b) => (
      new Date(b.createdAt) > new Date(a.createdAt) ? b : a
    ));

    if (latest.status === 'queued' || latest.status === 'running') {
      updateScreenerJob({
        id: latest.id,
        phase: 'running',
        kind: 'rank',
        label: 'Ranked screener scan',
        status: latest.progressLabel ?? 'Running ranked scan...',
        progressCurrent: Math.round(latest.progressPct ?? 0),
        progressTotal: 100,
        resultsHref: '/screener?mode=rank',
      });
      return;
    }

    if (latest.status === 'completed') {
      const result = latest.result as RankedScanResult | undefined;
      completeScreenerJob({
        resultCount: result?.results?.length ?? null,
        status: result?.results
          ? `${result.results.length} ranked result${result.results.length === 1 ? '' : 's'} ready`
          : 'Ranked scan complete',
        resultsHref: '/screener?mode=rank',
      });
      return;
    }

    if (latest.status === 'failed') {
      failScreenerJob(latest.error ?? 'Ranked scan failed');
      return;
    }

    if (latest.status === 'cancelled') {
      stopScreenerJob('Ranked scan cancelled');
    }
  }, [tasks]);

  return null;
}
