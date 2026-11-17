'use client';

// features/screener/components/CcStrikeGrid.tsx
// CC-PMCC-GUIDANCE-0001 slice A -- the covered-call decision area and strike grid. One decision area on top (headline, three
// facts, Review order), then the grid. Every number comes from lib/scans/ccGuidance.ts so the headline, the facts, the cells
// and the button always agree. Nothing here places an order; Review order only opens the order screen.
//   POP = (1 - delta) x 100, a model estimate (delta reflects IV), not a guarantee.
//   A call is a pick only when its price gap passes the shared rule and it pays at least Dean's minimum.
//   No call below the cost basis is ever shown: the grid never holds one.

import { useEffect, useMemo, useState } from 'react';
import type { CcGrid, CcGridCell } from '@/lib/scans/ccGridTypes';
import { CC_GOALS, DEFAULT_CC_GOAL, ccCellNumbers, ccStockMovePct, cellInGoal, filterCcGrid, pickCellForSellPrice, pickDefaultAnchor, pickQuickCell, CC_QUICK_PICKS, CC_MIN_PAY_CHOICES, selectCcGridWindow, type CcGoal } from '@/lib/scans/ccGridView';
import { buildCcCardView, ccCellVerdict, ccEffectiveMinPay, ccExpirationLabel, ccFillLabel, ccPopPct, ccPopTone, ccStrikeLabel, pickSmallAndSafe, CC_SMALL_SAFE_MIN_POP } from '@/lib/scans/ccGuidance';
import { useCcMinPay } from '@/features/screener/useCcMinPay';
import { CcBasisLine, type CcBasisInfo } from './CcBasisLine';

interface Theme { border: string; text: string; textMuted: string; textFaint: string }

const dollars = (n: number) => `$${Math.round(n).toLocaleString('en-US')}`;
const TONE = { green: 'text-emerald-400', amber: 'text-amber-300' } as const;
const POP_TONE = { green: 'text-emerald-400', yellow: 'text-yellow-300', red: 'text-red-400' } as const;

