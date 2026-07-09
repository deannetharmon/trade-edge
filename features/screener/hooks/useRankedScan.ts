// features/screener/hooks/useRankedScan.ts
//
// Ranked Scan orchestration. TE-0002B moves execution off the browser tab and
// into the Redis-backed server job engine. The page only starts/polls the job
// and mirrors completed results into the existing Screener state.

import { useCallback, useEffect, useState } from 'react';
import {
  completeScreenerJob,
  failScreenerJob,
  startScreenerJob,
  stopScreenerJob,
  updateScreenerJob,
} from '@/lib/screener/screenerJobStore';
import type { RulesType } from '@/lib/scans/constants';
import type { RankedScanInput, RankedScanResult } from '@/lib/scans/ranked-scan-runner';
import type { ServerJobRecord } from '@/lib/jobs/types';
import type { UseRankedScanParams, UseRankedScanResult } from '../types';

const ACTIVE_RANKED_JOB_KEY = 'trade-edge-active-ranked-scan-job-id';

async function fetchJob(jobId: string): Promise<ServerJobRecord<RankedScanInput, RankedScanResult>> {
  const res = await fetch(`/api/jobs/status/${encodeURIComponent(jobId)}`, { cache: 'no-store' });
  const json = await res.json();
  if (!res.ok) throw new Error(json?.error ?? 'Failed to load ranked scan job');
  return json.job as ServerJobRecord<RankedScanInput, RankedScanResult>;
}

export function useRankedScan(params: UseRankedScanParams): UseRankedScanResult {
  const {
    screenMode, tickers, rankConfig,
    setResults, setRawScanCache, setResultsCachedAt,
    setLoading, setStatus, setError,
  } = params;

  const [rankedScanJobId, setRankedScanJobId] = useState<string | null>(null);

  // Reconnect after navigation/remount. The job lives in Redis, not the page,
  // so the Screener can safely come and go while the server continues scanning.
  useEffect(() => {
    if (screenMode !== 'rank') return;
    if (rankedScanJobId) return;
    try {
      const existing = window.localStorage.getItem(ACTIVE_RANKED_JOB_KEY);
      if (existing) setRankedScanJobId(existing);
    } catch {}
  }, [screenMode, rankedScanJobId]);

  useEffect(() => {
    if (!rankedScanJobId || screenMode !== 'rank') return;

    let cancelled = false;
    let timer: number | null = null;

    const poll = async () => {
      try {
        const job = await fetchJob(rankedScanJobId);
        if (cancelled) return;

        if (job.status === 'queued' || job.status === 'running') {
          setLoading(true);
          setStatus(job.progressLabel || 'Running ranked scan...');
          setError('');
          updateScreenerJob({
            id: job.id,
            phase: 'running',
            kind: 'rank',
            label: 'Ranked screener scan',
            status: job.progressLabel || 'Running ranked scan...',
            progressCurrent: job.progressPct,
            progressTotal: 100,
            resultsHref: '/screener?mode=rank',
          });
          timer = window.setTimeout(poll, 1500);
          return;
        }

        if (job.status === 'completed') {
          setLoading(false);
          setStatus('');
          const result = job.result;
          if (result) {
            setResults(result.results);
            setRawScanCache(result.rawScanCache);
            setResultsCachedAt(job.completedAt ? new Date(job.completedAt).getTime() : Date.now());
            try { window.localStorage.removeItem(ACTIVE_RANKED_JOB_KEY); } catch {}
            completeScreenerJob({
              resultCount: result.results.length,
              status: `${result.results.length} ranked result${result.results.length === 1 ? '' : 's'} ready`,
              resultsHref: '/screener?mode=rank',
            });
          } else {
            completeScreenerJob({ status: 'Ranked scan complete', resultsHref: '/screener?mode=rank' });
          }
          return;
        }

        if (job.status === 'failed') {
          setLoading(false);
          setStatus('');
          setError(job.error ?? 'Ranked scan failed');
          try { window.localStorage.removeItem(ACTIVE_RANKED_JOB_KEY); } catch {}
          failScreenerJob(job.error ?? 'Ranked scan failed');
          return;
        }

        if (job.status === 'cancelled') {
          setLoading(false);
          setStatus('');
          try { window.localStorage.removeItem(ACTIVE_RANKED_JOB_KEY); } catch {}
          stopScreenerJob('Ranked scan cancelled');
        }
      } catch (err) {
        if (cancelled) return;
        setLoading(false);
        setStatus('');
        const msg = err instanceof Error ? err.message : 'Failed to poll ranked scan job';
        setError(msg);
        failScreenerJob(msg);
      }
    };

    poll();

    return () => {
      cancelled = true;
      if (timer != null) window.clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rankedScanJobId, screenMode]);

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
      total: 100,
      status: 'Starting ranked scan...',
      resultsHref: '/screener?mode=rank',
    });

    const input: RankedScanInput = { activeSymbols, sRules, eRules, sLabel, eLabel, rankConfig };

    try {
      const res = await fetch('/api/jobs/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'ranked-scan', input }),
      });
      const json = await res.json();
      if (!res.ok || !json?.jobId) throw new Error(json?.error ?? 'Failed to start ranked scan');
      try { window.localStorage.setItem(ACTIVE_RANKED_JOB_KEY, json.jobId); } catch {}
      setRankedScanJobId(json.jobId);
    } catch (err) {
      setLoading(false);
      setStatus('');
      const msg = err instanceof Error ? err.message : 'Failed to start ranked scan';
      setError(msg);
      failScreenerJob(msg);
    }
  }, [tickers, rankConfig]);

  return { startRankedScan };
}
