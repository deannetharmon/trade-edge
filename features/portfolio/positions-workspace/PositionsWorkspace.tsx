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
import { buildCapitalViewModel, buildMoneynessMovementViewModel, buildMoneynessViewModel, comparisonTone, SEMANTIC_TONE_CLASS, stopPresentation, type SemanticTone } from './model/presentation';
import { buildBreakevenViewModel } from './model/breakeven';
import type { AnalysisColumnId, AnalysisViewId, ExistingIncomeOpportunity, FinancialAggregate, PositionAnalysisFilters, PositionsWorkspaceModel, SymbolGroupViewModel } from './model/types';
import { DebitStopObservation, StopEvidencePanel } from '@/components/portfolio-data/StopEvidencePanel';
import { canonicalRecommendationToAction } from '@/lib/portfolio/canonicalRecommendationPresentation';
import { evaluateHeldPmccLiveReadiness, type HeldPmccLiveReadiness } from '@/lib/scans/pmccHeldReadinessClient';
import { buildIncomeCard } from '@/lib/leaps-position-intelligence/incomeCard';
import { buildCycleCard } from '@/lib/leaps-position-intelligence/cycleCard';
import { buildSinceOpen, isBaselineAtOpen } from '@/lib/leaps-position-intelligence/sinceOpen';
import { selectEntryRecord, type LeapsEntryRecord } from '@/lib/leaps-position-intelligence/entryRecords';
import { buildEventCallouts, earningsDateInWindow, isNearItm, type EventCalendarDates, type EventCheckStatus } from '@/lib/leaps-position-intelligence/eventNote';
import { applyMandateGates, describeIncomeRules } from '@/lib/leaps-position-intelligence/mandateGates';
import type { LeapsMandate } from '@/lib/leaps-position-intelligence/types';
import { MandateForm } from './MandateForm';
import { IncomeHistory } from './IncomeHistory';
import { DecisionHistory } from './DecisionHistory';
import { HistoryStrip } from './HistoryStrip';
import { StockHoldings } from './StockHoldings';
import type { SellStockDialogDeps } from './SellStockDialog';
import { buildPnlReconciliation, buildPnlSecondLine, buildPositionPnlBases, describePnlReconciliation, wideMarketNote } from './model/pnlBases';
import { buildSparklines, cleanHistory } from '@/lib/leaps-position-intelligence/sparklines';
import { CalloutList, TileGrid } from '@/components/dashboard/DashboardParts';

export function isPositionsWorkspaceV2Enabled(value = process.env.NEXT_PUBLIC_POSITIONS_WORKSPACE_V2_ENABLED): boolean {
  return value === 'true';
}

const money = (value: number | null) => value == null || !Number.isFinite(value) ? 'Unavailable' : new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(value);
const quotePrice = (value: number | null) => value == null || !Number.isFinite(value) ? 'Unavailable' : new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value);
const moneyExact = (value: number | null) => value == null || !Number.isFinite(value) ? 'Unavailable' : new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value);
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

function PortfolioView({ groups, th, renderStopControl }: { groups: SymbolGroupViewModel[]; th: typeof THEMES[Theme]; renderStopControl?: (position: Position) => ReactNode }) {
  const [selected, setSelected] = useState<string | null>(groups[0]?.symbol ?? null);
  const [mobileDetail, setMobileDetail] = useState(false);
  const [openChartSymbol, setOpenChartSymbol] = useState<string | null>(null);
  const [chartData, setChartData] = useState<Record<string, number[] | null>>({});
  const [chartLoadingSymbol, setChartLoadingSymbol] = useState<string | null>(null);
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
      {groups.map(item => { const primaryValue = item.equityMarketValueAggregate.completeness !== 'not-applicable' ? item.equityMarketValueAggregate : item.longOptionValueMid.completeness !== 'not-applicable' ? item.longOptionValueMid : item.optionBuybackMid; const equity = item.equities[0]; const option = item.options[0]; return <div key={item.symbol} onClick={() => { setSelected(item.symbol); setMobileDetail(true); }} className={`grid min-h-[84px] w-full grid-cols-[minmax(180px,1.35fr)_minmax(150px,1fr)_minmax(150px,1fr)_minmax(130px,.8fr)_120px] items-center gap-3 border-b px-4 py-3 text-left transition cursor-pointer focus-within:ring-2 focus-within:ring-inset focus-within:ring-teal-400 ${th.border} ${item.symbol === selected ? 'border-l-4 border-l-teal-400 bg-teal-400/10' : 'border-l-4 border-l-transparent hover:bg-white/5'}`}>
        <span><button ref={node => { if (node) rowRefs.current.set(item.symbol, node); else rowRefs.current.delete(item.symbol); }} type="button" aria-current={item.symbol === selected ? 'true' : undefined} aria-expanded={item.symbol === selected} aria-controls="symbol-position-detail" onClick={e => { e.stopPropagation(); setSelected(item.symbol); setMobileDetail(true); }} className="block text-left focus:outline-none"><span className="block font-sans text-sm font-bold text-white">{item.symbol} <span aria-hidden="true">{item.symbol === selected ? '●' : ''}</span></span><span className={`block text-[11px] ${th.textFaint}`}>{item.compositionLabel} · {item.instrumentCount} instrument{item.instrumentCount === 1 ? '' : 's'}</span></button><span className="mt-1 block" onClick={e => e.stopPropagation()}><ChartLinkButton symbol={item.symbol} chartSymbol={INDEX_CHART_SYMBOLS[item.symbol.toUpperCase()] ?? item.symbol} instanceKey={`portfolio-${item.symbol}`} th={th} showChart={openChartSymbol === item.symbol} setShowChart={open => setOpenChartSymbol(open ? item.symbol : null)} sparkData={chartData[item.symbol] ?? null} setSparkData={data => setChartData(current => ({ ...current, [item.symbol]: data }))} sparkLoading={chartLoadingSymbol === item.symbol} setSparkLoading={loading => setChartLoadingSymbol(loading ? item.symbol : null)} /></span></span>
        <span className="text-[11px]"><span className="block text-white">{primaryValue === item.optionBuybackMid && primaryValue.completeness !== 'not-applicable' ? 'Buyback obligation (mid)' : primaryValue === item.longOptionValueMid ? 'Liquidation value (mid)' : 'Equity market value'}</span><AggregateValue aggregate={primaryValue} absent="No applicable value" /></span>
        <span className="text-[11px]">{equity ? <><span className="block text-white">Average share basis</span><span>{equity.basisComplete ? money(equity.basis) : 'Unavailable — Equity basis missing'}</span></> : option ? <><span className="block text-white">Opening {option.entryPriceEffect.toLowerCase()}</span><span>{option.entryEconomicsComplete ? money(option.entryCredit ?? null) : 'Unavailable — Option entry economics missing'}</span></> : null}</span>
        <span className="text-[11px]"><span className={item.needsAttention ? 'text-amber-300' : 'text-white/70'}>{item.needsAttention ? 'Needs attention' : item.unrealizedPnlMid.completeness === 'partial' ? 'Data incomplete' : 'Monitoring'}</span><span className={`block ${th.textFaint}`}>{option ? `${option.dte} DTE` : item.equityMarketValueAggregate.asOf ? 'Current mark' : 'Freshness unknown'}</span></span>
        <span className={`text-right font-sans text-sm font-semibold ${item.unrealizedPnlMid.value == null ? th.textFaint : item.unrealizedPnlMid.value >= 0 ? 'text-emerald-400' : 'text-red-400'}`}><AggregateValue aggregate={item.unrealizedPnlMid} absent="Not applicable" />{item.unrealizedPnlPct != null ? <span className="block text-[10px]">{item.unrealizedPnlPct.toFixed(1)}%</span> : item.unrealizedPnlPctReason ? <span className="sr-only">{item.unrealizedPnlPctReason}</span> : null}</span>
      </div>})}
    </section>
    {group && <SymbolDetail group={group} th={th} mobile={mobileDetail} onBack={() => setMobileDetail(false)} onClose={closeDetail} renderStopControl={renderStopControl} />}
  </div>;
}

