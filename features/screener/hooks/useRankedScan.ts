// features/screener/hooks/useRankedScan.ts
//
// Ranked Scan orchestration, extracted from app/screener/page.tsx (RF-0001).
// This is a mechanical relocation of the logic TE-0005A added — no behavior
// change. It still runs Ranked Scan as a background task via the Command
// Bus / Task Manager (see docs/reviews/TE-0005A-Implementation-Report.md)
// and still mirrors task state into the same results/loading/status/error
// setters the page already renders from. Filter and Targeted are untouched
// and continue to call runScreen()/runTargetedScan() directly in page.tsx.

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

  // Reconnect: on mount (or whenever screenMode becomes 'rank'), find the
  // most recently created ranked-scan task the TaskManager already knows
  // about — the TaskManager instance lives at the app root and survives
  // this page unmounting/remounting on navigation, so no extra persistence
  // is needed for this ticket (memory-only task state, per ADR-0001/TE-0005A).
  useEffect(() => {
    if (screenMode !== 'rank') return;
    if (rankedScanTaskId) return; // already tracking one (e.g. just started it)
    const rankedTasks = allTasks.filter(t => t.kind === 'ranked-scan');
    if (rankedTasks.length === 0) return;
    const latest = rankedTasks.reduce((a, b) => (new Date(b.createdAt) > new Date(a.createdAt) ? b : a));
    setRankedScanTaskId(latest.id);
  }, [screenMode, allTasks, rankedScanTaskId]);

  const rankedScanTask = useTask(rankedScanTaskId);

  // Mirror the reconnected/active task's state into the same
  // results/loading/status/error/rawScanCache/resultsCachedAt state Filter
  // and Targeted already render from — zero new rendering paths.
  useEffect(() => {
    if (!rankedScanTask || screenMode !== 'rank') return;
    if (rankedScanTask.status === 'queued' || rankedScanTask.status === 'running') {
      setLoading(true);
      setStatus(rankedScanTask.progressLabel ?? 'Running...');
      setError('');
      updateScreenerJob({
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

  // Starts a Ranked Scan as a background task via the Command Bus, instead
  // of calling runScreen() directly. Same inputs runScreen's rank branch
  // used to take; same activeSymbols derivation as runScreen.
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
    setRankedScanTaskId(null); // clear so the reconnect effect above picks up the fresh task, not a stale one

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
