// features/wheel/WheelPlanTab.tsx
'use client';

// WHEEL-SYSTEM-0001 (W1) -- the Wheel "Plan" tab: profile and limits, the honest worst case, and the unlock ladder.
//
// Every parameter has a default the trader can change at any time; only the changes are saved (lib/wheel/planSchema).
// The tab warns about unusual values but never blocks them; only values that break the math are refused.
// It reads live quotes and chains in the browser (TastyTrade blocks server IPs), one symbol at a time.
// It places no order and changes no position or recommendation.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { getAccessToken } from '@/lib/auth/tastytradeToken';
import { fetchWheelChain, getWheelQuote, type WheelChainResult } from '@/lib/wheel/chainSearch';
import {
  DEFAULT_PLAN_PARAMS,
  PLAN_PARAM_KEYS,
  PROFILE_LABELS,
  allocate,
  cashForOnePutCents,
  computeLimits,
  contractsThatFit,
  fitsAtAccountCents,
  formatBps,
  formatCents,
  formatPctTenths,
  formatUnlock,
  isLeveragedEtf,
  isOverridden,
  lossBudgetBps,
  maxCashPerNameCents,
  monthsToUnlock,
  pctTenthsOfAccount,
  resolveParams,
  summarizeStress,
  validateParams,
  type PlanOverrides,
  type PlanParams,
  type PlanProfile,
  type UnlockMonths,
} from '@/lib/wheel/capitalPlan';
import { classifyRow, type FetchOutcome, type RowStatus } from '@/lib/wheel/planPut';
import { MAX_OVERRIDE_CONTRACTS, MAX_WHEEL_LIST, SYMBOL_PATTERN, type WheelListEntry, type WheelPlan } from '@/lib/wheel/planSchema';

export interface WheelPlanDeps {
  getToken: () => Promise<string>;
  fetchChain: (symbol: string, token: string, window: { min: number; max: number }) => Promise<WheelChainResult>;
  fetchQuote: (symbol: string, token: string) => Promise<number | null>;
  fetchImpl: typeof fetch;
}

const defaultDeps: WheelPlanDeps = {
  getToken: () => getAccessToken(),
  fetchChain: (symbol, token, window) => fetchWheelChain(symbol, token, window),
  fetchQuote: (symbol, token) => getWheelQuote(symbol, token),
  fetchImpl: (...args) => fetch(...args),
};

const STARTER_ETFS = ['XLU', 'XLF', 'XLE', 'XLP', 'XLV'];
const SAVE_DELAY_MS = 600;
const AUTH_ERROR = /\((401|403)\)/;

type RowData = { loading: true } | { loading: false; window: string; outcome: FetchOutcome };
type SaveState = 'idle' | 'saving' | 'saved' | 'error' | 'blocked';

// ── Parameter fields ──────────────────────────────────────────────────────────────────────────────

interface FieldSpec {
  key: keyof PlanParams;
  label: string;
  help: string;
  suffix: string;
  toText: (v: number) => string;
  fromText: (t: string) => number | null;
}

const trimNumber = (n: number) => String(Number(n.toFixed(4)));
const num = (t: string) => { const n = parseFloat(t.replace(/[$,%\s]/g, '')); return Number.isFinite(n) ? n : null; };
const bpsField = (key: keyof PlanParams, label: string, help: string): FieldSpec => ({
  key, label, help, suffix: '%',
  toText: (v) => trimNumber(v / 100),
  fromText: (t) => { const n = num(t); return n === null ? null : Math.round(n * 100); },
});

