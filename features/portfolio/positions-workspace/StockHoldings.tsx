// features/portfolio/positions-workspace/StockHoldings.tsx
//
// STOCKS-0001 -- the "Stock holdings" section under the Position Analysis options table. Display, notes, price alerts, and safe actions only:
// no order is placed from here (stock orders are a separate, reviewed ticket). Every number comes from model/stockHoldings.ts, which reads the
// workspace model's equity holdings and the symbol's covered-call capacity; nothing is computed or guessed here.

import Link from 'next/link';
import { useEffect, useState, type ReactNode } from 'react';
import { ChartLinkButton } from '@/components/ChartLinkButton';
import type { THEMES, Theme as AppTheme } from '@/lib/theme';
import { money } from '@/lib/leaps-analysis/dashboard';
import { signedMoney } from '@/lib/leaps-position-intelligence/incomeCard';
import { derivePmccMarketSession } from '@/lib/scans/pmccProduction';
import { buildStockHoldingRows, buildStockTotals, isPriceAlertCrossed, stockPricesAsOf, type CoveredTone, type StockHoldingRow } from './model/stockHoldings';
import type { SymbolGroupViewModel } from './model/types';
import { SellStockDialog, type SellStockDialogDeps } from './SellStockDialog';
import { alignedStockColumns } from './model/stockColumnAlignment';
import { IntentSelectControl } from './IntentSelect';
import { marketMetricsPath, parseMarketMetricsEarnings, type StockEarnings } from './model/stockEarnings';
import { nextEarningsLine } from './model/nextEarnings';
import type { PositionIntent } from '@/lib/portfolio-data/types';
import type { StockAiAnalysis, StockAnalysisContext } from '@/lib/portfolio/stockAnalysis';

/** Matches the notes route's limit (app/api/position-notes/route.ts). */
export const STOCK_NOTE_MAX_LENGTH = 150;

const INDEX_CHART_SYMBOLS: Record<string, string> = { SPX: '^GSPC', SPXW: '^GSPC', NDX: '^NDX', RUT: '^RUT', VIX: '^VIX', DJX: '^DJI' };

type SavedAlert = { targetPrice: number; direction: 'above' | 'below' };
type Theme = { border: string; textFaint: string };

const COLUMNS = 'grid-cols-[minmax(110px,1.1fr)_minmax(90px,0.8fr)_minmax(90px,0.9fr)_minmax(100px,0.95fr)_minmax(110px,1fr)_minmax(120px,1.15fr)_minmax(170px,1.6fr)_minmax(170px,1.8fr)_minmax(140px,1.4fr)_minmax(70px,0.6fr)]';
const PILL: Record<CoveredTone, string> = {
  good: 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300',
  neutral: 'border-neutral-500/40 bg-neutral-500/10 text-neutral-300',
  watch: 'border-amber-500/40 bg-amber-500/10 text-amber-300',
};

function StockNoteEditor({ label, savedNote, onSave }: { label: string; savedNote: string; onSave: (note: string) => Promise<void> }) {
  const [draft, setDraft] = useState(savedNote);
  const [state, setState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { setDraft(savedNote); setState('idle'); setError(null); }, [savedNote, label]);
  const save = async () => {
    if (draft === savedNote || state === 'saving') return;
    if (draft.length > STOCK_NOTE_MAX_LENGTH) { setError(`Maximum ${STOCK_NOTE_MAX_LENGTH} characters`); setState('error'); return; }
    setState('saving'); setError(null);
    try { await onSave(draft); setState('saved'); } catch (cause) { setError(cause instanceof Error ? cause.message : 'Save failed'); setState('error'); }
  };
  return (
    <label className="block">
      <span className="sr-only">{label}</span>
      <textarea aria-label={label} value={draft} maxLength={STOCK_NOTE_MAX_LENGTH} placeholder="Add a note…"
        onChange={event => { setDraft(event.target.value); setState('idle'); }} onBlur={() => void save()}
        onKeyDown={event => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); void save(); } else if (event.key === 'Escape') { event.preventDefault(); setDraft(savedNote); } }}
        className="h-12 w-full resize-y rounded border border-white/20 bg-transparent px-2 py-1 text-xs text-white focus:outline-none focus:ring-2 focus:ring-teal-400" />
      <span className="mt-1 block text-[9px] text-white/40">{state === 'saving' ? 'Saving…' : state === 'saved' ? 'Saved' : state === 'error' ? error : `${draft.length}/${STOCK_NOTE_MAX_LENGTH} · Enter or blur to save`}</span>
    </label>
  );
}

