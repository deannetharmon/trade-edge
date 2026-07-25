// features/screener/hooks/useRankedScan.ts
//
// Ranked Scan orchestration, extracted from app/screener/page.tsx (RF-0001).
// Restored to the browser/TaskManager execution path after the experimental
// server-side TastyTrade scan path hit authorization failures from Vercel.

import { useCallback, useEffect, useState } from 'react';
import { useCommandBus } from '@/hooks/useCommandBus';
import { useTaskManager } from '@/hooks/useTaskManager';
import { useTask } from '@/hooks/useTask';
import {
  completeScreenerJob,
  failScreenerJob,
  startScreenerJob,
  stopScreenerJob,
  updateScreenerJob,
} from '@/lib/screener/screenerJobStore';
import type { RulesType } from '@/lib/scans/constants';
import type { RankedScanInput, RankedScanResult } from '@/lib/scans/ranked-scan-runner';
import type { StartRankedScanResult } from '@/lib/commands/command-handlers';
import type { UseRankedScanParams, UseRankedScanResult } from '../types';

export function useRankedScan(params: UseRankedScanParams): UseRankedScanResult {
  const {
    screenMode, tickers, rankConfig,
    setResults, setRawScanCache, setResultsCachedAt,
    setLoading, setStatus, setError,
  } = params;

  const { dispatch } = useCommandBus();
  const { tasks: allTasks } = useTaskManager();
  const [rankedScanTaskId, setRankedScanTaskId] = useState<string | null>(null);

  // PO corrective round 4 (WA-0005 Defect 2): previously this effect only
  // ever picked a ranked-scan task ONCE per mount (`if (rankedScanTaskId)
  // return;`), then stuck to that same id for the mount's lifetime unless
  // startRankedScan() explicitly reset it back to null before dispatching a
  // new scan. That made this the only way to observe a second, genuinely
  // distinct ranked-scan task -- which round 3's test suite worked around by
  // reusing the SAME task id for a simulated "second run" (a disclosed
  // simplification the round 4 Product Owner review required be fixed, not
  // merely disclosed again).
  //
  // Corrected: this effect now always tracks the LATEST ranked-scan task by
  // creation order (allTasks preserves TaskManager's own insertion order,
  // confirmed by direct read of lib/tasks/task-store.ts's
  // `Array.from(this.tasks.values())`), regardless of whether
  // `rankedScanTaskId` is already set. It only calls setRankedScanTaskId
  // when the latest id actually differs from what's already tracked, so
  // this is a no-op on every render where nothing changed. This is strictly
  // more correct than the old one-shot pick (a genuinely newer ranked-scan
  // task is always followed, exactly as if startRankedScan() had reset
  // tracking first) and does not change behavior for the common
  // single-task-per-mount case.
  useEffect(() => {
    if (screenMode !== 'rank') return;
    const rankedTasks = allTasks.filter(t => t.kind === 'ranked-scan');
    if (rankedTasks.length === 0) return;
    const latest = rankedTasks.reduce((a, b) => (new Date(b.createdAt) >= new Date(a.createdAt) ? b : a));
    if (latest.id !== rankedScanTaskId) setRankedScanTaskId(latest.id);
  }, [screenMode, allTasks, rankedScanTaskId]);

  const rankedScanTask = useTask(rankedScanTaskId);

  useEffect(() => {
    if (!rankedScanTask || screenMode !== 'rank') return;
    if (rankedScanTask.status === 'queued' || rankedScanTask.status === 'running') {
      setLoading(true);
      setStatus(rankedScanTask.progressLabel ?? 'Running...');
      setError('');
      updateScreenerJob({
        id: rankedScanTask.id,
        phase: 'running',
        kind: 'rank',
        label: 'Ranked screener scan',
        status: rankedScanTask.progressLabel ?? 'Running ranked scan...',
        resultsHref: '/screener?mode=rank',
      });
    } else if (rankedScanTask.status === 'completed') {
      setLoading(false);
      setStatus('');
      const result = rankedScanTask.result as RankedScanResult | undefined;
      if (result) {
        setResults(result.results);
        setRawScanCache(result.rawScanCache);
        setResultsCachedAt(rankedScanTask.completedAt ? new Date(rankedScanTask.completedAt).getTime() : Date.now());
        completeScreenerJob({
          resultCount: result.results.length,
          status: `${result.results.length} ranked result${result.results.length === 1 ? '' : 's'} ready`,
          resultsHref: '/screener?mode=rank',
        });
      } else {
        completeScreenerJob({ status: 'Ranked scan complete', resultsHref: '/screener?mode=rank' });
      }
    } else if (rankedScanTask.status === 'failed') {
      setLoading(false);
      setStatus('');
      setError(rankedScanTask.error ?? 'Ranked scan failed');
      failScreenerJob(rankedScanTask.error ?? 'Ranked scan failed');
    } else if (rankedScanTask.status === 'cancelled') {
      setLoading(false);
      setStatus('');
      stopScreenerJob('Ranked scan cancelled');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rankedScanTask, screenMode]);

  const startRankedScan = useCallback(async (
    sRules: RulesType, eRules: RulesType, sLabel?: string, eLabel?: string
  ) => {
    const activeSymbols = tickers.filter(t => t.active).map(t => t.symbol);
    if (!activeSymbols.length) {
      setError('No active tickers in watchlist. Check the box next to a ticker to include it in the scan.');
      return;
    }
    setError('');
    setResults([]);
    setResultsCachedAt(null);
    setLoading(true);
    setStatus('Starting ranked scan...');
    startScreenerJob({
      kind: 'rank',
      label: 'Ranked screener scan',
      total: activeSymbols.length,
      status: 'Starting ranked scan...',
      resultsHref: '/screener?mode=rank',
    });
    setRankedScanTaskId(null);

    const res = await dispatch<RankedScanInput, StartRankedScanResult>({
      type: 'START_RANKED_SCAN',
      payload: { activeSymbols, sRules, eRules, sLabel, eLabel, rankConfig },
    });

    if (res.handled && res.result?.taskId) {
      setRankedScanTaskId(res.result.taskId);
    } else {
      setLoading(false);
      setStatus('');
      setError(res.error ?? 'Failed to start ranked scan');
      failScreenerJob(res.error ?? 'Failed to start ranked scan');
    }
  }, [tickers, rankConfig, dispatch]);

  return { startRankedScan };
}
