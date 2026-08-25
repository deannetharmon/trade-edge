'use client';

import Link from 'next/link';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { ActionType, Position } from '@/lib/portfolio-data/types';
import type { THEMES, Theme } from '@/lib/theme';
import { ANALYSIS_COLUMNS, columnsForView } from './model/columns';
import { activeFilterCount, DEFAULT_FILTERS, matchesAnalysisFilters } from './model/filters';
import { DEFAULT_PREFERENCES, loadPreferences, savePreferences } from './model/preferences';
import { buildCapitalViewModel, buildMoneynessViewModel, comparisonTone, directionalMovementTone, SEMANTIC_TONE_CLASS, stopPresentation, type SemanticTone } from './model/presentation';
import type { AnalysisColumnId, AnalysisViewId, FinancialAggregate, PositionAnalysisFilters, PositionsWorkspaceModel, SymbolGroupViewModel } from './model/types';

export function isPositionsWorkspaceV2Enabled(value = process.env.NEXT_PUBLIC_POSITIONS_WORKSPACE_V2_ENABLED): boolean {
  return value === 'true';
}

const money = (value: number | null) => value == null || !Number.isFinite(value) ? 'Unavailable' : new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(value);
const number = (value: number | null | undefined, digits = 1) => value == null || !Number.isFinite(value) ? '—' : value.toFixed(digits);

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
  onExecute?: (position: Position, action: ActionType) => void;
  renderStopControl?: (position: Position) => ReactNode;
}

function AnalysisView({ model, th, getManagementActions, onExecute, renderStopControl }: { model: PositionsWorkspaceModel; th: typeof THEMES[Theme] } & ManagementActionProps) {
  const [preferences, setPreferences] = useState(DEFAULT_PREFERENCES);
  const [hydrated, setHydrated] = useState(false);
  const [filterOpen, setFilterOpen] = useState(false);
  const [columnsOpen, setColumnsOpen] = useState(false);
  const [draftFilters, setDraftFilters] = useState(preferences.filters);
  const [draftColumns, setDraftColumns] = useState<AnalysisColumnId[]>(preferences.customColumnIds);
  useEffect(() => { const loaded = loadPreferences(); setPreferences(loaded); setDraftFilters(loaded.filters); setDraftColumns(loaded.customColumnIds); setHydrated(true); }, []);
  useEffect(() => { if (hydrated) savePreferences(preferences); }, [preferences, hydrated]);
  const columns = preferences.analysisView === 'custom' ? preferences.customColumnIds : columnsForView(preferences.analysisView);
  const rows = model.analysisRows.filter(row => matchesAnalysisFilters(row, preferences.filters));
  const chooseView = (view: AnalysisViewId) => setPreferences(current => ({ ...current, analysisView: view, customColumnIds: view === 'custom' ? current.customColumnIds : columnsForView(view) }));
  return <>
    <div className={`mb-3 flex flex-wrap items-center gap-2 rounded-xl border ${th.border} p-3`}><label className={`text-xs ${th.textMuted}`}>View <select value={preferences.analysisView} onChange={event => chooseView(event.target.value as AnalysisViewId)} className="ml-2 min-h-11 rounded border border-white/20 bg-slate-950 px-3 text-white focus:ring-2 focus:ring-teal-400"><option value="management">Management</option><option value="risk">Risk</option><option value="full">Full Detail</option><option value="custom">Custom</option></select></label><button type="button" onClick={() => { setDraftFilters(preferences.filters); setFilterOpen(true); }} className="min-h-11 rounded border border-white/20 px-3 text-xs text-white focus:ring-2 focus:ring-teal-400">Filter{activeFilterCount(preferences.filters) ? ` ${activeFilterCount(preferences.filters)}` : ''}</button><button type="button" onClick={() => { setDraftColumns(columns); setColumnsOpen(true); }} className="min-h-11 rounded border border-white/20 px-3 text-xs text-white focus:ring-2 focus:ring-teal-400">Customize Columns</button><span className={`ml-auto text-xs ${th.textFaint}`}>{rows.length} of {model.analysisRows.length} positions</span></div>
    <div className="max-w-full overflow-x-auto rounded-xl border border-white/10" tabIndex={0} aria-label="Position analysis table, horizontally scrollable"><table className="min-w-max border-collapse text-left text-[11px]"><thead><tr>{ANALYSIS_COLUMNS.filter(column => columns.includes(column.id)).map(column => <th key={column.id} scope="col" className={`whitespace-nowrap border-b border-r border-white/10 bg-slate-950 px-3 py-3 uppercase tracking-wider text-white/50 ${column.id === 'identity' ? 'sticky left-0 z-20' : ''}`}>{column.label}</th>)}</tr></thead><tbody>{rows.map(row => <AnalysisRow key={row.id} position={row.position} columns={columns} th={th} actions={getManagementActions?.(row.position) ?? []} onExecute={onExecute} renderStopControl={renderStopControl} />)}</tbody></table></div>
    {filterOpen && <FilterDialog draft={draftFilters} setDraft={setDraftFilters} onClose={() => setFilterOpen(false)} onApply={() => { setPreferences(current => ({ ...current, filters: draftFilters })); setFilterOpen(false); }} onClear={() => setDraftFilters(DEFAULT_FILTERS)} />}
    {columnsOpen && <ColumnsDialog selected={draftColumns} setSelected={setDraftColumns} preset={preferences.analysisView} onClose={() => setColumnsOpen(false)} onApply={() => { setPreferences(current => ({ ...current, analysisView: 'custom', customColumnIds: draftColumns })); setColumnsOpen(false); }} />}
  </>;
}

