'use client';
// app/settings/scan-defaults/page.tsx
//
// SCREENER-PREFS-0001 -- Diane's mock (2026-09-21): "Scan Defaults" settings
// page, three groups (General / Delta by strategy / Scan behavior), each
// field editable inline with an "Any" pill to clear, no save button --
// edits apply immediately with a brief "Saved" confirmation, same pattern
// the post-scan result chips already use.

import { useEffect, useState } from 'react';
import type { DeltaStrategy, ModeStrategy, ScanMode, ScanPreferences } from '@/lib/screener/scanPreferences';
import { EMPTY_SCAN_PREFERENCES } from '@/lib/screener/scanPreferences';

type Theme = 'dark' | 'medium' | 'light';
const LS_THEME = 'hunter-theme';
const THEMES = {
  dark: { bg: 'bg-[#080c14]', border: 'border-slate-700', header: 'bg-gradient-to-r from-[#0d1117] to-[#080c14]', text: 'text-white', textMuted: 'text-slate-200', textFaint: 'text-slate-400', input: 'bg-slate-800', card: 'bg-slate-900/60', label: 'text-slate-300' },
  medium: { bg: 'bg-[#1a1f2e]', border: 'border-slate-600', header: 'bg-gradient-to-r from-[#1e2436] to-[#1a1f2e]', text: 'text-white', textMuted: 'text-slate-200', textFaint: 'text-slate-400', input: 'bg-[#1a1f2e]', card: 'bg-[#222840]/80', label: 'text-slate-300' },
  light: { bg: 'bg-slate-50', border: 'border-slate-300', header: 'bg-gradient-to-r from-slate-800 to-slate-900', text: 'text-slate-950', textMuted: 'text-slate-900', textFaint: 'text-slate-700', input: 'bg-slate-50', card: 'bg-white', label: 'text-slate-800' },
};
function getSavedTheme(): Theme {
  try { const t = localStorage.getItem(LS_THEME); return (t === 'dark' || t === 'medium' || t === 'light') ? t : 'dark'; }
  catch { return 'dark'; }
}

const DELTA_STRATEGIES: { key: DeltaStrategy; label: string }[] = [
  { key: 'csp', label: 'CSP' }, { key: 'ic', label: 'Iron Condor' }, { key: 'spreads', label: 'Spreads' },
];
const MODE_STRATEGIES: { key: ModeStrategy; label: string }[] = [{ key: 'csp', label: 'CSP' }, { key: 'spreads', label: 'Spreads' }];
// Default sort field is in the ticket's scope but not yet built in this
// increment -- the schema and page have no sort-field row yet; see the
// implementation report's "not yet done" list.

type Th = typeof THEMES[Theme];

function Section({ title, children, th }: { title: string; children: React.ReactNode; th: Th }) {
  return (
    <div className={`border ${th.border} ${th.card} rounded-xl p-6 space-y-3`}>
      <h2 className={`text-xs font-bold tracking-widest ${th.textMuted} uppercase border-b ${th.border} pb-2`}>{title}</h2>
      {children}
    </div>
  );
}

/** A single numeric field with an "Any" pill to clear it, saving immediately on blur/Enter. */
function NumberRow({ label, value, onSave, th, max = 100_000, testId }: {
  label: string; value: number | null; onSave: (v: number | null) => Promise<void>; th: Th; max?: number; testId: string;
}) {
  const [draft, setDraft] = useState(value == null ? '' : String(value));
  const [saved, setSaved] = useState(false);
  useEffect(() => setDraft(value == null ? '' : String(value)), [value]);

  const commit = async (next: number | null) => {
    await onSave(next);
    setSaved(true);
    setTimeout(() => setSaved(false), 1200);
  };
  const onBlur = () => {
    const trimmed = draft.trim();
    if (trimmed === '') return void commit(null);
    const n = Number(trimmed);
    if (!Number.isFinite(n) || n < 0 || n > max) { setDraft(value == null ? '' : String(value)); return; }
    void commit(n);
  };

  return (
    <div className={`flex items-center justify-between gap-3 py-2 border-b ${th.border} last:border-0`}>
      <span className={`text-[11px] ${th.label}`}>{label}</span>
      <div className="flex items-center gap-2">
        <input
          aria-label={label}
          data-testid={testId}
          value={draft}
          placeholder="Any"
          onChange={e => setDraft(e.target.value)}
          onBlur={onBlur}
          onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
          className={`w-20 text-[11px] ${th.input} border ${th.border} rounded px-2 py-1 ${th.text} focus:outline-none text-right`}
        />
        {value != null && (
          <button
            aria-label={`Clear ${label}`}
            onClick={() => { setDraft(''); void commit(null); }}
            className={`text-[9px] px-2 py-1 rounded border ${th.border} ${th.textFaint} hover:border-amber-500/50`}
          >Any</button>
        )}
        {saved && <span className="text-[9px] text-emerald-400" role="status">Saved</span>}
      </div>
    </div>
  );
}