function StockAlertEditor({ id, symbol, price, savedAlert, onSave }: { id: string; symbol: string; price: number | null; savedAlert: SavedAlert | null; onSave: (targetPrice: number | null, direction: 'above' | 'below') => Promise<void> }) {
  const [draft, setDraft] = useState(savedAlert?.targetPrice != null ? String(savedAlert.targetPrice) : '');
  const [direction, setDirection] = useState<'above' | 'below'>(savedAlert?.direction ?? 'above');
  const [state, setState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    setDraft(savedAlert?.targetPrice != null ? String(savedAlert.targetPrice) : ''); setDirection(savedAlert?.direction ?? 'above'); setState('idle'); setError(null);
  }, [savedAlert?.targetPrice, savedAlert?.direction, id]);
  const run = async (target: number | null) => {
    setState('saving'); setError(null);
    try { await onSave(target, direction); setState('saved'); } catch (cause) { setError(cause instanceof Error ? cause.message : 'Save failed'); setState('error'); }
  };
  const save = async () => {
    if (state === 'saving') return;
    const trimmed = draft.trim();
    if (trimmed === '') { if (savedAlert != null) await run(null); return; }
    const parsed = Number(trimmed);
    if (!Number.isFinite(parsed) || parsed <= 0) { setError('Enter a positive price'); setState('error'); return; }
    if (parsed === savedAlert?.targetPrice && direction === savedAlert?.direction) return;
    await run(parsed);
  };
  return (
    <div>
      <div className="flex items-center gap-1">
        <label className="sr-only" htmlFor={`stock-alert-direction-${id}`}>Alert direction for {symbol}</label>
        <select id={`stock-alert-direction-${id}`} value={direction} onChange={event => { setDirection(event.target.value as 'above' | 'below'); setState('idle'); }} className="rounded border border-white/20 bg-transparent px-1 py-1 text-[10px] text-white focus:outline-none focus:ring-2 focus:ring-teal-400">
          <option value="above" className="text-black">≥</option>
          <option value="below" className="text-black">≤</option>
        </select>
        <label className="sr-only" htmlFor={`stock-alert-target-${id}`}>Target price for {symbol}</label>
        <input id={`stock-alert-target-${id}`} type="text" inputMode="decimal" placeholder="Target $" value={draft}
          onChange={event => { setDraft(event.target.value); setState('idle'); }} onBlur={() => void save()}
          onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); void save(); } else if (event.key === 'Escape') { event.preventDefault(); setDraft(savedAlert?.targetPrice != null ? String(savedAlert.targetPrice) : ''); setDirection(savedAlert?.direction ?? 'above'); } }}
          className="w-16 rounded border border-white/20 bg-transparent px-2 py-1 text-xs text-white focus:outline-none focus:ring-2 focus:ring-teal-400" />
      </div>
      <span className="mt-1 block text-[9px] text-white/40">{state === 'saving' ? 'Saving…' : state === 'saved' ? 'Saved' : state === 'error' ? error : 'Enter or blur to save'}</span>
      {isPriceAlertCrossed(savedAlert, price) && <span className="mt-1 block rounded bg-emerald-500/20 px-1.5 py-0.5 text-[9px] font-bold text-emerald-300">Target reached: consider selling</span>}
    </div>
  );
}

type SaveNote = (accountNumber: string, key: string, note: string) => Promise<void>;
type SaveAlert = (accountNumber: string, key: string, targetPrice: number | null, direction: 'above' | 'below') => Promise<void>;

