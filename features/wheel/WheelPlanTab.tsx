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
  maxCashPerNameCents,
  monthsToUnlock,
  resolveParams,
  summarizeStress,
  validateParams,
  type PlanOverrides,
  type PlanParams,
  type PlanProfile,
  type UnlockMonths,
} from '@/lib/wheel/capitalPlan';
import { classifyRow, type FetchOutcome, type RowStatus } from '@/lib/wheel/planPut';
import { MAX_WHEEL_LIST, SYMBOL_PATTERN, type WheelListEntry, type WheelPlan } from '@/lib/wheel/planSchema';

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
  bpsField('sectorLimitBps', 'Most in one sector', 'Cash tied up in one sector, as a share of the account.'),
  { key: 'targetDeltaBps', label: 'Target delta of the put', help: 'The put to price is the one nearest this delta.', suffix: 'delta',
    toText: (v) => (v / 10_000).toFixed(2), fromText: (t) => { const n = num(t); return n === null ? null : Math.round(n * 10_000); } },
  { key: 'dteMin', label: 'Days to expiry, from', help: 'Earliest expiry considered.', suffix: 'days', toText: String, fromText: (t) => { const n = num(t); return n === null ? null : Math.round(n); } },
  { key: 'dteMax', label: 'Days to expiry, to', help: 'Latest expiry considered.', suffix: 'days', toText: String, fromText: (t) => { const n = num(t); return n === null ? null : Math.round(n); } },
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
        fit: contractsThatFit(maxCash, cashCents), fitsAt, unlock: monthsToUnlock(fitsAt, params.accountCents, params.monthlyGrowthBps),
      };
    });
  }, [wheelList, data, params, limits, hasErrors]);

  const allocation = useMemo(() => {
    if (!limits) return null;
    const okRows = rows.filter((r): r is Extract<typeof r, { kind: 'ok' }> => r.kind === 'ok');
    return allocate(
      okRows.map((r) => ({ symbol: r.entry.symbol, sector: (r.entry.sector || r.entry.symbol).toUpperCase(), cashCents: r.cashCents, maxCashCents: r.maxCash })),
      limits.wheelCashCents,
      limits.sectorLimitCents,
    );
  }, [rows, limits]);

  const stress = useMemo(() => (limits && allocation ? summarizeStress(params, limits, allocation.deployedCents) : null), [params, limits, allocation]);
  const inPlan = (symbol: string) => allocation?.rows.find((r) => r.symbol === symbol)?.contracts ?? 0;

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
    idle: '', saving: 'Saving…', saved: 'Saved', error: 'Could not save. Your changes are still on screen.', blocked: 'Not saved: fix the values above first.',
  };

  return (
    <div className="space-y-6" data-testid="wheel-plan-tab">
      <p className="text-xs text-white/50">
        The plan turns your account size and a loss limit into what fits today, and when the names you like unlock. Defaults are recommendations; change anything, any time.
      </p>

      {/* Profile */}
      <section className="space-y-3">
        <h2 className="text-[10px] font-bold uppercase tracking-wider text-white/40">How much one bad name may cost you</h2>
        <div role="radiogroup" aria-label="Profile" className="flex flex-wrap gap-2">
          {(['careful', 'balanced', 'concentrated', 'custom'] as PlanProfile[]).map((p) => (
            <button
              key={p}
              type="button"
              role="radio"
              aria-checked={profile === p}
              onClick={() => setParam('profile', p)}
              className={`rounded border px-3 py-2 text-xs ${profile === p ? 'border-teal-400/60 bg-teal-400/10 text-white' : 'border-white/10 text-white/60 hover:text-white/80'}`}
            >
              {PROFILE_LABELS[p]}{p === 'careful' ? ' · 6%' : p === 'balanced' ? ' · 9% (recommended)' : p === 'concentrated' ? ' · 12%' : ''}
            </button>
          ))}
        </div>
        {profile === 'custom' && (
          <ParamField
            spec={bpsField('customLossBps', 'Custom loss budget per name', 'Share of the account you accept losing if one name falls by the assumed drop.')}
            params={params} overrides={overrides} onCommit={setParam} onReset={resetParam}
          />
        )}
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {FIELDS.map((spec) => (
            <ParamField key={spec.key} spec={spec} params={params} overrides={overrides} onCommit={setParam} onReset={resetParam} />
          ))}
        </div>
        <div className="flex items-center gap-4 text-[11px]">
          <button type="button" onClick={resetAll} className="text-white/50 hover:text-white/80">Reset all to defaults</button>
          <span aria-live="polite" className="text-white/40">{saveText[saveState]}</span>
        </div>
        {validation.errors.map((e) => <p key={e} role="alert" className="text-xs text-red-300">{e}</p>)}
        {validation.warnings.map((w) => <p key={w} className="text-xs text-amber-300">{w}</p>)}
      </section>

      {limits && stress && allocation && (
        <>
          {/* Limits */}
          <section className="grid gap-3 rounded-lg border border-white/10 p-4 text-xs sm:grid-cols-2 lg:grid-cols-3">
            <div><div className="text-[10px] uppercase tracking-wider text-white/40">Cash reserve</div><div className="text-sm font-bold">{formatCents(limits.reserveCents)}</div></div>
            <div><div className="text-[10px] uppercase tracking-wider text-white/40">Spread risk cap (each spread up to {formatCents(limits.singleSpreadCents)})</div><div className="text-sm font-bold">{formatCents(limits.spreadCapCents)}</div></div>
            <div><div className="text-[10px] uppercase tracking-wider text-white/40">Wheel cash</div><div className="text-sm font-bold">{formatCents(limits.wheelCashCents)}</div></div>
            <div><div className="text-[10px] uppercase tracking-wider text-white/40">Most cash on one name</div><div className="text-sm font-bold">{formatCents(limits.maxCashPerNameCents)}</div></div>
            <div><div className="text-[10px] uppercase tracking-wider text-white/40">Highest put strike that fits</div><div className="text-sm font-bold">${limits.highestStrikeDollars}</div></div>
            <div><div className="text-[10px] uppercase tracking-wider text-white/40">Most in one sector</div><div className="text-sm font-bold">{formatCents(limits.sectorLimitCents)}</div></div>
          </section>

          {/* Stress */}
          <section className="space-y-2 rounded-lg border border-white/10 p-4 text-xs" aria-label="Worst case">
            <h2 className="text-[10px] font-bold uppercase tracking-wider text-white/40">
              If every holding fell {formatBps(params.stressBps)} together
            </h2>
            <dl className="grid grid-cols-[1fr_auto] gap-x-6 gap-y-1">
              <dt className="text-white/60">Today ({formatCents(stress.deployedCents)} in the plan)</dt>
              <dd className="text-right">−{formatCents(stress.wheelLossCents)} ({formatPctTenths(stress.wheelLossPctTenths)})</dd>
              <dt className="text-white/60">Wheel fully deployed ({formatCents(stress.fullWheelCents)})</dt>
              <dd className="text-right">−{formatCents(stress.fullWheelLossCents)} ({formatPctTenths(stress.fullWheelLossPctTenths)})</dd>
              <dt className="font-bold">Plus spreads at full loss ({formatCents(stress.spreadCapCents)})</dt>
              <dd className="text-right font-bold">−{formatCents(stress.worstCaseCents)} ({formatPctTenths(stress.worstCasePctTenths)})</dd>
            </dl>
            <p className="text-[10px] text-white/40">A rough worst case, not a forecast. It needs everything to go wrong at once, and sector ETFs can fall further than this in a crash.</p>
          </section>

          {/* Ladder */}
          <section className="space-y-3">
            <h2 className="text-[10px] font-bold uppercase tracking-wider text-white/40">Unlock ladder</h2>
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
              {wheelList.length === 0 && (
                <button type="button" onClick={() => addSymbols(STARTER_ETFS)} className="text-xs text-teal-300 hover:text-teal-200">
                  Add starter ETFs ({STARTER_ETFS.join(', ')})
                </button>
              )}
              {addError && <span role="alert" className="text-xs text-red-300">{addError}</span>}
            </div>

            {wheelList.length === 0 ? (
              <p className="text-sm text-white/40">Add a symbol to see the cash one put needs, whether it fits, and when it unlocks.</p>
            ) : (
              <div className="overflow-x-auto rounded-lg border border-white/10">
                <table className="w-full min-w-[860px] text-xs">
                  <thead>
                    <tr className="bg-white/5 text-[10px] uppercase tracking-wider text-white/40">
                      <th className="px-3 py-2 text-left">Symbol</th>
                      <th className="px-3 py-2 text-left">Sector</th>
                      <th className="px-3 py-2 text-right">Price</th>
                      <th className="px-3 py-2 text-left">Put priced</th>
                      <th className="px-3 py-2 text-right">Cash for one</th>
                      <th className="px-3 py-2 text-right">Fits</th>
                      <th className="px-3 py-2 text-right">In plan</th>
                      <th className="px-3 py-2 text-right">Fits at account</th>
                      <th className="px-3 py-2 text-left">Unlocks in</th>
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
                            <td className="px-3 py-2 text-right">{formatCents(row.fitsAt)}</td>
                            <td className="px-3 py-2">{row.unlock.kind === 'fits' ? <span className="text-emerald-300">Fits now</span> : formatUnlock(row.unlock as UnlockMonths)}</td>
                          </>
                        )}
                        {row.kind === 'loading' && <td colSpan={6} className="px-3 py-2 text-white/40">Loading…</td>}
                        {row.kind === 'leveraged' && <td colSpan={6} className="px-3 py-2 text-amber-300">Not a wheel candidate: a leveraged or inverse ETF can fall far more than 30% in a month. Small put spreads only.</td>}
                        {row.kind === 'state' && (
                          <td colSpan={6} className="px-3 py-2">
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
              Cash for one is the strike times 100 at the put nearest delta {(params.targetDeltaBps / 10_000).toFixed(2)}. "Fits at account" is the account size at which one contract first fits your loss limit, using your chosen profile.
              Cash goes to names in list order until ranking arrives. No open-interest or spread filter is applied yet.
            </p>
          </section>
        </>
      )}

      <p className="text-[10px] text-white/30">Guidance from TradeEdge rules. You decide; no orders are placed automatically.</p>
    </div>
  );
}