function DeltaRow({ label, value, onSave, th, testId }: {
  label: string; value: { min: number; max: number } | undefined; onSave: (v: { min: number; max: number } | null) => Promise<void>; th: Th; testId: string;
}) {
  const [min, setMin] = useState(value?.min != null ? String(value.min) : '');
  const [max, setMax] = useState(value?.max != null ? String(value.max) : '');
  const [saved, setSaved] = useState(false);
  useEffect(() => { setMin(value?.min != null ? String(value.min) : ''); setMax(value?.max != null ? String(value.max) : ''); }, [value?.min, value?.max]);

  const commitPair = async (nextMin: string, nextMax: string) => {
    if (nextMin.trim() === '' && nextMax.trim() === '') { await onSave(null); setSaved(true); setTimeout(() => setSaved(false), 1200); return; }
    const mn = Number(nextMin);
    const mx = Number(nextMax);
    if (!Number.isFinite(mn) || !Number.isFinite(mx) || mn < 0 || mx > 1 || mn > mx) return;
    await onSave({ min: mn, max: mx });
    setSaved(true);
    setTimeout(() => setSaved(false), 1200);
  };

  return (
    <div className={`flex items-center justify-between gap-3 py-2 border-b ${th.border} last:border-0`}>
      <span className={`text-[11px] ${th.label} w-28`}>{label}</span>
      <div className="flex items-center gap-2">
        <input aria-label={`${label} minimum delta`} data-testid={`${testId}-min`} value={min} placeholder="Any"
          onChange={e => setMin(e.target.value)} onBlur={() => void commitPair(min, max)}
          className={`w-16 text-[11px] ${th.input} border ${th.border} rounded px-2 py-1 ${th.text} focus:outline-none text-right`} />
        <span className={th.textFaint}>–</span>
        <input aria-label={`${label} maximum delta`} data-testid={`${testId}-max`} value={max} placeholder="Any"
          onChange={e => setMax(e.target.value)} onBlur={() => void commitPair(min, max)}
          className={`w-16 text-[11px] ${th.input} border ${th.border} rounded px-2 py-1 ${th.text} focus:outline-none text-right`} />
        {value && (
          <button aria-label={`Clear ${label} delta`} onClick={() => { setMin(''); setMax(''); void commitPair('', ''); }}
            className={`text-[9px] px-2 py-1 rounded border ${th.border} ${th.textFaint} hover:border-amber-500/50`}>Any</button>
        )}
        {saved && <span className="text-[9px] text-emerald-400" role="status">Saved</span>}
      </div>
    </div>
  );
}

function ModeRow({ label, value, onSave, th, testId }: {
  label: string; value: ScanMode | undefined; onSave: (v: ScanMode | null) => Promise<void>; th: Th; testId: string;
}) {
  return (
    <div className={`flex items-center justify-between gap-3 py-2 border-b ${th.border} last:border-0`}>
      <span className={`text-[11px] ${th.label}`}>{label}</span>
      <select
        aria-label={`${label} default mode`}
        data-testid={testId}
        value={value ?? ''}
        onChange={e => void onSave(e.target.value === '' ? null : (e.target.value as ScanMode))}
        className={`text-[11px] ${th.input} border ${th.border} rounded px-2 py-1 ${th.text} focus:outline-none`}
      >
        <option value="">Any (app default)</option>
        <option value="rank">Rank</option>
        <option value="targeted">Targeted</option>
      </select>
    </div>
  );
}

