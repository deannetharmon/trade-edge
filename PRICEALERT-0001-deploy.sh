#!/bin/bash
set -e

git pull --rebase origin main

mkdir -p "$(dirname "app/api/position-price-alerts/route.ts")"
cat > app/api/position-price-alerts/route.ts << 'SCRIPT_EOF'
// app/api/position-price-alerts/route.ts

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import Redis from 'ioredis';
import { authOptions } from '@/lib/auth';

// PRICEALERT-0001: same Redis-backed, accountNumber::positionKey-keyed
// pattern as /api/position-notes -- one more per-position, user-editable
// field, same shape. `direction` is included from day one (not hardcoded
// to 'above') so a future downside/put-side trigger doesn't need a second
// migration later -- today's only real use case (UBER/NFLX's coach-given
// $125 targets) happens to be 'above', but the storage shouldn't assume
// that's the only case that will ever exist.
type Direction = 'above' | 'below';
interface PriceAlert { targetPrice: number; direction: Direction; }
type PriceAlertStore = Record<string, PriceAlert>;

const redis = new Redis(process.env.REDIS_URL!);
const redisKey = (userId: string) => `position-price-alerts:${userId}`;
const alertKey = (accountNumber: string, positionKey: string) => `${encodeURIComponent(accountNumber)}::${encodeURIComponent(positionKey)}`;

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const userId = (session.user as { id: string }).id;
  try {
    const raw = await redis.get(redisKey(userId));
    return NextResponse.json({ alerts: raw ? JSON.parse(raw) : {} });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Unable to load price alerts' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const userId = (session.user as { id: string }).id;
  try {
    const body = await req.json();
    const accountNumber = typeof body?.accountNumber === 'string' ? body.accountNumber.trim() : '';
    const positionKey = typeof body?.positionKey === 'string' ? body.positionKey.trim() : '';
    const targetPrice = typeof body?.targetPrice === 'number' ? body.targetPrice : null;
    const direction: Direction | null = body?.direction === 'above' || body?.direction === 'below' ? body.direction : null;
    // A null targetPrice (rather than a number) is how the caller clears
    // an alert -- same "empty string deletes" convention position-notes
    // already uses, adapted for a numeric field.
    const clearing = body?.targetPrice === null;
    if (!accountNumber || !positionKey) return NextResponse.json({ error: 'Account and position are required' }, { status: 400 });
    if (!clearing && (targetPrice == null || !Number.isFinite(targetPrice) || targetPrice <= 0)) {
      return NextResponse.json({ error: 'Target price must be a positive number' }, { status: 400 });
    }
    if (!clearing && direction == null) return NextResponse.json({ error: 'Direction must be "above" or "below"' }, { status: 400 });

    const raw = await redis.get(redisKey(userId));
    const store: PriceAlertStore = raw ? JSON.parse(raw) : {};
    const key = alertKey(accountNumber, positionKey);
    if (clearing) delete store[key]; else store[key] = { targetPrice: targetPrice!, direction: direction! };
    await redis.set(redisKey(userId), JSON.stringify(store));
    return NextResponse.json({ ok: true, key, alert: clearing ? null : store[key] });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Unable to save price alert' }, { status: 500 });
  }
}
SCRIPT_EOF

mkdir -p "$(dirname "features/portfolio/positions-workspace/PositionsWorkspace.tsx")"
cat > features/portfolio/positions-workspace/PositionsWorkspace.tsx << 'SCRIPT_EOF'
'use client';

import Link from 'next/link';
import { ChartLinkButton } from '@/components/ChartLinkButton';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { ActionType, Position } from '@/lib/portfolio-data/types';
import { netEdgeLive, netEdgePeak, netEdgeColor, netEdgeDayChangePct, netEdgeDaysTracked, netEdgeRolledOver } from '@/lib/portfolio-data/acquisition';
import type { THEMES, Theme } from '@/lib/theme';
import { ANALYSIS_COLUMNS, columnsForView } from './model/columns';
import { activeFilterCount, DEFAULT_FILTERS, matchesAnalysisFilters } from './model/filters';
import { DEFAULT_PREFERENCES, loadPreferences, savePreferences } from './model/preferences';
import { buildCapitalViewModel, buildMoneynessViewModel, comparisonTone, directionalMovementTone, SEMANTIC_TONE_CLASS, stopPresentation, type SemanticTone } from './model/presentation';
import { buildBreakevenViewModel } from './model/breakeven';
import type { AnalysisColumnId, AnalysisViewId, ExistingIncomeOpportunity, FinancialAggregate, PositionAnalysisFilters, PositionsWorkspaceModel, SymbolGroupViewModel } from './model/types';

export function isPositionsWorkspaceV2Enabled(value = process.env.NEXT_PUBLIC_POSITIONS_WORKSPACE_V2_ENABLED): boolean {
  return value === 'true';
}

const money = (value: number | null) => value == null || !Number.isFinite(value) ? 'Unavailable' : new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(value);
const number = (value: number | null | undefined, digits = 1) => value == null || !Number.isFinite(value) ? '—' : value.toFixed(digits);
const POSITION_NOTE_MAX_LENGTH = 150;
const INDEX_CHART_SYMBOLS: Record<string, string> = { SPX: '^GSPC', SPXW: '^GSPC', NDX: '^NDX', RUT: '^RUT', VIX: '^VIX', DJX: '^DJI' };

export interface WorkspaceAiAnalysis {
  positionKey: string;
  symbol: string;
  recommendation: string;
  confidence: string;
  summary: string;
  reasoning: string;
  risks: string[];
  catalysts: string[];
  generatedAt: string;
}

export function profitTargetPresentation(position: Pick<Position, 'entryPriceEffect' | 'entryEconomicsComplete' | 'profitTarget'>): string {
  const target = position.profitTarget;
  if (position.entryPriceEffect !== 'Credit' || position.entryEconomicsComplete !== true) return 'Target unavailable';
  if (!Number.isFinite(target) || target < 0 || target > 1) return 'Target unavailable';
  const percent = new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 }).format(target * 100);
  return `Target ${percent}%`;
}

// PLTARGET-0001: % of target progress, signed and never floored -- a
// position down against its target shows a negative %, not 0%, since "just
// opened" and "losing ground" are meaningfully different states. Gated
// identically to profitTargetPresentation above (same Credit/complete/valid
// -target checks) so the % only ever appears alongside a real "Target X%"
// label, never a stray number next to "Target unavailable". Computed off
// Position.targetPrice (already canonical -- Math.abs(creditReceived) *
// profitTarget, already gated for debit/incomplete-economics elsewhere) --
// no new math. `pnl` is passed in rather than read from `position.pnl`
// directly so the % always matches whatever dollar figure the caller is
// actually displaying (closeNowPnl ?? pnl), not a different pnl source.
export function profitTargetPct(
  position: Pick<Position, 'entryPriceEffect' | 'entryEconomicsComplete' | 'targetPrice'>,
  pnl: number | null | undefined
): number | null {
  if (position.entryPriceEffect !== 'Credit' || position.entryEconomicsComplete !== true) return null;
  if (!Number.isFinite(position.targetPrice) || position.targetPrice <= 0) return null;
  if (pnl == null || !Number.isFinite(pnl)) return null;
  return (pnl / position.targetPrice) * 100;
}

function AggregateValue({ aggregate, absent }: { aggregate: FinancialAggregate; absent: string }) {
  if (aggregate.completeness === 'not-applicable') return <span className="text-white/40">{absent}</span>;
  if (aggregate.completeness === 'unavailable') return <span className="text-white/40">Unavailable{aggregate.reasons[0] ? ` — ${aggregate.reasons[0]}` : ''}</span>;
  return <><span>{aggregate.completeness === 'partial' ? 'Partial ' : ''}{money(aggregate.value)}</span>{aggregate.completeness === 'partial' && <span className="block text-white/40">{aggregate.includedCount} of {aggregate.expectedCount} instruments priced{aggregate.reasons[0] ? ` · ${aggregate.reasons[0]}` : ''}</span>}</>;
}