const FIELDS: FieldSpec[] = [
  { key: 'accountCents', label: 'Account value', help: 'The total the plan works from. A typed number, so it does not move with the market.', suffix: '$',
    toText: (v) => trimNumber(v / 100), fromText: (t) => { const n = num(t); return n === null ? null : Math.round(n * 100); } },
  bpsField('reserveBps', 'Cash reserve', 'Never used by the plan.'),
  bpsField('spreadCapBps', 'Spread risk cap (total)', 'Most you can lose across all open spreads on names you like, added together.'),
  bpsField('singleSpreadCapBps', 'Single spread cap', 'Most any one spread may risk.'),
  bpsField('dropBps', 'Assumed drop of one stock', 'How far one holding is assumed to fall when sizing a position.'),
  bpsField('stressBps', 'Stress fall (all together)', 'The fall applied to every holding at once in the worst-case line.'),
  { key: 'targetDeltaBps', label: 'Target delta of the put', help: 'The put to price is the one nearest this delta.', suffix: 'delta',
    toText: (v) => (v / 10_000).toFixed(2), fromText: (t) => { const n = num(t); return n === null ? null : Math.round(n * 10_000); } },
  { key: 'dteMin', label: 'Days to expiry, from', help: 'Earliest expiry considered.', suffix: 'days', toText: String, fromText: (t) => { const n = num(t); return n === null ? null : Math.round(n); } },
  { key: 'dteMax', label: 'Days to expiry, to', help: 'Latest expiry considered.', suffix: 'days', toText: String, fromText: (t) => { const n = num(t); return n === null ? null : Math.round(n); } },
  bpsField('sectorLimitBps', 'Most in one sector', 'Cash tied up in one sector, as a share of the account.'),
  { key: 'monthlyGrowthBps', label: 'Assumed monthly growth', help: 'Used only for "months to unlock". A simple monthly rate; ignores losses, fees and taxes.', suffix: '% a month',
    toText: (v) => trimNumber(v / 100), fromText: (t) => { const n = num(t); return n === null ? null : Math.round(n * 100); } },
];

function displayDefault(spec: FieldSpec): string {
  return `${spec.suffix === '$' ? '$' : ''}${spec.toText(DEFAULT_PLAN_PARAMS[spec.key] as number)}${spec.suffix === '$' || spec.suffix === 'delta' ? '' : ` ${spec.suffix}`}`;
}