function Row({ row, th, chart, intentControl, earnings, gridStyle, savedNote, onSaveNote, savedAlert, onSaveAlert, onSell, onAnalyze }: {
  row: StockHoldingRow; chart: ReactNode; intentControl: ReactNode; earnings: ReactNode; gridStyle?: { gridTemplateColumns: string }; th: Theme; savedNote: string; onSaveNote: SaveNote; savedAlert: SavedAlert | null; onSaveAlert: SaveAlert; onSell: (row: StockHoldingRow) => void; onAnalyze?: (row: StockHoldingRow) => void;
}) {
  const pnlTone = row.pnl == null ? 'text-white/40' : row.pnl >= 0 ? 'text-emerald-400' : 'text-red-400';
  const canSellCovered = row.covered.kind === 'available';
  return (
    <div role="row" style={gridStyle} className={`grid ${COLUMNS} items-start border-t ${th.border}`} data-testid={`stock-row-${row.key}`}>
      <div className="p-3"><b className="text-white">{row.symbol}</b><span className={`block ${th.textFaint}`}>Equity · {row.direction.toLowerCase()}</span>{intentControl && <span className="mt-1 block">{intentControl}</span>}<span className="mt-1 block">{chart}</span>{earnings && <span className="mt-1 block">{earnings}</span>}</div>
      <div className="p-3 font-mono text-white">{row.shares}{row.sharesNote && <span className={`block font-sans text-[10px] ${th.textFaint}`}>{row.sharesNote}</span>}</div>
      <div className="p-3 font-mono text-white">{row.price != null ? money(row.price) : '—'}</div>
      <div className="p-3 font-mono text-white">{row.avgCost != null ? <>{money(row.avgCost)}<span className={`block font-sans text-[10px] ${th.textFaint}`}>cost {money(row.costBasis ?? 0)}</span></> : <span className="text-amber-300">— <span className="block font-sans text-[10px]">basis incomplete</span></span>}</div>
      <div className="p-3 font-mono text-white">{row.value != null ? (row.value < 0 ? `-${money(Math.abs(row.value))}` : money(row.value)) : '—'}</div>
      <div className={`p-3 font-mono font-semibold ${pnlTone}`}>
        {row.pnl != null ? <>{signedMoney(Math.round(row.pnl * 100) / 100)}{row.pnlPct != null && <span className="block font-sans text-[10px] font-normal">{row.pnlPct >= 0 ? '+' : ''}{row.pnlPct.toFixed(1)}%</span>}</>
          : <span className="font-sans text-[11px] font-normal">Unavailable<span className="block text-[10px] text-amber-300">{!row.basisComplete ? 'needs a complete cost basis' : 'price unavailable'}</span></span>}
      </div>
      <div className="p-3">
        <span className={`inline-block rounded-full border px-2.5 py-1 text-[11px] ${PILL[row.covered.tone]}`}>{row.covered.headline}</span>
        {row.covered.detail && <span className={`mt-1 block text-[10px] ${th.textFaint}`}>{row.covered.detail}</span>}
        {row.direction === 'Long' && (canSellCovered
          ? <Link href={`/screener?strategy=covered-call&symbol=${encodeURIComponent(row.symbol)}`} className="mt-2 inline-flex min-h-8 items-center rounded border border-teal-500/50 px-2 text-[10px] text-teal-300 focus:ring-2 focus:ring-teal-400">Sell covered call</Link>
          : <span className={`mt-2 inline-flex min-h-8 items-center rounded border border-white/10 px-2 text-[10px] ${th.textFaint}`} aria-disabled="true" title={row.covered.kind === 'needs-shares' ? row.covered.headline : row.covered.detail ?? row.covered.headline}>Sell covered call</span>)}
      </div>
      <div className="p-3"><StockNoteEditor label={`Note for ${row.symbol} stock holding`} savedNote={savedNote} onSave={note => onSaveNote(row.accountNumber, row.key, note)} /></div>
      <div className="p-3"><StockAlertEditor id={row.key} symbol={row.symbol} price={row.price} savedAlert={savedAlert} onSave={(target, direction) => onSaveAlert(row.accountNumber, row.key, target, direction)} /></div>
      <div className="flex flex-col items-start gap-2 p-3">
        {onAnalyze && (
          <button type="button" data-testid={`analyze-button-${row.key}`} onClick={() => onAnalyze(row)}
            className="inline-flex min-h-8 items-center gap-1 rounded border border-indigo-500/60 px-2 text-[10px] font-bold text-indigo-300 hover:bg-indigo-500/10 focus:outline-none focus:ring-2 focus:ring-indigo-400">
            <span aria-hidden>✦</span> Analyze
          </button>
        )}
        {row.direction === 'Long' ? (
          row.sellable.maxSellableShares > 0 ? (
            <button type="button" data-testid={`sell-button-${row.key}`} onClick={() => onSell(row)}
              className="inline-flex min-h-8 items-center rounded border border-red-500/50 px-2 text-[10px] text-red-300 focus:outline-none focus:ring-2 focus:ring-red-400">
              Sell
            </button>
          ) : (
            <span data-testid={`sell-button-${row.key}`} className={`inline-flex min-h-8 items-center rounded border border-white/10 px-2 text-[10px] ${th.textFaint}`} aria-disabled="true"
              title={row.sellable.blockedByDataQuality ? 'Share commitment could not be verified. Selling is blocked until it can be.' : `All ${row.shares} shares are committed to an open call.`}>
              Sell
            </span>
          )
        ) : <span className={`text-[10px] ${th.textFaint}`}>—</span>}
      </div>
    </div>
  );
}