function DialogShell({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  const closeRef = useRef<HTMLButtonElement>(null);
  useEffect(() => { closeRef.current?.focus(); }, []);
  return <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/70 p-4" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) onClose(); }}>
    <section role="dialog" aria-modal="true" aria-labelledby="workspace-dialog-title" className="max-h-[90vh] w-full max-w-2xl overflow-auto rounded-xl border border-white/20 bg-slate-950 p-5 text-white shadow-2xl" onKeyDown={event => { if (event.key === 'Escape') onClose(); }}>
      <header className="mb-4 flex items-center justify-between"><h2 id="workspace-dialog-title" className="text-base font-semibold">{title}</h2><button ref={closeRef} type="button" onClick={onClose} className="min-h-11 min-w-11 rounded border border-white/20 focus:outline-none focus:ring-2 focus:ring-teal-400" aria-label={`Close ${title}`}>×</button></header>
      {children}
    </section>
  </div>;
}

function PortfolioView({ groups, th }: { groups: SymbolGroupViewModel[]; th: typeof THEMES[Theme] }) {
  const [selected, setSelected] = useState<string | null>(groups[0]?.symbol ?? null);
  const [mobileDetail, setMobileDetail] = useState(false);
  const rowRefs = useRef(new Map<string, HTMLButtonElement>());
  useEffect(() => { if (selected && !groups.some(group => group.symbol === selected)) setSelected(groups[0]?.symbol ?? null); }, [groups, selected]);
  const group = groups.find(item => item.symbol === selected) ?? null;
  const closeDetail = () => {
    const selectedRow = selected ? rowRefs.current.get(selected) : undefined;
    setSelected(null);
    setMobileDetail(false);
    window.setTimeout(() => selectedRow?.focus(), 0);
  };
  return <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(320px,38%)]">
    <section aria-label="Portfolio positions" className={`${mobileDetail ? 'hidden lg:block' : ''} overflow-hidden rounded-xl border ${th.border}`}>
      <div className={`grid grid-cols-[minmax(180px,1.35fr)_minmax(150px,1fr)_minmax(150px,1fr)_minmax(130px,.8fr)_120px] gap-3 border-b ${th.border} px-4 py-2 text-[10px] uppercase tracking-wider ${th.textFaint}`}><span>Symbol / composition</span><span>Current value</span><span>Opening economics / basis</span><span>Status / freshness</span><span className="text-right">Unrealized P/L (mid)</span></div>
      {groups.map(item => { const primaryValue = item.equityMarketValueAggregate.completeness !== 'not-applicable' ? item.equityMarketValueAggregate : item.longOptionValueMid.completeness !== 'not-applicable' ? item.longOptionValueMid : item.optionBuybackMid; const equity = item.equities[0]; const option = item.options[0]; return <button ref={node => { if (node) rowRefs.current.set(item.symbol, node); else rowRefs.current.delete(item.symbol); }} key={item.symbol} type="button" aria-current={item.symbol === selected ? 'true' : undefined} aria-expanded={item.symbol === selected} aria-controls="symbol-position-detail" onClick={() => { setSelected(item.symbol); setMobileDetail(true); }} className={`grid min-h-[84px] w-full grid-cols-[minmax(180px,1.35fr)_minmax(150px,1fr)_minmax(150px,1fr)_minmax(130px,.8fr)_120px] items-center gap-3 border-b px-4 py-3 text-left transition focus:outline-none focus:ring-2 focus:ring-inset focus:ring-teal-400 ${th.border} ${item.symbol === selected ? 'border-l-4 border-l-teal-400 bg-teal-400/10' : 'border-l-4 border-l-transparent hover:bg-white/5'}`}>
        <span><span className="block font-mono text-sm font-bold text-white">{item.symbol} <span aria-hidden="true">{item.symbol === selected ? '●' : ''}</span></span><span className={`block text-[11px] ${th.textFaint}`}>{item.compositionLabel} · {item.instrumentCount} instrument{item.instrumentCount === 1 ? '' : 's'}</span></span>
        <span className="text-[11px]"><span className="block text-white">{primaryValue === item.optionBuybackMid && primaryValue.completeness !== 'not-applicable' ? 'Buyback obligation (mid)' : primaryValue === item.longOptionValueMid ? 'Liquidation value (mid)' : 'Equity market value'}</span><AggregateValue aggregate={primaryValue} absent="No applicable value" /></span>
        <span className="text-[11px]">{equity ? <><span className="block text-white">Average share basis</span><span>{equity.basisComplete ? money(equity.basis) : 'Unavailable — Equity basis missing'}</span></> : option ? <><span className="block text-white">Opening {option.entryPriceEffect.toLowerCase()}</span><span>{option.entryEconomicsComplete ? money(option.entryCredit ?? null) : 'Unavailable — Option entry economics missing'}</span></> : null}</span>
        <span className="text-[11px]"><span className={item.needsAttention ? 'text-amber-300' : 'text-white/70'}>{item.needsAttention ? 'Needs attention' : item.unrealizedPnlMid.completeness === 'partial' ? 'Data incomplete' : 'Monitoring'}</span><span className={`block ${th.textFaint}`}>{option ? `${option.dte} DTE` : item.equityMarketValueAggregate.asOf ? 'Current mark' : 'Freshness unknown'}</span></span>
        <span className={`text-right font-mono text-sm font-semibold ${item.unrealizedPnlMid.value == null ? th.textFaint : item.unrealizedPnlMid.value >= 0 ? 'text-emerald-400' : 'text-red-400'}`}><AggregateValue aggregate={item.unrealizedPnlMid} absent="Not applicable" />{item.unrealizedPnlPct != null ? <span className="block text-[10px]">{item.unrealizedPnlPct.toFixed(1)}%</span> : item.unrealizedPnlPctReason ? <span className="sr-only">{item.unrealizedPnlPctReason}</span> : null}</span>
      </button>})}
    </section>
    {group && <SymbolDetail group={group} th={th} mobile={mobileDetail} onBack={() => setMobileDetail(false)} onClose={closeDetail} />}
  </div>;
}

function SymbolDetail({ group, th, mobile, onBack, onClose }: { group: SymbolGroupViewModel; th: typeof THEMES[Theme]; mobile: boolean; onBack: () => void; onClose: () => void }) {
  return <aside id="symbol-position-detail" role="region" aria-labelledby="symbol-position-detail-title" onKeyDown={event => { if (event.key === 'Escape') onClose(); }} className={`${mobile ? 'block' : 'hidden lg:block'} rounded-xl border ${th.border} ${th.card} p-4`}>
    <header className={`mb-4 flex items-center justify-between border-b ${th.border} pb-3`}><div><button type="button" onClick={onBack} className="mb-2 min-h-11 text-xs text-teal-300 lg:hidden">← Back to Positions</button><h2 id="symbol-position-detail-title" className="font-mono text-lg font-bold text-white">{group.symbol} position details</h2><p className={`text-xs ${th.textFaint}`}>{money(group.underlyingPrice)} underlying · {group.compositionLabel} · {group.instrumentCount} instrument{group.instrumentCount === 1 ? '' : 's'} · {group.unrealizedPnlMid.asOf ? `as of ${group.unrealizedPnlMid.asOf}` : 'quote time unknown'}</p></div><button type="button" onClick={onClose} className="hidden min-h-11 rounded border border-white/20 px-3 text-xs focus:ring-2 focus:ring-teal-400 lg:block" aria-label={`Close ${group.symbol} position details`}>× Close</button></header>
    <dl className="grid grid-cols-2 gap-3 text-xs"><div><dt className={th.textFaint}>Unrealized P/L (mark-mid)</dt><dd className="font-mono text-white"><AggregateValue aggregate={group.unrealizedPnlMid} absent="Not applicable" /></dd></div><div><dt className={th.textFaint}>Options close-now P/L (marketable estimate)</dt><dd className="font-mono text-white"><AggregateValue aggregate={group.optionCloseNowPnl} absent="No option position" /></dd></div>{group.equities.length ? <div><dt className={th.textFaint}>Equity market value</dt><dd className="font-mono text-white"><AggregateValue aggregate={group.equityMarketValueAggregate} absent="No equity holding" /></dd></div> : <div><dt className={th.textFaint}>Equity</dt><dd>No equity holding</dd></div>}{group.options.length === 0 && <div><dt className={th.textFaint}>Options</dt><dd>No option position</dd></div>}{group.longOptionValueMid.completeness !== 'not-applicable' && <div><dt className={th.textFaint}>Long-option liquidation value (mid)</dt><dd className="font-mono text-white"><AggregateValue aggregate={group.longOptionValueMid} absent="No long option" /></dd></div>}{group.optionBuybackMid.completeness !== 'not-applicable' && <div><dt className={th.textFaint}>Short/net-credit buyback obligation (mid)</dt><dd className="font-mono text-white"><AggregateValue aggregate={group.optionBuybackMid} absent="No short option" /></dd></div>}{group.options.length > 0 && <div><dt className={th.textFaint}>Marketable close value estimate</dt><dd className="font-mono text-white"><AggregateValue aggregate={group.optionMarketableClose} absent="No option position" /></dd></div>}</dl>
    {group.equities.length > 0 && <div className={`my-4 rounded border ${th.border} p-3 text-xs`}><p className="font-semibold text-white">Share capacity</p>{group.capacity.status === 'ok' ? <p className={`mt-1 ${th.textMuted}`}>{group.capacity.sharesOwned} shares owned · {group.capacity.allocatedContracts * 100} allocated · {group.capacity.reservedContracts * 100} reserved · {group.capacity.unallocatedShares} unallocated shares · {group.capacity.availableContracts} covered-call contract{group.capacity.availableContracts === 1 ? '' : 's'} available · {group.capacity.remainderShares}-share remainder</p> : <p className="mt-1 text-amber-300">Share-capacity evidence unavailable — {group.capacity.blockingReason ?? 'working-order evidence incomplete'}</p>}</div>}
    <div className="space-y-2"><h3 className={`text-[10px] uppercase tracking-wider ${th.textFaint}`}>Instruments</h3>{group.equities.map((holding, index) => <div key={`equity-${index}`} className={`rounded border ${th.border} p-3 text-xs`}><b className="text-white">{holding.direction} {holding.quantity} shares</b><p>Current price {money(holding.currentPrice)} · Average basis {holding.basisComplete ? money(holding.basis) : 'Unavailable'}</p><p>Market value {money(holding.marketValue)} · Unrealized P/L (mark) {money(holding.unrealizedPnl)}</p>{holding.dataQualityWarnings.map(warning => <p key={warning} className="mt-1 text-amber-300">{warning}</p>)}</div>)}{group.optionInstruments.map(instrument => { const option = instrument.position; const capital = buildCapitalViewModel(option); return <div key={instrument.key} className={`rounded border ${th.border} p-3 text-xs`}><b className="text-white">{instrument.roleLabel} · {option.quantity} contract{option.quantity === 1 ? '' : 's'}</b><p>{option.legs.map(leg => `${leg.direction} ${leg.strikePrice}${leg.optionType}`).join(' / ')} · {option.expDate} · {option.dte} DTE</p><p>Opening {option.entryPriceEffect.toLowerCase()} {option.entryEconomicsComplete ? money(option.entryCredit ?? null) : 'Unavailable — option entry economics missing'}</p><p>{instrument.midpointLabel} {money(option.currentValue)} · {instrument.marketableLabel} {money(option.closeValue)}</p><p>Unrealized P/L (mid) {money(option.pnl)} · Close-now P/L {money(option.closeNowPnl)}</p><p>{capital.label} {capital.value == null ? capital.reason : money(capital.value)}</p>{instrument.role === 'short-call' && <p className="text-amber-300">Coverage requires a verified share or long-call relationship.</p>}</div>})}</div>
    {group.contextualAction === 'covered-call' && <Link href={`/screener?strategy=covered-call&symbol=${encodeURIComponent(group.symbol)}`} className="mt-4 inline-flex min-h-11 items-center rounded border border-teal-500 px-4 text-xs font-semibold text-teal-300">Find Covered Call</Link>}
  </aside>;
}