export default function ScanDefaultsPage() {
  const [theme, setTheme] = useState<Theme>('dark');
  useEffect(() => setTheme(getSavedTheme()), []);
  const th = THEMES[theme];

  const [prefs, setPrefs] = useState<ScanPreferences>(EMPTY_SCAN_PREFERENCES);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);

  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const res = await fetch('/api/screener/preferences');
        if (!res.ok) throw new Error('failed');
        const data = await res.json();
        if (alive) setPrefs(data.preferences ?? EMPTY_SCAN_PREFERENCES);
      } catch {
        if (alive) setLoadError(true);
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => { alive = false; };
  }, []);

  const save = async (patch: Record<string, unknown>): Promise<void> => {
    const res = await fetch('/api/screener/preferences', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(patch) });
    if (!res.ok) return;
    const data = await res.json();
    if (data.preferences) setPrefs(data.preferences);
  };

  const saveGlobal = (field: keyof ScanPreferences) => (v: number | null) => save({ [field]: v });
  const saveDelta = (strategy: DeltaStrategy) => (v: { min: number; max: number } | null) => save({ delta: { [strategy]: v } });
  const saveMode = (strategy: ModeStrategy) => (v: ScanMode | null) => save({ defaultMode: { [strategy]: v } });

  return (
    <div className={`min-h-screen ${th.bg} font-sans transition-colors duration-200`}>
      <div className={`${th.header} border-b ${th.border} px-6 py-4`}>
        <a href="/screener" className={`text-[10px] ${th.textFaint} hover:text-blue-400 transition-colors tracking-wider`}>← Back to SCREENER</a>
        <h1 className="text-base font-bold tracking-widest text-white mt-1">SCAN DEFAULTS</h1>
        <p className="text-[10px] text-white/50 tracking-wider">Default values for scan and result filters. Every value here is still fully editable in the moment on the scan screens -- this only changes where they start.</p>
      </div>

      <main className="px-6 py-6 max-w-3xl mx-auto space-y-6">
        {loadError && (
          <div className={`border border-amber-700/40 bg-amber-500/10 rounded-lg px-4 py-2 text-[11px] text-amber-300`} role="alert">
            Your saved preferences could not be loaded right now. The scan screens will use their normal defaults.
          </div>
        )}
        {loading ? (
          <p className={`text-[11px] ${th.textFaint}`}>Loading…</p>
        ) : (
          <>
            <Section title="General" th={th}>
              <NumberRow label="DTE minimum" value={prefs.dteMin} onSave={saveGlobal('dteMin')} th={th} max={365} testId="pref-dte-min" />
              <NumberRow label="DTE maximum" value={prefs.dteMax} onSave={saveGlobal('dteMax')} th={th} max={730} testId="pref-dte-max" />
              <NumberRow label="Open interest minimum" value={prefs.oiMin} onSave={saveGlobal('oiMin')} th={th} testId="pref-oi-min" />
              <NumberRow label="Credit ratio minimum (%)" value={prefs.creditRatioMin} onSave={saveGlobal('creditRatioMin')} th={th} max={100} testId="pref-credit-ratio-min" />
              <NumberRow label="POP minimum (%)" value={prefs.popMin} onSave={saveGlobal('popMin')} th={th} max={100} testId="pref-pop-min" />
              <NumberRow label="OTM minimum (%)" value={prefs.otmMin} onSave={saveGlobal('otmMin')} th={th} max={100} testId="pref-otm-min" />
            </Section>

            <Section title="Delta, by strategy" th={th}>
              <p className={`text-[10px] ${th.textFaint} mb-1`}>Each strategy keeps its own delta default -- CSP, Iron Condor and Spreads have different structural risk bands and are never shared.</p>
              {DELTA_STRATEGIES.map(({ key, label }) => (
                <DeltaRow key={key} label={label} value={prefs.delta[key]} onSave={saveDelta(key)} th={th} testId={`pref-delta-${key}`} />
              ))}
            </Section>

            <Section title="Scan behavior" th={th}>
              <p className={`text-[10px] ${th.textFaint} mb-1`}>Default launch mode. CC and PMCC always use their own scan mode and are not shown here.</p>
              {MODE_STRATEGIES.map(({ key, label }) => (
                <ModeRow key={key} label={`${label} default mode`} value={prefs.defaultMode[key]} onSave={saveMode(key)} th={th} testId={`pref-mode-${key}`} />
              ))}
            </Section>
          </>
        )}
      </main>
    </div>
  );
}