function SymbolDetail({ group, th, mobile, onBack, onClose, renderStopControl }: { group: SymbolGroupViewModel; th: typeof THEMES[Theme]; mobile: boolean; onBack: () => void; onClose: () => void; renderStopControl?: (position: Position) => ReactNode }) {
  return <aside id="symbol-position-detail" role="region" aria-labelledby="symbol-position-detail-title" onKeyDown={event => { if (event.key === 'Escape') onClose(); }} className={`${mobile ? 'block' : 'hidden lg:block'} rounded-xl border ${th.border} ${th.card} p-4`}>
    <header className={`mb-4 flex items-center justify-between border-b ${th.border} pb-3`}><div><button type="button" onClick={onBack} className="mb-2 min-h-11 text-xs text-teal-300 lg:hidden">← Back to Positions</button><h2 id="symbol-position-detail-title" className="font-sans text-lg font-bold text-white">{group.symbol} position details</h2><p className={`text-xs ${th.textFaint}`}>{money(group.underlyingPrice)} underlying · {group.compositionLabel} · {group.instrumentCount} instrument{group.instrumentCount === 1 ? '' : 's'} · {group.unrealizedPnlMid.asOf ? `as of ${group.unrealizedPnlMid.asOf}` : 'quote time unknown'}</p></div><button type="button" onClick={onClose} className="hidden min-h-11 rounded border border-white/20 px-3 text-xs focus:ring-2 focus:ring-teal-400 lg:block" aria-label={`Close ${group.symbol} position details`}>× Close</button></header>
    <dl className="grid grid-cols-2 gap-3 text-xs"><div><dt className={th.textFaint}>Unrealized P/L (mark-mid)</dt><dd className="font-sans text-white"><AggregateValue aggregate={group.unrealizedPnlMid} absent="Not applicable" /></dd></div><div><dt className={th.textFaint}>Options close-now P/L (marketable estimate)</dt><dd className="font-sans text-white"><AggregateValue aggregate={group.optionCloseNowPnl} absent="No option position" /></dd></div>{group.equities.length ? <div><dt className={th.textFaint}>Equity market value</dt><dd className="font-sans text-white"><AggregateValue aggregate={group.equityMarketValueAggregate} absent="No equity holding" /></dd></div> : <div><dt className={th.textFaint}>Equity</dt><dd>No equity holding</dd></div>}{group.options.length === 0 && <div><dt className={th.textFaint}>Options</dt><dd>No option position</dd></div>}{group.longOptionValueMid.completeness !== 'not-applicable' && <div><dt className={th.textFaint}>Long-option liquidation value (mid)</dt><dd className="font-sans text-white"><AggregateValue aggregate={group.longOptionValueMid} absent="No long option" /></dd></div>}{group.optionBuybackMid.completeness !== 'not-applicable' && <div><dt className={th.textFaint}>Short/net-credit buyback obligation (mid)</dt><dd className="font-sans text-white"><AggregateValue aggregate={group.optionBuybackMid} absent="No short option" /></dd></div>}{group.options.length > 0 && <div><dt className={th.textFaint}>Marketable close value estimate</dt><dd className="font-sans text-white"><AggregateValue aggregate={group.optionMarketableClose} absent="No option position" /></dd></div>}</dl>
    {group.equities.length > 0 && <div className={`my-4 rounded border ${th.border} p-3 text-xs`}><p className="font-semibold text-white">Share capacity</p>{group.capacity.status === 'ok' ? <p className={`mt-1 ${th.textMuted}`}>{group.capacity.sharesOwned} shares owned · {group.capacity.allocatedContracts * 100} allocated · {group.capacity.reservedContracts * 100} reserved · {group.capacity.unallocatedShares} unallocated shares · {group.capacity.availableContracts} covered-call contract{group.capacity.availableContracts === 1 ? '' : 's'} available · {group.capacity.remainderShares}-share remainder</p> : <p className="mt-1 text-amber-300">Share-capacity evidence unavailable — {group.capacity.blockingReason ?? 'working-order evidence incomplete'}</p>}</div>}
    <div className="space-y-2"><h3 className={`text-[10px] uppercase tracking-wider ${th.textFaint}`}>Instruments</h3>{group.equities.map((holding, index) => <div key={`equity-${index}`} className={`rounded border ${th.border} p-3 text-xs`}><b className="text-white">{holding.direction} {holding.quantity} shares</b><p>Current price {money(holding.currentPrice)} · Average basis {holding.basisComplete ? money(holding.basis) : 'Unavailable'}</p><p>Market value {money(holding.marketValue)} · Unrealized P/L (mark) {money(holding.unrealizedPnl)}</p>{holding.dataQualityWarnings.map(warning => <p key={warning} className="mt-1 text-amber-300">{warning}</p>)}</div>)}{group.optionInstruments.map(instrument => { const option = instrument.position; const capital = buildCapitalViewModel(option); const stop = stopPresentation(option.stopLossClassification); return <div key={instrument.key} className={`rounded border ${th.border} p-3 text-xs`}><b className="text-white">{instrument.roleLabel} · {option.quantity} contract{option.quantity === 1 ? '' : 's'}</b><p>{option.legs.map(leg => `${leg.direction} ${leg.strikePrice}${leg.optionType}`).join(' / ')} · {option.expDate} · {option.dte} DTE</p><p>Opening {option.entryPriceEffect.toLowerCase()} {option.entryEconomicsComplete ? money(option.entryCredit ?? null) : 'Unavailable — option entry economics missing'}</p><p>{instrument.midpointLabel} {money(option.currentValue)} · {instrument.marketableLabel} {money(option.closeValue)}</p><p>Unrealized P/L (mid) {money(option.pnl)} · Close-now P/L {money(option.closeNowPnl)}</p><p>{capital.label} {capital.value == null ? capital.reason : money(capital.value)}</p><p className={SEMANTIC_TONE_CLASS[stop.tone]}>Stop {stop.label}</p><div className="mt-2">{renderStopControl?.(option) ?? (option.entryPriceEffect === 'Debit' ? <DebitStopObservation position={option} /> : <StopEvidencePanel assessment={option.stopAssessment} />)}</div>{instrument.role === 'short-call' && <p className="text-amber-300">Coverage requires a verified share or long-call relationship.</p>}</div>})}</div>
    {group.contextualAction === 'covered-call' && <Link href={`/screener?strategy=covered-call&symbol=${encodeURIComponent(group.symbol)}`} className="mt-4 inline-flex min-h-11 items-center rounded border border-teal-500 px-4 text-xs font-semibold text-teal-300">Find Covered Call</Link>}
  </aside>;
}

