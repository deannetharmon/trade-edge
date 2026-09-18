'use client';

import Link from 'next/link';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { ActionType, Position } from '@/lib/portfolio-data/types';
import type { THEMES, Theme } from '@/lib/theme';
import { ANALYSIS_COLUMNS, columnsForView } from './model/columns';
import { activeFilterCount, DEFAULT_FILTERS, matchesAnalysisFilters } from './model/filters';
import { DEFAULT_PREFERENCES, loadPreferences, savePreferences } from './model/preferences';
import type { AnalysisColumnId, AnalysisViewId, PositionAnalysisFilters, PositionsWorkspaceModel, SymbolGroupViewModel } from './model/types';

export function isPositionsWorkspaceV2Enabled(value = process.env.NEXT_PUBLIC_POSITIONS_WORKSPACE_V2_ENABLED): boolean {
  return value === 'true';
}

const money = (value: number | null) => value == null || !Number.isFinite(value) ? 'Unavailable' : new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(value);
const number = (value: number | null | undefined, digits = 1) => value == null || !Number.isFinite(value) ? '—' : value.toFixed(digits);

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
      <div className={`grid grid-cols-[minmax(0,1.5fr)_minmax(130px,1fr)_120px] gap-3 border-b ${th.border} px-4 py-2 text-[10px] uppercase tracking-wider ${th.textFaint}`}><span>Symbol / strategy</span><span>Status</span><span className="text-right">Unrealized P/L</span></div>
      {groups.map(item => <button ref={node => { if (node) rowRefs.current.set(item.symbol, node); else rowRefs.current.delete(item.symbol); }} key={item.symbol} type="button" aria-current={item.symbol === selected ? 'true' : undefined} aria-expanded={item.symbol === selected} aria-controls="symbol-position-detail" onClick={() => { setSelected(item.symbol); setMobileDetail(true); }} className={`grid min-h-[68px] w-full grid-cols-[minmax(0,1.5fr)_minmax(130px,1fr)_120px] items-center gap-3 border-b px-4 py-3 text-left transition focus:outline-none focus:ring-2 focus:ring-inset focus:ring-teal-400 ${th.border} ${item.symbol === selected ? 'border-l-4 border-l-teal-400 bg-teal-400/10' : 'border-l-4 border-l-transparent hover:bg-white/5'}`}>
        <span><span className="block font-mono text-sm font-bold text-white">{item.symbol} <span aria-hidden="true">{item.symbol === selected ? '●' : ''}</span></span><span className={`block text-[11px] ${th.textFaint}`}>{money(item.underlyingPrice)} · {item.instrumentCount} instrument{item.instrumentCount === 1 ? '' : 's'} · {item.strategies.join(', ') || 'Equity'}</span></span>
        <span className="text-[11px]"><span className={item.needsAttention ? 'text-amber-300' : 'text-white/70'}>{item.needsAttention ? 'Needs attention' : 'Monitoring'}</span><span className={`block ${th.textFaint}`}>{item.capacity.status === 'ok' ? `${item.capacity.availableContracts * 100} shares available` : 'Capacity unavailable'}</span></span>
        <span className={`text-right font-mono text-sm font-semibold ${item.symbolUnrealizedPnl == null ? th.textFaint : item.symbolUnrealizedPnl >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>{money(item.symbolUnrealizedPnl)}</span>
      </button>)}
    </section>
    {group && <SymbolDetail group={group} th={th} mobile={mobileDetail} onBack={() => setMobileDetail(false)} onClose={closeDetail} />}
  </div>;
}

function SymbolDetail({ group, th, mobile, onBack, onClose }: { group: SymbolGroupViewModel; th: typeof THEMES[Theme]; mobile: boolean; onBack: () => void; onClose: () => void }) {
  return <aside id="symbol-position-detail" role="region" aria-labelledby="symbol-position-detail-title" onKeyDown={event => { if (event.key === 'Escape') onClose(); }} className={`${mobile ? 'block' : 'hidden lg:block'} rounded-xl border ${th.border} ${th.card} p-4`}>
    <header className={`mb-4 flex items-center justify-between border-b ${th.border} pb-3`}><div><button type="button" onClick={onBack} className="mb-2 min-h-11 text-xs text-teal-300 lg:hidden">← Back to Positions</button><h2 id="symbol-position-detail-title" className="font-mono text-lg font-bold text-white">{group.symbol} position details</h2><p className={`text-xs ${th.textFaint}`}>{group.instrumentCount} independently identified instrument{group.instrumentCount === 1 ? '' : 's'}</p></div><button type="button" onClick={onClose} className="hidden min-h-11 rounded border border-white/20 px-3 text-xs focus:ring-2 focus:ring-teal-400 lg:block" aria-label={`Close ${group.symbol} position details`}>× Close</button></header>
    <dl className="grid grid-cols-2 gap-3 text-xs"><div><dt className={th.textFaint}>Equity market value</dt><dd className="font-mono text-white">{money(group.equityMarketValue)}</dd></div><div><dt className={th.textFaint}>Option market value</dt><dd className="font-mono text-white">{money(group.optionMarketValue)}</dd></div></dl>
    <div className={`my-4 rounded border ${th.border} p-3 text-xs`}><p className="font-semibold text-white">Coverage and capacity</p>{group.capacity.status === 'ok' ? <p className={`mt-1 ${th.textMuted}`}>{group.capacity.sharesOwned} shares · {group.capacity.allocatedContracts} existing short-call contract{group.capacity.allocatedContracts === 1 ? '' : 's'} · {group.capacity.reservedContracts} reserved · {group.capacity.availableContracts * 100} available · {group.capacity.remainderShares}-share remainder</p> : <p className="mt-1 text-amber-300">{group.capacity.blockingReason}. Reliable holdings remain visible.</p>}{!group.capacity.basisComplete && <p className="mt-2 text-amber-300">Average basis unavailable — strike-vs-basis metrics unavailable.</p>}</div>
    <div className="space-y-2"><h3 className={`text-[10px] uppercase tracking-wider ${th.textFaint}`}>Instruments</h3>{group.equities.map((holding, index) => <div key={`equity-${index}`} className={`rounded border ${th.border} p-3 text-xs`}><b className="text-white">{holding.direction} {holding.quantity} shares</b><p className={th.textFaint}>Unrealized P/L {money(holding.unrealizedPnl)}</p></div>)}{group.options.map(option => <div key={option.key} className={`rounded border ${th.border} p-3 text-xs`}><b className="text-white">{option.strategy} · {option.quantity} contract{option.quantity === 1 ? '' : 's'}</b><p className={th.textFaint}>{option.expDate} · {option.dte} DTE · Coverage relationship unresolved</p></div>)}</div>
    {group.contextualAction === 'covered-call' && <Link href={`/screener?strategy=covered-call&symbol=${encodeURIComponent(group.symbol)}`} className="mt-4 inline-flex min-h-11 items-center rounded border border-teal-500 px-4 text-xs font-semibold text-teal-300">Find Covered Call</Link>}
  </aside>;
}

interface ManagementActionProps {
  getManagementActions?: (position: Position) => ActionType[];
  onExecute?: (position: Position, action: ActionType) => void;
}

function AnalysisView({ model, th, getManagementActions, onExecute }: { model: PositionsWorkspaceModel; th: typeof THEMES[Theme] } & ManagementActionProps) {
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
    <div className="max-w-full overflow-x-auto rounded-xl border border-white/10" tabIndex={0} aria-label="Position analysis table, horizontally scrollable"><table className="min-w-max border-collapse text-left text-[11px]"><thead><tr>{ANALYSIS_COLUMNS.filter(column => columns.includes(column.id)).map(column => <th key={column.id} scope="col" className={`whitespace-nowrap border-b border-r border-white/10 bg-slate-950 px-3 py-3 uppercase tracking-wider text-white/50 ${column.id === 'identity' ? 'sticky left-0 z-20' : ''}`}>{column.label}</th>)}</tr></thead><tbody>{rows.map(row => <AnalysisRow key={row.id} position={row.position} columns={columns} th={th} actions={getManagementActions?.(row.position) ?? []} onExecute={onExecute} />)}</tbody></table></div>
    {filterOpen && <FilterDialog draft={draftFilters} setDraft={setDraftFilters} onClose={() => setFilterOpen(false)} onApply={() => { setPreferences(current => ({ ...current, filters: draftFilters })); setFilterOpen(false); }} onClear={() => setDraftFilters(DEFAULT_FILTERS)} />}
    {columnsOpen && <ColumnsDialog selected={draftColumns} setSelected={setDraftColumns} preset={preferences.analysisView} onClose={() => setColumnsOpen(false)} onApply={() => { setPreferences(current => ({ ...current, analysisView: 'custom', customColumnIds: draftColumns })); setColumnsOpen(false); }} />}
  </>;
}

const ACTION_LABELS: Partial<Record<ActionType, string>> = { TAKE_PROFIT: 'Take Profit', CLOSE_ROLL: 'Close/Roll', PLACE_GTC: 'Place GTC', CUT_LOSSES: 'Cut Losses' };

function AnalysisRow({ position: p, columns, th, actions, onExecute }: { position: Position; columns: AnalysisColumnId[]; th: typeof THEMES[Theme]; actions: ActionType[]; onExecute?: (position: Position, action: ActionType) => void }) {
  const first = p.snapshotHistory?.[0]; const prior = p.snapshotHistory?.[p.snapshotHistory.length - 1];
  const cell: Record<AnalysisColumnId, ReactNode> = {
    identity: <><b className="text-white">{p.symbol}</b><span className="block text-amber-300">{p.strategy}</span><span className={th.textFaint}>{p.quantity} contract{p.quantity === 1 ? '' : 's'}</span></>,
    dates: <>{p.entryDate ?? 'Entry unavailable'}<b className="block text-white">{p.expDate}</b><span>{p.dte} DTE</span></>,
    underlying: <><b className="text-white">{money(p.stockPrice)}</b><span className="block text-emerald-300">{number(p.buffer)}% OTM</span></>,
    strike: <>{p.legs.map(leg => `${leg.strikePrice}${leg.optionType}`).join(' / ') || '—'}</>,
    capital: <>{p.maxRiskReliable === false ? 'Unavailable' : money(p.maxRisk)}</>,
    entry: <><b className="text-white">{p.entryPriceEffect}</b><span className="block">{p.entryEconomicsComplete === false ? 'Unavailable' : money(p.entryCredit ?? p.creditReceived)}</span></>,
    value: <><span>Buyback {money(p.closeValue)}</span><span className="block">Mid {money(p.currentValue)}</span></>,
    pnl: <><b className={(p.closeNowPnl ?? p.pnl ?? 0) >= 0 ? 'text-emerald-400' : 'text-red-400'}>{money(p.closeNowPnl ?? p.pnl)}</b><span className="block">Target {p.profitTarget}%</span></>,
    evolution: <><span className="block text-white">first tracked → now</span><span>POP {number(first?.pop ?? p.pop)} → {number(p.pop)}</span><span className="block">Δ {number(first?.netDelta ?? p.deltaAtEntry)} → {number(p.netDelta)}</span><span className="block">Θ {number(first?.theta ?? p.thetaAtEntry)} → {number(p.theta)}</span><span className="block">Γ {number(first?.gamma ?? p.gammaAtEntry, 3)} → {number(p.gamma, 3)}</span><span className="block">V {number(first?.netVega ?? p.vegaAtEntry)} → {number(p.netVega)}</span><span className="block">IV {number(first?.iv ?? p.ivAtEntry)} → {number(p.iv)} · IVR {number(first?.ivr ?? p.ivrAtEntry)} → {number(p.ivr)}</span><span className="block">OTM {number(first?.buffer ?? p.otmAtEntry)} → {number(p.buffer)} · DTE {first?.dte ?? p.dteAtEntry ?? '—'} → {p.dte}</span></>,
    movement: <details><summary className="cursor-pointer text-white">{prior ? 'Prior snapshot → now' : 'Tracking — first day tracked'}</summary>{prior && <span className="mt-1 block">Stock {money(prior.stockPrice)} → {money(p.stockPrice)}<br/>P/L {money(prior.pnl)} → {money(p.pnl)}<br/>IV {number(prior.iv)} → {number(p.iv)} · POP {number(prior.pop)} → {number(p.pop)}<br/><span className={th.textFaint}>Why this changed: observed metric movement since the prior qualified snapshot; no causal claim.</span></span>}</details>,
    greeks: <>Δ {number(p.netDelta)}<br/>Θ {number(p.theta)}<br/>Γ {number(p.gamma, 3)}<br/>V {number(p.netVega)}</>,
    volatility: <>IV {number(p.iv)}%<br/>IVR {number(p.ivr)}</>,
    orders: <><span className={p.hasGtc ? 'text-emerald-400' : 'text-amber-300'}>GTC {p.hasGtc ? 'Live' : 'None'}</span><span className="block">Stop {p.stopLossClassification.replaceAll('_', ' ')}</span></>,
    recommendation: <><b className="text-white">{p.recommendation?.label ?? 'Hold'}</b><span className={`block max-w-48 ${th.textFaint}`}>{p.structureAmbiguous ? p.structureBlockMessage : p.recommendation?.primaryReason ?? 'Continue monitoring'}</span>{actions.length > 0 && <span className="mt-2 flex max-w-56 flex-wrap gap-1">{actions.map(action => <button key={action} type="button" onClick={() => onExecute?.(p, action)} className="min-h-11 rounded border border-white/20 px-2 text-[10px] text-white focus:ring-2 focus:ring-teal-400">{ACTION_LABELS[action] ?? action}</button>)}</span>}<span className={`mt-1 block ${th.textFaint}`}>Actions open the existing review flow; no order is submitted here.</span></>,
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

export function PositionsWorkspace({ model, th, getManagementActions, onExecute }: { model: PositionsWorkspaceModel; th: typeof THEMES[Theme] } & ManagementActionProps) {
  const [view, setView] = useState<'portfolio' | 'analysis'>('portfolio');
  useEffect(() => { const loaded = loadPreferences(); setView(loaded.workspaceView); }, []);
  const switchView = (next: 'portfolio' | 'analysis') => { setView(next); const loaded = loadPreferences(); savePreferences({ ...loaded, workspaceView: next }); };
  return <section className="p-4 sm:p-6" aria-label="Positions workspace"><div role="tablist" aria-label="Positions workspace views" className={`mb-4 flex gap-1 border-b ${th.border}`}>{(['portfolio', 'analysis'] as const).map(item => <button key={item} role="tab" aria-selected={view === item} onClick={() => switchView(item)} className={`min-h-11 border-b-2 px-4 text-xs font-bold tracking-wider focus:outline-none focus:ring-2 focus:ring-teal-400 ${view === item ? 'border-teal-400 text-white' : `border-transparent ${th.textFaint}`}`}>{item === 'portfolio' ? 'Portfolio' : 'Position Analysis'}</button>)}</div>{view === 'portfolio' ? <PortfolioView groups={model.symbolGroups} th={th} /> : <AnalysisView model={model} th={th} getManagementActions={getManagementActions} onExecute={onExecute} />}</section>;
}
