// features/trade-map/OptimizePanel.tsx
//
// OPTMAP-0001 S5: the screener's own pick for this symbol at the trader's width, plus the screener's best at each width.
// Display only: every number comes from the screener's finders (lib/trademap/optimize.ts); nothing here scores or ranks.

'use client';

import type { SpreadCandidate } from '@/lib/scans/types';
import type { Greeks } from '@/lib/trademap/greeks';

export interface OptimizePanelProps {
  th: any;
  /** The width in dollars the pick was searched at; null when every width was searched. */
  widthDollars: number | null;
  pick: SpreadCandidate | null;
  atEachWidth: SpreadCandidate[];
  noQuotes: boolean;
  /** Short strike currently on the map, to mark the loaded row. */
  loadedShort: number | null;
  loadedLong: number | null;
  loadedExp: string | null;
  canUndo: boolean;
  /** The saved POP minimum (percent) for this symbol type, to say plainly when a pick is below it. */
  popMin: number | null;
  /** The stock's current price, its IV rank and the position's Greeks today, for the selected trade's detail. */
  stock: number | null;
  ivRankPct: number | null;
  greeks: Greeks | null;
  onLoad: (c: SpreadCandidate) => void;
  onUndo: () => void;
  onClose: () => void;
}

const usd0 = (v: number) => `${v < 0 ? '-' : '+'}$${Math.round(Math.abs(v)).toLocaleString('en-US')}`;
const sgn = (v: number, d: number) => `${v < 0 ? '-' : '+'}${Math.abs(v).toFixed(d)}`;
const widthText = (w: number) => `$${Number.isInteger(w) ? w : w.toFixed(2)}`;


function Stat({ th, label, value, sub, tone }: { th: any; label: string; value: string; sub?: string; tone?: 'good' }) {
  return (
    <div className="flex flex-col gap-0.5">
      <div className={`text-[10px] tracking-wider ${th.textFaint}`}>{label}</div>
      <div className={`text-sm font-semibold ${tone === 'good' ? 'text-emerald-400' : th.text}`}>{value}</div>
      <div className={`text-[10px] ${th.textFaint}`}>{sub ?? ''}</div>
    </div>
  );
}

/** The selected trade's numbers, all from the screener's candidate or the grid's own model. */
function SelectedDetail({ p, c }: { p: OptimizePanelProps; c: SpreadCandidate }) {
  const { th } = p;
  const isPut = c.strategy === 'BPS';
  const credit = c.credit;
  const breakeven = isPut ? c.shortStrike - credit : c.shortStrike + credit;
  const fromStock = p.stock ? ((breakeven / p.stock) - 1) * 100 : null;
  const maxLoss = (c.spreadWidth - credit) * 100;
  return (
    <div data-testid="optimize-detail" className={`border ${th.border} rounded-lg p-3 flex flex-col gap-2`}>
      <div className={`text-xs font-bold ${th.text}`}>
        Selected: short {c.shortStrike} / long {c.longStrike} {isPut ? 'put' : 'call'}{' '}
        <span className={`font-normal ${th.textFaint}`}>{widthText(c.spreadWidth)} wide · {c.dte} days</span>
      </div>
      <div className="grid grid-cols-3 sm:grid-cols-6 gap-3">
        <Stat th={th} label="STOCK" value={p.stock == null ? '—' : `$${p.stock.toFixed(2)}`} sub="now" />
        <Stat th={th} label="ENTRY CREDIT" tone="good" value={`$${credit.toFixed(2)}`} sub={c.midCredit != null && c.naturalCredit != null ? `mid $${c.midCredit.toFixed(2)} · natural $${c.naturalCredit.toFixed(2)}` : undefined} />
        <Stat th={th} label="BREAKEVEN" value={`$${breakeven.toFixed(2)}`} sub={fromStock == null ? undefined : `${fromStock >= 0 ? '+' : '-'}${Math.abs(fromStock).toFixed(1)}% from stock`} />
        <Stat th={th} label="MAX PROFIT" value={`$${Math.round(credit * 100).toLocaleString('en-US')}`} sub={`${isPut ? 'at or above' : 'at or below'} ${c.shortStrike}`} />
        <Stat th={th} label="MAX LOSS" value={`$${Math.round(maxLoss).toLocaleString('en-US')}`} sub={`${isPut ? 'at or below' : 'at or above'} ${c.longStrike}`} />
        <Stat th={th} label="CREDIT RATIO" value={c.creditRatio.toFixed(2)} sub="of width" />
        <Stat th={th} label="PROFIT TARGET" value={usd0(credit * 50)} sub="50% of credit" />
        <Stat th={th} label="STOP" value={usd0(-credit * 100)} sub="2x credit" />
        <Stat th={th} label="SHORT DELTA" value={c.shortDelta.toFixed(2)} sub={`OI ${c.shortOI.toLocaleString('en-US')} / ${c.longOI.toLocaleString('en-US')}`} />
        <Stat th={th} label="POP" value={c.pop == null ? '—' : `${Math.round(c.pop)}%`} sub="screener model" />
        <Stat th={th} label="ROC" value={`${Math.round(c.roc)}%`} sub="on max loss" />
        <Stat th={th} label="IV RANK" value={p.ivRankPct == null ? '—' : String(Math.round(p.ivRankPct))} />
      </div>
      {p.popMin != null && c.pop != null && c.pop < p.popMin && (
        <div className={`text-xs ${th.textFaint}`}>POP {Math.round(c.pop)}% is below your saved minimum of {Math.round(p.popMin)}%. The screener&apos;s finder does not filter on POP; the rule check shows it before Send.</div>
      )}
      {p.greeks && (
        <>
          <div className={`text-[10px] tracking-wider ${th.textFaint}`}>POSITION GREEKS TODAY</div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <Stat th={th} label="DELTA" value={sgn(p.greeks.delta, 1)} sub="shares equivalent" />
            <Stat th={th} label="GAMMA" value={p.greeks.gamma.toFixed(2)} sub="delta change per $1" />
            <Stat th={th} label="THETA" value={`${p.greeks.theta < 0 ? '-' : '+'}$${Math.abs(p.greeks.theta).toFixed(2)}`} sub="per day" />
            <Stat th={th} label="VEGA" value={`${p.greeks.vega < 0 ? '-' : '+'}$${Math.abs(p.greeks.vega).toFixed(2)}`} sub="per IV point" />
          </div>
        </>
      )}
    </div>
  );
}