const ACTION_LABELS: Partial<Record<ActionType, string>> = { TAKE_PROFIT: 'Take Profit', CLOSE_ROLL: 'Close/Roll', PLACE_GTC: 'Place GTC', CUT_LOSSES: 'Cut Losses' };

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

function AnalysisRow({ position: p, columns, th, actions, onExecute, renderStopControl }: { position: Position; columns: AnalysisColumnId[]; th: typeof THEMES[Theme]; actions: ActionType[]; onExecute?: (position: Position, action: ActionType) => void; renderStopControl?: (position: Position) => ReactNode }) {
  const first = p.snapshotHistory?.[0];
  const moneyness = buildMoneynessViewModel(p.stockPrice, p.legs);
  const capital = buildCapitalViewModel(p);
  const pnl = p.closeNowPnl ?? p.pnl;
  const stop = stopPresentation(p.stopLossClassification);
  const stopControl = renderStopControl?.(p) ?? null;
  const entryTone = p.entryPriceEffect === 'Credit' ? 'positive' : p.entryPriceEffect === 'Debit' ? 'warning' : 'neutral';
  const firstPnl = first?.pnl;
  const firstBuffer = first?.buffer ?? p.otmAtEntry;
  const bufferTone: SemanticTone = firstBuffer == null || p.buffer == null ? 'neutral' : firstBuffer > 0 && p.buffer <= 0 ? 'negative' : p.buffer < firstBuffer ? 'warning' : p.buffer > firstBuffer ? 'positive' : 'neutral';
  const cell: Record<AnalysisColumnId, ReactNode> = {
    identity: <><b className="text-white">{p.symbol}</b><span className="block text-amber-300">{p.strategy}</span><span className={th.textFaint}>{p.quantity} contract{p.quantity === 1 ? '' : 's'}</span></>,
    dates: <>{p.entryDate ?? 'Entry unavailable'}<b className="block text-white">{p.expDate}</b><span>{p.dte} DTE</span></>,
    underlying: <><b className="text-white">{money(p.stockPrice)}</b>{moneyness ? <span className={`block ${SEMANTIC_TONE_CLASS[moneyness.tone]}`}>{moneyness.state === 'ATM' ? 'ATM' : `${moneyness.distancePct.toFixed(1)}% ${moneyness.state}`}</span> : <span className={`block ${th.textFaint}`} title="No unambiguous canonical management leg">Moneyness unavailable</span>}</>,
    strike: <>{p.legs.map(leg => `${leg.strikePrice}${leg.optionType}`).join(' / ') || '—'}</>,
    capital: <><b className="text-white">{capital.label}</b>{capital.value == null ? <span className={`block max-w-40 ${th.textFaint}`} title={capital.reason}>{capital.reason}</span> : <span className="block">{capital.suffix ? `${capital.value}${capital.suffix}` : money(capital.value)}</span>}</>,
    entry: <><b className={SEMANTIC_TONE_CLASS[entryTone]}>{p.entryPriceEffect}</b><span className={`block ${SEMANTIC_TONE_CLASS[entryTone]}`}>{p.entryEconomicsComplete === false ? 'Unavailable' : money(p.entryCredit ?? p.creditReceived)}</span></>,
    value: <><span>{p.entryPriceEffect === 'Debit' ? 'Liquidation' : 'Buyback'} {money(p.closeValue)}</span><span className="block">Mid {money(p.currentValue)}</span></>,
    pnl: <><b className={pnl == null || Math.abs(pnl) < 0.005 ? SEMANTIC_TONE_CLASS.neutral : pnl > 0 ? SEMANTIC_TONE_CLASS.positive : SEMANTIC_TONE_CLASS.negative}>{money(pnl)}</b><span className="block">Target {p.profitTarget}%</span></>,
    evolution: <><span className="block text-white">first tracked → now</span><SemanticComparison label="P/L" prior={firstPnl} current={pnl} tone={comparisonTone(firstPnl, pnl)} digits={0} /><SemanticComparison label="POP" prior={first?.pop ?? p.popAtEntry} current={p.pop} tone={comparisonTone(first?.pop ?? p.popAtEntry, p.pop)} /><SemanticComparison label="Δ" prior={first?.netDelta ?? p.deltaAtEntry} current={p.netDelta} tone={directionalMovementTone(first?.netDelta ?? p.deltaAtEntry, p.netDelta)} /><SemanticComparison label="Θ" prior={first?.theta ?? p.thetaAtEntry} current={p.theta} tone={directionalMovementTone(first?.theta ?? p.thetaAtEntry, p.theta)} /><SemanticComparison label="Γ" prior={first?.gamma ?? p.gammaAtEntry} current={p.gamma} tone={directionalMovementTone(first?.gamma ?? p.gammaAtEntry, p.gamma)} digits={3} /><SemanticComparison label="V" prior={first?.netVega ?? p.vegaAtEntry} current={p.netVega} tone={directionalMovementTone(first?.netVega ?? p.vegaAtEntry, p.netVega)} /><SemanticComparison label="IV" prior={first?.iv ?? p.ivAtEntry} current={p.iv} tone={directionalMovementTone(first?.iv ?? p.ivAtEntry, p.iv)} suffix="%" /><SemanticComparison label="IVR" prior={first?.ivr ?? p.ivrAtEntry} current={p.ivr} tone={directionalMovementTone(first?.ivr ?? p.ivrAtEntry, p.ivr)} /><SemanticComparison label="Moneyness" prior={firstBuffer} current={p.buffer} tone={bufferTone} suffix="%" /><span className="block"><span className="text-white/70">DTE </span><span className="text-white/40">{first?.dte ?? p.dteAtEntry ?? '—'}</span><span className="px-1 text-white/30">→</span><span className={p.dte <= 21 ? 'font-semibold text-red-400' : p.dte <= 35 ? 'font-semibold text-amber-300' : 'text-white/50'}>{p.dte}</span></span></>,
    greeks: <>Δ {number(p.netDelta)}<br/>Θ {number(p.theta)}<br/>Γ {number(p.gamma, 3)}<br/>V {number(p.netVega)}</>,
    volatility: <>IV {number(p.iv)}%<br/>IVR {number(p.ivr)}</>,
    orders: <><span className={p.hasGtc ? SEMANTIC_TONE_CLASS.positive : SEMANTIC_TONE_CLASS.warning}>GTC {p.hasGtc ? 'Live' : 'None'}</span><span className={`block ${SEMANTIC_TONE_CLASS[stop.tone]}`}>Stop {stop.label}</span><span className="mt-2 block">{stopControl ?? <span className={th.textFaint}>{stop.action} review blocked by the current canonical order workflow</span>}</span>{p.entryPriceEffect === 'Debit' && <span className={`mt-1 block max-w-44 ${th.textFaint}`}>Debit stop submission remains blocked until the canonical sell-to-close stop path supports it.</span>}</>,
    recommendation: <><b className={SEMANTIC_TONE_CLASS[recommendationTone(p)]}>{p.recommendation?.label ?? 'Hold'}</b><span className={`block max-w-48 ${th.textFaint}`}>{p.structureAmbiguous ? p.structureBlockMessage : p.recommendation?.primaryReason ?? 'Continue monitoring'}</span>{actions.length > 0 && <span className="mt-2 flex max-w-56 flex-wrap gap-1">{actions.map(action => <button key={action} type="button" onClick={() => onExecute?.(p, action)} className="min-h-11 rounded border border-white/20 px-2 text-[10px] text-white focus:ring-2 focus:ring-teal-400">{ACTION_LABELS[action] ?? action}</button>)}</span>}<span className={`mt-1 block ${th.textFaint}`}>Actions open the existing review flow; no order is submitted here.</span></>,
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

export function PositionsWorkspace({ model, th, getManagementActions, onExecute, renderStopControl }: { model: PositionsWorkspaceModel; th: typeof THEMES[Theme] } & ManagementActionProps) {
  const [view, setView] = useState<'portfolio' | 'analysis'>('portfolio');
  useEffect(() => { const loaded = loadPreferences(); setView(loaded.workspaceView); }, []);
  const switchView = (next: 'portfolio' | 'analysis') => { setView(next); const loaded = loadPreferences(); savePreferences({ ...loaded, workspaceView: next }); };
  return <section className="p-4 sm:p-6" aria-label="Positions workspace"><div role="tablist" aria-label="Positions workspace views" className={`mb-4 flex gap-1 border-b ${th.border}`}>{(['portfolio', 'analysis'] as const).map(item => <button key={item} role="tab" aria-selected={view === item} onClick={() => switchView(item)} className={`min-h-11 border-b-2 px-4 text-xs font-bold tracking-wider focus:outline-none focus:ring-2 focus:ring-teal-400 ${view === item ? 'border-teal-400 text-white' : `border-transparent ${th.textFaint}`}`}>{item === 'portfolio' ? 'Portfolio' : 'Position Analysis'}</button>)}</div>{view === 'portfolio' ? <PortfolioView groups={model.symbolGroups} th={th} /> : <AnalysisView model={model} th={th} getManagementActions={getManagementActions} onExecute={onExecute} renderStopControl={renderStopControl} />}</section>;
}