function PmccReadinessCard({ opportunity, th, onFind }: { opportunity: ExistingIncomeOpportunity; th: typeof THEMES[Theme]; onFind?: (opportunity: ExistingIncomeOpportunity) => void }) {
  const [live, setLive] = useState<HeldPmccLiveReadiness | null>(null);
  const [loading, setLoading] = useState(false);
  useEffect(() => {
    if (opportunity.status !== 'review-income-call' || !opportunity.accountNumber || !opportunity.positionKey || !opportunity.exactContract || !opportunity.heldPmccLong) return;
    let active = true;
    setLoading(true);
    void evaluateHeldPmccLiveReadiness({ accountNumber: opportunity.accountNumber, positionKey: opportunity.positionKey, underlyingSymbol: opportunity.symbol, occSymbol: opportunity.exactContract, ...opportunity.heldPmccLong, avgOpenPrice: opportunity.heldPmccLong.entryDebitPerShare ?? null })
      .then(result => { if (active) setLive(result); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [opportunity]);
  // LEAPS-MANDATE-0001: the trader's saved income rules for this held LEAPS (read-only here; saved through the form below).
  const [mandate, setMandate] = useState<LeapsMandate | null>(null);
  const [editingMandate, setEditingMandate] = useState(false);
  const [mandateLoaded, setMandateLoaded] = useState(false);
  const mandateAccount = opportunity.accountNumber;
  const mandateOcc = opportunity.exactContract;
  const hasHeldLong = Boolean(opportunity.heldPmccLong);
  useEffect(() => {
    if (!mandateAccount || !mandateOcc || !hasHeldLong) return;
    let active = true;
    Promise.resolve()
      .then(() => fetch(`/api/leaps-mandate?accountNumber=${encodeURIComponent(mandateAccount)}&longOcc=${encodeURIComponent(mandateOcc)}`))
      .then(response => response.ok ? response.json() : Promise.reject(new Error('mandate request failed')))
      .then(data => { if (active) { setMandate((data?.mandate ?? null) as LeapsMandate | null); setMandateLoaded(true); } })
      .catch(() => { if (active) setMandateLoaded(true); /* no saved rules could be read: the defaults stay in force */ });
    return () => { active = false; };
  }, [mandateAccount, mandateOcc, hasHeldLong]);
  // LEAPS-ENTRY-0001: the market state recorded when this position's opening order was accepted (only orders placed through TradeEdge have one).
  const [entryRecords, setEntryRecords] = useState<LeapsEntryRecord[]>([]);
  useEffect(() => {
    if (!mandateAccount || !mandateOcc || !hasHeldLong) return;
    let active = true;
    Promise.resolve()
      .then(() => fetch(`/api/leaps-entry-records?accountNumber=${encodeURIComponent(mandateAccount)}&longOcc=${encodeURIComponent(mandateOcc)}`))
      .then(response => response.ok ? response.json() : Promise.reject(new Error('entry records request failed')))
      .then(data => { if (active && Array.isArray(data?.records)) setEntryRecords(data.records as LeapsEntryRecord[]); })
      .catch(() => { /* no entry record could be read: the first-seen baseline is used */ });
    return () => { active = false; };
  }, [mandateAccount, mandateOcc, hasHeldLong]);
  const requiresLiveEvaluation = opportunity.status === 'review-income-call' && Boolean(opportunity.accountNumber && opportunity.positionKey && opportunity.exactContract && opportunity.heldPmccLong);
  const missingLiveEvidence = opportunity.status === 'review-income-call' && !requiresLiveEvaluation;
  // Never flash a positive readiness label before the fresh shared evaluator
  // returns. A held foundation is only a candidate for review, not a current
  // quoted short-call opportunity.
  const status = live?.status ?? (requiresLiveEvaluation || loading ? 'checking' : missingLiveEvidence ? 'not-ready' : opportunity.status);
  const label = status === 'review-income-call' ? 'Review income call' : status === 'market-closed' ? 'Market closed' : status === 'monitor' ? 'Monitor' : status === 'checking' ? 'Checking current quotes…' : 'Not ready';
  const tone = status === 'review-income-call' ? 'text-emerald-300' : status === 'monitor' || status === 'market-closed' || status === 'checking' ? 'text-amber-300' : 'text-red-300';
  const reason = live?.reason ?? (missingLiveEvidence ? 'Exact held-LEAPS identity is incomplete, so PMCC review cannot run.' : opportunity.reason);
  const monitorMessage = live?.status === 'monitor'
    ? (live.monitorReason === 'quote-quality' ? 'Current quote quality is outside the review policy.' : 'No qualifying short-call candidate is currently available.')
    : opportunity.status === 'monitor' && opportunity.monitorReason === 'capacity-reserved'
      ? 'A short call is already open or working against this exact LEAPS.'
      : null;
  const liveReview = live?.status === 'review-income-call';
  // LEAPS-POS-0001: the held LEAPS as a dashboard -- your LEAPS, the income call under review, and short rule-based callouts.
  // Every number comes from the position's own facts and the live candidate (lib/leaps-position-intelligence/incomeCard.ts).
  const held = opportunity.heldPmccLong;
  const liveCandidate = live?.status === 'review-income-call' ? live.candidate : null;
  // LEAPS-POS-0002: a held LEAPS with a short call already open shows the cycle (capture, time, room, if-assigned) instead.
  const pairedShort = held ? opportunity.pairedShort : undefined;
  // LEAPS-EVENTS-0001: real earnings / ex-dividend dates (same /api/event-risk source the PMCC modals use) for the call's window.
  const eventExpiration = pairedShort?.expiration ?? liveCandidate?.expiration ?? null;
  const eventKey = eventExpiration ? `${opportunity.symbol}:${eventExpiration}` : '';
  const [eventCheck, setEventCheck] = useState<{ key: string; status: EventCheckStatus; calendar: EventCalendarDates | null }>({ key: '', status: 'loading', calendar: null });
  useEffect(() => {
    if (!eventExpiration) return;
    let active = true;
    const key = `${opportunity.symbol}:${eventExpiration}`;
    setEventCheck({ key, status: 'loading', calendar: null });
    const from = new Date().toISOString().slice(0, 10);
    Promise.resolve()
      .then(() => fetch(`/api/event-risk?symbol=${encodeURIComponent(opportunity.symbol)}&from=${from}&to=${eventExpiration}`))
      .then(response => response.ok ? response.json() : Promise.reject(new Error('event request failed')))
      .then(data => {
        if (!active) return;
        if (data?.verified && data?.events) setEventCheck({ key, status: 'ok', calendar: { earningsDate: data.events.earningsDate ?? null, exDividendDate: data.events.exDividendDate ?? null } });
        else setEventCheck({ key, status: 'unavailable', calendar: null });
      })
      .catch(() => { if (active) setEventCheck({ key, status: 'unavailable', calendar: null }); });
    return () => { active = false; };
  }, [opportunity.symbol, eventExpiration]);
  const events = eventExpiration ? buildEventCallouts({
    status: eventCheck.key === eventKey ? eventCheck.status : 'loading', calendar: eventCheck.key === eventKey ? eventCheck.calendar : null,
    shortExpiration: eventExpiration, mode: pairedShort ? 'open-call' : 'candidate',
    nearItm: isNearItm(pairedShort?.strike ?? liveCandidate?.strike ?? 0, held?.stockPrice), today: new Date().toISOString().slice(0, 10),
  }) : undefined;
  // LEAPS-MANDATE-0001: the trader's rules (or the defaults: breakeven floor, no selling through earnings) applied to the candidate.
  const today = new Date().toISOString().slice(0, 10);
  const earningsDate = eventExpiration ? earningsDateInWindow({ status: eventCheck.key === eventKey ? eventCheck.status : 'loading', calendar: eventCheck.key === eventKey ? eventCheck.calendar : null, shortExpiration: eventExpiration, today }) : null;
  const gate = held && !pairedShort ? applyMandateGates({
    mandate, longStrike: held.strike, entryDebitPerShare: held.entryDebitPerShare ?? null, stockPrice: held.stockPrice ?? null,
    candidate: liveCandidate ? { strike: liveCandidate.strike, credit: liveCandidate.credit } : null, earningsInWindow: earningsDate,
  }) : null;
  const gated = gate && gate.state !== 'review-income-call' ? gate : null;
  const canReview = liveReview && !gated;
  // LEAPS-LEDGER-0001: report what the card says to the decision ledger when its state changes. Fire-and-forget; the server records only a change
  // of state or reason (at most every 30 minutes). Reported only after the inputs that decide the state have loaded, so a half-loaded first
  // render is never recorded.
  const reportLedgerEvent = (event: unknown) => {
    if (!mandateAccount || !mandateOcc || typeof fetch !== 'function') return;
    void Promise.resolve()
      .then(() => fetch('/api/leaps-ledger', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ accountNumber: mandateAccount, longOccSymbol: mandateOcc, requestId: crypto.randomUUID().replace(/-/g, ''), event }) }))
      .catch(() => { /* a log entry that cannot be written is not worth interrupting anything */ });
  };
  const eventsSettled = !eventExpiration || (eventCheck.key === eventKey && eventCheck.status !== 'loading');
  const evaluatedState = held && !pairedShort && mandateLoaded && eventsSettled && (liveReview || gated) ? (gated ? gated.state : 'review-income-call') : null;
  const evaluatedKey = evaluatedState ? `${evaluatedState}|${gated?.reasonCode ?? ''}` : '';
  useEffect(() => {
    if (!evaluatedState || !held) return;
    reportLedgerEvent({
      type: 'decision-evaluated',
      payload: {
        state: evaluatedState, reasonCode: gated?.reasonCode ?? null,
        candidate: liveCandidate ? { strike: liveCandidate.strike, expiration: liveCandidate.expiration, credit: liveCandidate.credit, delta: liveCandidate.delta, dte: liveCandidate.dte } : null,
        stockPrice: held.stockPrice ?? null,
        callouts: (gate?.callouts ?? []).slice(0, 6).map(callout => ({ tone: callout.tone, text: callout.text.slice(0, 200) })),
        rules: describeIncomeRules(mandate, held.entryDebitPerShare != null ? held.strike + held.entryDebitPerShare : null).slice(0, 300),
      },
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [evaluatedKey]);
  const displayLabel = gated ? (gated.state === 'hold-uncovered' ? 'Hold uncovered' : gated.state === 'reassess-thesis' ? 'Reassess thesis' : 'Monitor') : label;
  const displayTone = gated ? (gated.state === 'reassess-thesis' ? 'text-red-300' : 'text-amber-300') : tone;
  // LEAPS-SINCE-0001: where the stock, delta and IVR have gone since the entry baseline (labelled honestly: "since you opened" only when the baseline is at the real open).
  // LEAPS-ENTRY-0001: when an order record exists for this position's open date it is the baseline (stock, delta at order time); IVR is only
  // available from the first-seen baseline, so it is used only when that baseline itself was taken at the open.
  const entryMatch = held?.atEntry ? selectEntryRecord(entryRecords, held.atEntry.entryDate) : null;
  const sinceEntry = held?.atEntry
    ? entryMatch
      ? { capturedAt: entryMatch.record.recordedAt, capturedFrom: 'order' as const, entryDate: held.atEntry.entryDate, stockPrice: entryMatch.record.underlying.price, deltaPerShare: entryMatch.record.long?.delta ?? null, ivr: isBaselineAtOpen(held.atEntry.capturedAt, held.atEntry.entryDate) ? held.atEntry.ivr : null }
      : { ...held.atEntry, capturedFrom: 'baseline' as const }
    : null;
  const sinceOpen = held && sinceEntry ? buildSinceOpen({
    strike: held.strike,
    now: { stockPrice: held.stockPrice ?? null, delta: held.delta ?? null, ivr: held.nowIvr ?? null, markPerShare: held.markPerShare ?? null },
    entry: { ...sinceEntry, entryPricePerShare: held.entryDebitPerShare ?? null },
  }) : null;
  // LEAPS-SPARK-0001: value, delta and stock over the days the app has recorded this position.
  const sparklines = held?.history ? buildSparklines({ history: held.history, quantity: held.quantity }) : null;
  const historyStrip = held ? <HistoryStrip sparklines={sparklines} daysRecorded={cleanHistory(held.history ?? []).length} th={th} /> : null;
  // LEAPS-CYCLES-0001: the short calls sold on this stock since the LEAPS was opened (loaded from the Trade Log only when asked for).
  const extrinsicLostDollars = held && sinceOpen?.extrinsicLostPerShare != null ? sinceOpen.extrinsicLostPerShare * 100 * Math.abs(held.quantity) : null;
  const historyBlock = held && mandateAccount ? <IncomeHistory accountNumber={mandateAccount} underlying={opportunity.symbol} longEntryDate={held.atEntry?.entryDate ?? null} extrinsicLostDollars={extrinsicLostDollars} th={th} /> : null;
  const decisionBlock = held && mandateAccount && mandateOcc ? <DecisionHistory accountNumber={mandateAccount} longOccSymbol={mandateOcc} /> : null;
  const sinceBlock = sinceOpen && sinceOpen.tiles.length > 0 ? (<div data-testid="since-open"><p className="mb-1 text-[9px] uppercase tracking-wider text-neutral-400">{sinceOpen.label}</p><TileGrid tiles={sinceOpen.tiles} th={th} /></div>) : null;
  const incomeCard = held ? buildIncomeCard({
    longCall: { strike: held.strike, dte: held.dte, quantity: Math.abs(held.quantity), entryDebitPerShare: held.entryDebitPerShare ?? null, markPerShare: held.markPerShare ?? null, delta: held.delta ?? null, stockPrice: held.stockPrice ?? null },
    candidate: liveCandidate, events, gates: gate ?? undefined,
  }) : null;
  const cycleCard = held && pairedShort ? buildCycleCard({
    longCall: { strike: held.strike, dte: held.dte, quantity: Math.abs(held.quantity), entryDebitPerShare: held.entryDebitPerShare ?? null, markPerShare: held.markPerShare ?? null, delta: held.delta ?? null, stockPrice: held.stockPrice ?? null },
    short: { strike: pairedShort.strike, dte: pairedShort.dte, quantity: pairedShort.quantity, soldPerShare: pairedShort.soldPerShare, markPerShare: pairedShort.markPerShare, delta: pairedShort.delta },
    events,
  }) : null;
  // The long explanatory sentence is the whole story for Monitor / Not ready; for a Review state the dashboard carries it and the sentence moves under Details.
  const reasonLine = <p className={`mt-2 ${th.textFaint}`}>{reason}</p>;
  return <div className="rounded border border-white/10 p-3 text-xs"><div className="flex items-start justify-between gap-2"><div><b className="text-white">{opportunity.symbol} · PMCC income call</b><p className={`mt-1 ${displayTone}`}>{displayLabel}{cycleCard?.windowOpen && <span className="ml-2 rounded border border-amber-500/50 bg-amber-500/10 px-2 py-0.5 text-[10px] font-bold text-amber-300">CLOSE OR ROLL WINDOW</span>}</p></div>{canReview && <button type="button" onClick={() => { reportLedgerEvent({ type: 'user-decision', payload: { action: 'opened-review' } }); onFind?.(opportunity); }} className="min-h-8 rounded border border-teal-500/50 px-2 text-[10px] text-teal-300 focus:ring-2 focus:ring-teal-400">Review PMCC short calls</button>}</div>{status !== 'review-income-call' && !cycleCard && reasonLine}{monitorMessage && !cycleCard && <p className="mt-2 text-[10px] text-amber-200"><b>Monitor:</b> {monitorMessage}</p>}{cycleCard && pairedShort && (<div className="mt-3 space-y-3" data-testid="cycle-dashboard"><div><p className="mb-1 text-[9px] uppercase tracking-wider text-neutral-400">Short call since you sold it · ${pairedShort.strike} C · {pairedShort.expiration}</p><TileGrid tiles={cycleCard.shortTiles} th={th} /></div><div><p className="mb-1 text-[9px] uppercase tracking-wider text-neutral-400">Your LEAPS</p><TileGrid tiles={cycleCard.longTiles} th={th} /></div>{sinceBlock}{historyStrip}<CalloutList callouts={cycleCard.callouts} th={th} />{historyBlock}{decisionBlock}</div>)}{!cycleCard && incomeCard && (<div className="mt-3 space-y-3" data-testid="income-readiness-dashboard"><div><p className="mb-1 text-[9px] uppercase tracking-wider text-neutral-400">Your LEAPS</p><TileGrid tiles={incomeCard.longTiles} th={th} /></div>{sinceBlock}{historyStrip}{liveCandidate && incomeCard.candidateTiles.length > 0 && (<div><p className="mb-1 text-[9px] uppercase tracking-wider text-neutral-400">Income call to review · Sell {Math.abs(held!.quantity)} × ${liveCandidate.strike} C · {liveCandidate.expiration}</p><TileGrid tiles={incomeCard.candidateTiles} th={th} /></div>)}<CalloutList callouts={incomeCard.callouts} th={th} />{historyBlock}{decisionBlock}</div>)}{held && !cycleCard && mandateAccount && mandateOcc && (<div className="mt-2 text-[10px]" data-testid="income-rules">{editingMandate ? <MandateForm underlyingSymbol={opportunity.symbol} longOccSymbol={mandateOcc} accountNumber={mandateAccount} breakeven={held.entryDebitPerShare != null ? held.strike + held.entryDebitPerShare : null} initial={mandate} onSaved={saved => { setMandate(saved); setEditingMandate(false); }} onCancel={() => setEditingMandate(false)} /> : <p className={th.textFaint}>{describeIncomeRules(mandate, held.entryDebitPerShare != null ? held.strike + held.entryDebitPerShare : null)}<button type="button" onClick={() => setEditingMandate(true)} className="ml-2 text-teal-300 underline focus:ring-2 focus:ring-teal-400">{mandate ? 'Edit rules' : 'Set your income rules'}</button></p>}</div>)}<p className="mt-2 text-[10px] text-cyan-200"><b>Next:</b> {canReview ? 'Review the exact held LEAPS in PMCC.' : opportunity.nextStep}</p><details className="mt-2 rounded border border-white/10 p-2"><summary className="cursor-pointer text-[10px] text-neutral-400">Details</summary>{(status === 'review-income-call' || cycleCard) && reasonLine}{monitorMessage && cycleCard && <p className="mt-2 text-[10px] text-amber-200"><b>Monitor:</b> {monitorMessage}</p>}{live?.status === 'review-income-call' && <p className={`mt-2 text-[10px] ${th.textFaint}`}>Candidate: Δ {live.candidate.delta.toFixed(2)} · {live.candidate.dte} DTE · OI {live.candidate.openInterest} · credit ${live.candidate.credit.toFixed(2)}{live.candidate.spreadPct != null ? ` · spread ${live.candidate.spreadPct.toFixed(1)}%` : ''}</p>}<p className={`mt-2 text-[10px] ${th.textFaint}`}>Freshness: {live?.asOf ?? opportunity.freshness}</p></details></div>;
}

interface ManagementActionProps {
  getManagementActions?: (position: Position) => ActionType[];
  onExecute?: (position: Position, action: ActionType, initialRollMode?: 'close' | 'roll') => void;
  renderStopControl?: (position: Position) => ReactNode;
  onAnalyze?: (position: Position, traderNote: string) => Promise<WorkspaceAiAnalysis>;
  renderAnalysisConversation?: (position: Position, analysis: WorkspaceAiAnalysis) => ReactNode;
  onFindPmccShortCall?: (opportunity: ExistingIncomeOpportunity) => void;
}

function AnalysisView({ model, th, getManagementActions, onExecute, renderStopControl, onAnalyze, renderAnalysisConversation, onFindPmccShortCall, sellDeps }: { model: PositionsWorkspaceModel; th: typeof THEMES[Theme]; sellDeps?: SellStockDialogDeps } & ManagementActionProps) {
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
  // GET and a trader's first blur-save can race on initial mount.  Once a
  // local mutation starts, an older GET payload must never overwrite it.
  const priceAlertsLocallyMutated = useRef(false);
  const [analysisPosition, setAnalysisPosition] = useState<Position | null>(null);
  const [analysis, setAnalysis] = useState<WorkspaceAiAnalysis | null>(null);
  const [analysisLoading, setAnalysisLoading] = useState(false);
  const [analysisError, setAnalysisError] = useState<string | null>(null);
  const [openChartKey, setOpenChartKey] = useState<string | null>(null);
  const [chartData, setChartData] = useState<Record<string, number[] | null>>({});
  const [chartLoadingSymbol, setChartLoadingSymbol] = useState<string | null>(null);
  const [incomeSectionOpen, setIncomeSectionOpen] = useState(false);
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
      if (active && !priceAlertsLocallyMutated.current) setPriceAlerts(payload.alerts ?? {});
    }).catch(error => { if (active) setPriceAlertsLoadError(error instanceof Error ? error.message : 'Unable to load price alerts'); });
    return () => { active = false; };
  }, []);
  const noteStorageKey = (position: Position) => `${encodeURIComponent(position.accountNumber || model.accountNumber || '')}::${encodeURIComponent(position.key)}`;
  // STOCKS-0001: notes and alerts are stored per accountNumber + key; option rows use the position's key, stock holdings use their own key
  // format (equity:SYMBOL:long|short), so the two can never collide in the shared store.
  const storageKeyFor = (accountNumber: string, key: string) => `${encodeURIComponent(accountNumber)}::${encodeURIComponent(key)}`;
  const saveNoteFor = async (accountNumber: string, positionKey: string, note: string) => {
    if (!accountNumber) throw new Error('Broker account identity is unavailable');
    const response = await fetch('/api/position-notes', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ accountNumber, positionKey, note }) });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error ?? 'Unable to save note');
    setNotes(current => ({ ...current, [storageKeyFor(accountNumber, positionKey)]: note }));
  };
  const saveNote = async (position: Position, note: string) => saveNoteFor(position.accountNumber || model.accountNumber || '', position.key, note);
  // Same accountNumber::positionKey scheme as noteStorageKey -- one storage
  // convention, two fields (Dane's consolidation principle).
  const priceAlertStorageKey = (position: Position) => `${encodeURIComponent(position.accountNumber || model.accountNumber || '')}::${encodeURIComponent(position.key)}`;
  const savePriceAlertFor = async (accountNumber: string, positionKey: string, targetPrice: number | null, direction: 'above' | 'below') => {
    if (!accountNumber) throw new Error('Broker account identity is unavailable');
    // Mark before the request, rather than after it resolves: the initial GET
    // may resolve while this POST is in flight with a pre-save empty store.
    priceAlertsLocallyMutated.current = true;
    const response = await fetch('/api/position-price-alerts', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ accountNumber, positionKey, targetPrice, direction }) });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error ?? 'Unable to save price alert');
    setPriceAlerts(current => {
      const next = { ...current };
      const storageKey = storageKeyFor(accountNumber, positionKey);
      if (targetPrice == null) delete next[storageKey];
      else next[storageKey] = { targetPrice, direction };
      return next;
    });
  };
  const savePriceAlert = async (position: Position, targetPrice: number | null, direction: 'above' | 'below') => savePriceAlertFor(position.accountNumber || model.accountNumber || '', position.key, targetPrice, direction);
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
  // POSITIONS-SORT-0001: only columns with one unambiguous, directly
  // comparable value on Position are sortable. Left out on purpose:
  // 'strike' (multiple strikes/breakevens, no single canonical number),
  // 'evolution' (six different Greeks shown at once, no representative
  // value), 'orders' (categorical stop classification, not a natural
  // order), 'notes'/'priceAlert' (free text), 'recommendation'
  // (categorical action label). 'volatility' sorts by IVR specifically
  // (not IV) since IVR is the more standard screening metric.
  const SORTABLE_COLUMNS: ReadonlySet<AnalysisColumnId> = new Set<AnalysisColumnId>(['identity', 'dates', 'underlying', 'capital', 'entry', 'value', 'pnl', 'netEdge', 'pop', 'volatility']);
  const sortValueFor = (position: Position, columnId: AnalysisColumnId): number | string | null => {
    switch (columnId) {
      case 'identity': return position.symbol;
      case 'dates': return position.dte;
      case 'underlying': return position.buffer;
      case 'capital': return buildCapitalViewModel(position).value;
      case 'entry': return position.entryCredit ?? position.creditReceived ?? null;
      case 'value': return position.closeValue ?? position.currentValue ?? null;
      case 'pnl': return position.closeNowPnl ?? position.pnl ?? null;
      case 'netEdge': return netEdgeLive(position);
      case 'pop': return position.pop;
      case 'volatility': return position.ivr;
      default: return null;
    }
  };
  const [sort, setSort] = useState<{ column: AnalysisColumnId; direction: 'asc' | 'desc' } | null>(null);
  const toggleSort = (columnId: AnalysisColumnId) => {
    if (!SORTABLE_COLUMNS.has(columnId)) return;
    setSort(current => {
      if (current?.column !== columnId) return { column: columnId, direction: 'asc' };
      if (current.direction === 'asc') return { column: columnId, direction: 'desc' };
      return null; // third click on the same column clears back to natural order
    });
  };
  const sortedRows = sort
    ? [...rows].sort((a, b) => {
        const av = sortValueFor(a.position, sort.column);
        const bv = sortValueFor(b.position, sort.column);
        // Nulls always sort last, regardless of direction -- a missing
        // value isn't "low," it's unknown, and burying it at the bottom
        // either way keeps it from masquerading as the smallest real value.
        if (av == null && bv == null) return 0;
        if (av == null) return 1;
        if (bv == null) return -1;
        const cmp = typeof av === 'string' && typeof bv === 'string'
          ? av.localeCompare(bv)
          : av < bv ? -1 : av > bv ? 1 : 0;
        return sort.direction === 'asc' ? cmp : -cmp;
      })
    : rows;
  const chooseView = (view: AnalysisViewId) => setPreferences(current => ({ ...current, analysisView: view, customColumnIds: view === 'custom' ? current.customColumnIds : columnsForView(view) }));
  return <>
    <section aria-label="Existing-position income eligibility" className={`mb-3 rounded-xl border ${th.border} p-3`}>
      <div className="flex flex-wrap items-center justify-between gap-2"><div><h2 className="text-xs font-bold tracking-wider text-white">Existing-position income</h2><p className={`mt-1 text-[10px] ${th.textFaint}`}>Launches the Screener only when the held position is safe to evaluate.</p></div><div className="flex items-center gap-3"><span className={`text-[10px] ${th.textFaint}`}>{(model.incomeOpportunities ?? []).length} candidate{(model.incomeOpportunities ?? []).length === 1 ? '' : 's'} found</span><button type="button" aria-expanded={incomeSectionOpen} aria-controls="existing-position-income-content" onClick={() => setIncomeSectionOpen(open => !open)} className="min-h-8 rounded border border-white/20 px-2 text-[10px] text-white focus:ring-2 focus:ring-teal-400">{incomeSectionOpen ? 'Collapse' : 'Expand'}</button></div></div>
      {incomeSectionOpen && <div id="existing-position-income-content"><div className="mt-3 grid gap-2 lg:grid-cols-2">{(model.incomeOpportunities ?? []).map(opportunity => opportunity.kind === 'pmcc-short-call'
        ? <PmccReadinessCard key={opportunity.id} opportunity={opportunity} th={th} onFind={onFindPmccShortCall} />
        : <div key={opportunity.id} className="rounded border border-white/10 p-3 text-xs"><div className="flex items-start justify-between gap-2"><div><b className="text-white">{opportunity.symbol} · {opportunity.title}</b><p className={`mt-1 ${opportunity.status === 'eligible' ? 'text-emerald-300' : opportunity.status === 'no-capacity' ? 'text-amber-300' : opportunity.status === 'unavailable' ? 'text-red-300' : th.textMuted}`}>{opportunity.status === 'eligible' ? 'Ready — find short call' : opportunity.status === 'no-capacity' ? 'Short-call capacity unavailable' : opportunity.status === 'unavailable' ? 'Broker data unavailable' : 'Not eligible'}</p></div></div><p className={`mt-2 ${th.textFaint}`}>{opportunity.reason}</p><p className="mt-1 text-[10px] text-cyan-200"><b>Next:</b> {opportunity.nextStep}</p><p className={`mt-2 ${th.textFaint}`}>Shares {opportunity.sharesOwned ?? '—'} · Allocated {opportunity.allocatedContracts ?? '—'} · Reserved {opportunity.reservedContracts ?? '—'} · Available {opportunity.availableContracts ?? '—'}</p><p className={`mt-2 text-[10px] ${th.textFaint}`}>Freshness: {opportunity.freshness}</p></div>)}</div>
        {/* PW-0002: with structural non-candidates filtered out, zero results is
            a real, common state now (no held long calls or coverable shares
            at all) -- give it an explicit message instead of a blank grid. */}
        {(model.incomeOpportunities ?? []).length === 0 && <p className={`mt-3 text-xs ${th.textFaint}`}>No held long calls or coverable shares found in this portfolio right now.</p>}
      </div>}
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
      <span className={`ml-auto text-xs ${th.textFaint}`}>{rows.length} of {model.analysisRows.length} option positions</span>
    </div>
    {(() => {
      // PNL-BASIS-0001: reconcile this table (options only) with the Portfolio view (options + equities).
      const perSymbol = model.symbolGroups.map(group => group.symbolUnrealizedPnl);
      const summary = describePnlReconciliation(buildPnlReconciliation({
        options: model.analysisRows.map(row => row.position),
        equities: model.symbolGroups.flatMap(group => group.equities),
        portfolioTotal: perSymbol.length > 0 && perSymbol.every(value => value != null) ? perSymbol.reduce<number>((sum, value) => sum + (value as number), 0) : null,
      }));
      return summary.line ? <p role="status" data-testid="pnl-reconciliation" className={`mb-2 text-[11px] ${summary.tone === 'warn' ? 'text-amber-300' : th.textFaint}`}>{summary.line}</p> : null;
    })()}
    {notesLoadError && <p role="status" className="mb-2 text-xs text-amber-300">Position notes unavailable — {notesLoadError}</p>}
    {priceAlertsLoadError && <p role="status" className="mb-2 text-xs text-amber-300">Price alerts unavailable — {priceAlertsLoadError}</p>}
    <div className="max-w-full overflow-x-auto rounded-xl border border-white/10" tabIndex={0} aria-label="Position analysis table, horizontally scrollable"><table className="min-w-max border-collapse text-left text-[11px]"><thead><tr>{ANALYSIS_COLUMNS.filter(column => columns.includes(column.id)).map(column => {
  const sortable = SORTABLE_COLUMNS.has(column.id);
  const isActiveSort = sort?.column === column.id;
  const labelContent = column.id === 'strike' ? 'Strike / BE' : column.id === 'underlying' ? <><span className="block">Strike</span><span className="block">Gap</span></> : column.id === 'entry' ? <><span className="block">Entry</span><span className="block">Credit / Debit</span></> : column.label;
  return <th key={column.id} scope="col" title={column.id === 'capital' ? 'Capital / Collateral' : sortable ? `Sort by ${column.label}` : undefined} aria-sort={isActiveSort ? (sort!.direction === 'asc' ? 'ascending' : 'descending') : undefined} onClick={sortable ? () => toggleSort(column.id) : undefined} className={`border-b border-r border-white/10 bg-slate-950 px-2 py-2 uppercase tracking-wider text-white/50 ${sortable ? 'cursor-pointer select-none hover:text-white/80' : ''} ${column.id === 'identity' ? 'sticky left-0 z-20' : ''} ${column.id === 'capital' ? 'w-28 max-w-28' : column.id === 'strike' ? 'w-24 max-w-24 whitespace-nowrap' : column.id === 'underlying' ? 'w-20 max-w-20 whitespace-nowrap' : column.id === 'entry' ? 'w-20 max-w-20' : column.id === 'orders' || column.id === 'notes' ? 'w-40 max-w-40' : 'whitespace-nowrap'}`}>{labelContent}{sortable && <span aria-hidden="true" className={`ml-1 inline-block ${isActiveSort ? 'text-teal-400' : 'text-white/20'}`}>{isActiveSort ? (sort!.direction === 'asc' ? '▲' : '▼') : '⇅'}</span>}</th>;
})}</tr></thead><tbody>{sortedRows.map(row => <AnalysisRow key={row.id} position={row.position} columns={columns} th={th} actions={getManagementActions?.(row.position) ?? []} onExecute={onExecute} renderStopControl={renderStopControl} onAnalyze={onAnalyze ? analyze : undefined} savedNote={notes[noteStorageKey(row.position)] ?? ''} onSaveNote={saveNote} savedAlert={priceAlerts[priceAlertStorageKey(row.position)] ?? null} onSaveAlert={savePriceAlert} chartOpen={openChartKey === row.position.key} setChartOpen={open => setOpenChartKey(open ? row.position.key : null)} sparkData={chartData[row.position.symbol] ?? null} setSparkData={data => setChartData(current => ({ ...current, [row.position.symbol]: data }))} sparkLoading={chartLoadingSymbol === row.position.symbol} setSparkLoading={loading => setChartLoadingSymbol(loading ? row.position.symbol : current => current === row.position.symbol ? null : current)} />)}</tbody></table></div>
    <StockHoldings groups={model.symbolGroups} quoteAsOf={model.quoteAsOf} notes={notes} alerts={priceAlerts} storageKey={storageKeyFor} onSaveNote={saveNoteFor} onSaveAlert={savePriceAlertFor} th={th} sellDeps={sellDeps} />
    {filterOpen && <FilterDialog draft={draftFilters} setDraft={setDraftFilters} onClose={() => setFilterOpen(false)} onApply={() => { setPreferences(current => ({ ...current, filters: draftFilters })); setFilterOpen(false); }} onClear={() => setDraftFilters(DEFAULT_FILTERS)} />}
    {columnsOpen && <ColumnsDialog selected={draftColumns} setSelected={setDraftColumns} preset={preferences.analysisView} onClose={() => setColumnsOpen(false)} onApply={() => { setPreferences(current => ({ ...current, analysisView: 'custom', customColumnIds: draftColumns })); setColumnsOpen(false); }} />}
    {analysisPosition && <DialogShell title={`AI analysis — ${analysisPosition.symbol}`} onClose={() => { if (!analysisLoading) setAnalysisPosition(null); }}><div aria-live="polite">{analysisLoading ? <p>Analyzing {analysisPosition.symbol}…</p> : analysisError ? <div><p role="alert" className="text-red-400">{analysisError}</p><button type="button" onClick={() => analyze(analysisPosition)} className="mt-3 min-h-8 rounded border border-white/20 px-3 text-xs focus:ring-2 focus:ring-teal-400">Retry analysis</button></div> : analysis ? <div className="space-y-3 text-sm"><p className="text-[10px] uppercase tracking-wider text-white/50">AI interpretation · deterministic Suggested Action remains authoritative</p><p><b>{analysis.recommendation}</b> · {analysis.confidence} confidence</p><p>{analysis.summary}</p><details className="rounded border border-white/10 bg-white/[0.02] p-3 text-xs"><summary className="cursor-pointer font-semibold text-indigo-300">Position context locked for this conversation</summary><p className="mt-2 text-white/60">{analysisPosition.symbol} · {analysisPosition.strategy} · expires {analysisPosition.expDate} · {analysisPosition.dte} DTE</p><p className="mt-1 break-all font-sans text-[10px] text-white/40">Position ID: {analysisPosition.key}</p><p className="mt-1 text-white/40">Snapshot captured {new Date(analysis.generatedAt).toLocaleString()}. Follow-ups retain this snapshot and conversation history.</p></details>{renderAnalysisConversation && <section aria-label={`AI follow-up conversation for ${analysisPosition.symbol}`} className="overflow-hidden rounded-lg border border-indigo-500/30 bg-indigo-500/[0.04]"><div className="px-4 pt-3"><p className="text-xs font-semibold text-indigo-200">Continue with AI</p><p className="mt-1 text-[10px] text-white/50">Ask a follow-up or attach chart and option-chain images.</p></div>{renderAnalysisConversation(analysisPosition, analysis)}</section>}<details className="rounded border border-white/10 p-3 text-xs"><summary className="cursor-pointer font-semibold text-white/70">Show full AI reasoning and risks</summary><p className="mt-3 text-white/70">{analysis.reasoning}</p>{analysis.risks.length > 0 && <div className="mt-3"><b>Risks</b><ul className="list-disc pl-5">{analysis.risks.map(risk => <li key={risk}>{risk}</li>)}</ul></div>}</details><p className="text-xs text-white/50">Advisory analysis only. No brokerage order is prepared or submitted.</p></div> : null}</div></DialogShell>}
  </>;
}