interface ManagementActionProps {
  getManagementActions?: (position: Position) => ActionType[];
  onExecute?: (position: Position, action: ActionType, initialRollMode?: 'close' | 'roll') => void;
  renderStopControl?: (position: Position) => ReactNode;
  onAnalyze?: (position: Position, traderNote: string) => Promise<WorkspaceAiAnalysis>;
  renderAnalysisConversation?: (position: Position, analysis: WorkspaceAiAnalysis) => ReactNode;
}

function AnalysisView({ model, th, getManagementActions, onExecute, renderStopControl, onAnalyze, renderAnalysisConversation }: { model: PositionsWorkspaceModel; th: typeof THEMES[Theme] } & ManagementActionProps) {
  const [preferences, setPreferences] = useState(DEFAULT_PREFERENCES);
  const [hydrated, setHydrated] = useState(false);
  const [filterOpen, setFilterOpen] = useState(false);
  const [columnsOpen, setColumnsOpen] = useState(false);
  const [draftFilters, setDraftFilters] = useState(preferences.filters);
  const [draftColumns, setDraftColumns] = useState<AnalysisColumnId[]>(preferences.customColumnIds);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [notesLoadError, setNotesLoadError] = useState<string | null>(null);
  // PRICEALERT-0001: same store/fetch/save shape as notes above.
  const [priceAlerts, setPriceAlerts] = useState<Record<string, { targetPrice: number; direction: 'above' | 'below' }>>({});
  const [priceAlertsLoadError, setPriceAlertsLoadError] = useState<string | null>(null);
  const [analysisPosition, setAnalysisPosition] = useState<Position | null>(null);
  const [analysis, setAnalysis] = useState<WorkspaceAiAnalysis | null>(null);
  const [analysisLoading, setAnalysisLoading] = useState(false);
  const [analysisError, setAnalysisError] = useState<string | null>(null);
  const [openChartKey, setOpenChartKey] = useState<string | null>(null);
  const [chartData, setChartData] = useState<Record<string, number[] | null>>({});
  const [chartLoadingSymbol, setChartLoadingSymbol] = useState<string | null>(null);
  const [incomeReview, setIncomeReview] = useState<ExistingIncomeOpportunity | null>(null);
  useEffect(() => { const loaded = loadPreferences(); setPreferences(loaded); setDraftFilters(loaded.filters); setDraftColumns(loaded.customColumnIds); setHydrated(true); }, []);
  useEffect(() => { if (hydrated) savePreferences(preferences); }, [preferences, hydrated]);
  useEffect(() => {
    if (typeof fetch !== 'function') return;
    let active = true;
    fetch('/api/position-notes').then(async response => {
      if (!response.ok) throw new Error((await response.json().catch(() => ({})))?.error ?? 'Unable to load notes');
      const payload = await response.json();
      if (active) setNotes(payload.notes ?? {});
    }).catch(error => { if (active) setNotesLoadError(error instanceof Error ? error.message : 'Unable to load notes'); });
    return () => { active = false; };
  }, []);
  useEffect(() => {
    if (typeof fetch !== 'function') return;
    let active = true;
    fetch('/api/position-price-alerts').then(async response => {
      if (!response.ok) throw new Error((await response.json().catch(() => ({})))?.error ?? 'Unable to load price alerts');
      const payload = await response.json();
      if (active) setPriceAlerts(payload.alerts ?? {});
    }).catch(error => { if (active) setPriceAlertsLoadError(error instanceof Error ? error.message : 'Unable to load price alerts'); });
    return () => { active = false; };
  }, []);
  const noteStorageKey = (position: Position) => `${encodeURIComponent(position.accountNumber || model.accountNumber || '')}::${encodeURIComponent(position.key)}`;
  const saveNote = async (position: Position, note: string) => {
    const accountNumber = position.accountNumber || model.accountNumber;
    if (!accountNumber) throw new Error('Broker account identity is unavailable');
    const response = await fetch('/api/position-notes', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ accountNumber, positionKey: position.key, note }) });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error ?? 'Unable to save note');
    setNotes(current => ({ ...current, [noteStorageKey(position)]: note }));
  };
  // Same accountNumber::positionKey scheme as noteStorageKey -- one storage
  // convention, two fields (Dane's consolidation principle).
  const priceAlertStorageKey = (position: Position) => `${encodeURIComponent(position.accountNumber || model.accountNumber || '')}::${encodeURIComponent(position.key)}`;
  const savePriceAlert = async (position: Position, targetPrice: number | null, direction: 'above' | 'below') => {
    const accountNumber = position.accountNumber || model.accountNumber;
    if (!accountNumber) throw new Error('Broker account identity is unavailable');
    const response = await fetch('/api/position-price-alerts', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ accountNumber, positionKey: position.key, targetPrice, direction }) });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error ?? 'Unable to save price alert');
    setPriceAlerts(current => {
      const next = { ...current };
      if (targetPrice == null) delete next[priceAlertStorageKey(position)];
      else next[priceAlertStorageKey(position)] = { targetPrice, direction };
      return next;
    });
  };
  const analyze = async (position: Position) => {
    if (!onAnalyze || analysisLoading) return;
    setAnalysisPosition(position);
    setAnalysis(null);
    setAnalysisError(null);
    setAnalysisLoading(true);
    try {
      const result = await onAnalyze(position, notes[noteStorageKey(position)] ?? '');
      if (result.positionKey !== position.key) throw new Error('Analysis identity did not match the selected position');
      setAnalysis(result);
    } catch (error) {
      setAnalysisError(error instanceof Error ? error.message : 'Analysis failed');
    } finally { setAnalysisLoading(false); }
  };
  const columns = preferences.analysisView === 'custom' ? preferences.customColumnIds : columnsForView(preferences.analysisView);
  const rows = model.analysisRows.filter(row => matchesAnalysisFilters(row, preferences.filters));
  const chooseView = (view: AnalysisViewId) => setPreferences(current => ({ ...current, analysisView: view, customColumnIds: view === 'custom' ? current.customColumnIds : columnsForView(view) }));
  return <>
    <section aria-label="Existing-position income eligibility" className={`mb-3 rounded-xl border ${th.border} p-3`}>
      <div className="flex flex-wrap items-baseline justify-between gap-2"><div><h2 className="text-xs font-bold tracking-wider text-white">Existing-position income</h2><p className={`mt-1 text-[10px] ${th.textFaint}`}>Portfolio-first eligibility only. Short-call timing is not yet a recommendation.</p></div><span className={`text-[10px] ${th.textFaint}`}>{(model.incomeOpportunities ?? []).length} candidate{(model.incomeOpportunities ?? []).length === 1 ? '' : 's'} found</span></div>
      <div className="mt-3 grid gap-2 lg:grid-cols-2">{(model.incomeOpportunities ?? []).map(opportunity => <div key={opportunity.id} className="rounded border border-white/10 p-3 text-xs"><div className="flex items-start justify-between gap-2"><div><b className="text-white">{opportunity.symbol} · {opportunity.title}</b><p className={`mt-1 ${opportunity.status === 'eligible' ? 'text-emerald-300' : opportunity.status === 'no-capacity' ? 'text-amber-300' : opportunity.status === 'unavailable' ? 'text-red-300' : th.textMuted}`}>{opportunity.status === 'eligible' ? 'Eligible — evaluate short call' : opportunity.status === 'no-capacity' ? 'Fully covered / no available capacity' : opportunity.status === 'unavailable' ? 'Broker data unavailable' : 'Not eligible'}</p></div>{opportunity.status === 'eligible' && <button type="button" onClick={() => setIncomeReview(opportunity)} className="min-h-8 rounded border border-teal-500/50 px-2 text-[10px] text-teal-300 focus:ring-2 focus:ring-teal-400">Review</button>}</div><p className={`mt-2 ${th.textFaint}`}>{opportunity.reason}</p>{opportunity.kind === 'covered-call' && <p className={`mt-2 ${th.textFaint}`}>Shares {opportunity.sharesOwned ?? '—'} · Allocated {opportunity.allocatedContracts ?? '—'} · Reserved {opportunity.reservedContracts ?? '—'} · Available {opportunity.availableContracts ?? '—'}</p>}<p className={`mt-2 text-[10px] ${th.textFaint}`}>Freshness: {opportunity.freshness}</p></div>)}</div>
      {/* PW-0002: with structural non-candidates filtered out, zero results is
          a real, common state now (no held long calls or coverable shares
          at all) -- give it an explicit message instead of a blank grid. */}
      {(model.incomeOpportunities ?? []).length === 0 && <p className={`mt-3 text-xs ${th.textFaint}`}>No held long calls or coverable shares found in this portfolio right now.</p>}
      {incomeReview && <div role="status" className="mt-3 rounded border border-blue-500/40 bg-blue-500/10 p-3 text-xs text-blue-100"><b>{incomeReview.symbol} · {incomeReview.title} review</b><p className="mt-1">Review-only. {incomeReview.exactContract ? `Held contract: ${incomeReview.exactContract}. ` : ''}Short-call timing policy is not yet approved; no recommendation, ticket, or order has been created.</p><button type="button" onClick={() => setIncomeReview(null)} className="mt-2 min-h-8 rounded border border-blue-400/50 px-2 text-[10px] text-blue-200 focus:ring-2 focus:ring-blue-400">Close review</button></div>}
    </section>
    <div className={`mb-3 flex flex-wrap items-center gap-2 rounded-xl border ${th.border} p-3`}>
      {/* PW-0001: segmented buttons replace the View dropdown -- fixed 4-option
          set, one click instead of open-then-pick. Styled to match the existing
          Portfolio/Position Analysis role="tablist" toggle above this component.
          Custom is only ever reached via "Customize Columns" -> Apply (never a
          cold-start choice), so it's excluded from the button row until a
          custom column set actually exists, then it becomes selectable. */}
      <div role="tablist" aria-label="Column view" className="flex gap-1">
        {(['management', 'risk', 'full'] as const).map(item => (
          <button key={item} type="button" role="tab" aria-selected={preferences.analysisView === item}
            onClick={() => chooseView(item)}
            className={`min-h-11 rounded border px-3 text-xs font-bold tracking-wider focus:outline-none focus:ring-2 focus:ring-teal-400 ${preferences.analysisView === item ? 'border-teal-400 bg-teal-400/10 text-white' : `border-white/20 ${th.textFaint} hover:text-white`}`}>
            {item === 'management' ? 'Management' : item === 'risk' ? 'Risk' : 'Full Detail'}
          </button>
        ))}
        {preferences.analysisView === 'custom' && (
          <button type="button" role="tab" aria-selected={true}
            onClick={() => chooseView('custom')}
            className="min-h-11 rounded border border-teal-400 bg-teal-400/10 px-3 text-xs font-bold tracking-wider text-white focus:outline-none focus:ring-2 focus:ring-teal-400">
            Custom
          </button>
        )}
      </div>
      <button type="button" onClick={() => { setDraftFilters(preferences.filters); setFilterOpen(true); }} className="min-h-11 rounded border border-white/20 px-3 text-xs text-white focus:ring-2 focus:ring-teal-400">Filter{activeFilterCount(preferences.filters) ? ` ${activeFilterCount(preferences.filters)}` : ''}</button>
      <button type="button" onClick={() => { setDraftColumns(columns); setColumnsOpen(true); }} className="min-h-11 rounded border border-white/20 px-3 text-xs text-white focus:ring-2 focus:ring-teal-400">Customize Columns</button>
      <span className={`ml-auto text-xs ${th.textFaint}`}>{rows.length} of {model.analysisRows.length} positions</span>
    </div>
    {notesLoadError && <p role="status" className="mb-2 text-xs text-amber-300">Position notes unavailable — {notesLoadError}</p>}
    {priceAlertsLoadError && <p role="status" className="mb-2 text-xs text-amber-300">Price alerts unavailable — {priceAlertsLoadError}</p>}
    <div className="max-w-full overflow-x-auto rounded-xl border border-white/10" tabIndex={0} aria-label="Position analysis table, horizontally scrollable"><table className="min-w-max border-collapse text-left text-[11px]"><thead><tr>{ANALYSIS_COLUMNS.filter(column => columns.includes(column.id)).map(column => <th key={column.id} scope="col" title={column.id === 'capital' ? 'Capital / Collateral' : undefined} className={`border-b border-r border-white/10 bg-slate-950 px-2 py-2 uppercase tracking-wider text-white/50 ${column.id === 'identity' ? 'sticky left-0 z-20' : ''} ${column.id === 'capital' ? 'w-28 max-w-28' : column.id === 'strike' ? 'w-32 max-w-32' : column.id === 'underlying' ? 'w-24 max-w-24' : column.id === 'entry' ? 'w-20 max-w-20' : column.id === 'notes' ? 'w-40 max-w-40' : 'whitespace-nowrap'}`}>{column.id === 'strike' ? <><span className="block">Strike /</span><span className="block">BE</span></> : column.id === 'underlying' ? <><span className="block">Strike</span><span className="block">Gap</span></> : column.id === 'entry' ? <><span className="block">Entry</span><span className="block">Credit / Debit</span></> : column.label}</th>)}</tr></thead><tbody>{rows.map(row => <AnalysisRow key={row.id} position={row.position} columns={columns} th={th} actions={getManagementActions?.(row.position) ?? []} onExecute={onExecute} renderStopControl={renderStopControl} onAnalyze={onAnalyze ? analyze : undefined} savedNote={notes[noteStorageKey(row.position)] ?? ''} onSaveNote={saveNote} savedAlert={priceAlerts[priceAlertStorageKey(row.position)] ?? null} onSaveAlert={savePriceAlert} chartOpen={openChartKey === row.position.key} setChartOpen={open => setOpenChartKey(open ? row.position.key : null)} sparkData={chartData[row.position.symbol] ?? null} setSparkData={data => setChartData(current => ({ ...current, [row.position.symbol]: data }))} sparkLoading={chartLoadingSymbol === row.position.symbol} setSparkLoading={loading => setChartLoadingSymbol(loading ? row.position.symbol : current => current === row.position.symbol ? null : current)} />)}</tbody></table></div>
    {filterOpen && <FilterDialog draft={draftFilters} setDraft={setDraftFilters} onClose={() => setFilterOpen(false)} onApply={() => { setPreferences(current => ({ ...current, filters: draftFilters })); setFilterOpen(false); }} onClear={() => setDraftFilters(DEFAULT_FILTERS)} />}
    {columnsOpen && <ColumnsDialog selected={draftColumns} setSelected={setDraftColumns} preset={preferences.analysisView} onClose={() => setColumnsOpen(false)} onApply={() => { setPreferences(current => ({ ...current, analysisView: 'custom', customColumnIds: draftColumns })); setColumnsOpen(false); }} />}
    {analysisPosition && <DialogShell title={`AI analysis — ${analysisPosition.symbol}`} onClose={() => { if (!analysisLoading) setAnalysisPosition(null); }}><div aria-live="polite">{analysisLoading ? <p>Analyzing {analysisPosition.symbol}…</p> : analysisError ? <div><p role="alert" className="text-red-400">{analysisError}</p><button type="button" onClick={() => analyze(analysisPosition)} className="mt-3 min-h-8 rounded border border-white/20 px-3 text-xs focus:ring-2 focus:ring-teal-400">Retry analysis</button></div> : analysis ? <div className="space-y-3 text-sm"><p className="text-[10px] uppercase tracking-wider text-white/50">AI interpretation · deterministic Suggested Action remains authoritative</p><p><b>{analysis.recommendation}</b> · {analysis.confidence} confidence</p><p>{analysis.summary}</p><details className="rounded border border-white/10 bg-white/[0.02] p-3 text-xs"><summary className="cursor-pointer font-semibold text-indigo-300">Position context locked for this conversation</summary><p className="mt-2 text-white/60">{analysisPosition.symbol} · {analysisPosition.strategy} · expires {analysisPosition.expDate} · {analysisPosition.dte} DTE</p><p className="mt-1 break-all font-mono text-[10px] text-white/40">Position ID: {analysisPosition.key}</p><p className="mt-1 text-white/40">Snapshot captured {new Date(analysis.generatedAt).toLocaleString()}. Follow-ups retain this snapshot and conversation history.</p></details>{renderAnalysisConversation && <section aria-label={`AI follow-up conversation for ${analysisPosition.symbol}`} className="overflow-hidden rounded-lg border border-indigo-500/30 bg-indigo-500/[0.04]"><div className="px-4 pt-3"><p className="text-xs font-semibold text-indigo-200">Continue with AI</p><p className="mt-1 text-[10px] text-white/50">Ask a follow-up or attach chart and option-chain images.</p></div>{renderAnalysisConversation(analysisPosition, analysis)}</section>}<details className="rounded border border-white/10 p-3 text-xs"><summary className="cursor-pointer font-semibold text-white/70">Show full AI reasoning and risks</summary><p className="mt-3 text-white/70">{analysis.reasoning}</p>{analysis.risks.length > 0 && <div className="mt-3"><b>Risks</b><ul className="list-disc pl-5">{analysis.risks.map(risk => <li key={risk}>{risk}</li>)}</ul></div>}</details><p className="text-xs text-white/50">Advisory analysis only. No brokerage order is prepared or submitted.</p></div> : null}</div></DialogShell>}
  </>;
}

