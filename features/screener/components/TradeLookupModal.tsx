'use client';

// features/screener/components/TradeLookupModal.tsx
//
// TRADE-LOOKUP-0001D: paste a trading-group post (CSP or covered call), see the live chain with the posted contract
// highlighted, compare nearby strikes and the next expiration, and send a put to the existing CSP order dialog.
// Inspection only: nothing here scores, qualifies or places an order. All data and math come from lib/tradeLookup
// (which reuses positionMetrics and the scans' own checks); the modal just shows them.
//
// Covered calls are inspection-only because TradeEdge has no covered-call order dialog yet (the Covered Call scan
// says "Analysis only"). The coverage line still tells the trader whether shares or a LEAP would cover the call.

import { useCallback, useEffect, useMemo, useState } from 'react';
import { ScanModalShell, type ScanModalTheme } from './ScanModalShell';
import { parsePost } from '@/lib/tradeLookup/parsePost';
import { loadTradeLookup, type LookupDeps } from '@/lib/tradeLookup/loadLookup';
import { buildCcOrderInput, buildCspOrderResult, ccHandoffBlockReason, handoffBlockReason } from '@/lib/tradeLookup/orderHandoff';
import type { CcOrderInput } from './CcTradeModal';
import {
  LOOKUP_COLUMNS, DEFAULT_LOOKUP_COLUMNS, LOCKED_COLUMN, loadLookupColumns, saveLookupColumns, toggleLookupColumn,
  type LookupColumnId,
} from '@/lib/tradeLookup/lookupColumns';
import { quoteStatusLine, quotesMayBeStale } from '@/lib/tradeLookup/quoteStatus';
import type { LoadOutcome, LookupResult, LookupRow } from '@/lib/tradeLookup/lookupTypes';
import type { ExpiryResolution, ParsedContract } from '@/lib/tradeLookup/types';
import type { ScreenResult } from '@/lib/scans/types';

interface Props {
  th: ScanModalTheme;
  deps: LookupDeps;
  onClose: () => void;
  /** Hands a chosen put to the existing CSP order dialog. */
  onOrderCsp: (result: ScreenResult) => void;
  /** Hands a chosen covered call to the call order dialog, which proves coverage itself. Omit to keep calls inspection-only. */
  onOrderCc?: (order: CcOrderInput) => void;
  /** True while the order dialog is open on top: the modal keeps its state but draws nothing. */
  suspended?: boolean;
}

/** A value outside the trader's range is shown in amber with its reason on hover. The numbers are always shown. */
const OUT_OF_RANGE = 'font-bold text-amber-300 bg-amber-500/10';
function flagOf(row: LookupRow, code: string): string {
  const f = row.flags.filter((x) => x.code === code)[0];
  return f ? f.label : '';
}

const GROUP_TEXT: Record<string, string> = {
  Contract: 'text-neutral-300',
  Risk: 'text-purple-300',
  Economics: 'text-emerald-300',
  Liquidity: 'text-sky-300',
  Compare: 'text-amber-300',
};

const money = (n: number | null) => (n === null ? '—' : '$' + n.toFixed(2));
const num2 = (n: number | null) => (n === null ? '—' : n.toFixed(2));
const pct0 = (n: number | null) => (n === null ? '—' : n.toFixed(0) + '%');
const signed = (n: number | null, digits: number, prefix = '') =>
  n === null ? '—' : (n > 0 ? '+' : n < 0 ? '−' : '') + prefix + Math.abs(n).toFixed(digits);
const rowKey = (r: LookupRow) => r.expiration + '|' + r.right + '|' + r.strike;

function describeContract(c: ParsedContract): string {
  return (c.strategy === 'CSP' ? 'Cash-secured put' : 'Covered call') + ' · ' + c.ticker + ' ' + c.strike + (c.right === 'P' ? 'P' : 'C') +
    ' · ' + c.expiry.month + '/' + c.expiry.day + (c.expiry.year ? '/' + c.expiry.year : '') +
    (c.postedPrice !== null ? ' · posted $' + c.postedPrice.toFixed(2) : '');
}

function blockedMessage(res: ExpiryResolution): string {
  if (res.status === 'expired') return res.date + ' has already passed (' + Math.abs(res.daysOut) + ' day' + (Math.abs(res.daysOut) === 1 ? '' : 's') + ' ago). Check the post date.';
  if (res.status === 'not_listed') {
    return res.reason === 'weekend'
      ? res.date + ' is a weekend, so no option expires then. Check the date in the post.'
      : res.date + ' is not one of the expirations this ticker lists.';
  }
  if (res.status === 'invalid_date') return res.reason;
  if (res.status === 'confirm_far') return res.date + ' is ' + res.daysOut + ' days out. That is further than most group posts go.';
  return '';
}