const ACTION_LABELS: Partial<Record<ActionType, string>> = { TAKE_PROFIT: 'Take Profit Now', CLOSE_ROLL: 'Close Position / Roll', PLACE_GTC: 'Set/Edit Profit Target', CUT_LOSSES: 'Cut Losses' };

function SemanticComparison({ label, prior, current, tone, digits = 1, suffix = '' }: { label: string; prior: number | null | undefined; current: number | null | undefined; tone: SemanticTone; digits?: number; suffix?: string }) {
  const material = tone !== 'neutral';
  // TELEMETRY-METRIC-DIRECTION-0001: real up/down arrow, colored per the
  // same tone driving the value text -- the static gray "→" separator
  // alone didn't carry any directional information, which was the actual
  // complaint (Dean: hard to see whether a metric moved up or down, not
  // just that it's colored). No arrow at all when the value didn't move
  // or is missing -- matches the neutral tone in that case.
  const moved = prior != null && current != null && Number.isFinite(prior) && Number.isFinite(current) && current !== prior;
  const arrowGlyph = moved ? (current! > prior! ? '▲' : '▼') : '—';
  return <span className="block"><span className="text-white/70">{label} </span><span className="text-white/40">{number(prior, digits)}{prior == null ? '' : suffix}</span><span className={`px-1 text-sm leading-none ${material ? SEMANTIC_TONE_CLASS[tone] : 'text-white/30'}`} aria-hidden="true">{arrowGlyph}</span><span className={`${SEMANTIC_TONE_CLASS[tone]} ${material ? 'font-semibold' : ''}`}>{number(current, digits)}{current == null ? '' : suffix}</span></span>;
}