const ACTION_LABELS: Partial<Record<ActionType, string>> = { TAKE_PROFIT: 'Take Profit Now', CLOSE_ROLL: 'Close Position / Roll', PLACE_GTC: 'Set/Edit Profit Target', CUT_LOSSES: 'Cut Losses' };

function SemanticComparison({ label, prior, current, tone, digits = 1, suffix = '' }: { label: string; prior: number | null | undefined; current: number | null | undefined; tone: SemanticTone; digits?: number; suffix?: string }) {
  const material = tone !== 'neutral';
  return <span className="block"><span className="text-white/70">{label} </span><span className="text-white/40">{number(prior, digits)}{prior == null ? '' : suffix}</span><span className="px-1 text-white/30">→</span><span className={`${SEMANTIC_TONE_CLASS[tone]} ${material ? 'font-semibold' : ''}`}>{number(current, digits)}{current == null ? '' : suffix}</span></span>;
}

function recommendationTone(position: Position): SemanticTone {
  const label = (position.recommendation?.label ?? 'Hold').toLowerCase();
  if (label.includes('profit')) return 'positive';
  if (label.includes('cut') || label.includes('close')) return 'negative';
  if (label.includes('reduce') || label.includes('review')) return 'warning';
  return 'neutral';
}

function PositionNoteEditor({ position, savedNote, onSave }: { position: Position; savedNote: string; onSave: (position: Position, note: string) => Promise<void> }) {
  const [draft, setDraft] = useState(savedNote);
  const [state, setState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { setDraft(savedNote); setState('idle'); setError(null); }, [savedNote, position.key]);
  const save = async () => {
    if (draft === savedNote || state === 'saving') return;
    if (draft.length > POSITION_NOTE_MAX_LENGTH) { setError(`Maximum ${POSITION_NOTE_MAX_LENGTH} characters`); setState('error'); return; }
    setState('saving'); setError(null);
    try { await onSave(position, draft); setState('saved'); } catch (cause) { setError(cause instanceof Error ? cause.message : 'Save failed'); setState('error'); }
  };
  return <label className="block"><span className="sr-only">Note for {position.symbol} {position.strategy} position</span><textarea aria-label={`Note for ${position.symbol} ${position.strategy} position`} value={draft} maxLength={POSITION_NOTE_MAX_LENGTH} rows={3} wrap="soft" onChange={event => { setDraft(event.target.value); setState('idle'); }} onBlur={() => void save()} onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); void save(); } else if (event.key === 'Escape') { event.preventDefault(); setDraft(savedNote); setState('idle'); setError(null); } }} className="w-36 resize-y rounded border border-white/20 bg-transparent px-2 py-1 text-xs text-white focus:outline-none focus:ring-2 focus:ring-teal-400" /><span className="mt-1 block text-[9px] text-white/40">{draft.length}/{POSITION_NOTE_MAX_LENGTH} · {state === 'saving' ? 'Saving…' : state === 'saved' ? 'Saved' : state === 'error' ? error : 'Enter or blur to save'}</span></label>;
}