function ParamField({ spec, params, overrides, onCommit, onReset }: {
  spec: FieldSpec;
  params: PlanParams;
  overrides: PlanOverrides;
  onCommit: (key: keyof PlanParams, value: number) => void;
  onReset: (key: keyof PlanParams) => void;
}) {
  const current = spec.toText(params[spec.key] as number);
  const [text, setText] = useState(current);
  useEffect(() => { setText(current); }, [current]);
  const changed = isOverridden(overrides, spec.key);
  const commit = () => {
    const parsed = spec.fromText(text);
    if (parsed === null) { setText(current); return; }
    if (parsed !== params[spec.key]) onCommit(spec.key, parsed);
  };
  const id = `wheel-plan-${spec.key}`;
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="text-[11px] text-white/70">{spec.label}</label>
      <div className="flex items-center gap-2">
        {spec.suffix === '$' && <span className="text-xs text-white/40">$</span>}
        <input
          id={id}
          value={text}
          inputMode="decimal"
          onChange={(e) => setText(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
          className="w-24 rounded border border-white/10 bg-white/5 px-2 py-1 text-right text-xs focus:border-white/30 focus:outline-none"
        />
        {spec.suffix !== '$' && <span className="text-[10px] text-white/40">{spec.suffix}</span>}
        {changed ? (
          <button type="button" onClick={() => onReset(spec.key)} className="text-[10px] text-amber-300 hover:text-amber-200">
            changed (default {displayDefault(spec)}) · Reset
          </button>
        ) : (
          <span className="text-[10px] text-white/30">default</span>
        )}
      </div>
      <p className="text-[10px] text-white/35">{spec.help}</p>
    </div>
  );
}

// ── The tab ───────────────────────────────────────────────────────────────────────────────────────

export default function WheelPlanTab({ deps = defaultDeps }: { deps?: WheelPlanDeps }) {
  const [loadState, setLoadState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [overrides, setOverrides] = useState<PlanOverrides>({});
  const [wheelList, setWheelList] = useState<WheelListEntry[]>([]);
  const [saveState, setSaveState] = useState<SaveState>('idle');
  const [newSymbol, setNewSymbol] = useState('');
  const [addError, setAddError] = useState<string | null>(null);
  const [data, setData] = useState<Record<string, RowData>>({});
  const [tokenProblem, setTokenProblem] = useState(false);
  const [showAdjust, setShowAdjust] = useState(false);

  const dirty = useRef(false);
  const dataRef = useRef(data);
  dataRef.current = data;

  // ── Load the saved plan ─────────────────────────────────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await deps.fetchImpl('/api/wheel-plan');
        if (!res.ok) throw new Error(`status ${res.status}`);
        const body = (await res.json()) as { plan?: WheelPlan };
        if (cancelled) return;
        setOverrides(body.plan?.overrides ?? {});
        setWheelList(body.plan?.wheelList ?? []);
        setLoadState('ready');
      } catch {
        if (!cancelled) setLoadState('error');
      }
    })();
    return () => { cancelled = true; };
  }, [deps]);

  const params = useMemo(() => resolveParams(overrides), [overrides]);
  const validation = useMemo(() => validateParams(params), [params]);
  const hasErrors = validation.errors.length > 0;

  // ── Save (debounced), only ever the overrides and the list ──────────────────────────────────────
  useEffect(() => {
    if (loadState !== 'ready' || !dirty.current) return;
    if (hasErrors) { setSaveState('blocked'); return; }
    setSaveState('saving');
    const timer = setTimeout(async () => {
      try {
        const res = await deps.fetchImpl('/api/wheel-plan', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ overrides, wheelList }),
        });
        setSaveState(res.ok ? 'saved' : 'error');
      } catch {
        setSaveState('error');
      }
    }, SAVE_DELAY_MS);
    return () => clearTimeout(timer);
  }, [overrides, wheelList, loadState, hasErrors, deps]);

  // ── Live quotes and chains, one symbol at a time ────────────────────────────────────────────────
  // A row is "loading" until its answer lands. `inflight` records the symbols a live loop is actually fetching, so a row
  // whose loop was cancelled (a newer run started) is picked up again instead of staying on "Loading" forever.
  const windowKey = `${params.dteMin}-${params.dteMax}`;
  const symbolsKey = wheelList.map((e) => e.symbol).join(',');
  const inflight = useRef(new Set<string>());
  const [refreshTick, setRefreshTick] = useState(0);

  const loadSymbol = useCallback(async (symbol: string, run: { cancelled: boolean }) => {
    const window = { min: params.dteMin, max: params.dteMax };
    let outcome: FetchOutcome;
    try {
      const token = await deps.getToken();
      const [chainResult, quoteResult] = await Promise.allSettled([deps.fetchChain(symbol, token, window), deps.fetchQuote(symbol, token)]);
      const chain = chainResult.status === 'fulfilled' ? chainResult.value : null;
      const chainError = chainResult.status === 'rejected' ? (chainResult.reason instanceof Error ? chainResult.reason.message : 'Chain failed to load.') : null;
      if (chainError && AUTH_ERROR.test(chainError) && !run.cancelled) setTokenProblem(true);
      outcome = { quote: quoteResult.status === 'fulfilled' ? quoteResult.value : null, chain, chainError };
    } catch {
      if (!run.cancelled) setTokenProblem(true);
      outcome = { quote: null, chain: null, chainError: 'TastyTrade session missing or expired.' };
    }
    if (run.cancelled) return; // a newer run took over; this late answer is dropped and the row is re-queued
    inflight.current.delete(symbol);
    setData((prev) => ({ ...prev, [symbol]: { loading: false, window: `${window.min}-${window.max}`, outcome } }));
  }, [deps, params.dteMin, params.dteMax]);

  useEffect(() => {
    if (loadState !== 'ready' || hasErrors) return;
    const wanted = wheelList.map((e) => e.symbol).filter((s) => !isLeveragedEtf(s));
    const todo = wanted.filter((s) => {
      const row = dataRef.current[s];
      if (!row) return true;
      return row.loading ? !inflight.current.has(s) : row.window !== windowKey;
    });
    if (!todo.length) return;
    const run = { cancelled: false };
    setData((prev) => { const next = { ...prev }; for (const s of todo) next[s] = { loading: true }; return next; });
    (async () => {
      for (const symbol of todo) {
        if (run.cancelled) return;
        inflight.current.add(symbol);
        await loadSymbol(symbol, run);
      }
    })();
    return () => {
      run.cancelled = true;
      for (const s of todo) inflight.current.delete(s);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loadState, symbolsKey, windowKey, hasErrors, refreshTick]);

  const requeue = useCallback((symbols: string[]) => {
    setTokenProblem(false);
    for (const s of symbols) inflight.current.delete(s);
    setData((prev) => { const next = { ...prev }; for (const s of symbols) delete next[s]; return next; });
    setRefreshTick((t) => t + 1);
  }, []);
  const retry = useCallback((symbol: string) => requeue([symbol]), [requeue]);
  const retryAll = useCallback(() => requeue(wheelList.map((e) => e.symbol)), [requeue, wheelList]);

  // ── Edits ───────────────────────────────────────────────────────────────────────────────────────
  const setParam = (key: keyof PlanParams, value: number | PlanProfile) => {
    dirty.current = true;
    setOverrides((prev) => {
      const next: Record<string, unknown> = { ...prev };
      if (value === DEFAULT_PLAN_PARAMS[key]) delete next[key]; else next[key] = value;
      return next as PlanOverrides;
    });
  };
  const resetParam = (key: keyof PlanParams) => {
    dirty.current = true;
    setOverrides((prev) => { const next = { ...prev }; delete next[key]; return next; });
  };
  const resetAll = () => { dirty.current = true; setOverrides({}); };
  const updateList = (fn: (list: WheelListEntry[]) => WheelListEntry[]) => { dirty.current = true; setWheelList(fn); };

  const addSymbols = (symbols: string[]) => {
    const cleaned = symbols.map((s) => s.trim().toUpperCase()).filter(Boolean);
    const bad = cleaned.find((s) => !SYMBOL_PATTERN.test(s));
    if (bad) { setAddError(`"${bad}" is not a valid symbol.`); return; }
    const have = new Set(wheelList.map((e) => e.symbol));
    const fresh = cleaned.filter((s) => !have.has(s));
    if (!fresh.length) { setAddError('That symbol is already on the list.'); return; }
    if (wheelList.length + fresh.length > MAX_WHEEL_LIST) { setAddError(`The list can hold at most ${MAX_WHEEL_LIST} symbols.`); return; }
    setAddError(null);
    updateList((list) => [...list, ...fresh.map((symbol) => ({ symbol }))]);
  };

  // ── Derived plan ────────────────────────────────────────────────────────────────────────────────
  const limits = useMemo(() => (hasErrors ? null : computeLimits(params)), [params, hasErrors]);

  const rows = useMemo(() => {
    if (hasErrors || !limits) return [];
    return wheelList.map((entry) => {
      if (isLeveragedEtf(entry.symbol)) return { entry, kind: 'leveraged' as const };
      const row = data[entry.symbol];
      if (!row || row.loading) return { entry, kind: 'loading' as const };
      const status: RowStatus = classifyRow(row.outcome, params.targetDeltaBps);
      if (status.kind !== 'ok') return { entry, kind: 'state' as const, status, quote: row.outcome.quote };
      const cashCents = cashForOnePutCents(status.put.leg.strikePrice);
      const dropBps = entry.dropBps ?? params.dropBps;
      const maxCash = maxCashPerNameCents(params, dropBps);
      const fitsAt = fitsAtAccountCents(cashCents, params, dropBps);
      return {
        entry, kind: 'ok' as const, status, quote: row.outcome.quote, cashCents, maxCash,
        fit: contractsThatFit(maxCash, cashCents), fitsAt,
        fitsConcentrated: cashCents <= maxCashPerNameCents({ ...params, profile: 'concentrated' }, dropBps), unlock: monthsToUnlock(fitsAt, params.accountCents, params.monthlyGrowthBps),
      };
    });
  }, [wheelList, data, params, limits, hasErrors]);

  const allocation = useMemo(() => {
    if (!limits) return null;
    const okRows = rows.filter((r): r is Extract<typeof r, { kind: 'ok' }> => r.kind === 'ok');
    return allocate(
      okRows.map((r) => ({ symbol: r.entry.symbol, sector: (r.entry.sector || r.entry.symbol).toUpperCase(), cashCents: r.cashCents, maxCashCents: r.maxCash, forcedContracts: r.entry.contracts })),
      limits.wheelCashCents,
      limits.sectorLimitCents,
    );
  }, [rows, limits]);

  const stress = useMemo(() => (limits && allocation ? summarizeStress(params, limits, allocation.deployedCents) : null), [params, limits, allocation]);
  const inPlan = (symbol: string) => allocation?.rows.find((r) => r.symbol === symbol)?.contracts ?? 0;
  const isForced = (symbol: string) => allocation?.rows.find((r) => r.symbol === symbol)?.forced ?? false;

  // Warnings for the trader's own contract counts: shown, never blocking.
  const overrideWarnings = useMemo(() => {
    if (!limits || !allocation) return [] as string[];
    const out: string[] = [];
    for (const row of rows) {
      if (row.kind !== 'ok' || !row.entry.contracts) continue;
      const total = row.entry.contracts * row.cashCents;
      if (total <= row.maxCash) continue;
      const drop = row.entry.dropBps ?? params.dropBps;
      const lossCents = Math.round((total * drop) / 10_000);
      out.push(
        `${row.entry.symbol}: ${row.entry.contracts} contract${row.entry.contracts === 1 ? '' : 's'} tie${row.entry.contracts === 1 ? 's' : ''} up ${formatCents(total)} (${formatPctTenths(pctTenthsOfAccount(total, params.accountCents))} of the account), above your ${formatCents(row.maxCash)} limit for one name. ` +
        `A ${formatBps(drop)} fall would cost ${formatCents(lossCents)} (${formatPctTenths(pctTenthsOfAccount(lossCents, params.accountCents))} of the account), above your ${formatBps(limits.lossBudgetBps)} budget.`,
      );
    }
    if (allocation.deployedCents > limits.wheelCashCents) {
      out.push(`The plan uses ${formatCents(allocation.deployedCents)}, ${formatCents(allocation.deployedCents - limits.wheelCashCents)} more than your ${formatCents(limits.wheelCashCents)} of wheel cash. The extra comes out of your spread cap or reserve.`);
    }
    for (const [sector, cents] of Object.entries(allocation.bySector)) {
      if (cents > limits.sectorLimitCents) out.push(`${sector} holds ${formatCents(cents)}, above your ${formatCents(limits.sectorLimitCents)} sector limit.`);
    }
    return out;
  }, [rows, limits, allocation, params]);

  // ── Render ──────────────────────────────────────────────────────────────────────────────────────
  if (loadState === 'loading') return <p className="text-sm text-white/40">Loading your plan…</p>;
  if (loadState === 'error') {
    return (
      <p className="text-sm text-red-300">
        Your saved plan could not be loaded. Nothing was changed. Reload the page to try again.
      </p>
    );
  }

  const profile = params.profile;
  const saveText: Record<SaveState, string> = {
    idle: '', saving: 'Saving…', saved: 'Saved', error: 'Could not save. Your changes are still on screen.', blocked: 'Not saved: fix the values below first.',
  };
  const changedCount = PLAN_PARAM_KEYS.filter((k) => isOverridden(overrides, k)).length;
  const adjustOpen = showAdjust || hasErrors;
  const missingStarters = STARTER_ETFS.filter((sym) => !wheelList.some((e) => e.symbol === sym));
  const loss = (cents: number) => (cents === 0 ? formatCents(0) : `−${formatCents(cents)}`);

  // One card per profile with the figures that matter side by side (as in the approved mock).
  const profileCards = (['careful', 'balanced', 'concentrated', 'custom'] as PlanProfile[]).map((p) => {
    const pp: PlanParams = { ...params, profile: p };
    const l = computeLimits(pp);
    return {
      p,
      lossCents: Math.floor((lossBudgetBps(pp) * params.accountCents) / 10_000),
      maxCash: l.maxCashPerNameCents,
      strike: l.highestStrikeDollars,
      names: limits && l.maxCashPerNameCents > 0 ? Math.ceil(limits.wheelCashCents / l.maxCashPerNameCents) : 0,
      lossBps: lossBudgetBps(pp),
    };
  });
  const PROFILE_NOTE: Record<PlanProfile, string> = {
    careful: 'Smallest positions and the widest spread across names.',
    balanced: 'The recommended starting point.',
    concentrated: 'Opens bigger names, but one bad name hurts more.',
    custom: 'Set your own loss budget below.',
  };

  return (
    <div className="space-y-6" data-testid="wheel-plan-tab">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="max-w-3xl text-xs text-white/50">
          What fits your account today, and when the names you like unlock. Defaults are recommendations; change anything, any time.
        </p>
        <span aria-live="polite" className="text-[11px] text-white/40">{saveText[saveState]}</span>
      </div>

      {validation.errors.map((e) => <p key={e} role="alert" className="text-xs text-red-300">{e}</p>)}
      {validation.warnings.map((w) => <p key={w} className="text-xs text-amber-300">{w}</p>)}

      {/* 1. Profile cards */}
      <section className="space-y-3" aria-label="Profile">
        <h2 className="text-[10px] font-bold uppercase tracking-wider text-white/40">How much one bad name may cost you</h2>
        <div role="radiogroup" aria-label="Profile" className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {profileCards.map((c) => {
            const selected = profile === c.p;
            return (
              <button
                key={c.p}
                type="button"
                role="radio"
                aria-checked={selected}
                onClick={() => setParam('profile', c.p)}
                className={`flex flex-col gap-2 rounded-lg border p-4 text-left ${selected ? 'border-teal-400/60 bg-teal-400/5' : 'border-white/10 hover:border-white/25'}`}
              >
                <span className="flex items-center justify-between gap-2 text-sm font-bold">
                  {PROFILE_LABELS[c.p]}
                  <span className={`rounded-full border px-2 py-0.5 text-[10px] ${c.p === 'balanced' ? 'border-emerald-500/40 text-emerald-300' : 'border-white/15 text-white/50'}`}>
                    {formatBps(c.lossBps)} per name{c.p === 'balanced' ? ', recommended' : ''}
                  </span>
                </span>
                <dl className="grid grid-cols-[1fr_auto] gap-x-3 gap-y-1 text-[11px]">
                  <dt className="text-white/45">Loss if one name falls {formatBps(params.dropBps)}</dt><dd className="text-right">{formatCents(c.lossCents)}</dd>
                  <dt className="text-white/45">Cash on one name</dt><dd className="text-right">{formatCents(c.maxCash)}</dd>
                  <dt className="text-white/45">Highest put strike</dt><dd className="text-right">${c.strike}</dd>
                  <dt className="text-white/45">Names to fill wheel cash</dt><dd className="text-right">{c.names || '—'}</dd>
                </dl>
                <span className="text-[10px] text-white/40">{PROFILE_NOTE[c.p]}</span>
              </button>
            );
          })}
        </div>
        {profile === 'custom' && (
          <ParamField
            spec={bpsField('customLossBps', 'Custom loss budget per name', 'Share of the account you accept losing if one name falls by the assumed drop.')}
            params={params} overrides={overrides} onCommit={setParam} onReset={resetParam}
          />
        )}
      </section>

      {limits && stress && allocation && (
        <>
          {/* 2. Limits and worst case, side by side */}
          <section className="grid gap-4 lg:grid-cols-2">
            <div className="space-y-2 rounded-lg border border-white/10 p-4 text-xs" data-testid="wheel-plan-limits">
              <h2 className="text-[10px] font-bold uppercase tracking-wider text-white/40">Common to every profile</h2>
              <dl className="grid grid-cols-[1fr_auto] gap-x-6 gap-y-1">
                <dt className="text-white/60">Cash reserve ({formatBps(params.reserveBps)})</dt><dd className="text-right">{formatCents(limits.reserveCents)}</dd>
                <dt className="text-white/60">Spread risk cap ({formatBps(params.spreadCapBps)}, {formatCents(limits.singleSpreadCents)} each)</dt><dd className="text-right">{formatCents(limits.spreadCapCents)}</dd>
                <dt className="font-bold">Wheel cash</dt><dd className="text-right font-bold">{formatCents(limits.wheelCashCents)}</dd>
                <dt className="text-white/60">Most cash on one name</dt><dd className="text-right">{formatCents(limits.maxCashPerNameCents)}</dd>
                <dt className="text-white/60">Highest put strike that fits</dt><dd className="text-right">${limits.highestStrikeDollars}</dd>
                <dt className="text-white/60">Most in one sector ({formatBps(params.sectorLimitBps)})</dt><dd className="text-right">{formatCents(limits.sectorLimitCents)}</dd>
              </dl>
            </div>

            <div className="space-y-2 rounded-lg border border-white/10 p-4 text-xs" aria-label="Worst case">
              <h2 className="text-[10px] font-bold uppercase tracking-wider text-white/40">
                Stress test: every holding falls {formatBps(params.stressBps)} together
              </h2>
              <dl className="grid grid-cols-[1fr_auto] gap-x-6 gap-y-1">
                <dt className="text-white/60">Today ({formatCents(stress.deployedCents)} in the plan)</dt>
                <dd className="text-right">{loss(stress.wheelLossCents)} ({formatPctTenths(stress.wheelLossPctTenths)})</dd>
                <dt className="text-white/60">Wheel fully deployed ({formatCents(stress.fullWheelCents)})</dt>
                <dd className="text-right">{loss(stress.fullWheelLossCents)} ({formatPctTenths(stress.fullWheelLossPctTenths)})</dd>
                <dt className="font-bold">Plus spreads at full loss ({formatCents(stress.spreadCapCents)})</dt>
                <dd className="text-right font-bold text-amber-300">{loss(stress.worstCaseCents)} ({formatPctTenths(stress.worstCasePctTenths)})</dd>
              </dl>
              <p className="text-[10px] text-white/40">A rough worst case, not a forecast. It needs everything to go wrong at once, and sector ETFs can fall further than this in a crash.</p>
            </div>
          </section>

          {/* 3. Unlock ladder */}
          <section className="space-y-3">
            <h2 className="text-[10px] font-bold uppercase tracking-wider text-white/40">Unlock ladder: what fits now, and what you grow into</h2>
            {tokenProblem && (
              <div role="alert" className="flex items-center gap-3 rounded border border-amber-400/40 bg-amber-400/5 p-3 text-xs text-amber-200">
                <span>Reconnect TastyTrade: your session is missing or expired, so live prices could not load.</span>
                <button type="button" onClick={retryAll} className="rounded border border-amber-400/40 px-2 py-1 text-[11px] hover:bg-amber-400/10">Retry all</button>
              </div>
            )}
            <div className="flex flex-wrap items-center gap-2">
              <input
                value={newSymbol}
                onChange={(e) => setNewSymbol(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') { addSymbols([newSymbol]); setNewSymbol(''); } }}
                placeholder="Add symbol (e.g. XLF)"
                aria-label="Add symbol"
                className="w-44 rounded border border-white/10 bg-white/5 px-3 py-2 text-sm focus:border-white/30 focus:outline-none"
              />
              <button type="button" onClick={() => { addSymbols([newSymbol]); setNewSymbol(''); }} className="rounded bg-white/10 px-3 py-2 text-xs font-bold hover:bg-white/15">Add</button>
              {missingStarters.length > 0 && (
                <button type="button" onClick={() => addSymbols(missingStarters)} className="text-xs text-teal-300 hover:text-teal-200">
                  {wheelList.length === 0 ? 'Add starter ETFs' : 'Add remaining starter ETFs'} ({missingStarters.join(', ')})
                </button>
              )}
              {addError && <span role="alert" className="text-xs text-red-300">{addError}</span>}
            </div>

            {overrideWarnings.map((w) => <p key={w} className="text-xs text-amber-300">{w}</p>)}
            {wheelList.length === 0 ? (
              <p className="text-sm text-white/40">Add a symbol to see the cash one put needs, whether it fits, and when it unlocks.</p>
            ) : (
              <div className="overflow-x-auto rounded-lg border border-white/10">
                <table className="w-full min-w-[980px] text-xs">
                  <thead>
                    <tr className="bg-white/5 text-[10px] uppercase tracking-wider text-white/40">
                      <th className="px-3 py-2 text-left">Stock</th>
                      <th className="px-3 py-2 text-left">Sector</th>
                      <th className="px-3 py-2 text-right">Price</th>
                      <th className="px-3 py-2 text-left">Put priced</th>
                      <th className="px-3 py-2 text-right">Cash for one put</th>
                      <th className="px-3 py-2 text-right">Fits</th>
                      <th className="px-3 py-2 text-right">In plan</th>
                      <th className="px-3 py-2 text-right">Your contracts</th>
                      <th className="px-3 py-2 text-right">Fits at account</th>
                      <th className="px-3 py-2 text-left">Today</th>
                      <th className="px-3 py-2" />
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((row) => (
                      <tr key={row.entry.symbol} className="border-t border-white/5" data-testid={`ladder-row-${row.entry.symbol}`}>
                        <td className="px-3 py-2 font-bold">{row.entry.symbol}</td>
                        <td className="px-3 py-2">
                          <input
                            aria-label={`Sector for ${row.entry.symbol}`}
                            defaultValue={row.entry.sector ?? ''}
                            placeholder="own sector"
                            onBlur={(e) => {
                              const sector = e.target.value.trim().slice(0, 32);
                              if (sector === (row.entry.sector ?? '')) return;
                              updateList((list) => list.map((x) => (x.symbol === row.entry.symbol ? { ...x, sector: sector || undefined } : x)));
                            }}
                            className="w-28 rounded border border-white/10 bg-white/5 px-2 py-1 text-xs focus:border-white/30 focus:outline-none"
                          />
                        </td>
                        {row.kind === 'ok' || row.kind === 'state' ? (
                          <td className="px-3 py-2 text-right">{row.quote != null ? `$${row.quote.toFixed(2)}` : 'unavailable'}</td>
                        ) : <td className="px-3 py-2 text-right text-white/30">—</td>}
                        {row.kind === 'ok' && (
                          <>
                            <td className="px-3 py-2">{row.status.kind === 'ok' && `${row.status.put.leg.strikePrice}P · ${row.status.put.expirationDate} · Δ${(row.status.put.deltaBps / 10_000).toFixed(2)}`}</td>
                            <td className="px-3 py-2 text-right">{formatCents(row.cashCents)}</td>
                            <td className="px-3 py-2 text-right">{row.fit}</td>
                            <td className="px-3 py-2 text-right font-bold">{inPlan(row.entry.symbol)}</td>
                            <td className="px-3 py-2 text-right">
                              <input
                                key={`${row.entry.symbol}-${row.entry.contracts ?? 'auto'}`}
                                aria-label={`Contracts for ${row.entry.symbol}`}
                                defaultValue={row.entry.contracts ?? ''}
                                placeholder="auto"
                                inputMode="numeric"
                                onBlur={(e) => {
                                  const text = e.target.value.trim();
                                  const n = text === '' ? undefined : Number.parseInt(text, 10);
                                  if (n !== undefined && !(Number.isInteger(n) && n >= 1 && n <= MAX_OVERRIDE_CONTRACTS)) { e.target.value = String(row.entry.contracts ?? ''); return; }
                                  if (n === row.entry.contracts) return;
                                  updateList((list) => list.map((x) => (x.symbol === row.entry.symbol ? { ...x, contracts: n } : x)));
                                }}
                                onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
                                className="w-16 rounded border border-white/10 bg-white/5 px-2 py-1 text-right text-xs focus:border-white/30 focus:outline-none"
                              />
                            </td>
                            <td className="px-3 py-2 text-right">{formatCents(row.fitsAt)}</td>
                            <td className="px-3 py-2">
                              {isForced(row.entry.symbol) ? (
                                <span className="rounded-full border border-amber-500/40 px-2 py-0.5 text-[10px] font-bold text-amber-300">Your override</span>
                              ) : row.unlock.kind === 'fits' ? (
                                <span className="rounded-full border border-emerald-500/40 px-2 py-0.5 text-[10px] font-bold text-emerald-300">Wheel now</span>
                              ) : row.fitsConcentrated ? (
                                <span className="rounded-full border border-amber-500/40 px-2 py-0.5 text-[10px] font-bold text-amber-300">Concentrated only</span>
                              ) : (
                                <span className="rounded-full border border-white/15 px-2 py-0.5 text-[10px] font-bold text-white/60">Unlocks in {formatUnlock(row.unlock as UnlockMonths)}</span>
                              )}
                            </td>
                          </>
                        )}
                        {row.kind === 'loading' && <td colSpan={7} className="px-3 py-2 text-white/40">Loading…</td>}
                        {row.kind === 'leveraged' && <td colSpan={7} className="px-3 py-2 text-amber-300">Not a wheel candidate: a leveraged or inverse ETF can fall far more than 30% in a month. Small put spreads only.</td>}
                        {row.kind === 'state' && (
                          <td colSpan={7} className="px-3 py-2">
                            {row.status.kind === 'chain-error' && <span className="text-red-300">Chain error: {row.status.message}</span>}
                            {row.status.kind === 'quote-unavailable' && <span className="text-amber-300">Quote unavailable, and no put was found. Retry.</span>}
                            {row.status.kind === 'no-put' && <span className="text-white/50">No put found near delta {(params.targetDeltaBps / 10_000).toFixed(2)} in {params.dteMin} to {params.dteMax} days.</span>}
                          </td>
                        )}
                        <td className="whitespace-nowrap px-3 py-2 text-right">
                          {(row.kind === 'state') && <button type="button" onClick={() => retry(row.entry.symbol)} className="mr-2 text-[10px] text-blue-300 hover:text-blue-200">Retry</button>}
                          <button type="button" aria-label={`Remove ${row.entry.symbol}`} onClick={() => updateList((list) => list.filter((x) => x.symbol !== row.entry.symbol))} className="text-white/40 hover:text-red-300">✕</button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <p className="text-[10px] text-white/40">
              Cash for one put is the strike times 100 at the put nearest delta {(params.targetDeltaBps / 10_000).toFixed(2)}. "Fits at account" is the account size at which one contract first fits your chosen profile, and "Wheel now" means it fits today.
              Cash goes to names in list order until ranking arrives. No open-interest or spread filter is applied yet.
            </p>
          </section>
        </>
      )}

      {/* 4. Adjust any default (collapsed until you change something or hit an error) */}
      <section className="space-y-3 rounded-lg border border-white/10 p-4">
        <button
          type="button"
          aria-expanded={adjustOpen}
          onClick={() => setShowAdjust((v) => !v)}
          className="flex w-full items-center justify-between text-left text-xs font-bold text-white/70 hover:text-white"
        >
          <span>Adjust any default{changedCount ? ` (${changedCount} changed)` : ''}</span>
          <span aria-hidden="true">{adjustOpen ? '▾' : '▸'}</span>
        </button>
        {adjustOpen && (
          <>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {FIELDS.map((spec) => (
                <ParamField key={spec.key} spec={spec} params={params} overrides={overrides} onCommit={setParam} onReset={resetParam} />
              ))}
            </div>
            <button type="button" onClick={resetAll} className="text-[11px] text-white/50 hover:text-white/80">Reset all to defaults</button>
          </>
        )}
      </section>

      <p className="text-[10px] text-white/30">Guidance from TradeEdge rules. You decide; no orders are placed automatically.</p>
    </div>
  );
}