export function recommendationTone(position: Position): SemanticTone {
  // EXIT-PRESSURE-0001 -- a Cut Losses recommendation that specifically
  // matches the trader's own pre-set stop is a quiet confirmation the plan
  // is executing, not new alarming information -- rendered calm/
  // informational rather than the same urgent red used for a breach the
  // trader didn't already plan for.
  if (position.recommendation?.managementIntent?.quietConfirmation) return 'informational';
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
  // Recommendation/Actions split (Ian/Paul/Diane/Quinn approved) -- Adjust
  // GTC/Stop opens the EXISTING renderStopControl output inline (no new

  // ACTIONS-ROW-RESPONSIVE-0001 (Quinn approved) -- width-driven, not a
  // viewport media query, since this table's column width varies with how
  // many columns Dean has toggled via "Customize Columns," not just device
  // size. ResizeObserver on the actions row itself, not the whole cell.
  const actionsRef = useRef<HTMLSpanElement>(null);
  const [actionsNarrow, setActionsNarrow] = useState(false);
  useEffect(() => {
    const el = actionsRef.current;
    // Guard: ResizeObserver isn't implemented in jsdom (test environment)
    // and, defensively, may not exist in every real runtime either -- skip
    // the width-responsive behavior rather than crash the whole component.
    if (!el || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(entries => {
      for (const entry of entries) setActionsNarrow(entry.contentRect.width < 300);
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  const first = p.snapshotHistory?.[0];
  const moneyness = buildMoneynessViewModel(p.stockPrice, p.legs);
  const moneynessMovement = buildMoneynessMovementViewModel(p.stockPriceAtEntry ?? null, p.stockPrice, p.legs);
  const capital = buildCapitalViewModel(p);
  const pnl = p.closeNowPnl ?? p.pnl;
  const pctOfTarget = profitTargetPct(p, pnl);
  // PNL-BASIS-0001: say which basis the P/L above is on, and show the other one (display only; the rules' own inputs are unchanged).
  const pnlBases = buildPositionPnlBases(p);
  const pnlSecond = buildPnlSecondLine(pnlBases);
  const pnlWide = wideMarketNote(pnlBases, p.currentValue);
  const stop = stopPresentation(p.stopLossClassification);
  const stopControl = renderStopControl?.(p) ?? null;
  const breakeven = buildBreakevenViewModel(p);
  const standaloneLeap = p.strategy === 'CALL' && p.legs.length === 1 && p.legs[0]?.direction === 'Long' && p.dte >= 365;
  const priceBuffer = breakeven.values.length === 1 && p.stockPrice != null
    ? p.stockPrice - breakeven.values[0]
    : null;
  const priceBufferPct = priceBuffer != null && p.stockPrice != null && p.stockPrice > 0 ? priceBuffer / p.stockPrice * 100 : null;
  const entryTone = p.entryPriceEffect === 'Credit' ? 'positive' : p.entryPriceEffect === 'Debit' ? 'warning' : 'neutral';
  const firstPnl = first?.pnl;
  const cell: Record<AnalysisColumnId, ReactNode> = {
    identity: <><b className="text-white">{p.symbol}</b><span className="block text-amber-300">{standaloneLeap ? 'LEAPS CALL' : p.strategy}</span><span className={th.textFaint}>{standaloneLeap ? 'Standalone · ' : ''}{p.quantity} contract{p.quantity === 1 ? '' : 's'}</span><span className="mt-1 block"><ChartLinkButton symbol={p.symbol} chartSymbol={INDEX_CHART_SYMBOLS[p.symbol.toUpperCase()] ?? p.symbol} instanceKey={p.key} th={th} showChart={chartOpen} setShowChart={setChartOpen} sparkData={sparkData} setSparkData={setSparkData} sparkLoading={sparkLoading} setSparkLoading={setSparkLoading} /></span></>,
    dates: <>{p.entryDate ?? 'Entry unavailable'}<b className="block text-white">{p.expDate}</b><span className="block text-white/55"><span className="font-bold text-white/80">DTE:</span> {first?.dte ?? p.dteAtEntry ?? '—'} <span className="px-1 text-white/30">→</span> <span className="font-bold text-white">{p.dte}</span></span></>,
    underlying: <>{p.stockPriceAtEntry != null && p.stockPrice != null ? <span className="block text-white/55"><span className="font-bold text-white/80">Price:</span> {quotePrice(p.stockPriceAtEntry)} <span className="px-1 text-white/30">→</span> <span className="font-bold text-white">{quotePrice(p.stockPrice)}</span></span> : <b className="block text-white">{quotePrice(p.stockPrice)}</b>}{moneynessMovement ? <span className={`mt-1 block ${SEMANTIC_TONE_CLASS[moneynessMovement.tone]}`}>{moneynessMovement.entry.state === moneynessMovement.current.state ? `${moneynessMovement.entry.distancePct.toFixed(1)}% → ${moneynessMovement.current.distancePct.toFixed(1)}% ${moneynessMovement.current.state} (${moneynessMovement.changePct >= 0 ? '+' : ''}${moneynessMovement.changePct.toFixed(1)}%)` : `${moneynessMovement.entry.distancePct.toFixed(1)}% ${moneynessMovement.entry.state} → ${moneynessMovement.current.distancePct.toFixed(1)}% ${moneynessMovement.current.state}`}</span> : moneyness ? <span className={`block ${SEMANTIC_TONE_CLASS[moneyness.tone]}`}>{moneyness.state === 'ATM' ? 'ATM' : `${moneyness.distancePct.toFixed(1)}% ${moneyness.state}`}</span> : <span className={`block ${th.textFaint}`} title="No unambiguous canonical management leg">Strike distance unavailable</span>}</>,
    strike: <><span className="block">{p.legs.map(leg => `${leg.direction === 'Short' ? 'Short ' : 'Long '}${leg.strikePrice}${leg.optionType}`).join(' · ') || '—'}</span><span className={`mt-1 block ${breakeven.values.length ? 'text-white' : th.textFaint}`} title={breakeven.unavailableReason ?? undefined}>{breakeven.values.length ? `AT-EXP B/E ${breakeven.values.map(value => moneyExact(value)).join(' / ')}` : 'AT-EXP B/E —'}</span>{priceBuffer != null && <span className={`block ${SEMANTIC_TONE_CLASS[priceBuffer >= 0 ? 'positive' : 'negative']}`}>Price Buffer {priceBuffer >= 0 ? '' : '−'}{money(Math.abs(priceBuffer))}{priceBufferPct != null ? ` (${priceBufferPct.toFixed(1)}%)` : ''}</span>}</>,
    capital: <><b className="text-white">{capital.label}</b>{capital.value == null ? <span className={`block max-w-40 ${th.textFaint}`} title={capital.reason}>{capital.reason}</span> : <span className="block">{capital.suffix ? `${capital.value}${capital.suffix}` : money(capital.value)}</span>}</>,
    entry: <><b className={SEMANTIC_TONE_CLASS[entryTone]}>{p.entryPriceEffect}</b><span className={`block ${SEMANTIC_TONE_CLASS[entryTone]}`}>{p.entryEconomicsComplete === false ? 'Unavailable' : money(p.entryCredit ?? p.creditReceived)}</span></>,
    value: <><span>{p.entryPriceEffect === 'Debit' ? 'Liquidation' : 'Buyback'} {money(p.closeValue)}</span><span className="block">Mid {money(p.currentValue)}</span></>,
    // PLTARGET-0001: signed % of target next to the dollar figure. >=100%
    // (target reached/exceeded) gets bold + SEMANTIC_TONE_CLASS.positive --
    // the literal moment the take-profit rule says exit -- otherwise follows
    // the sign of the % itself (Ian: signed, never floored to 0).
    pnl: <><b className={pnl == null || Math.abs(pnl) < 0.005 ? SEMANTIC_TONE_CLASS.neutral : pnl > 0 ? SEMANTIC_TONE_CLASS.positive : SEMANTIC_TONE_CLASS.negative}>{money(pnl)}{pctOfTarget != null && <span className={pctOfTarget >= 100 ? `font-bold ${SEMANTIC_TONE_CLASS.positive}` : pctOfTarget > 0 ? SEMANTIC_TONE_CLASS.positive : pctOfTarget < 0 ? SEMANTIC_TONE_CLASS.negative : SEMANTIC_TONE_CLASS.neutral}> ({pctOfTarget.toFixed(0)}% of target)</span>}</b><span className="block text-[10px] text-white/55">{pnlBases.primary === 'close-now' ? 'close now' : 'mid'}</span><span className="block">{profitTargetPresentation(p)}</span>{pnlSecond && <span className="block text-[10px] text-white/70" data-testid="pnl-other-basis">{pnlSecond.text}</span>}{pnlWide && <span className="block text-[10px] text-amber-300" data-testid="pnl-wide-market">{pnlWide}</span>}</>,
    // TELEMETRY-METRIC-DIRECTION-0001: directionalMovementTone previously
    // treated every metric identically (any movement = informational,
    // no movement = neutral) -- didn't implement the team's actual rules.
    // Theta/Gamma now use comparisonTone (already correct, already used
    // for P/L above) with the real goodWhenHigher direction per metric.
    // Delta/Vega/IV/IVR are genuinely neutral -- no verdict, confirmed
    // final with Dean, not a placeholder -- so they no longer call
    // directionalMovementTone at all.
    evolution: <><span className="block text-white">first tracked → now</span><SemanticComparison label="P/L" prior={firstPnl} current={pnl} tone={comparisonTone(firstPnl, pnl)} digits={0} /><SemanticComparison label="Δ" prior={first?.netDelta ?? p.deltaAtEntry} current={p.netDelta} tone="neutral" /><SemanticComparison label="Θ" prior={first?.theta ?? p.thetaAtEntry} current={p.theta} tone={comparisonTone(first?.theta ?? p.thetaAtEntry, p.theta, true)} /><SemanticComparison label="Γ" prior={first?.gamma ?? p.gammaAtEntry} current={p.gamma} tone={comparisonTone(first?.gamma ?? p.gammaAtEntry, p.gamma, false)} digits={3} /><SemanticComparison label="V" prior={first?.netVega ?? p.vegaAtEntry} current={p.netVega} tone="neutral" /><SemanticComparison label="IV" prior={first?.iv ?? p.ivAtEntry} current={p.iv} tone="neutral" suffix="%" /><SemanticComparison label="IVR" prior={first?.ivr ?? p.ivrAtEntry} current={p.ivr} tone="neutral" /></>,
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
    // GTC-SCOPE-0001: labeled by what this signal actually represents --
    // p.gtcOrderId only ever resolves via findProfitGtcOrder (a limit
    // order, explicitly never a stop -- see its doc comment), so a
    // generic "GTC Live" badge sitting directly above "Stop Unsupported"
    // or "Stop None" falsely read as if a protective stop were active.
    // Protective-stop status has its own line immediately below (`Stop
    // {stop.label}`) and is unaffected by this change.
    orders: <><span className={p.gtcOrderId != null ? SEMANTIC_TONE_CLASS.positive : SEMANTIC_TONE_CLASS.warning}>Profit Target {p.gtcOrderId != null ? 'Live' : 'None'}</span><span className={`block ${SEMANTIC_TONE_CLASS[stop.tone]}`}>Stop {stop.label}</span><span className="mt-2 block">{stopControl ?? <span className={th.textFaint}>{stop.action} review blocked by the current canonical order workflow</span>}</span></>,
    notes: <PositionNoteEditor position={p} savedNote={savedNote} onSave={onSaveNote} />,
    priceAlert: <PriceAlertEditor position={p} savedAlert={savedAlert} onSave={onSaveAlert} />,
    recommendation: <>
      {/* Recommendation zone -- pure explanation, never clickable (Ian). */}
      <p className={`text-[9px] uppercase tracking-wider ${th.textFaint}`}>Recommendation</p>
      <b className={SEMANTIC_TONE_CLASS[recommendationTone(p)]}>{p.recommendation?.label ?? 'Hold'}</b>
      <span className={`block max-w-48 ${th.textFaint}`}>{p.structureAmbiguous ? p.structureBlockMessage : p.recommendation?.managementIntent?.reasons?.[0] ?? p.recommendation?.primaryReason ?? 'Continue monitoring'}</span>

      <div className="my-2 max-w-64 border-t border-white/10" />

      {/* Actions zone -- equal visual weight; only the action matching the
          recommendation gets the "suggested" tag (never more than one, per
          Ian). Cut Losses / Roll Position keep distinct color even here. */}
      <p className={`text-[9px] uppercase tracking-wider ${th.textFaint}`}>Actions</p>
      <span ref={actionsRef} className="mt-1 flex max-w-64 flex-wrap items-center gap-1">
        <button type="button" onClick={() => onAnalyze?.(p)} disabled={!onAnalyze} title={!onAnalyze ? 'Canonical analysis is unavailable' : undefined} className="min-h-8 rounded border border-blue-500/50 px-2 text-[10px] text-blue-300 focus:ring-2 focus:ring-blue-400 disabled:cursor-not-allowed disabled:opacity-40">{actionsNarrow ? 'Analyze' : 'Analyze with AI'}</button>
        {actions.map(action => action === 'CLOSE_ROLL' ? (
          <span key={action} className="contents">
            <span className="flex items-center gap-1">
              <button type="button" onClick={() => onExecute?.(p, action, 'close')} className="min-h-8 rounded border border-white/20 px-2 text-[10px] text-white focus:ring-2 focus:ring-teal-400">{actionsNarrow ? 'Close' : 'Close Position'}</button>
              {p.recommendation && canonicalRecommendationToAction(p.recommendation.kind) === action && <span className={`text-[9px] whitespace-nowrap ${th.textFaint}`}>← suggested</span>}
            </span>
            <span className="flex items-center gap-1">
              <button type="button" onClick={() => onExecute?.(p, action, 'roll')} className="min-h-8 rounded border border-purple-500/50 px-2 text-[10px] text-purple-300 focus:ring-2 focus:ring-purple-400">Roll Position</button>
            </span>
          </span>
        ) : (
          <span key={action} className="flex items-center gap-1">
            <button type="button" onClick={() => onExecute?.(p, action)} className={`min-h-8 rounded border px-2 text-[10px] focus:ring-2 focus:ring-teal-400 ${action === 'CUT_LOSSES' ? 'border-red-500/50 text-red-300' : 'border-white/20 text-white'}`}>{ACTION_LABELS[action] ?? action}</button>
            {p.recommendation && canonicalRecommendationToAction(p.recommendation.kind) === action && <span className={`text-[9px] whitespace-nowrap ${th.textFaint}`}>← suggested</span>}
          </span>
        ))}
      </span>
    </>,
  };
  return <tr className="align-top hover:bg-white/[0.03]">{ANALYSIS_COLUMNS.filter(column => columns.includes(column.id)).map(column => <td key={column.id} className={`max-w-64 border-b border-r border-white/10 px-3 py-3 ${th.textMuted} ${column.id === 'identity' ? `sticky left-0 z-10 ${th.card}` : ''} ${column.id === 'strike' ? 'w-24 max-w-24 whitespace-nowrap' : column.id === 'underlying' ? 'w-20 max-w-20 whitespace-nowrap' : column.id === 'orders' || column.id === 'notes' ? 'w-40 max-w-40' : ''}`}>{cell[column.id]}</td>)}</tr>;
}

function FilterDialog({ draft, setDraft, onClose, onApply, onClear }: { draft: PositionAnalysisFilters; setDraft: (value: PositionAnalysisFilters) => void; onClose: () => void; onApply: () => void; onClear: () => void }) {
  const update = <K extends keyof PositionAnalysisFilters>(key: K, value: PositionAnalysisFilters[K]) => setDraft({ ...draft, [key]: value });
  return <DialogShell title="Filter positions" onClose={onClose}><div className="grid gap-4 sm:grid-cols-2"><label className="text-xs">Symbol<input value={draft.symbol} onChange={event => update('symbol', event.target.value)} className="mt-1 block min-h-11 w-full rounded border border-white/20 bg-slate-900 px-3" /></label><label className="text-xs">Strategy<input value={draft.strategy} onChange={event => update('strategy', event.target.value)} className="mt-1 block min-h-11 w-full rounded border border-white/20 bg-slate-900 px-3" /></label><label className="text-xs">Attention<select value={draft.attention} onChange={event => update('attention', event.target.value as PositionAnalysisFilters['attention'])} className="mt-1 block min-h-11 w-full rounded border border-white/20 bg-slate-900 px-3"><option value="all">All</option><option value="attention">Needs attention</option><option value="monitoring">Monitoring</option></select></label><label className="text-xs">Open P/L<select value={draft.pnl} onChange={event => update('pnl', event.target.value as PositionAnalysisFilters['pnl'])} className="mt-1 block min-h-11 w-full rounded border border-white/20 bg-slate-900 px-3"><option value="all">All</option><option value="positive">Positive</option><option value="negative">Negative</option><option value="unavailable">Unavailable</option></select></label></div><div className="mt-5 flex justify-between"><button onClick={onClear} className="min-h-11 px-3 text-xs">Clear All</button><div className="flex gap-2"><button onClick={onClose} className="min-h-11 rounded border border-white/20 px-4 text-xs">Cancel</button><button onClick={onApply} className="min-h-11 rounded bg-teal-500 px-4 text-xs font-bold text-slate-950">Apply</button></div></div></DialogShell>;
}

function ColumnsDialog({ selected, setSelected, preset, onClose, onApply }: { selected: AnalysisColumnId[]; setSelected: (value: AnalysisColumnId[]) => void; preset: AnalysisViewId; onClose: () => void; onApply: () => void }) {
  const toggle = (id: AnalysisColumnId) => setSelected(selected.includes(id) ? selected.filter(value => value !== id) : [...selected, id]);
  return <DialogShell title="Customize columns" onClose={onClose}><div className="grid gap-2 sm:grid-cols-2">{ANALYSIS_COLUMNS.map(column => <label key={column.id} className="flex min-h-11 items-center gap-2 rounded border border-white/10 px-3 text-xs"><input type="checkbox" checked={selected.includes(column.id)} disabled={column.id === 'identity'} onChange={() => toggle(column.id)} /><span><b className="block">{column.label}</b><span className="text-white/50">{column.group}</span></span></label>)}</div><div className="mt-5 flex justify-between"><button onClick={() => setSelected(columnsForView(preset === 'custom' ? 'management' : preset))} className="min-h-11 px-3 text-xs">Reset to preset</button><div className="flex gap-2"><button onClick={onClose} className="min-h-11 rounded border border-white/20 px-4 text-xs">Cancel</button><button disabled={selected.length < 2} onClick={onApply} className="min-h-11 rounded bg-teal-500 px-4 text-xs font-bold text-slate-950 disabled:opacity-40">Apply</button></div></div></DialogShell>;
}

export function PositionsWorkspace({ model, th, getManagementActions, onExecute, renderStopControl, onAnalyze, renderAnalysisConversation, onFindPmccShortCall, sellDeps }: { model: PositionsWorkspaceModel; th: typeof THEMES[Theme]; sellDeps?: SellStockDialogDeps } & ManagementActionProps) {
  const [view, setView] = useState<'portfolio' | 'analysis'>('portfolio');
  useEffect(() => { const loaded = loadPreferences(); setView(loaded.workspaceView); }, []);
  const switchView = (next: 'portfolio' | 'analysis') => { setView(next); const loaded = loadPreferences(); savePreferences({ ...loaded, workspaceView: next }); };
  return <section className="p-4 sm:p-6" aria-label="Positions workspace"><div role="tablist" aria-label="Positions workspace views" className={`mb-4 flex gap-1 border-b ${th.border}`}>{(['portfolio', 'analysis'] as const).map(item => <button key={item} role="tab" aria-selected={view === item} onClick={() => switchView(item)} className={`min-h-11 border-b-2 px-4 text-xs font-bold tracking-wider focus:outline-none focus:ring-2 focus:ring-teal-400 ${view === item ? 'border-teal-400 text-white' : `border-transparent ${th.textFaint}`}`}>{item === 'portfolio' ? 'Portfolio' : 'Position Analysis'}</button>)}</div>{view === 'portfolio' ? <PortfolioView groups={model.symbolGroups} th={th} renderStopControl={renderStopControl} /> : <AnalysisView model={model} th={th} getManagementActions={getManagementActions} onExecute={onExecute} renderStopControl={renderStopControl} onAnalyze={onAnalyze} renderAnalysisConversation={renderAnalysisConversation} onFindPmccShortCall={onFindPmccShortCall} sellDeps={sellDeps} />}</section>;
}