// PRICEALERT-0001: not auto-filled from Notes text -- parsing "$125" out of
// free-form notes reliably is more error-prone than it's worth. Same
// draft/save/status shape as PositionNoteEditor above. No auto-fill from
// existing Notes text (Paul: re-entering the number once is simpler and
// safer than fragile free-text parsing).
function PriceAlertEditor({ position, savedAlert, onSave }: { position: Position; savedAlert: { targetPrice: number; direction: 'above' | 'below' } | null; onSave: (position: Position, targetPrice: number | null, direction: 'above' | 'below') => Promise<void> }) {
  const [draft, setDraft] = useState(savedAlert?.targetPrice != null ? String(savedAlert.targetPrice) : '');
  const [direction, setDirection] = useState<'above' | 'below'>(savedAlert?.direction ?? 'above');
  const [state, setState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    setDraft(savedAlert?.targetPrice != null ? String(savedAlert.targetPrice) : '');
    setDirection(savedAlert?.direction ?? 'above');
    setState('idle'); setError(null);
  }, [savedAlert?.targetPrice, savedAlert?.direction, position.key]);
  const save = async () => {
    if (state === 'saving') return;
    const trimmed = draft.trim();
    if (trimmed === '') {
      if (savedAlert == null) return; // nothing to clear
      setState('saving'); setError(null);
      try { await onSave(position, null, direction); setState('saved'); } catch (cause) { setError(cause instanceof Error ? cause.message : 'Save failed'); setState('error'); }
      return;
    }
    const parsed = Number(trimmed);
    if (!Number.isFinite(parsed) || parsed <= 0) { setError('Enter a positive price'); setState('error'); return; }
    if (parsed === savedAlert?.targetPrice && direction === savedAlert?.direction) return;
    setState('saving'); setError(null);
    try { await onSave(position, parsed, direction); setState('saved'); } catch (cause) { setError(cause instanceof Error ? cause.message : 'Save failed'); setState('error'); }
  };
  const crossed = savedAlert != null && position.stockPrice != null
    && (savedAlert.direction === 'above' ? position.stockPrice >= savedAlert.targetPrice : position.stockPrice <= savedAlert.targetPrice);
  return <div>
    <div className="flex items-center gap-1">
      <label className="sr-only" htmlFor={`price-alert-direction-${position.key}`}>Alert direction for {position.symbol}</label>
      <select id={`price-alert-direction-${position.key}`} value={direction} onChange={event => { setDirection(event.target.value as 'above' | 'below'); setState('idle'); }} className="rounded border border-white/20 bg-transparent px-1 py-1 text-[10px] text-white focus:outline-none focus:ring-2 focus:ring-teal-400">
        <option value="above" className="text-black">≥</option>
        <option value="below" className="text-black">≤</option>
      </select>
      <label className="sr-only" htmlFor={`price-alert-target-${position.key}`}>Target price for {position.symbol}</label>
      <input id={`price-alert-target-${position.key}`} type="text" inputMode="decimal" placeholder="Target $" value={draft}
        onChange={event => { setDraft(event.target.value); setState('idle'); }}
        onBlur={() => void save()}
        onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); void save(); } else if (event.key === 'Escape') { event.preventDefault(); setDraft(savedAlert?.targetPrice != null ? String(savedAlert.targetPrice) : ''); setDirection(savedAlert?.direction ?? 'above'); setState('idle'); setError(null); } }}
        className="w-16 rounded border border-white/20 bg-transparent px-2 py-1 text-xs text-white focus:outline-none focus:ring-2 focus:ring-teal-400" />
    </div>
    <span className="mt-1 block text-[9px] text-white/40">{state === 'saving' ? 'Saving…' : state === 'saved' ? 'Saved' : state === 'error' ? error : 'Enter or blur to save'}</span>
    {crossed && <span className="mt-1 block rounded bg-emerald-500/20 px-1.5 py-0.5 text-[9px] font-bold text-emerald-300">Target reached</span>}
  </div>;
}