export default function OptimizePanel(p: OptimizePanelProps) {
  const { th } = p;
  const head = p.noQuotes
    ? 'No usable quotes for these strikes yet'
    : p.pick
      ? "Screener's best opportunity"
      : "Nothing qualifies in the screener's ranked scan";
  return (
    <div data-testid="optimize-panel" className={`${th.card} ${th.border} border rounded-lg p-3 flex flex-col gap-2`}>
      <div className="flex flex-wrap items-center gap-3">
        <span className={`text-sm font-bold ${th.text}`}>{head}</span>
        <span className="ml-auto flex gap-3 text-xs">
          {p.canUndo && <button type="button" onClick={p.onUndo} className="text-[var(--accent,#3b82f6)] underline decoration-dotted">Undo</button>}
          <button type="button" onClick={p.onClose} className={`${th.textFaint} underline decoration-dotted`}>Close</button>
        </span>
      </div>
      {p.noQuotes && <div className={`text-xs ${th.textFaint}`}>The broker returned no complete two-sided quotes for this expiration. Try again when the market is open.</div>}
      {!p.noQuotes && !p.pick && (
        <div className={`text-xs ${th.textFaint}`}>No short strike meets your saved delta, market, credit ratio, return on risk and POP rules at this width. Your strikes were not changed. {p.atEachWidth.length > 0 ? 'The screener does find these at other widths:' : 'Try another width or expiration.'}</div>
      )}
      {p.pick && <div className={`text-xs ${th.textFaint}`}>Loaded onto the map. Chosen with your saved scan criteria, using the same logic as the screener.</div>}
      {(() => {
        const same = (c: SpreadCandidate) => c.shortStrike === p.loadedShort && c.longStrike === p.loadedLong && c.expiration === p.loadedExp;
        const sel = p.atEachWidth.find(same) ?? (p.pick && same(p.pick) ? p.pick : null);
        return sel ? <SelectedDetail p={p} c={sel} /> : null;
      })()}
      {p.atEachWidth.length > 0 && (
        <>
          <div className={`text-[11px] tracking-wider ${th.textFaint}`}>THE SCREENER&apos;S TOP RESULTS, BEST FIRST (click one to load it)</div>
          <div className="overflow-x-auto">
            <div className="min-w-[600px] flex flex-col gap-0.5 tabular-nums">
              <div className={`grid grid-cols-[84px_64px_96px_76px_64px_64px_64px_1fr] gap-2 px-2 text-[10px] tracking-wider ${th.textFaint}`}>
                <span>EXPIRES</span><span>WIDTH</span><span>STRIKES</span><span className="text-right">CREDIT</span><span className="text-right">DELTA</span><span className="text-right">POP</span><span className="text-right">ROC</span><span />
              </div>
              {p.atEachWidth.map((c, i) => {
                const loaded = c.shortStrike === p.loadedShort && c.longStrike === p.loadedLong && c.expiration === p.loadedExp;
                return (
                  <button
                    key={`${c.expiration}-${c.shortStrike}-${c.longStrike}`}
                    type="button"
                    onClick={() => p.onLoad(c)}
                    className={`grid grid-cols-[84px_64px_96px_76px_64px_64px_64px_1fr] gap-2 items-center text-left text-sm rounded px-2 py-1.5 ${loaded ? 'bg-[#16233a] ring-1 ring-[#2f4a78]' : 'hover:bg-white/5'} ${th.text}`}
                  >
                    <span className={th.textFaint}>{c.expiration.slice(5)} · {c.dte}d</span>
                    <span className={th.textFaint}>{widthText(c.spreadWidth)}</span>
                    <span className="font-semibold">{c.shortStrike} / {c.longStrike}</span>
                    <span className="text-right font-semibold text-emerald-400">${c.credit.toFixed(2)}</span>
                    <span className="text-right">{c.shortDelta.toFixed(2)}</span>
                    <span className="text-right">{Math.round(c.pop ?? 0)}%</span>
                    <span className="text-right">{Math.round(c.roc)}%</span>
                    <span>{i === 0 && <span className="whitespace-nowrap px-2 py-0.5 rounded-full border border-emerald-700 bg-emerald-500/10 text-emerald-400 text-[10px] font-semibold">Best opportunity</span>}</span>
                  </button>
                );
              })}
            </div>
          </div>
        </>
      )}
      <div className={`text-[11px] ${th.textFaint}`}>Same ranked scan and saved criteria as the screener; Trade Map adds no scoring. Bull put and bear call spreads for now.</div>
    </div>
  );
}