export function CcStrikeGrid({ grid: rawGrid, th, symbol, initial, onAnchorChange, onReview, basisInfo }: {
  grid: CcGrid; th: Theme; symbol?: string;
  /** The trade the scan picked: the grid starts on it, so the grid and the Review order button agree from the first frame. */
  initial?: { expiration: string; strike: number } | null;
  /** Called with the call the decision area describes whenever it changes. */
  onAnchorChange?: (cell: CcGridCell | null) => void;
  /** Review order opens the order screen for the call shown. Omit to hide the button (the page supplies its own). */
  onReview?: (cell: CcGridCell) => void;
  /** Where the cost basis came from, for the basis line. */
  basisInfo?: CcBasisInfo;
}) {
  const [goal, setGoal] = useState<CcGoal>(DEFAULT_CC_GOAL);
  const [minPay, setMinPay] = useCcMinPay();
  const filtered = useMemo(() => filterCcGrid(rawGrid), [rawGrid]);
  const grid = filtered.grid;
  const [allExpirations, setAllExpirations] = useState(false);
  const [selected, setSelected] = useState<{ expiration: string; strike: number } | null>(null);
  const [frame, setFrame] = useState<{ expiration: string; strike: number } | null>(null);
  const [extraAbove, setExtraAbove] = useState(0);
  const [extraBelow, setExtraBelow] = useState(0);
  const [sellAt, setSellAt] = useState('');
  const [sellNote, setSellNote] = useState<string | null>(null);
  const [showCalls, setShowCalls] = useState(false);

  // The call the area starts on: the scan's pick when it is still a pick, else the best pick for the goal, else Small & safe.
  const auto = useMemo(() => {
    const picks = grid.cells.filter(c => ccCellVerdict(grid, c, minPay) === 'pick');
    const fromScan = initial ? grid.cells.find(c => c.expiration === initial.expiration && c.strike === initial.strike) : undefined;
    if (fromScan && ccCellVerdict(grid, fromScan, minPay) === 'pick') return { cell: fromScan, smallSafe: false };
    const best = pickDefaultAnchor(picks, goal);
    if (best) return { cell: best, smallSafe: false };
    const ss = pickSmallAndSafe(grid, minPay);
    return { cell: ss, smallSafe: ss !== null };
  }, [grid, minPay, goal, initial]);

  const frameCell = frame ?? (auto.cell ? { expiration: auto.cell.expiration, strike: auto.cell.strike } : null);
  const view = useMemo(
    () => selectCcGridWindow(grid, goal, { allExpirations, selected: frameCell, extraAbove, extraBelow }),
    [grid, goal, allExpirations, frameCell?.expiration, frameCell?.strike, extraAbove, extraBelow], // eslint-disable-line react-hooks/exhaustive-deps
  );

  const clicked = selected ? view.cell(selected.expiration, selected.strike) ?? null : null;
  const anchor = clicked ?? auto.cell;
  const anchorKey = anchor ? `${anchor.expiration}|${anchor.strike}` : '';
  useEffect(() => { onAnchorChange?.(anchor); }, [anchorKey]); // eslint-disable-line react-hooks/exhaustive-deps

  if (rawGrid.cells.length === 0) {
    return <p className={`text-[13px] ${th.textFaint}`}>No calls passed the safety checks for the strike grid.</p>;
  }

  const reset = () => { setSelected(null); setFrame(null); setExtraAbove(0); setExtraBelow(0); };
  const card = anchor ? buildCcCardView({ grid, cell: anchor, minPay, symbol, autoSmallSafe: clicked === null && auto.smallSafe }) : null;
  const floorPhrase = ccEffectiveMinPay(minPay);

  // S1: nothing fits. Say so with the real numbers.
  const bestPaying = grid.cells.filter(c => !c.wide).reduce<CcGridCell | null>((b, c) => (b === null || ccCellNumbers(grid, c).premiumTotal > ccCellNumbers(grid, b).premiumTotal ? c : b), null);
  const noneFits = auto.cell === null;

  return (
    <section aria-label="Covered call strike grid" data-testid="cc-strike-grid" className={`mt-2 border-t ${th.border} pt-2 cursor-default`} onClick={e => e.stopPropagation()}>
      <div role="group" aria-label="Minimum pay" className="mb-2 flex flex-wrap items-center gap-1.5 text-[13px]">
        <span className={th.textFaint}>Pays at least ${floorPhrase} for the order</span>
        {CC_MIN_PAY_CHOICES.map(n => (
          <button key={n} type="button" aria-pressed={minPay === n} onClick={() => { setMinPay(n); reset(); }}
            className={`rounded border px-2 py-0.5 ${minPay === n ? 'border-emerald-400 bg-emerald-500/10 text-emerald-300' : 'border-neutral-700 text-neutral-400'}`}>{n === 0 ? 'Any' : `$${n}`}</button>
        ))}
      </div>

      {card && anchor && (
        <div data-testid="cc-decision" className={`mb-2 rounded border ${th.border} p-3`}>
          <div className="flex flex-wrap items-center gap-2">
            {card.tag && <span data-testid="cc-small-safe-tag" className="rounded bg-emerald-500/15 px-2 py-0.5 text-[13px] font-bold tracking-wide text-emerald-300">{card.tag}</span>}
            <p data-testid="cc-headline" className={`text-base font-bold ${th.text}`}>{card.headline}</p>
          </div>
          {card.note && <p className="mt-0.5 text-[13px] text-amber-300">{card.note}</p>}
          <div className="mt-2 grid gap-2 sm:grid-cols-3">
            {[card.collect, card.keep, card.fill].map(f => (
              <div key={f.label} data-testid={`cc-fact-${f.label.toLowerCase().replace(/ /g, '-')}`}>
                <p className={`text-[13px] font-bold tracking-wide ${th.textFaint}`}>{f.label}</p>
                <p className={`text-lg font-bold ${f.label === 'KEEP YOUR SHARES' ? POP_TONE[ccPopTone(ccPopPct(anchor.delta))] : TONE[f.tone]}`}>{f.big}</p>
                <p className={`text-[13px] ${th.textMuted}`}>{f.sub}</p>
              </div>
            ))}
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-3">
            {onReview && (
              <button type="button" data-testid="cc-review-order" disabled={!card.canReview} onClick={() => onReview(anchor)}
                className="rounded border border-teal-500/60 px-3 py-1.5 text-[13px] font-bold text-teal-300 disabled:cursor-not-allowed disabled:opacity-40">Review order</button>
            )}
            {card.reviewOffNote && <span className="text-[13px] text-amber-300">{card.reviewOffNote}</span>}
          </div>
          <details className={`mt-1 text-[13px] ${th.textMuted}`}>
            <summary className="cursor-pointer text-teal-300">Why this call</summary>
            <ul className="mt-1 list-disc space-y-0.5 pl-5">{card.why.map(w => <li key={w}>{w}</li>)}</ul>
          </details>
          <details className={`text-[13px] ${th.textMuted}`}>
            <summary className="cursor-pointer text-teal-300">How to read this</summary>
            <p className="mt-1">POP is the chance the call expires worthless and you keep your shares, from the market&apos;s delta (it reflects implied volatility). It is an estimate, not a guarantee. Price gap is the difference between the bid and the ask as a share of the price: over 10% (or over 50 cents) is too big and the call is never a pick. You should collect about the bid up to the middle price rounded down.</p>
          </details>
        </div>
      )}

      {noneFits && (
        <p data-testid="cc-none-fits" className="mb-2 rounded border border-amber-500/40 px-3 py-2 text-[13px] text-amber-300">
          No call fits.{' '}
          {bestPaying
            ? `The best-paying call is ${ccStrikeLabel(bestPaying.strike)} Exp ${ccExpirationLabel(bestPaying.expiration)}: ${dollars(ccCellNumbers(grid, bestPaying).premiumTotal)} with POP ${ccPopPct(bestPaying.delta)}%, under your ${dollars(floorPhrase)} minimum${ccPopPct(bestPaying.delta) < CC_SMALL_SAFE_MIN_POP ? ` and under POP ${CC_SMALL_SAFE_MIN_POP}%` : ''}.`
            : 'Every call has a price gap that is too big.'}
        </p>
      )}
      {basisInfo !== undefined && <div className="mb-2"><CcBasisLine basis={basisInfo} /></div>}

      <div className="mb-1.5 flex flex-wrap items-center gap-2">
        <span className={`text-[13px] font-bold uppercase tracking-widest ${th.textMuted}`}>Strike grid</span>
        <div role="group" aria-label="Goal" className="flex flex-wrap gap-1">
          {(Object.keys(CC_GOALS) as CcGoal[]).map(g => (
            <button key={g} type="button" aria-pressed={goal === g} onClick={() => { setGoal(g); reset(); }}
              className={`rounded border px-2 py-0.5 text-[13px] font-bold ${goal === g ? 'border-emerald-400 bg-emerald-500/10 text-emerald-300' : 'border-neutral-700 text-neutral-400'}`}>
              {CC_GOALS[g].label} <span className="font-normal opacity-70">{CC_GOALS[g].pop}</span>
            </button>
          ))}
        </div>
      </div>

      {anchor && (
        <>
        <div role="group" aria-label="Quick picks" className="mb-1.5 flex flex-wrap items-center gap-1.5 text-[13px]">
          <span className={th.textFaint}>Jump to:</span>
          {CC_QUICK_PICKS.map(q => (
            <button key={q.kind} type="button"
              onClick={() => {
                const c = pickQuickCell(grid, q.kind);
                if (c) { const at = { expiration: c.expiration, strike: c.strike }; setSelected(at); setFrame(at); setSellNote(null); } else setSellNote('No call qualifies for that pick.');
              }}
              className="rounded border border-neutral-700 px-2 py-0.5 text-neutral-300">{q.label}</button>
          ))}
        </div>
        <form data-testid="cc-sell-price" className="mb-1.5 flex flex-wrap items-center gap-2 text-[13px]"
          onSubmit={e => {
            e.preventDefault();
            const pick = pickCellForSellPrice(grid, Number(sellAt.replace(/[$,\s]/g, '')), { expiration: anchor.expiration });
            setSellNote(pick.note);
            if (pick.cell) { const at = { expiration: pick.cell.expiration, strike: pick.cell.strike }; setSelected(at); setFrame(at); }
          }}>
          <label className={th.textFaint}>I would sell my shares at $
            <input aria-label="Price I would sell my shares at" inputMode="decimal" value={sellAt} onChange={e => setSellAt(e.target.value)}
              className="ml-1 w-20 rounded border border-white/20 bg-transparent px-1.5 py-0.5 font-mono text-white" />
          </label>
          <button type="submit" className="rounded border border-teal-500/50 px-2 py-0.5 text-teal-300">Find the call</button>
          {sellNote && <span role="status" className="text-amber-300">{sellNote}</span>}
        </form>
        </>
      )}

      {view.strikes.length > 0 && (
        <div className="overflow-x-auto">
          {view.moreStrikesAbove > 0 && (
            <button type="button" onClick={() => setExtraAbove(n => n + 1)} className="mb-1 rounded border border-neutral-700 px-2 py-0.5 text-[13px] text-neutral-300">+ Add one higher strike</button>
          )}
          <table className="w-full border-collapse text-[13px]">
            <thead>
              <tr>
                <th className={`p-1 text-left font-medium ${th.textFaint}`}>Strike</th>
                {view.expirations.map(e => (
                  <th key={e.expiration} className={`p-1 text-left font-medium ${th.textMuted}`}>{ccExpirationLabel(e.expiration)} <span className="opacity-60">· {e.dte}d</span></th>
                ))}
              </tr>
            </thead>
            <tbody>
              {view.strikes.map(strike => (
                <tr key={strike}>
                  <th scope="row" className={`p-1 text-left font-bold ${th.text}`}>{ccStrikeLabel(strike)}</th>
                  {view.expirations.map(e => {
                    const cell = view.cell(e.expiration, strike);
                    if (!cell) return <td key={e.expiration} className={`p-1 ${th.textFaint}`}>—</td>;
                    const isSel = anchor !== null && anchor.expiration === cell.expiration && anchor.strike === cell.strike;
                    const n = ccCellNumbers(grid, cell);
                    const verdict = ccCellVerdict(grid, cell, minPay);
                    const pop = ccPopPct(cell.delta);
                    const gap = ccFillLabel(cell).gapPct;
                    const total = n.calledAwayTotal;
                    const muted = verdict === 'wide' || verdict === 'low_pay';
                    return (
                      <td key={e.expiration} className="p-0.5">
                        <button type="button" onClick={() => setSelected({ expiration: cell.expiration, strike: cell.strike })}
                          aria-label={`${cell.strike} call ${cell.expiration}`} aria-pressed={isSel} data-verdict={verdict}
                          title={`Bid $${cell.bid.toFixed(2)} / ask $${cell.ask.toFixed(2)}. POP ${pop}% is the market's estimate of the chance you keep your shares.`}
                          className={`w-full rounded border p-1.5 text-left ${muted ? 'bg-white/5 opacity-60' : ''} ${isSel ? 'border-white' : verdict === 'wide' ? 'border-neutral-700' : cellInGoal(cell, goal) ? 'border-emerald-500/60' : 'border-neutral-800'}`}>
                          <span className={`block text-sm font-bold ${muted ? 'text-neutral-300' : 'text-emerald-400'}`}>{dollars(n.premiumTotal)} <span className="text-[13px] font-normal opacity-80">{n.usedBid ? 'at the bid' : 'now'}</span></span>
                          {verdict === 'wide' ? (
                            <span className="block text-[13px] text-yellow-300">Price gap {gap !== null ? `${gap.toFixed(0)}%` : 'too big'} · not a pick</span>
                          ) : (
                            <span className={`block text-[13px] ${th.textMuted}`}>
                              <span className={POP_TONE[ccPopTone(pop)]}>POP {pop}%</span>
                              {total !== null && <span> · {total < 0 ? '-' : '+'}{dollars(Math.abs(total))} if called</span>}
                              {verdict === 'low_pay' && <span className="block text-amber-300">pays under {dollars(floorPhrase)}</span>}
                              {verdict === 'small_safe' && <span className="block text-emerald-300">small &amp; safe</span>}
                            </span>
                          )}
                        </button>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
          {view.moreStrikesBelow > 0 && (
            <button type="button" onClick={() => setExtraBelow(n => n + 1)} className="mt-1 rounded border border-neutral-700 px-2 py-0.5 text-[13px] text-neutral-300">+ Add one lower strike</button>
          )}
        </div>
      )}

      <div className="mt-1 flex flex-wrap items-center gap-3">
        {view.moreExpirations > 0 && (
          <button type="button" onClick={() => setAllExpirations(true)} className="rounded border border-neutral-700 px-2 py-0.5 text-[13px] text-neutral-300">+ {view.moreExpirations} more expiration{view.moreExpirations === 1 ? '' : 's'}</button>
        )}
        {allExpirations && (
          <button type="button" onClick={() => setAllExpirations(false)} className="rounded border border-neutral-700 px-2 py-0.5 text-[13px] text-neutral-300">Show fewer expirations</button>
        )}
        {filtered.hiddenThinOi > 0 && (
          <p data-testid="cc-grid-hidden" className={`w-full text-[13px] ${th.textFaint}`}>Hidden: {filtered.hiddenThinOi} with open interest under your minimum.</p>
        )}
        <div className="w-full">
          <button type="button" aria-expanded={showCalls} onClick={() => setShowCalls(v => !v)} className="rounded border border-neutral-700 px-2 py-0.5 text-[13px] text-neutral-300">{showCalls ? 'Hide the calls' : 'Show the calls'}</button>
          {showCalls && (
            <div className="mt-1 overflow-x-auto">
              <table data-testid="cc-calls-table" className="w-full border-collapse text-[13px]">
                <thead><tr className={th.textFaint}>{['Expiry', 'Strike', '% above price', 'POP', 'You would collect', 'Price gap', 'Why outside'].map(h => <th key={h} className="p-1 text-left font-medium">{h}</th>)}</tr></thead>
                <tbody>
                  {[...grid.cells].sort((x, y) => x.expiration.localeCompare(y.expiration) || x.strike - y.strike).map(cell => {
                    const n = ccCellNumbers(grid, cell);
                    const v = ccCellVerdict(grid, cell, minPay);
                    const f = ccFillLabel(cell);
                    const up = ccStockMovePct(grid, cell);
                    const why = v === 'wide' ? 'Price gap too big, never a pick' : v === 'low_pay' ? `Pays under ${dollars(floorPhrase)}` : v === 'small_safe' ? 'Under your minimum, but small & safe' : '';
                    return (
                      <tr key={`${cell.expiration}|${cell.strike}`} className={th.textMuted}>
                        <td className="p-1">{ccExpirationLabel(cell.expiration)}</td>
                        <td className="p-1">{ccStrikeLabel(cell.strike)}</td>
                        <td className="p-1">{up !== null ? `${up.toFixed(1)}%` : '—'}</td>
                        <td className="p-1">{ccPopPct(cell.delta)}%</td>
                        <td className="p-1">{dollars(n.premiumTotal)} <span className="opacity-70">(bid ${cell.bid.toFixed(2)} / ask ${cell.ask.toFixed(2)})</span></td>
                        <td className="p-1">{f.gapPct !== null ? `${f.gapPct.toFixed(1)}%` : '—'}</td>
                        <td className="p-1">{why}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
        <p className={`w-full text-[13px] ${th.textFaint}`}>Green outline: in your goal range. Grayed: not a pick (price gap too big, or pays too little). No call below your cost is ever shown.</p>
      </div>
    </section>
  );
}