function AnalysisRow({ position: p, columns, th, actions, onExecute, renderStopControl, onAnalyze, savedNote, onSaveNote, savedAlert, onSaveAlert, chartOpen, setChartOpen, sparkData, setSparkData, sparkLoading, setSparkLoading }: { position: Position; columns: AnalysisColumnId[]; th: typeof THEMES[Theme]; actions: ActionType[]; onExecute?: (position: Position, action: ActionType, initialRollMode?: 'close' | 'roll') => void; renderStopControl?: (position: Position) => ReactNode; onAnalyze?: (position: Position) => void; savedNote: string; onSaveNote: (position: Position, note: string) => Promise<void>; savedAlert: { targetPrice: number; direction: 'above' | 'below' } | null; onSaveAlert: (position: Position, targetPrice: number | null, direction: 'above' | 'below') => Promise<void>; chartOpen: boolean; setChartOpen: (open: boolean) => void; sparkData: number[] | null; setSparkData: (data: number[] | null) => void; sparkLoading: boolean; setSparkLoading: (loading: boolean) => void }) {
  const first = p.snapshotHistory?.[0];
  const moneyness = buildMoneynessViewModel(p.stockPrice, p.legs);
  const capital = buildCapitalViewModel(p);
  const pnl = p.closeNowPnl ?? p.pnl;
  const pctOfTarget = profitTargetPct(p, pnl);
  const stop = stopPresentation(p.stopLossClassification);
  const stopControl = renderStopControl?.(p) ?? null;
  const breakeven = buildBreakevenViewModel(p);
  const entryTone = p.entryPriceEffect === 'Credit' ? 'positive' : p.entryPriceEffect === 'Debit' ? 'warning' : 'neutral';
  const firstPnl = first?.pnl;
  const firstBuffer = first?.buffer ?? p.otmAtEntry;
  const bufferTone: SemanticTone = firstBuffer == null || p.buffer == null ? 'neutral' : firstBuffer > 0 && p.buffer <= 0 ? 'negative' : p.buffer < firstBuffer ? 'warning' : p.buffer > firstBuffer ? 'positive' : 'neutral';
  const cell: Record<AnalysisColumnId, ReactNode> = {
    identity: <><b className="text-white">{p.symbol}</b><span className="block text-amber-300">{p.strategy}</span><span className={th.textFaint}>{p.quantity} contract{p.quantity === 1 ? '' : 's'}</span></>,
    dates: <>{p.entryDate ?? 'Entry unavailable'}<b className="block text-white">{p.expDate}</b><span>{p.dte} DTE</span></>,
    underlying: <><b className="block text-white">{money(p.stockPrice)}</b>{moneyness ? <span className={`block ${SEMANTIC_TONE_CLASS[moneyness.tone]}`}>{moneyness.state === 'ATM' ? 'ATM' : `${moneyness.distancePct.toFixed(1)}% ${moneyness.state}`}</span> : <span className={`block ${th.textFaint}`} title="No unambiguous canonical management leg">Strike distance unavailable</span>}<ChartLinkButton symbol={p.symbol} chartSymbol={INDEX_CHART_SYMBOLS[p.symbol.toUpperCase()] ?? p.symbol} instanceKey={p.key} th={th} showChart={chartOpen} setShowChart={setChartOpen} sparkData={sparkData} setSparkData={setSparkData} sparkLoading={sparkLoading} setSparkLoading={setSparkLoading} /></>,
    strike: <><span className="block">{p.legs.map(leg => `${leg.strikePrice}${leg.optionType}`).join(' / ') || '—'}</span><span className={`block ${breakeven.values.length ? 'text-white' : th.textFaint}`} title={breakeven.unavailableReason ?? undefined}>{breakeven.values.length ? `BE ${breakeven.values.map(value => value.toFixed(2)).join(' / ')}` : 'BE —'}</span></>,
    capital: <><b className="text-white">{capital.label}</b>{capital.value == null ? <span className={`block max-w-40 ${th.textFaint}`} title={capital.reason}>{capital.reason}</span> : <span className="block">{capital.suffix ? `${capital.value}${capital.suffix}` : money(capital.value)}</span>}</>,
    entry: <><b className={SEMANTIC_TONE_CLASS[entryTone]}>{p.entryPriceEffect}</b><span className={`block ${SEMANTIC_TONE_CLASS[entryTone]}`}>{p.entryEconomicsComplete === false ? 'Unavailable' : money(p.entryCredit ?? p.creditReceived)}</span></>,
    value: <><span>{p.entryPriceEffect === 'Debit' ? 'Liquidation' : 'Buyback'} {money(p.closeValue)}</span><span className="block">Mid {money(p.currentValue)}</span></>,
    // PLTARGET-0001: signed % of target next to the dollar figure. >=100%
    // (target reached/exceeded) gets bold + SEMANTIC_TONE_CLASS.positive --
    // the literal moment the take-profit rule says exit -- otherwise follows
    // the sign of the % itself (Ian: signed, never floored to 0).
    pnl: <><b className={pnl == null || Math.abs(pnl) < 0.005 ? SEMANTIC_TONE_CLASS.neutral : pnl > 0 ? SEMANTIC_TONE_CLASS.positive : SEMANTIC_TONE_CLASS.negative}>{money(pnl)}{pctOfTarget != null && <span className={pctOfTarget >= 100 ? `font-bold ${SEMANTIC_TONE_CLASS.positive}` : pctOfTarget > 0 ? SEMANTIC_TONE_CLASS.positive : pctOfTarget < 0 ? SEMANTIC_TONE_CLASS.negative : SEMANTIC_TONE_CLASS.neutral}> ({pctOfTarget.toFixed(0)}%)</span>}</b><span className="block">{profitTargetPresentation(p)}</span></>,
    evolution: <><span className="block text-white">first tracked → now</span><SemanticComparison label="P/L" prior={firstPnl} current={pnl} tone={comparisonTone(firstPnl, pnl)} digits={0} /><SemanticComparison label="Δ" prior={first?.netDelta ?? p.deltaAtEntry} current={p.netDelta} tone={directionalMovementTone(first?.netDelta ?? p.deltaAtEntry, p.netDelta)} /><SemanticComparison label="Θ" prior={first?.theta ?? p.thetaAtEntry} current={p.theta} tone={directionalMovementTone(first?.theta ?? p.thetaAtEntry, p.theta)} /><SemanticComparison label="Γ" prior={first?.gamma ?? p.gammaAtEntry} current={p.gamma} tone={directionalMovementTone(first?.gamma ?? p.gammaAtEntry, p.gamma)} digits={3} /><SemanticComparison label="V" prior={first?.netVega ?? p.vegaAtEntry} current={p.netVega} tone={directionalMovementTone(first?.netVega ?? p.vegaAtEntry, p.netVega)} /><SemanticComparison label="IV" prior={first?.iv ?? p.ivAtEntry} current={p.iv} tone={directionalMovementTone(first?.iv ?? p.ivAtEntry, p.iv)} suffix="%" /><SemanticComparison label="IVR" prior={first?.ivr ?? p.ivrAtEntry} current={p.ivr} tone={directionalMovementTone(first?.ivr ?? p.ivrAtEntry, p.ivr)} /><SemanticComparison label="Strike distance" prior={firstBuffer} current={p.buffer} tone={bufferTone} suffix="%" /><span className="block"><span className="text-white/70">DTE </span><span className="text-white/40">{first?.dte ?? p.dteAtEntry ?? '—'}</span><span className="px-1 text-white/30">→</span><span className={p.dte <= 21 ? 'font-semibold text-red-400' : p.dte <= 35 ? 'font-semibold text-amber-300' : 'text-white/50'}>{p.dte}</span></span></>,
    greeks: <>Δ {number(p.netDelta)}<br/>Θ {number(p.theta)}<br/>Γ {number(p.gamma, 3)}<br/>V {number(p.netVega)}</>,
    // PW-0001: theta - estimated gamma drag, peak-relative color, day-over-day
    // change, rollover alarm. Standalone column, not folded into greeks/evolution
    // -- derived composite with its own peak-tracking semantics per Ian/Diane.
    netEdge: (() => {
      const live = netEdgeLive(p);
      const peak = netEdgePeak(p);
      const chg = netEdgeDayChangePct(p);
      const rolled = netEdgeRolledOver(p);
      const days = netEdgeDaysTracked(p);
      return <>
        <b className={netEdgeColor(p, th.textFaint)}>{live == null ? '—' : `${live >= 0 ? '+' : ''}$${live.toFixed(0)}/d`}</b>
        {chg != null && <span className={`block ${chg >= 0 ? SEMANTIC_TONE_CLASS.positive : SEMANTIC_TONE_CLASS.negative}`}>{chg >= 0 ? '+' : ''}{chg.toFixed(0)}% since yesterday</span>}
        {peak != null && <span className={`block ${th.textFaint}`}>Peak ${peak.toFixed(0)}/d · tracked {days}d</span>}
        {rolled && <span className="block text-amber-400">Rolled over from peak</span>}
      </>;
    })(),
    // POP-0001: two readings of the same lognormal engine, different
    // thresholds. Breakeven = "will I keep my credit" (existing p.pop).
    // Strike = "will price ever touch my strike" (new, p.popVsStrike). Both
    // null for debit/long positions (NFLX/UBER/MRNA-style) -- same
    // limitation calcPositionPop already has, not a regression.
    pop: <>
      <span className="block"><span className={th.textFaint}>Breakeven </span><b className="text-white">{p.pop == null ? '—' : `${p.pop.toFixed(1)}%`}</b></span>
      <span className="block"><span className={th.textFaint}>Strike </span><b className="text-white">{p.popVsStrike == null ? '—' : `${p.popVsStrike.toFixed(1)}%`}</b></span>
    </>,
    volatility: <>IV {number(p.iv)}%<br/>IVR {number(p.ivr)}</>,
    orders: <><span className={p.hasGtc ? SEMANTIC_TONE_CLASS.positive : SEMANTIC_TONE_CLASS.warning}>GTC {p.hasGtc ? 'Live' : 'None'}</span><span className={`block ${SEMANTIC_TONE_CLASS[stop.tone]}`}>Stop {stop.label}</span><span className="mt-2 block">{stopControl ?? <span className={th.textFaint}>{stop.action} review blocked by the current canonical order workflow</span>}</span>{p.entryPriceEffect === 'Debit' && <span className={`mt-1 block max-w-44 ${th.textFaint}`}>Debit stop submission remains blocked until the canonical sell-to-close stop path supports it.</span>}</>,
    notes: <PositionNoteEditor position={p} savedNote={savedNote} onSave={onSaveNote} />,
    priceAlert: <PriceAlertEditor position={p} savedAlert={savedAlert} onSave={onSaveAlert} />,
    recommendation: <><b className={SEMANTIC_TONE_CLASS[recommendationTone(p)]}>{p.recommendation?.label ?? 'Hold'}</b><span className={`block max-w-48 ${th.textFaint}`}>{p.structureAmbiguous ? p.structureBlockMessage : p.recommendation?.managementIntent?.reasons?.[0] ?? p.recommendation?.primaryReason ?? 'Continue monitoring'}</span><span className="mt-2 flex max-w-64 flex-wrap gap-1"><button type="button" onClick={() => onAnalyze?.(p)} disabled={!onAnalyze} title={!onAnalyze ? 'Canonical analysis is unavailable' : undefined} className="min-h-8 rounded border border-blue-500/50 px-2 text-[10px] text-blue-300 focus:ring-2 focus:ring-blue-400 disabled:cursor-not-allowed disabled:opacity-40">Analyze with AI</button>{actions.map(action => action === 'CLOSE_ROLL' ? <span key={action} className="contents"><button type="button" onClick={() => onExecute?.(p, action, 'close')} className="min-h-8 rounded border border-white/20 px-2 text-[10px] text-white focus:ring-2 focus:ring-teal-400">Close Position</button><button type="button" onClick={() => onExecute?.(p, action, 'roll')} className="min-h-8 rounded border border-purple-500/50 px-2 text-[10px] text-purple-300 focus:ring-2 focus:ring-purple-400">Roll Position</button></span> : <button key={action} type="button" onClick={() => onExecute?.(p, action)} className="min-h-8 rounded border border-white/20 px-2 text-[10px] text-white focus:ring-2 focus:ring-teal-400">{ACTION_LABELS[action] ?? action}</button>)}</span><span className={`mt-1 block ${th.textFaint}`}>Suggested Action is deterministic. Actions open review only; no order is submitted here.</span></>,
  };
  return <tr className="align-top hover:bg-white/[0.03]">{ANALYSIS_COLUMNS.filter(column => columns.includes(column.id)).map(column => <td key={column.id} className={`max-w-64 border-b border-r border-white/10 px-3 py-3 ${th.textMuted} ${column.id === 'identity' ? `sticky left-0 z-10 ${th.card}` : ''}`}>{cell[column.id]}</td>)}</tr>;
}

