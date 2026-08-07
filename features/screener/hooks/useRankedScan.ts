// features/screener/hooks/useRankedScan.ts
//
// Ranked Scan orchestration, extracted from app/screener/page.tsx (RF-0001).
// Restored to the browser/TaskManager execution path after the experimental
// server-side TastyTrade scan path hit authorization failures from Vercel.

import { useCallback, useEffect, useRef, useState } from 'react';
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
// SCREENER-RESULTS-0001 — Ranked mode's per-symbol loop runs inside
// lib/scans/ranked-scan-runner.ts, executed as a background task (and, per
// TE-0002B, sometimes server-side) — this hook cannot reach into that loop
// directly. Instead it reconstructs per-symbol outcomes from the runner's
// already-real signals once the task completes: `rawScanCache` contains
// exactly one entry per symbol whose chain/quote fetch actually succeeded
// (mirroring runScreen's identical scanCache.push pattern in page.tsx), so
// a planned symbol NOT in rawScanCache is a real acquisition failure, never
// silently dropped or misrepresented as a zero-candidate evaluation.
import {
  recordSymbolEvaluated, recordSymbolFailed, completeSession, stopSession, errorSession,
  type ScreenerScanSession,
} from '@/lib/screener/scanSession';
import { persistScanSession } from '@/lib/screener/scanSessionCache';