export function TradeLookupModal({ th, deps, onClose, onOrderCsp, onOrderCc, suspended = false }: Props) {
  const [text, setText] = useState('');
  const [notice, setNotice] = useState('');
  const [contract, setContract] = useState<ParsedContract | null>(null);
  const [quantity, setQuantity] = useState(1);
  const [loading, setLoading] = useState(false);
  const [outcome, setOutcome] = useState<LoadOutcome | null>(null);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [columns, setColumns] = useState<LookupColumnId[]>(DEFAULT_LOOKUP_COLUMNS);
  const [columnsOpen, setColumnsOpen] = useState(false);

  useEffect(() => { setColumns(loadLookupColumns()); }, []);

  const run = useCallback(async (c: ParsedContract, qty: number, confirmedFar: boolean) => {
    setLoading(true);
    setSelectedKey(null);
    try {
      const out = await loadTradeLookup(c, deps, { contracts: qty, confirmedFar });
      setOutcome(out);
    } catch (e) {
      setOutcome({ kind: 'error', message: e instanceof Error && e.message ? e.message : 'Lookup failed.' });
    } finally {
      setLoading(false);
    }
  }, [deps]);

  const submit = () => {
    setNotice('');
    setOutcome(null);
    const parsed = parsePost(text);
    if (parsed.kind === 'unreadable') { setContract(null); setNotice(parsed.reason); return; }
    if (parsed.kind === 'exit') {
      setContract(null);
      setNotice('This is an exit post for ' + parsed.tickers.join(', ') + '. Trade Lookup reads new trades only. Manage exits from Portfolio.');
      return;
    }
    setContract(parsed);
    void run(parsed, quantity, false);
  };

  const changeQuantity = (next: number) => {
    const q = Math.max(1, Math.min(99, next));
    setQuantity(q);
    // Only a loaded chain is re-priced; its date was already accepted, so a far date stays confirmed.
    if (contract && outcome && outcome.kind === 'result' && !loading) void run(contract, q, true);
  };

  const result: LookupResult | null = outcome && outcome.kind === 'result' ? outcome.result : null;
  const selected: LookupRow | null = useMemo(() => {
    if (!result || !selectedKey) return null;
    return result.rows.filter((r) => rowKey(r) === selectedKey)[0] || null;
  }, [result, selectedKey]);

  const now = new Date();
  const stale = quotesMayBeStale(now);

  const toggleColumn = (id: LookupColumnId) => {
    const next = toggleLookupColumn(columns, id);
    setColumns(next);
    saveLookupColumns(next);
  };
  const show = (id: LookupColumnId) => columns.indexOf(id) !== -1;

  if (suspended) return null;

  const inputCls = `rounded border ${th.inputBorder} ${th.input} px-2 py-1 text-xs ${th.text}`;

  return (
    <ScanModalShell
      th={th}
      titleId="trade-lookup-title"
      title="TRADE LOOKUP"
      subtitle="Paste a group post. See it on the live chain, compare nearby strikes, send a put to the order window."
      closeLabel="Close trade lookup"
      onClose={onClose}
      maxWidthClassName="max-w-5xl"
    >
      <div className="flex flex-col gap-3">
        <label className={`text-[10px] ${th.textFaint}`} htmlFor="trade-lookup-post">Group post</label>
        <textarea
          id="trade-lookup-post"
          data-autofocus
          rows={3}
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="NEW CSP SOXL 11/6 $120P @ $5.47"
          className={`w-full resize-y ${inputCls} font-mono`}
        />
        <div className="flex flex-wrap items-center gap-3">
          <label className={`flex items-center gap-2 text-xs ${th.textMuted}`}>
            Contracts
            <button type="button" aria-label="Fewer contracts" onClick={() => changeQuantity(quantity - 1)} className={`rounded border ${th.inputBorder} px-2 ${th.text}`}>{'−'}</button>
            <span aria-live="polite" className={`w-6 text-center font-bold ${th.text}`}>{quantity}</span>
            <button type="button" aria-label="More contracts" onClick={() => changeQuantity(quantity + 1)} className={`rounded border ${th.inputBorder} px-2 ${th.text}`}>+</button>
          </label>
          <button
            type="button"
            disabled={loading || text.trim() === ''}
            onClick={submit}
            className="ml-auto rounded-lg border border-cyan-400 bg-cyan-400 px-4 py-2 text-xs font-bold text-black disabled:cursor-not-allowed disabled:opacity-40"
          >
            {loading ? 'LOOKING UP…' : 'LOOK UP →'}
          </button>
        </div>

        {notice && <p role="alert" className="text-xs text-amber-300">{notice}</p>}

        {contract && (
          <p className={`text-[11px] ${th.textMuted}`} data-testid="trade-lookup-parsed">
            Read as: {describeContract(contract)}
            {contract.isRollLike && <span className="ml-2 text-amber-300">The post also mentions exiting or rolling. Only the new contract is looked up.</span>}
          </p>
        )}

        {outcome && outcome.kind === 'error' && <p role="alert" className="text-xs text-red-400">{outcome.message}</p>}

        {outcome && outcome.kind === 'blocked' && (
          <div role="alert" className="rounded-lg border border-amber-500/60 bg-amber-500/10 p-3 text-xs text-amber-200">
            <p>{blockedMessage(outcome.resolution)}</p>
            {outcome.resolution.status === 'confirm_far' && contract && (
              <button
                type="button"
                disabled={loading}
                onClick={() => void run(contract, quantity, true)}
                className="mt-2 rounded border border-amber-400 px-3 py-1 font-bold text-amber-200 disabled:opacity-40"
              >
                USE {outcome.resolution.date}
              </button>
            )}
          </div>
        )}

        {result && result.status === 'strike_not_listed' && (
          <div role="alert" className="rounded-lg border border-amber-500/60 bg-amber-500/10 p-3 text-xs text-amber-200">
            <p>{result.contract.strike} is not a listed strike for {result.expiration}. Nothing was rounded.</p>
            {result.nearestStrikes.length > 0 && (
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <span>Closest listed:</span>
                {result.nearestStrikes.map((s) => (
                  <button
                    key={s}
                    type="button"
                    disabled={loading}
                    onClick={() => { const c2 = Object.assign({}, result.contract, { strike: s }); setContract(c2); void run(c2, quantity, true); }}
                    className="rounded border border-amber-400 px-3 py-1 font-bold disabled:opacity-40"
                  >
                    {s}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        {result && result.status === 'no_rows' && (
          <p role="alert" className="text-xs text-amber-300">{result.notes.join(' ')}</p>
        )}

        {result && result.status === 'ok' && result.pick && (
          <>
            <div className={`flex flex-wrap items-center gap-x-4 gap-y-1 rounded-lg border ${th.border} px-3 py-2 text-xs`} data-testid="trade-lookup-header">
              <span className={th.text}>{result.contract.ticker}{result.underlyingPrice !== null ? ' $' + result.underlyingPrice.toFixed(2) : ''}</span>
              <span className={stale ? 'text-amber-300' : th.textMuted} data-testid="trade-lookup-quote-status">{quoteStatusLine(result.quotesAsOf, now)}</span>
              <button
                type="button"
                disabled={loading}
                onClick={() => contract && void run(contract, quantity, true)}
                className={`ml-auto rounded border ${th.inputBorder} px-3 py-1 ${th.text} disabled:opacity-40`}
              >
                {loading ? 'REFRESHING…' : 'REFRESH'}
              </button>
            </div>
            {stale && <p className="text-[11px] text-amber-300">Quotes outside regular hours can be stale or wide. Check again when the market is open before ordering.</p>}

            <p className={`text-xs ${th.textMuted}`} data-testid="trade-lookup-posted">
              {result.posted.postedPrice !== null
                ? <>Posted {money(result.posted.postedPrice)} {'→'} mid now {money(result.posted.mid)}
                    {result.posted.change !== null && <> ({signed(result.posted.change, 2, '$')}{result.posted.changePct !== null ? ', ' + signed(result.posted.changePct, 0) + '%' : ''})</>}
                    {result.posted.postAgeDays !== null && <> {'·'} post is {result.posted.postAgeDays} day{result.posted.postAgeDays === 1 ? '' : 's'} old</>}</>
                : <>The post gave no price. Mid now {money(result.posted.mid)}.</>}
            </p>

            {result.contract.strategy === 'CC' && (
              <p
                data-testid="trade-lookup-coverage"
                className={`rounded-lg border px-3 py-2 text-xs ${result.coverage.canOrder ? 'border-emerald-500/50 text-emerald-300' : 'border-amber-500/60 text-amber-200'}`}
              >
                {result.coverage.message}
                <span className="block opacity-80">
                  {onOrderCc
                    ? 'The order window reads your shares and LEAPs from the broker again before anything is placed.'
                    : 'Covered-call orders are not enabled in TradeEdge yet, so this table is for inspection.'}
                </span>
              </p>
            )}

            {result.notes.length > 0 && <ul className={`text-[11px] ${th.textFaint}`}>{result.notes.map((n) => <li key={n}>{n}</li>)}</ul>}

            <div className="flex items-center justify-between">
              <span className={`text-[10px] ${th.textFaint}`}>{result.contracts} contract{result.contracts === 1 ? '' : 's'} {'·'} the posted contract is highlighted</span>
              <button type="button" aria-expanded={columnsOpen} onClick={() => setColumnsOpen((o) => !o)} className={`rounded border ${th.inputBorder} px-3 py-1 text-[11px] ${th.textMuted}`}>
                Columns
              </button>
            </div>
            {columnsOpen && (
              <div className={`grid gap-2 rounded-lg border ${th.border} p-3 sm:grid-cols-3`} role="group" aria-label="Customize columns">
                {LOOKUP_COLUMNS.map((c) => (
                  <label key={c.id} className="flex items-center gap-2 text-xs">
                    <input type="checkbox" checked={show(c.id)} disabled={c.id === LOCKED_COLUMN} onChange={() => toggleColumn(c.id)} />
                    <span><b className={`block ${th.text}`}>{c.label}</b><span className={GROUP_TEXT[c.group]}>{c.group}</span></span>
                  </label>
                ))}
              </div>
            )}

            <div className="overflow-x-auto">
              <table className="w-full min-w-[640px] border-collapse text-xs" data-testid="trade-lookup-table">
                <thead>
                  <tr className={`text-left text-[10px] uppercase tracking-wider`}>
                    {LOOKUP_COLUMNS.filter((c) => show(c.id)).map((c) => (
                      <th key={c.id} scope="col" className={`px-2 py-1 font-bold ${GROUP_TEXT[c.group]}`}>{c.label}</th>
                    ))}
                    <th scope="col" className="px-2 py-1"><span className="sr-only">Select</span></th>
                  </tr>
                </thead>
                <tbody>
                  {result.rows.map((r) => {
                    const isSel = selectedKey === rowKey(r);
                    return (
                      <tr
                        key={rowKey(r)}
                        data-testid={r.isPick ? 'trade-lookup-pick-row' : 'trade-lookup-row'}
                        aria-selected={isSel}
                        className={`border-t ${th.border} ${r.isPick ? 'bg-cyan-400/10' : ''} ${isSel ? 'outline outline-1 outline-cyan-400' : ''} ${r.isNextExpiration ? 'border-dashed' : ''}`}
                      >
                        {show('strike') && (
                          <td className={`px-2 py-1.5 font-bold ${flagOf(r, 'below_cost_basis') ? OUT_OF_RANGE : th.text}`} title={flagOf(r, 'below_cost_basis') || undefined}>
                            {r.strike}{r.right}
                            {r.isPick && <span className="ml-1 rounded bg-cyan-400 px-1 text-[9px] text-black">POSTED</span>}
                            {r.isNextExpiration && <span className={`ml-1 text-[9px] ${th.textFaint}`}>NEXT EXP</span>}
                            {r.noQuote && <span className="ml-1 text-[9px] text-amber-300">NO QUOTE</span>}
                          </td>
                        )}
                        {show('expiration') && <td className={`px-2 py-1.5 ${th.textMuted}`}>{r.expiration} <span className={th.textFaint}>({r.dte}d)</span></td>}
                        {show('delta') && <td className={`px-2 py-1.5 ${flagOf(r, 'delta_outside_band') ? OUT_OF_RANGE : th.textMuted}`} title={flagOf(r, 'delta_outside_band') || undefined}>{r.delta === null ? '—' : Math.abs(r.delta).toFixed(2)}</td>}
                        {show('pop') && <td className={`px-2 py-1.5 ${th.textMuted}`}>{pct0(r.pop)}</td>}
                        {show('credit') && <td className={`px-2 py-1.5 ${th.textMuted}`}>{money(r.mid)} <span className={th.textFaint}>/ {money(r.natural)}</span></td>}
                        {show('bidAsk') && (
                          <td className={`px-2 py-1.5 ${flagOf(r, 'wide_spread') ? OUT_OF_RANGE : th.textMuted}`} title={flagOf(r, 'wide_spread') || undefined}>
                            {r.noQuote ? '—' : num2(r.bid) + ' / ' + num2(r.ask)}
                            {!r.noQuote && r.bid !== null && r.ask !== null && <span className="block text-[10px] opacity-80">spread ${(r.ask - r.bid).toFixed(2)}</span>}
                          </td>
                        )}
                        {show('breakeven') && <td className={`px-2 py-1.5 ${th.textMuted}`}>{money(r.breakeven)}</td>}
                        {show('maxRisk') && <td className={`px-2 py-1.5 ${th.textMuted}`}>{r.maxRisk === null ? '—' : '$' + Math.round(r.maxRisk).toLocaleString()}</td>}
                        {show('openInterest') && <td className={`px-2 py-1.5 ${flagOf(r, 'thin_oi') ? OUT_OF_RANGE : th.textMuted}`} title={flagOf(r, 'thin_oi') || undefined}>{r.openInterest === null ? '—' : r.openInterest.toLocaleString()}</td>}
                        {show('creditVsPick') && <td className={`px-2 py-1.5 ${th.textMuted}`}>{r.isPick ? '' : signed(r.creditVsPick, 2, '$')}</td>}
                        {show('popVsPick') && <td className={`px-2 py-1.5 ${th.textMuted}`}>{r.isPick ? '' : signed(r.popVsPick, 0) + (r.popVsPick === null ? '' : ' pts')}</td>}
                        <td className="px-2 py-1.5 text-right">
                          <button
                            type="button"
                            disabled={r.noQuote}
                            aria-label={`Select ${r.strike}${r.right} ${r.expiration}`}
                            onClick={() => setSelectedKey(rowKey(r))}
                            className={`rounded border px-2 py-0.5 text-[10px] font-bold disabled:cursor-not-allowed disabled:opacity-40 ${isSel ? 'border-cyan-400 text-cyan-300' : th.inputBorder + ' ' + th.text}`}
                          >
                            {isSel ? 'SELECTED' : 'SELECT'}
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {selected && (
              <div className={`rounded-lg border ${th.border} p-3 text-xs`} data-testid="trade-lookup-selected">
                <p className={`font-bold ${th.text}`}>
                  Selected: {selected.strike}{selected.right} {selected.expiration} ({selected.dte}d)
                </p>
                <p className={th.textMuted}>
                  Credit {money(selected.mid)} (natural {money(selected.natural)}) {'·'} POP {pct0(selected.pop)} {'·'} breakeven {money(selected.breakeven)}
                  {selected.maxRisk !== null && <> {'·'} max risk ${Math.round(selected.maxRisk).toLocaleString()}</>}
                </p>
                {selected.flags.length > 0 && (
                  <ul className="mt-1 text-amber-300">{selected.flags.map((f) => <li key={f.code}>{f.label}</li>)}</ul>
                )}
                <div className="mt-2 flex items-center gap-3">
                  {result.contract.strategy === 'CC' && onOrderCc && ccHandoffBlockReason(result, selected) === null ? (
                    <button
                      type="button"
                      onClick={() => {
                        const order = buildCcOrderInput(result, selected);
                        if (order) onOrderCc(order);
                      }}
                      className="rounded-lg bg-emerald-600 px-4 py-2 text-xs font-bold tracking-widest text-white hover:bg-emerald-500"
                    >
                      SEND TO ORDER {'→'}
                    </button>
                  ) : handoffBlockReason(result, selected) === null ? (
                    <button
                      type="button"
                      onClick={() => {
                        const order = buildCspOrderResult(result, selected);
                        if (order) onOrderCsp(order);
                      }}
                      className="rounded-lg bg-emerald-600 px-4 py-2 text-xs font-bold tracking-widest text-white hover:bg-emerald-500"
                    >
                      SEND TO ORDER {'→'}
                    </button>
                  ) : (
                    <span className={th.textFaint}>
                      {result.contract.strategy === 'CC'
                        ? (onOrderCc
                            ? (result.coverage.canOrder ? 'This call has no usable quote, so it cannot be ordered.' : 'Coverage is not proven for this call, so it cannot be ordered.')
                            : 'Covered-call orders are not enabled in TradeEdge yet.')
                        : 'This contract has no usable quote, so it cannot be ordered.'}
                    </span>
                  )}
                  <span className={`text-[10px] ${th.textFaint}`}>The order window re-checks the live quote and your cash before anything is placed.</span>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </ScanModalShell>
  );
}