/** POSITIONS-CARDS-0001: the stock holding as a card, same shell as the option cards (header, big P/L, chips, action row, Show detail). */
function StockCard({ row, th, chart, intentControl, earnings, savedNote, onSaveNote, savedAlert, onSaveAlert, onSell, onAnalyze }: {
  row: StockHoldingRow; chart: ReactNode; intentControl: ReactNode; earnings: ReactNode; th: Theme; savedNote: string; onSaveNote: SaveNote; savedAlert: SavedAlert | null; onSaveAlert: SaveAlert; onSell: (row: StockHoldingRow) => void; onAnalyze?: (row: StockHoldingRow) => void;
}) {
  const [detailOpen, setDetailOpen] = useState(false);
  const pnlTone = row.pnl == null ? 'text-white/40' : row.pnl >= 0 ? 'text-emerald-400' : 'text-red-400';
  const canSellCovered = row.covered.kind === 'available';
  const stats: Array<[string, string]> = [
    ['Shares', String(row.shares)],
    ['Price', row.price != null ? money(row.price) : '—'],
    ['Avg cost', row.avgCost != null ? money(row.avgCost) : '—'],
    ['Value', row.value != null ? (row.value < 0 ? `-${money(Math.abs(row.value))}` : money(row.value)) : '—'],
    ['Cost basis', row.costBasis != null ? money(row.costBasis) : '—'],
  ];
  return (
    <article aria-label={`${row.symbol} stock holding`} data-testid={`stock-card-${row.key}`} className={`rounded-xl border border-l-4 border-l-white/20 ${th.border} bg-white/[0.02] p-4`}>
      <div className="grid grid-cols-[1fr_auto] gap-x-4 gap-y-1">
        <div className="min-w-0">
          <h3 className="flex flex-wrap items-center gap-2 text-base font-bold text-white">{row.symbol}<span className="rounded border border-amber-300/40 px-1.5 py-0.5 text-[10px] font-semibold text-amber-300">STOCK</span></h3>
          <p className={`mt-0.5 text-xs ${th.textFaint}`}>{Math.abs(row.shares)} sh · {row.direction.toLowerCase()}{row.price != null ? ` · ${money(row.price)}` : ''}{row.sharesNote ? ` · ${row.sharesNote}` : ''}</p>
        </div>
        <div className="text-right">
          <b className={`block text-xl ${pnlTone}`}>{row.pnl != null ? signedMoney(Math.round(row.pnl * 100) / 100) : 'Unavailable'}</b>
          <span className={`block text-[11px] ${row.pnl == null ? 'text-amber-300' : th.textFaint}`}>{row.pnl != null ? (row.pnlPct != null ? `${row.pnlPct >= 0 ? '+' : ''}${row.pnlPct.toFixed(1)}% vs cost` : 'unrealized') : !row.basisComplete ? 'needs a complete cost basis' : 'price unavailable'}</span>
        </div>
      </div>
      <ul aria-label="Signals" className="mt-3 flex flex-wrap items-center gap-1.5">
        <li className={`rounded-full border px-2.5 py-0.5 text-[11px] ${PILL[row.covered.tone]}`}>{row.covered.headline}</li>
        {row.stale && <li className="rounded-full border border-amber-400/50 bg-amber-400/10 px-2 py-0.5 text-[11px] font-semibold text-amber-200">Stale price</li>}
        {earnings && <li className="text-[11px]">{earnings}</li>}
      </ul>
      {row.covered.detail && <p className={`mt-1 text-[11px] ${th.textFaint}`}>{row.covered.detail}</p>}
      {detailOpen && (
        <div data-testid="stock-card-detail" className="mt-3 space-y-3">
          <dl className="grid grid-cols-2 gap-2 sm:grid-cols-5">{stats.map(([label, value]) => <div key={label} className="rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2"><dt className={`text-[10px] uppercase tracking-wider ${th.textFaint}`}>{label}</dt><dd className="text-sm font-bold text-white">{value}</dd></div>)}</dl>
          <div className="grid gap-3 sm:grid-cols-2">
            <StockNoteEditor label={`Note for ${row.symbol} stock holding`} savedNote={savedNote} onSave={note => onSaveNote(row.accountNumber, row.key, note)} />
            <StockAlertEditor id={row.key} symbol={row.symbol} price={row.price} savedAlert={savedAlert} onSave={(target, direction) => onSaveAlert(row.accountNumber, row.key, target, direction)} />
          </div>
        </div>
      )}
      <div className="mt-3 flex flex-wrap items-center gap-2">
        {onAnalyze && <button type="button" data-testid={`analyze-button-${row.key}`} onClick={() => onAnalyze(row)} className="min-h-9 rounded-xl border border-blue-500/50 px-3 text-xs text-blue-300 focus:outline-none focus:ring-2 focus:ring-blue-400">Analyze</button>}
        {row.direction === 'Long' && (row.sellable.maxSellableShares > 0
          ? <button type="button" data-testid={`sell-button-${row.key}`} onClick={() => onSell(row)} className="min-h-9 rounded-xl border border-red-500/50 px-3 text-xs text-red-300 focus:outline-none focus:ring-2 focus:ring-red-400">Sell</button>
          : <span data-testid={`sell-button-${row.key}`} className={`inline-flex min-h-9 items-center rounded-xl border border-white/10 px-3 text-xs ${th.textFaint}`} aria-disabled="true" title={row.sellable.blockedByDataQuality ? 'Share commitment could not be verified. Selling is blocked until it can be.' : `All ${row.shares} shares are committed to an open call.`}>Sell</span>)}
        {row.direction === 'Long' && canSellCovered && <Link href={`/screener?strategy=covered-call&symbol=${encodeURIComponent(row.symbol)}`} className="inline-flex min-h-9 items-center rounded-xl border border-teal-500/50 px-3 text-xs text-teal-300 focus:ring-2 focus:ring-teal-400">Sell covered call</Link>}
        {chart}
        <button type="button" aria-expanded={detailOpen} onClick={() => setDetailOpen(open => !open)} className="ml-auto text-xs text-white/70 underline decoration-dotted underline-offset-2 hover:text-white">{detailOpen ? 'Hide detail' : 'Show detail'}</button>
        {intentControl && <span>{intentControl}</span>}
      </div>
    </article>
  );
}

