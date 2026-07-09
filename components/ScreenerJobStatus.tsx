'use client';

import { useEffect, useRef, useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useCommandBus } from '@/hooks/useCommandBus';
import {
  clearScreenerJob,
  completeScreenerJob,
  stopScreenerJob,
  useScreenerJobState,
} from '@/lib/screener/screenerJobStore';

const RESULT_KEYS = [
  { key: 'hunter-results-cache-at', href: '/screener', label: 'Screener scan complete' },
  { key: 'hunter-targeted-results-cache-at', href: '/screener?mode=targeted', label: 'Targeted scan complete' },
] as const;

const LAST_SEEN_KEY = 'trade-edge-last-seen-screener-results-at';

function readNumber(key: string): number | null {
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return null;
    const n = Number(raw);
    return Number.isFinite(n) ? n : null;
  } catch {
    return null;
  }
}

function latestResultTimestamp(): { ts: number; href: string; label: string } | null {
  let newest: { ts: number; href: string; label: string } | null = null;

  for (const item of RESULT_KEYS) {
    const ts = readNumber(item.key);
    if (ts && (!newest || ts > newest.ts)) {
      newest = { ts, href: item.href, label: item.label };
    }
  }

  return newest;
}

export function ScreenerJobStatus() {
  const job = useScreenerJobState();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { dispatch } = useCommandBus();
  const [dismissedId, setDismissedId] = useState<string | null>(null);
  const [stopping, setStopping] = useState(false);
  const mountedRef = useRef(false);

  useEffect(() => {
    mountedRef.current = true;

    if (readNumber(LAST_SEEN_KEY) == null) {
      const latest = latestResultTimestamp();
      if (latest) {
        try { window.localStorage.setItem(LAST_SEEN_KEY, String(latest.ts)); } catch {}
      }
    }

    const check = () => {
      if (!mountedRef.current) return;
      const lastSeen = readNumber(LAST_SEEN_KEY) ?? 0;
      const newest = latestResultTimestamp();

      if (!newest || newest.ts <= lastSeen) return;
      try { window.localStorage.setItem(LAST_SEEN_KEY, String(newest.ts)); } catch {}
      completeScreenerJob({
        status: newest.label,
        resultsHref: newest.href,
        resultCount: null,
      });
    };

    const timer = window.setInterval(check, 1500);
    return () => {
      mountedRef.current = false;
      window.clearInterval(timer);
    };
  }, []);

  if (job.phase === 'idle') return null;
  if (job.id && dismissedId === job.id && job.phase !== 'running') return null;

  const isRunning = job.phase === 'running';
  const isError = job.phase === 'error';
  const isStopped = job.phase === 'stopped';
  const pct = job.progressTotal > 0
    ? Math.min(100, Math.round((job.progressCurrent / job.progressTotal) * 100))
    : null;

  const targetHref = job.resultsHref || '/screener?mode=rank';
  const currentMode = searchParams.get('mode');
  const sameResultsView = pathname === '/screener' && (
    (targetHref.includes('mode=rank') && currentMode === 'rank') ||
    (!targetHref.includes('mode=') && !currentMode)
  );

  const openResults = () => {
    router.push(targetHref);
  };

  const handleStop = async () => {
    if (!job.id || stopping) return;
    setStopping(true);
    try {
      await dispatch({ type: 'CANCEL_TASK', payload: { taskId: job.id } });
      stopScreenerJob('Scan cancelled');
    } catch {
      stopScreenerJob('Scan stopped locally');
    } finally {
      setStopping(false);
    }
  };

  const dismiss = () => {
    if (job.id) setDismissedId(job.id);
    else clearScreenerJob();
  };

  return (
    <div className="fixed bottom-4 right-4 z-[100] w-80 rounded-xl border border-slate-700 bg-slate-950/95 shadow-2xl backdrop-blur p-3 text-slate-100">
      <div className="flex items-start gap-3">
        <div className={`mt-0.5 h-3 w-3 rounded-full shrink-0 ${
          isRunning ? 'border-2 border-blue-400 border-t-transparent animate-spin'
          : isError ? 'bg-red-500'
          : isStopped ? 'bg-yellow-400'
          : 'bg-emerald-400'
        }`} />
        <div className="min-w-0 flex-1">
          <p className="text-[10px] font-bold tracking-widest text-slate-300 uppercase">
            {job.label || (isRunning ? 'Screener running' : 'Screener update')}
          </p>
          <p className={`mt-1 text-xs leading-snug ${isError ? 'text-red-300' : 'text-slate-200'}`}>
            {job.error || job.status || (isRunning ? 'Scan in progress...' : 'Scan complete')}
          </p>

          {isRunning && pct != null && (
            <div className="mt-2">
              <div className="h-1.5 rounded-full bg-slate-800 overflow-hidden">
                <div className="h-full bg-blue-500 transition-all" style={{ width: `${pct}%` }} />
              </div>
              <p className="mt-1 text-[9px] text-slate-500">
                {job.progressCurrent}/{job.progressTotal} · {pct}%
              </p>
            </div>
          )}

          {isRunning ? (
            <div className="mt-3 flex items-center gap-2">
              <button
                onClick={handleStop}
                disabled={stopping}
                className="rounded-lg border border-red-500/70 px-2.5 py-1 text-[10px] font-bold tracking-wider text-red-300 hover:bg-red-500/10 disabled:opacity-50"
              >
                {stopping ? 'STOPPING...' : 'STOP SCAN'}
              </button>
              {!sameResultsView && (
                <button
                  onClick={openResults}
                  className="rounded-lg border border-slate-700 px-2.5 py-1 text-[10px] text-slate-400 hover:text-slate-200"
                >
                  VIEW
                </button>
              )}
            </div>
          ) : (
            <div className="mt-3 flex items-center gap-2">
              {!sameResultsView && (
                <button
                  onClick={openResults}
                  className="rounded-lg border border-emerald-600 px-2.5 py-1 text-[10px] font-bold tracking-wider text-emerald-300 hover:bg-emerald-500/10"
                >
                  OPEN RESULTS
                </button>
              )}
              <button
                onClick={dismiss}
                className="rounded-lg border border-slate-700 px-2.5 py-1 text-[10px] text-slate-400 hover:text-slate-200"
              >
                DISMISS
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