function FilterDialog({ draft, setDraft, onClose, onApply, onClear }: { draft: PositionAnalysisFilters; setDraft: (value: PositionAnalysisFilters) => void; onClose: () => void; onApply: () => void; onClear: () => void }) {
  const update = <K extends keyof PositionAnalysisFilters>(key: K, value: PositionAnalysisFilters[K]) => setDraft({ ...draft, [key]: value });
  return <DialogShell title="Filter positions" onClose={onClose}><div className="grid gap-4 sm:grid-cols-2"><label className="text-xs">Symbol<input value={draft.symbol} onChange={event => update('symbol', event.target.value)} className="mt-1 block min-h-11 w-full rounded border border-white/20 bg-slate-900 px-3" /></label><label className="text-xs">Strategy<input value={draft.strategy} onChange={event => update('strategy', event.target.value)} className="mt-1 block min-h-11 w-full rounded border border-white/20 bg-slate-900 px-3" /></label><label className="text-xs">Attention<select value={draft.attention} onChange={event => update('attention', event.target.value as PositionAnalysisFilters['attention'])} className="mt-1 block min-h-11 w-full rounded border border-white/20 bg-slate-900 px-3"><option value="all">All</option><option value="attention">Needs attention</option><option value="monitoring">Monitoring</option></select></label><label className="text-xs">Open P/L<select value={draft.pnl} onChange={event => update('pnl', event.target.value as PositionAnalysisFilters['pnl'])} className="mt-1 block min-h-11 w-full rounded border border-white/20 bg-slate-900 px-3"><option value="all">All</option><option value="positive">Positive</option><option value="negative">Negative</option><option value="unavailable">Unavailable</option></select></label></div><div className="mt-5 flex justify-between"><button onClick={onClear} className="min-h-11 px-3 text-xs">Clear All</button><div className="flex gap-2"><button onClick={onClose} className="min-h-11 rounded border border-white/20 px-4 text-xs">Cancel</button><button onClick={onApply} className="min-h-11 rounded bg-teal-500 px-4 text-xs font-bold text-slate-950">Apply</button></div></div></DialogShell>;
}

function ColumnsDialog({ selected, setSelected, preset, onClose, onApply }: { selected: AnalysisColumnId[]; setSelected: (value: AnalysisColumnId[]) => void; preset: AnalysisViewId; onClose: () => void; onApply: () => void }) {
  const toggle = (id: AnalysisColumnId) => setSelected(selected.includes(id) ? selected.filter(value => value !== id) : [...selected, id]);
  return <DialogShell title="Customize columns" onClose={onClose}><div className="grid gap-2 sm:grid-cols-2">{ANALYSIS_COLUMNS.map(column => <label key={column.id} className="flex min-h-11 items-center gap-2 rounded border border-white/10 px-3 text-xs"><input type="checkbox" checked={selected.includes(column.id)} disabled={column.id === 'identity'} onChange={() => toggle(column.id)} /><span><b className="block">{column.label}</b><span className="text-white/50">{column.group}</span></span></label>)}</div><div className="mt-5 flex justify-between"><button onClick={() => setSelected(columnsForView(preset === 'custom' ? 'management' : preset))} className="min-h-11 px-3 text-xs">Reset to preset</button><div className="flex gap-2"><button onClick={onClose} className="min-h-11 rounded border border-white/20 px-4 text-xs">Cancel</button><button disabled={selected.length < 2} onClick={onApply} className="min-h-11 rounded bg-teal-500 px-4 text-xs font-bold text-slate-950 disabled:opacity-40">Apply</button></div></div></DialogShell>;
}

export function PositionsWorkspace({ model, th, getManagementActions, onExecute, renderStopControl, onAnalyze, renderAnalysisConversation }: { model: PositionsWorkspaceModel; th: typeof THEMES[Theme] } & ManagementActionProps) {
  const [view, setView] = useState<'portfolio' | 'analysis'>('portfolio');
  useEffect(() => { const loaded = loadPreferences(); setView(loaded.workspaceView); }, []);
  const switchView = (next: 'portfolio' | 'analysis') => { setView(next); const loaded = loadPreferences(); savePreferences({ ...loaded, workspaceView: next }); };
  return <section className="p-4 sm:p-6" aria-label="Positions workspace"><div role="tablist" aria-label="Positions workspace views" className={`mb-4 flex gap-1 border-b ${th.border}`}>{(['portfolio', 'analysis'] as const).map(item => <button key={item} role="tab" aria-selected={view === item} onClick={() => switchView(item)} className={`min-h-11 border-b-2 px-4 text-xs font-bold tracking-wider focus:outline-none focus:ring-2 focus:ring-teal-400 ${view === item ? 'border-teal-400 text-white' : `border-transparent ${th.textFaint}`}`}>{item === 'portfolio' ? 'Portfolio' : 'Position Analysis'}</button>)}</div>{view === 'portfolio' ? <PortfolioView groups={model.symbolGroups} th={th} /> : <AnalysisView model={model} th={th} getManagementActions={getManagementActions} onExecute={onExecute} renderStopControl={renderStopControl} onAnalyze={onAnalyze} renderAnalysisConversation={renderAnalysisConversation} />}</section>;
}
SCRIPT_EOF

