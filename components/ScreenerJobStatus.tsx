'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useCommandBus } from '@/hooks/useCommandBus';
import {
  clearScreenerJob,
  stopScreenerJob,
  useScreenerJobState,
} from '@/lib/screener/screenerJobStore';

function getCurrentLocation(): { pathname: string; search: string } {
  if (typeof window === 'undefined') return { pathname: '', search: '' };
  return { pathname: window.location.pathname, search: window.location.search };
}

export function ScreenerJobStatus() {
  const job = useScreenerJobState();
  const router = useRouter();
  const { dispatch } = useCommandBus();
  const [dismissedId, setDismissedId] = useState<string | null>(null);
  const [stopping, setStopping] = useState(false);
  const [location, setLocation] = useState(() => getCurrentLocation());
  const mountedRef = useRef(false);

  useEffect(() => {
    mountedRef.current = true;
    // Job completion is now reported directly by each scan (runScreen,
    // runTargetedScan, runPMCCScan, runCspScan, and RankedScanTaskMirror
    // for Rank mode) via completeScreenerJob() the instant it finishes,
    // with an accurate result count and status message. This used to also
    // poll localStorage cache timestamps as a fallback detector, but that
    // path only ever knew "a scan of some kind finished" — no count, no
    // real mode awareness — and its 750ms interval would fire shortly
    // after the accurate direct call and clobber it with generic text.
    // Kept only to track the current URL for the same-view check below.
    const check = () => {
      if (!mountedRef.current) return;
      setLocation(getCurrentLocation());
    };
    window.addEventListener('popstate', check);
    return () => {
      mountedRef.current = false;
      window.removeEventListener('popstate', check);
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
  // Generic mode comparison — the old version only special-cased 'rank' and
  // "no mode param," so Open Results silently did nothing whenever you were
  // already on targeted/filter/pmcc/csp results (router.push to the exact
  // same URL is a no-op), because sameResultsView incorrectly evaluated to
  // false and the button rendered (and appeared clickable) when it should
  // have been hidden — or conversely could hide when it shouldn't. This
  // covers every mode by construction instead of enumerating them.
  const targetMode = new URLSearchParams(targetHref.split('?')[1] || '').get('mode');
  const currentMode = new URLSearchParams(location.search).get('mode');
  const sameResultsView = location.pathname === '/screener' && targetMode === currentMode;

  const openResults = () => {
    router.push(targetHref);
    window.setTimeout(() => setLocation(getCurrentLocation()), 0);
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
