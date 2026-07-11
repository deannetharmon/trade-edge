// app/autopilot/KillSwitchControl.tsx
'use client';

import { useCallback, useEffect, useState } from 'react';

type LoadState = 'loading' | 'ready' | 'error';

export default function KillSwitchControl() {
  const [loadState, setLoadState] = useState<LoadState>('loading');
  const [killSwitchEnabled, setKillSwitchEnabled] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadStatus = useCallback(async () => {
    setLoadState('loading');
    setError(null);
    try {
      const res = await fetch('/api/autopilot/status');
      const body = await res.json();
      if (!res.ok) throw new Error(body?.error ?? `Status request failed (${res.status}).`);
      setKillSwitchEnabled(Boolean(body.killSwitchEnabled));
      setLoadState('ready');
    } catch (e: any) {
      setError(e?.message ?? 'Failed to load Autopilot status.');
      setLoadState('error');
    }
  }, []);

  useEffect(() => {
    loadStatus();
  }, [loadStatus]);

  const toggleKillSwitch = useCallback(async () => {
    const next = !killSwitchEnabled;

    // Re-enabling recommendation generation is the more consequential
    // direction (going from paused back to active) -- confirm before
    // flipping it off. Turning the switch ON (pausing) needs no gate.
    if (!next) {
      const confirmed = window.confirm(
        'Turn off the Autopilot kill switch? Recommendation runs will resume ' +
          'generating candidate analyses (no execution either way -- this ' +
          'sprint has no order path).',
      );
      if (!confirmed) return;
    }

    setPending(true);
    setError(null);
    try {
      // saveAutopilotConfig() sanitizes whatever object it's given as a
      // COMPLETE config, filling any missing field with defaults -- it does
      // not merge with what's already saved. So this fetches the current
      // full config first and only changes killSwitchEnabled on it; PUTing
      // just { killSwitchEnabled } would silently reset every threshold and
      // per-strategy goal back to defaults.
      const currentRes = await fetch('/api/autopilot/config');
      const currentBody = await currentRes.json();
      if (!currentRes.ok) throw new Error(currentBody?.error ?? 'Failed to load current config.');

      const nextConfig = { ...currentBody.config, killSwitchEnabled: next };

      const putRes = await fetch('/api/autopilot/config', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          config: nextConfig,
          reason: next ? 'kill_switch_enabled_from_ui' : 'kill_switch_disabled_from_ui',
        }),
      });
      const putBody = await putRes.json();
      if (!putRes.ok) throw new Error(putBody?.error ?? 'Failed to save config.');

      setKillSwitchEnabled(Boolean(putBody.config?.killSwitchEnabled));
    } catch (e: any) {
      setError(e?.message ?? 'Failed to update the kill switch.');
    } finally {
      setPending(false);
    }
  }, [killSwitchEnabled]);

  const isOn = killSwitchEnabled;
  const isKnown = loadState === 'ready';

  return (
    <section
      className={`rounded-2xl border p-6 transition-colors ${
        isKnown && isOn
          ? 'border-rose-500/40 bg-rose-950/20'
          : 'border-slate-800 bg-slate-900/70'
      }`}
    >
      <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div>
          <div className="flex items-center gap-3">
            <span
              className={`h-2.5 w-2.5 rounded-full ${
                !isKnown
                  ? 'bg-slate-500'
                  : isOn
                    ? 'bg-rose-400'
                    : 'bg-emerald-400'
              }`}
            />
            <h2 className="text-lg font-semibold text-white">Kill Switch</h2>
            <span
              className={`rounded-full px-2 py-0.5 text-xs font-semibold uppercase tracking-wide ${
                !isKnown
                  ? 'bg-slate-800 text-slate-400'
                  : isOn
                    ? 'bg-rose-500/20 text-rose-200'
                    : 'bg-emerald-500/20 text-emerald-200'
              }`}
            >
              {loadState === 'loading' ? 'Loading' : loadState === 'error' ? 'Unknown' : isOn ? 'Paused' : 'Active'}
            </span>
          </div>
          <p className="mt-3 max-w-2xl text-sm leading-6 text-slate-300">
            When on, every recommendation run stops before any candidate is evaluated -- no
            candidate pipeline, no Decision Engine reasoning, no decision-log entries. One{' '}
            <code className="text-cyan-300">autopilot_paused</code> audit event is recorded per
            blocked attempt. This sprint has no order path either way, so the kill switch governs
            recommendation generation, not trade execution.
          </p>
          {error && (
            <p className="mt-3 text-sm text-rose-300">
              {error}{' '}
              <button
                type="button"
                onClick={loadStatus}
                className="underline underline-offset-2 hover:text-rose-200"
              >
                Retry
              </button>
            </p>
          )}
        </div>

        <button
          type="button"
          onClick={toggleKillSwitch}
          disabled={!isKnown || pending}
          className={`inline-flex shrink-0 items-center justify-center rounded-lg px-5 py-2.5 text-sm font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
            isKnown && isOn
              ? 'bg-emerald-500 text-emerald-950 hover:bg-emerald-400'
              : 'bg-rose-500 text-rose-950 hover:bg-rose-400'
          }`}
        >
          {pending ? 'Saving...' : isKnown && isOn ? 'Turn Off (Resume)' : 'Turn On (Pause)'}
        </button>
      </div>
    </section>
  );
}
