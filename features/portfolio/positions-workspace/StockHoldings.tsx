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

function Row({ row, th, chart, gridStyle, savedNote, onSaveNote, savedAlert, onSaveAlert, onSell }: {
  row: StockHoldingRow; chart: ReactNode; gridStyle?: { gridTemplateColumns: string }; th: Theme; savedNote: string; onSaveNote: SaveNote; savedAlert: SavedAlert | null; onSaveAlert: SaveAlert; onSell: (row: StockHoldingRow) => void;
}) {
  const pnlTone = row.pnl == null ? 'text-white/40' : row.pnl >= 0 ? 'text-emerald-400' : 'text-red-400';
  const canSellCovered = row.covered.kind === 'available';
  return (
    <div role="row" style={gridStyle} className={`grid ${COLUMNS} items-start border-t ${th.border}`} data-testid={`stock-row-${row.key}`}>
      <div className="p-3"><b className="text-white">{row.symbol}</b><span className={`block ${th.textFaint}`}>Equity · {row.direction.toLowerCase()}</span><span className="mt-1 block">{chart}</span></div>
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
      <div className="p-3">
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

export function StockHoldings({ columnWidths, groups, quoteAsOf, th, storageKey, notes, onSaveNote, alerts, onSaveAlert, sellDeps }: {
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
}) {
  const rows = buildStockHoldingRows(groups);
  const aligned = alignedStockColumns(columnWidths);
  const gridStyle = aligned ? { gridTemplateColumns: aligned.template } : undefined;
  const [sellRow, setSellRow] = useState<StockHoldingRow | null>(null);
  // The same quick chart the option rows use: one open at a time, closes cached per symbol.
  const [openChartKey, setOpenChartKey] = useState<string | null>(null);
  const [chartData, setChartData] = useState<Record<string, number[] | null>>({});
  const [chartLoadingSymbol, setChartLoadingSymbol] = useState<string | null>(null);
  if (rows.length === 0) return null;
  const totals = buildStockTotals(rows);
  const nowMs = Date.now();
  const asOf = stockPricesAsOf({ rows, fallback: quoteAsOf, nowMs, marketOpen: derivePmccMarketSession(new Date(nowMs)) === 'open' });
  const longRows = rows.filter(r => r.direction === 'Long');
  const noneReach100 = longRows.length > 0 && longRows.every(r => r.covered.kind === 'needs-shares');
  const incomplete = rows.filter(r => !r.basisComplete);

  return (
    <section className="mt-6" aria-label="Stock holdings" data-testid="stock-holdings">
      <div className="mb-2 flex flex-wrap items-center gap-3">
        <h3 className={`text-xs font-semibold tracking-wider ${th.textFaint}`}>STOCK HOLDINGS</h3>
        <span className={`text-xs ${th.textFaint}`}>{rows.length} holding{rows.length === 1 ? '' : 's'}</span>
        <div className={`h-px flex-1 ${th.border} border-t`} />
        {asOf && <span className="rounded-full border border-amber-500/40 bg-amber-500/10 px-2.5 py-0.5 text-[11px] text-amber-300" data-testid="stock-prices-as-of">{asOf.text}</span>}
      </div>
      <div className={`max-w-full overflow-x-auto rounded-xl border ${th.border}`} tabIndex={0} aria-label="Stock holdings, horizontally scrollable">
        <div role="table" className={aligned ? 'text-[11px]' : 'min-w-[1180px] text-[11px]'} style={aligned ? { width: aligned.total } : undefined}>
          <div role="row" style={gridStyle} className={`grid ${COLUMNS} bg-white/5 text-[10px] uppercase tracking-wider ${th.textFaint}`}>
            {['Holding', 'Shares', 'Price', 'Avg cost', totals.valueLabel, 'Unrealized P/L', 'Covered calls', 'Notes', 'Price alert', 'Sell'].map(name => <div key={name} role="columnheader" className="p-3">{name}</div>)}
          </div>
          {rows.map(row => (
            <Row key={row.key} row={row} th={th} gridStyle={gridStyle}
              chart={<ChartLinkButton symbol={row.symbol} chartSymbol={INDEX_CHART_SYMBOLS[row.symbol.toUpperCase()] ?? row.symbol} instanceKey={`stock-${row.key}`} th={th}
                showChart={openChartKey === row.key} setShowChart={open => setOpenChartKey(open ? row.key : null)}
                sparkData={chartData[row.symbol] ?? null} setSparkData={data => setChartData(current => ({ ...current, [row.symbol]: data }))}
                sparkLoading={chartLoadingSymbol === row.symbol} setSparkLoading={loading => setChartLoadingSymbol(loading ? row.symbol : null)} />}
              savedNote={notes[storageKey(row.accountNumber, row.key)] ?? ''} onSaveNote={onSaveNote}
              savedAlert={alerts[storageKey(row.accountNumber, row.key)] ?? null} onSaveAlert={onSaveAlert}
              onSell={sellDeps ? setSellRow : () => {}} />
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
      <ul className="mt-3 space-y-2 text-xs">
        {asOf && asOf.staleCount > 0 && <li className="rounded-lg border border-amber-500/35 bg-amber-500/10 px-3 py-2 text-amber-200">{asOf.staleCount} price{asOf.staleCount === 1 ? ' is' : 's are'} marked stale by the broker feed.</li>}
        {incomplete.length > 0 && <li className="rounded-lg border border-amber-500/35 bg-amber-500/10 px-3 py-2 text-amber-200">{incomplete.map(r => r.symbol).join(', ')} {incomplete.length === 1 ? 'has' : 'have'} no complete cost basis (several lots), so cost and P/L are not shown.</li>}
        {noneReach100 && <li className="rounded-lg border border-neutral-500/30 bg-neutral-500/10 px-3 py-2 text-neutral-200">{longRows.length === 1 ? 'This holding does not reach' : 'No holding reaches'} 100 shares, so covered calls are not available on {longRows.length === 1 ? 'it' : 'them'}.</li>}
        <li className="rounded-lg border border-neutral-500/30 bg-neutral-500/10 px-3 py-2 text-neutral-300">No suggested action for stocks here: the recommendation engine covers options only.</li>
      </ul>
      {sellRow && sellDeps && <SellStockDialog row={sellRow} deps={sellDeps} onClose={() => setSellRow(null)} />}
    </section>
  );
}