export function StockHoldings({ cards = false, earningsEnabled = false, intentEnabled = false, columnWidths, groups, quoteAsOf, th, storageKey, notes, onSaveNote, alerts, onSaveAlert, sellDeps, onAnalyze, renderConversation }: {
  /** POSITIONS-CARDS-0001: show holdings as cards (the Cards view) instead of the table. */
  cards?: boolean;
  /** Show each holding's next earnings date under its chart link (looked up from the broker's market metrics). */
  earningsEnabled?: boolean;
  /** POSITION-INTENT-0001: show the Hold / Wheel / Undecided control on each holding (saved in the same store as option intents). */
  intentEnabled?: boolean;
  /** Measured widths of the options table above (by column id); when complete, this table lines up with it. */
  columnWidths?: Record<string, number> | null;
  groups: Array<Pick<SymbolGroupViewModel, 'symbol' | 'equities' | 'capacity'>>;
  quoteAsOf: string | null;
  th: typeof THEMES[AppTheme];
  /** The same accountNumber::key scheme the option notes and alerts use. */
  storageKey: (accountNumber: string, key: string) => string;
  notes: Record<string, string>;
  onSaveNote: SaveNote;
  alerts: Record<string, SavedAlert>;
  onSaveAlert: SaveAlert;
  /** STOCKS-ORDERS-0001. Omit to leave the Sell action disabled everywhere (e.g. a read-only view). */
  sellDeps?: SellStockDialogDeps;
  /** STOCK-ANALYZE-0001. Omit to hide the Analyze button. */
  onAnalyze?: (row: StockHoldingRow, context: StockAnalysisContext) => Promise<StockAiAnalysis>;
  /** Follow-up questions about the analysis, in context (same "Continue with AI" section the option analysis has). */
  renderConversation?: (row: StockHoldingRow, analysis: StockAiAnalysis, context: StockAnalysisContext) => ReactNode;
}) {
  const rows = buildStockHoldingRows(groups);
  // Shares are not option positions, so their intent is saved under the account and holding key in the same store.
  const [intents, setIntents] = useState<Record<string, string>>({});
  useEffect(() => {
    if (!intentEnabled || typeof fetch !== 'function') return;
    let active = true;
    fetch('/api/position-intent').then(response => response.json()).then(payload => { if (active && payload?.intents) setIntents(payload.intents); }).catch(() => {});
    return () => { active = false; };
  }, [intentEnabled]);
  const [earningsBySymbol, setEarningsBySymbol] = useState<Record<string, StockEarnings>>({});
  const symbolsKey = Array.from(new Set(rows.map(r => r.symbol.toUpperCase()))).sort().join(',');
  useEffect(() => {
    if (!earningsEnabled || !symbolsKey || typeof fetch !== 'function') return;
    let active = true;
    fetch(marketMetricsPath(symbolsKey.split(',')), { cache: 'no-store' })
      .then(response => response.json())
      .then(payload => { if (active) setEarningsBySymbol(parseMarketMetricsEarnings(payload)); })
      .catch(() => {});
    return () => { active = false; };
  }, [earningsEnabled, symbolsKey]);
  const saveIntent = (id: string, intent: PositionIntent) => {
    setIntents(current => ({ ...current, [id]: intent }));
    if (typeof fetch !== 'function') return;
    fetch('/api/position-intent', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ positionKey: id, intent }) }).catch(() => {});
  };
  const aligned = alignedStockColumns(columnWidths);
  const gridStyle = aligned ? { gridTemplateColumns: aligned.template } : undefined;
  const [sellRow, setSellRow] = useState<StockHoldingRow | null>(null);
  const [analyzeRow, setAnalyzeRow] = useState<StockHoldingRow | null>(null);
  const [analysis, setAnalysis] = useState<StockAiAnalysis | null>(null);
  const [analysisError, setAnalysisError] = useState<string | null>(null);
  const [analysisLoading, setAnalysisLoading] = useState(false);
  const [analysisContext, setAnalysisContext] = useState<StockAnalysisContext>({});
  const runAnalysis = async (row: StockHoldingRow) => {
    if (!onAnalyze) return;
    setAnalyzeRow(row); setAnalysis(null); setAnalysisError(null); setAnalysisLoading(true);
    const earnings = earningsBySymbol[row.symbol.toUpperCase()];
    const idKey = `${row.accountNumber}::${row.key}`;
    try {
      const context: StockAnalysisContext = {
        note: notes[storageKey(row.accountNumber, row.key)] ?? '',
        intent: intents[idKey] ?? null,
        nextEarnings: earnings?.date ? `${earnings.date}${earnings.estimated ? ' (estimated)' : ''}` : null,
      };
      const result = await onAnalyze(row, context);
      setAnalysisContext(context);
      if (result.rowKey !== row.key) throw new Error('Analysis did not match this holding. Try again.');
      setAnalysis(result);
    } catch (e) { setAnalysisError(e instanceof Error ? e.message : 'Analysis failed'); }
    finally { setAnalysisLoading(false); }
  };
  // The same quick chart the option rows use: one open at a time, closes cached per symbol.
  const [openChartKey, setOpenChartKey] = useState<string | null>(null);
  const [chartData, setChartData] = useState<Record<string, number[] | null>>({});
  const [chartLoadingSymbol, setChartLoadingSymbol] = useState<string | null>(null);
  if (rows.length === 0) return null;
  const totals = buildStockTotals(rows);
  const nowMs = Date.now();
  const asOf = stockPricesAsOf({ rows, fallback: quoteAsOf, nowMs, marketOpen: derivePmccMarketSession(new Date(nowMs)) === 'open' });
  const incomplete = rows.filter(r => !r.basisComplete);

  return (
    <section className="mt-6" aria-label="Stock holdings" data-testid="stock-holdings">
      <div className="mb-2 flex flex-wrap items-center gap-3">
        <h3 className={`text-xs font-semibold tracking-wider ${th.textFaint}`}>STOCK HOLDINGS</h3>
        <span className={`text-xs ${th.textFaint}`}>{rows.length} holding{rows.length === 1 ? '' : 's'}</span>
        <div className={`h-px flex-1 ${th.border} border-t`} />
        {asOf && <span className="rounded-full border border-amber-500/40 bg-amber-500/10 px-2.5 py-0.5 text-[11px] text-amber-300" data-testid="stock-prices-as-of">{asOf.text}</span>}
      </div>
      {cards ? (
        <>
          <div data-testid="stock-cards" className="grid gap-3 lg:grid-cols-2">
            {rows.map(row => (
            <StockCard key={row.key} row={row} th={th}
              earnings={(() => { const e = earningsEnabled ? earningsBySymbol[row.symbol.toUpperCase()] : undefined; const line = e ? nextEarningsLine(e.date, e.estimated, null) : null; return line ? <span className={th.textFaint} data-testid="stock-next-earnings">{line.text}</span> : null; })()}
              intentControl={intentEnabled ? <IntentSelectControl family="STOCK" stored={intents[`${row.accountNumber}::${row.key}`]} ariaLabel={`Intent for ${row.symbol} shares`} onChange={intent => saveIntent(`${row.accountNumber}::${row.key}`, intent)} /> : null}
              chart={<ChartLinkButton symbol={row.symbol} chartSymbol={INDEX_CHART_SYMBOLS[row.symbol.toUpperCase()] ?? row.symbol} instanceKey={`stock-${row.key}`} th={th}
                showChart={openChartKey === row.key} setShowChart={open => setOpenChartKey(open ? row.key : null)}
                sparkData={chartData[row.symbol] ?? null} setSparkData={data => setChartData(current => ({ ...current, [row.symbol]: data }))}
                sparkLoading={chartLoadingSymbol === row.symbol} setSparkLoading={loading => setChartLoadingSymbol(loading ? row.symbol : null)} />}
              savedNote={notes[storageKey(row.accountNumber, row.key)] ?? ''} onSaveNote={onSaveNote}
              savedAlert={alerts[storageKey(row.accountNumber, row.key)] ?? null} onSaveAlert={onSaveAlert}
              onSell={sellDeps ? setSellRow : () => {}} onAnalyze={onAnalyze ? row => void runAnalysis(row) : undefined} />
            ))}
          </div>
          <p data-testid="stock-totals" className={`mt-3 text-xs ${th.textFaint}`}><b>Stocks total</b> · Value {totals.value != null ? (totals.value < 0 ? `-${money(Math.abs(totals.value))}` : money(totals.value)) : '—'} · P/L <span className={totals.pnl == null ? '' : totals.pnl >= 0 ? 'text-emerald-400' : 'text-red-400'}>{totals.pnl != null ? signedMoney(totals.pnl) : '—'}{totals.pnlPct != null ? ` (${totals.pnlPct >= 0 ? '+' : ''}${totals.pnlPct.toFixed(1)}%)` : ''}</span>{!totals.complete && <span className="text-amber-300"> · P/L covers {totals.pnlIncluded} of {totals.holdings} holdings</span>}</p>
        </>
      ) : (
      <div className={`max-w-full overflow-x-auto rounded-xl border ${th.border}`} tabIndex={0} aria-label="Stock holdings, horizontally scrollable">
        <div role="table" className={aligned ? 'text-[11px]' : 'min-w-[1180px] text-[11px]'} style={aligned ? { width: aligned.total } : undefined}>
          <div role="row" style={gridStyle} className={`grid ${COLUMNS} bg-white/5 text-[10px] uppercase tracking-wider ${th.textFaint}`}>
            {['Holding', 'Shares', 'Price', 'Avg cost', totals.valueLabel, 'Unrealized P/L', 'Covered calls', 'Notes', 'Price alert', 'Actions'].map(name => <div key={name} role="columnheader" className="p-3">{name}</div>)}
          </div>
          {rows.map(row => (
            <Row key={row.key} row={row} th={th} gridStyle={gridStyle}
              earnings={(() => { const e = earningsEnabled ? earningsBySymbol[row.symbol.toUpperCase()] : undefined; const line = e ? nextEarningsLine(e.date, e.estimated, null) : null; return line ? <span className={th.textFaint} data-testid="stock-next-earnings">{line.text}</span> : null; })()}
              intentControl={intentEnabled ? <IntentSelectControl family="STOCK" stored={intents[`${row.accountNumber}::${row.key}`]} ariaLabel={`Intent for ${row.symbol} shares`} onChange={intent => saveIntent(`${row.accountNumber}::${row.key}`, intent)} /> : null}
              chart={<ChartLinkButton symbol={row.symbol} chartSymbol={INDEX_CHART_SYMBOLS[row.symbol.toUpperCase()] ?? row.symbol} instanceKey={`stock-${row.key}`} th={th}
                showChart={openChartKey === row.key} setShowChart={open => setOpenChartKey(open ? row.key : null)}
                sparkData={chartData[row.symbol] ?? null} setSparkData={data => setChartData(current => ({ ...current, [row.symbol]: data }))}
                sparkLoading={chartLoadingSymbol === row.symbol} setSparkLoading={loading => setChartLoadingSymbol(loading ? row.symbol : null)} />}
              savedNote={notes[storageKey(row.accountNumber, row.key)] ?? ''} onSaveNote={onSaveNote}
              savedAlert={alerts[storageKey(row.accountNumber, row.key)] ?? null} onSaveAlert={onSaveAlert}
              onSell={sellDeps ? setSellRow : () => {}} onAnalyze={onAnalyze ? row => void runAnalysis(row) : undefined} />
          ))}
          <div role="row" style={gridStyle} className={`grid ${COLUMNS} items-center border-t ${th.border} bg-white/5`} data-testid="stock-totals">
            <div className={`p-3 text-[11px] font-semibold tracking-wider ${th.textFaint}`}>STOCKS TOTAL{!totals.complete && <span className="block text-[10px] font-normal text-amber-300">partial</span>}</div>
            <div className="p-3" /><div className="p-3" />
            <div className={`p-3 font-mono ${th.textFaint}`}>{totals.costBasis != null ? money(totals.costBasis) : ''}</div>
            <div className="p-3 font-mono font-semibold text-white">{totals.value != null ? (totals.value < 0 ? `-${money(Math.abs(totals.value))}` : money(totals.value)) : '—'}</div>
            <div className={`p-3 font-mono font-semibold ${totals.pnl == null ? 'text-white/40' : totals.pnl >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
              {totals.pnl != null ? signedMoney(totals.pnl) : '—'}
              {totals.pnlPct != null && <span className="block font-sans text-[10px] font-normal">{totals.pnlPct >= 0 ? '+' : ''}{totals.pnlPct.toFixed(1)}%</span>}
              {!totals.complete && <span className="block font-sans text-[10px] font-normal text-amber-300">P/L covers {totals.pnlIncluded} of {totals.holdings} holdings{totals.pnlPct == null ? ' · no percent' : ''}</span>}
            </div>
            <div className="p-3" /><div className="p-3" /><div className="p-3" />
          </div>
        </div>
      </div>
      )}
      <ul className="mt-3 space-y-2 text-xs">
        {asOf && asOf.staleCount > 0 && <li className="rounded-lg border border-amber-500/35 bg-amber-500/10 px-3 py-2 text-amber-200">{asOf.staleCount} price{asOf.staleCount === 1 ? ' is' : 's are'} marked stale by the broker feed.</li>}
        {incomplete.length > 0 && <li className="rounded-lg border border-amber-500/35 bg-amber-500/10 px-3 py-2 text-amber-200">{incomplete.map(r => r.symbol).join(', ')} {incomplete.length === 1 ? 'has' : 'have'} no complete cost basis (several lots), so cost and P/L are not shown.</li>}
      </ul>
      {analyzeRow && (
        <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/70 p-4" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget && !analysisLoading) setAnalyzeRow(null); }}>
          <section role="dialog" aria-modal="true" aria-label={`AI analysis of ${analyzeRow.symbol} shares`} className="max-h-[90vh] w-full max-w-xl overflow-auto rounded-xl border border-white/20 bg-slate-950 p-5 text-white shadow-2xl" onKeyDown={event => { if (event.key === 'Escape' && !analysisLoading) setAnalyzeRow(null); }}>
            <header className="mb-3 flex items-center justify-between"><h2 className="text-base font-semibold">AI analysis — {analyzeRow.symbol} shares</h2><button type="button" onClick={() => { if (!analysisLoading) setAnalyzeRow(null); }} aria-label="Close analysis" className="min-h-11 min-w-11 rounded border border-white/20 focus:outline-none focus:ring-2 focus:ring-teal-400">×</button></header>
            <div aria-live="polite" className="text-sm">
              {analysisLoading ? <p>Analyzing {analyzeRow.symbol}…</p>
                : analysisError ? <div><p role="alert" className="text-red-400">{analysisError}</p><button type="button" onClick={() => void runAnalysis(analyzeRow)} className="mt-3 min-h-8 rounded border border-white/20 px-3 text-xs focus:ring-2 focus:ring-teal-400">Retry analysis</button></div>
                : analysis ? (
                  <div className="space-y-3">
                    <p><b>{analysis.recommendation.replace(/_/g, ' ')}</b> · {analysis.confidence} confidence</p>
                    <p>{analysis.summary}</p>
                    {analysis.flipIf && <p className="text-xs text-white/70"><b>Would change the call:</b> {analysis.flipIf}</p>}
                    {renderConversation && <section aria-label={`AI follow-up conversation for ${analyzeRow.symbol} shares`} className="overflow-hidden rounded-lg border border-indigo-500/30 bg-indigo-500/[0.04]"><div className="px-4 pt-3"><p className="text-xs font-semibold text-indigo-200">Continue with AI</p><p className="mt-1 text-[10px] text-white/50">Ask a follow-up about this holding.</p></div>{renderConversation(analyzeRow, analysis, analysisContext)}</section>}
                    <details className="rounded border border-white/10 p-3 text-xs"><summary className="cursor-pointer font-semibold text-white/70">Show reasoning and risks</summary>
                      <p className="mt-3 text-white/70">{analysis.reasoning}</p>
                      {analysis.risks.length > 0 && <div className="mt-3"><b>Risks</b><ul className="list-disc pl-5">{analysis.risks.map(r => <li key={r}>{r}</li>)}</ul></div>}
                      {analysis.catalysts.length > 0 && <div className="mt-3"><b>In favor</b><ul className="list-disc pl-5">{analysis.catalysts.map(c => <li key={c}>{c}</li>)}</ul></div>}
                    </details>
                    <p className="text-xs text-white/50">Advisory only. No order is prepared or submitted. Generated {new Date(analysis.generatedAt).toLocaleString()}.</p>
                  </div>
                ) : null}
            </div>
          </section>
        </div>
      )}
      {sellRow && sellDeps && <SellStockDialog row={sellRow} deps={sellDeps} onClose={() => setSellRow(null)} />}
    </section>
  );
}