export function useRankedScan(params: UseRankedScanParams): UseRankedScanResult {
  const {
    screenMode, tickers, rankConfig,
    setResults, setRawScanCache, setResultsCachedAt,
    setLoading, setStatus, setError,
    beginSession, commitSession,
  } = params;

  const { dispatch } = useCommandBus();
  const { tasks: allTasks } = useTaskManager();
  const [rankedScanTaskId, setRankedScanTaskId] = useState<string | null>(null);
  // Holds the session across the async task lifecycle (start -> queued/
  // running -> completed/failed/cancelled) — a plain ref, not state, since
  // nothing here needs to re-render off it; only the completion handler
  // below reads it.
  const rankedSessionRef = useRef<ScreenerScanSession | null>(null);

  useEffect(() => {
    if (screenMode !== 'rank') return;
    if (rankedScanTaskId) return;
    const rankedTasks = allTasks.filter(t => t.kind === 'ranked-scan');
    if (rankedTasks.length === 0) return;
    const latest = rankedTasks.reduce((a, b) => (new Date(b.createdAt) > new Date(a.createdAt) ? b : a));
    setRankedScanTaskId(latest.id);
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
      let session = rankedSessionRef.current;
      // SCREENER-RESULTS-0001 corrective — reconnecting to an already-
      // completed task this hook instance never itself started (e.g. after
      // navigating away and back) used to call setResults(result.results)
      // directly, entirely bypassing the canonical session model (no
      // ScreenerScanSession was ever created, so accounting, strategy
      // isolation, and the cache-provenance/staleness guarantees all silently
      // did not apply to a reconnected Ranked scan's display). The task
      // itself always carries its own original input (see
      // lib/commands/command-handlers.ts's START_RANKED_SCAN handler, which
      // creates the task with `input` set to the exact RankedScanInput that
      // was dispatched), so a session can be constructed here too —
      // reconnection is no longer a special, session-less case.
      if (!session && result) {
        const activeSymbols = (rankedScanTask.input as RankedScanInput | undefined)?.activeSymbols;
        if (activeSymbols?.length) {
          session = beginSession({ universeSymbols: activeSymbols, eligibleSymbols: activeSymbols });
        }
      }
      if (result && session) {
        // SCREENER-RESULTS-0001 — reconstruct one canonical outcome per
        // planned symbol from the runner's real signals. `rawScanCache`
        // contains exactly one entry per symbol whose chain/quote fetch
        // succeeded (lib/scans/ranked-scan-runner.ts pushes to it only
        // immediately after its `Promise.all([getChain, getQuote])` for that
        // symbol resolves — see the loop's try block). The runner's own
        // catch block for that same try (its `errResult()` helper) still
        // fabricates a disqualified ScreenResult for a symbol whose fetch
        // failed and pushes it into `result.results` WITHOUT adding that
        // symbol to `rawScanCache` — precisely because that push never runs
        // on the failure path. So for a *completed* task specifically,
        // absence from rawScanCache always means the acquisition Promise.all
        // itself threw for that symbol (a real MARKET_DATA_REQUEST_FAILED),
        // never a cancellation (a cancelled run fails/cancels the whole task,
        // it never reaches 'completed' with a partial loop) and never a
        // classifyUnderlying failure (thrown outside any try in the runner's
        // loop, which likewise fails the whole task rather than completing
        // it). This is recorded as 'failed', never silently dropped and
        // never given a fabricated zero-candidate result.
        const evaluatedSymbols = new Set(result.rawScanCache.map(e => e.symbol));
        let s = session;
        for (const symbol of s.plannedScanSymbols) {
          if (evaluatedSymbols.has(symbol)) {
            const symbolResults = result.results.filter(r => r.symbol === symbol);
            s = symbolResults.length > 0
              ? recordSymbolEvaluated(s, symbol, symbolResults)
              : recordSymbolEvaluated(s, symbol, [], { reasonCode: 'NO_QUALIFYING_CANDIDATE' });
          } else {
            s = recordSymbolFailed(s, symbol, 'MARKET_DATA_REQUEST_FAILED');
          }
        }
        s = completeSession(s);
        rankedSessionRef.current = null;
        const finalSession = s;
        commitSession(finalSession, () => {
          // Displays finalSession.results (the canonical, reconciled set),
          // NOT the runner's raw result.results — the runner's own
          // errResult() fabrication for a failed symbol must never reach the
          // UI; recordSymbolFailed() above never adds anything to
          // finalSession.results for that symbol, so it's excluded here too.
          setResults(finalSession.results);
          setRawScanCache(result.rawScanCache);
          setResultsCachedAt(rankedScanTask.completedAt ? new Date(rankedScanTask.completedAt).getTime() : Date.now());
          persistScanSession(finalSession);
          completeScreenerJob({
            resultCount: finalSession.results.length,
            status: `${finalSession.results.length} ranked result${finalSession.results.length === 1 ? '' : 's'} ready`,
            resultsHref: '/screener?mode=rank',
          });
        });
      } else if (result) {
        // SCREENER-RESULTS-0001 final corrective — no session could be
        // constructed even from the task's own input (e.g. a legacy task
        // created before `input` was stored, or one dispatched with an empty
        // activeSymbols list). This used to fall back to displaying
        // result.results directly, which is exactly the trust-boundary
        // bypass the review flagged: unowned results with no canonical
        // session backing them. Fail closed instead — surface a clear error
        // and do not display the results.
        setError('This ranked scan cannot be displayed: its original scope could not be recovered, so canonical accounting is unavailable. Start a new ranked scan.');
        failScreenerJob('Ranked scan result missing scope data');
      } else {
        completeScreenerJob({ status: 'Ranked scan complete', resultsHref: '/screener?mode=rank' });
      }
    } else if (rankedScanTask.status === 'failed') {
      setLoading(false);
      setStatus('');
      setError(rankedScanTask.error ?? 'Ranked scan failed');
      failScreenerJob(rankedScanTask.error ?? 'Ranked scan failed');
      if (rankedSessionRef.current && rankedSessionRef.current.status === 'running') {
        const reasonCode = /token/i.test(rankedScanTask.error ?? '') ? 'ACCESS_TOKEN_UNAVAILABLE' : 'MARKET_DATA_REQUEST_FAILED';
        try {
          const errored = errorSession(rankedSessionRef.current, reasonCode);
          rankedSessionRef.current = null;
          commitSession(errored);
        } catch { /* session already terminal */ }
      }
    } else if (rankedScanTask.status === 'cancelled') {
      setLoading(false);
      setStatus('');
      stopScreenerJob('Ranked scan cancelled');
      if (rankedSessionRef.current && rankedSessionRef.current.status === 'running') {
        try {
          const stopped = stopSession(rankedSessionRef.current, 'CANCELLED');
          rankedSessionRef.current = null;
          commitSession(stopped);
        } catch { /* session already terminal */ }
      }
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
    // SCREENER-RESULTS-0001 — 'spreads' session, rank mode. No capacity-
    // style eligibility gate, so eligibleSymbols === the active watchlist.
    rankedSessionRef.current = beginSession({ universeSymbols: activeSymbols, eligibleSymbols: activeSymbols });
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
      if (rankedSessionRef.current && rankedSessionRef.current.status === 'running') {
        try {
          const errored = errorSession(rankedSessionRef.current, 'MARKET_DATA_REQUEST_FAILED');
          rankedSessionRef.current = null;
          commitSession(errored);
        } catch { /* session already terminal */ }
      }
    }
  }, [tickers, rankConfig, dispatch, beginSession, commitSession]);

  return { startRankedScan };
}