mkdir -p "$(dirname "features/portfolio/positions-workspace/model/columns.ts")"
cat > features/portfolio/positions-workspace/model/columns.ts << 'SCRIPT_EOF'
import type { AnalysisColumnId, AnalysisViewId } from './types';

export const ANALYSIS_COLUMNS: ReadonlyArray<{ id: AnalysisColumnId; label: string; group: string }> = [
  { id: 'identity', label: 'Position', group: 'Position' },
  { id: 'dates', label: 'Dates', group: 'Position' },
  { id: 'underlying', label: 'Strike Gap', group: 'Position' },
  { id: 'strike', label: 'Strike / BE', group: 'Position' },
  { id: 'capital', label: 'Capital', group: 'Economics' },
  { id: 'entry', label: 'Entry Credit / Debit', group: 'Economics' },
  { id: 'value', label: 'Close Value', group: 'Economics' },
  { id: 'pnl', label: 'P/L / Target', group: 'Economics' },
  { id: 'evolution', label: 'Since Tracked', group: 'Movement' },
  { id: 'greeks', label: 'Greeks', group: 'Risk & Greeks' },
  { id: 'netEdge', label: 'Net Edge', group: 'Risk & Greeks' },
  { id: 'pop', label: 'POP', group: 'Risk & Greeks' },
  { id: 'volatility', label: 'IV / IVR', group: 'Risk & Greeks' },
  { id: 'orders', label: 'Orders / Stop', group: 'Orders' },
  { id: 'notes', label: 'Notes', group: 'Position' },
  { id: 'priceAlert', label: 'Price Alert', group: 'Position' },
  { id: 'recommendation', label: 'Suggested Action', group: 'Recommendation' },
] as const;

const MANAGEMENT: AnalysisColumnId[] = ['identity', 'dates', 'underlying', 'strike', 'capital', 'entry', 'value', 'pnl', 'orders', 'notes', 'priceAlert', 'recommendation'];
const RISK: AnalysisColumnId[] = ['identity', 'dates', 'underlying', 'strike', 'pnl', 'evolution', 'greeks', 'netEdge', 'pop', 'volatility', 'notes', 'recommendation'];
const FULL = ANALYSIS_COLUMNS.map(column => column.id);

export function columnsForView(view: Exclude<AnalysisViewId, 'custom'>): AnalysisColumnId[] {
  return view === 'management' ? [...MANAGEMENT] : view === 'risk' ? [...RISK] : [...FULL];
}

export function sanitizeColumns(value: unknown): AnalysisColumnId[] {
  if (!Array.isArray(value)) return columnsForView('management');
  const valid = new Set(ANALYSIS_COLUMNS.map(column => column.id));
  const selected = Array.from(new Set(value.filter((id): id is AnalysisColumnId => typeof id === 'string' && valid.has(id as AnalysisColumnId))));
  if (!selected.includes('identity')) selected.unshift('identity');
  return selected.length >= 2 ? selected : columnsForView('management');
}
SCRIPT_EOF

mkdir -p "$(dirname "features/portfolio/positions-workspace/model/types.ts")"
cat > features/portfolio/positions-workspace/model/types.ts << 'SCRIPT_EOF'
import type { Position, PendingOrder } from '@/lib/portfolio-data/types';
import type { EquityHolding, PortfolioSnapshot, SnapshotDataQuality } from '@/lib/portfolio-snapshot/types';

export type PositionsWorkspaceView = 'portfolio' | 'analysis';
export type AnalysisViewId = 'management' | 'risk' | 'full' | 'custom';
export type AnalysisColumnId =
  | 'identity' | 'dates' | 'underlying' | 'strike' | 'capital' | 'entry'
  | 'value' | 'pnl' | 'evolution' | 'greeks' | 'netEdge' | 'pop' | 'volatility'
  | 'orders' | 'notes' | 'priceAlert' | 'recommendation';

export interface PositionAnalysisFilters {
  symbol: string;
  strategy: string;
  attention: 'all' | 'attention' | 'monitoring';
  pnl: 'all' | 'positive' | 'negative' | 'unavailable';
}

export interface CapacityViewModel {
  status: 'ok' | 'unavailable';
  sharesOwned: number;
  allocatedContracts: number;
  reservedContracts: number;
  availableContracts: number;
  remainderShares: number;
  basisComplete: boolean;
  blockingReason: string | null;
  unallocatedShares: number;
}

export type SymbolAssetComposition = 'equity-only' | 'long-option-only' | 'short-option-only' | 'mixed-options' | 'equity-and-options' | 'ambiguous';
export type InstrumentRole = 'long-equity' | 'short-equity' | 'long-call' | 'long-put' | 'short-call' | 'short-put' | 'multi-leg-option-structure' | 'ambiguous-option-structure';
export interface FinancialAggregate {
  value: number | null;
  completeness: 'complete' | 'partial' | 'unavailable' | 'not-applicable';
  includedCount: number;
  expectedCount: number;
  excludedInstrumentKeys: string[];
  reasons: string[];
  basis: 'mark-mid' | 'marketable-close' | 'mixed' | null;
  asOf: string | null;
}
export interface OptionInstrumentViewModel {
  key: string;
  position: Position;
  role: InstrumentRole;
  roleLabel: string;
  midpointLabel: string;
  marketableLabel: string;
}

export interface SymbolGroupViewModel {
  symbol: string;
  underlyingPrice: number | null;
  equityMarketValue: number | null;
  optionMarketValue: number | null;
  symbolUnrealizedPnl: number | null;
  equities: EquityHolding[];
  options: Position[];
  instrumentCount: number;
  strategies: string[];
  capacity: CapacityViewModel;
  needsAttention: boolean;
  contextualAction: 'covered-call' | 'short-call' | 'replacement' | null;
  composition: SymbolAssetComposition;
  compositionLabel: string;
  equityMarketValueAggregate: FinancialAggregate;
  longOptionValueMid: FinancialAggregate;
  optionBuybackMid: FinancialAggregate;
  optionMarketableClose: FinancialAggregate;
  unrealizedPnlMid: FinancialAggregate;
  optionCloseNowPnl: FinancialAggregate;
  unrealizedPnlPct: number | null;
  unrealizedPnlPctReason: string | null;
  optionInstruments: OptionInstrumentViewModel[];
}

export interface PositionAnalysisRowViewModel {
  id: string;
  position: Position;
  symbol: string;
  strategy: string;
  needsAttention: boolean;
}

export type ExistingIncomeOpportunityKind = 'pmcc-short-call' | 'covered-call';
export type ExistingIncomeOpportunityStatus = 'eligible' | 'no-capacity' | 'not-eligible' | 'unavailable';

/**
 * A portfolio-first, review-only income opportunity. This deliberately does
 * not assert that writing a call is attractive; timing policy is evaluated in
 * a later approved slice.
 */
export interface ExistingIncomeOpportunity {
  id: string;
  kind: ExistingIncomeOpportunityKind;
  status: ExistingIncomeOpportunityStatus;
  symbol: string;
  positionKey: string | null;
  title: string;
  reason: string;
  freshness: string;
  exactContract: string | null;
  sharesOwned: number | null;
  allocatedContracts: number | null;
  reservedContracts: number | null;
  availableContracts: number | null;
}

export interface PositionsWorkspaceModel {
  accountNumber: string | null;
  snapshotAsOf: string | null;
  quoteAsOf: string | null;
  dataQuality: SnapshotDataQuality;
  symbolGroups: SymbolGroupViewModel[];
  analysisRows: PositionAnalysisRowViewModel[];
  incomeOpportunities?: ExistingIncomeOpportunity[];
}

export interface PositionsWorkspaceInput {
  snapshot: PortfolioSnapshot | null;
  positions: Position[];
  pendingOrders: PendingOrder[];
  snapshotDataQuality: SnapshotDataQuality;
}
SCRIPT_EOF

git add app/api/position-price-alerts/route.ts features/portfolio/positions-workspace/PositionsWorkspace.tsx features/portfolio/positions-workspace/model/columns.ts features/portfolio/positions-workspace/model/types.ts
git commit -m "feat(portfolio): PRICEALERT-0001 per-position price-target alert"
git push

echo "PRICEALERT-0001 deployed. Verify via Vercel preview."
