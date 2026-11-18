// features/trade-map/CellDetailPanel.tsx
//
// OPTMAP-0001 S4a: the panel under the P/L grid. Click a grid cell to see that scenario's P/L, chance of profit,
// net Greeks and each leg's delta; with nothing selected it shows today at the current price. Display only: it never
// recommends, ranks or badges anything.

'use client';

import type { CellDetail } from '@/lib/trademap/cellDetail';

export interface CellDetailPanelProps {
  th: any;
  detail: CellDetail;
  /** True when the panel shows the user's selected cell; false for today at the current price. */
  selected: boolean;
  /** Percent change of the scenario price from the current price. */
  movePct: number | null;
  onClear: () => void;
}

const money0 = (v: number) => `${v < 0 ? '-' : '+'}$${Math.round(Math.abs(v)).toLocaleString('en-US')}`;
const money2 = (v: number) => `${v < 0 ? '-' : '+'}$${Math.abs(v).toFixed(2)}`;
const signed = (v: number, digits: number) => `${v < 0 ? '-' : '+'}${Math.abs(v).toFixed(digits)}`;
const shortDate = (iso: string) => new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
const priceText = (p: number) => (p % 1 === 0 ? p.toFixed(0) : p.toFixed(2));

function Stat({ th, label, value, sub, tone }: { th: any; label: string; value: string; sub: string; tone?: 'good' | 'bad' }) {
  return (
    <div className="flex flex-col gap-0.5">
      <div className={`text-[10px] tracking-wider ${th.textFaint}`}>{label}</div>
      <div className={`text-sm font-semibold ${tone === 'good' ? 'text-emerald-400' : tone === 'bad' ? 'text-rose-400' : th.text}`}>{value}</div>
      <div className={`text-[10px] ${th.textFaint}`}>{sub}</div>
    </div>
  );
}

export default function CellDetailPanel({ th, detail, selected, movePct, onClear }: CellDetailPanelProps) {
  const { greeks: g } = detail;
  const title = selected
    ? `If the stock is $${priceText(detail.price)} on ${shortDate(detail.date)}`
    : `Today at $${priceText(detail.price)}`;
  const plural = (n: number) => `${n} day${n === 1 ? '' : 's'}`;
  const left = detail.daysToExpiry === 0 ? 'at expiration' : `${plural(detail.daysToExpiry)} left to expiration`;
  const when = selected && detail.daysOut > 0 ? `${plural(detail.daysOut)} from now · ${left}` : left;
  const move = selected && movePct != null ? `${movePct >= 0 ? '+' : '-'}${Math.abs(movePct).toFixed(1)}% from now · ` : '';
  return (
    <div data-testid="cell-detail" className={`border-t ${th.border} p-3 flex flex-col gap-2 text-left`}>
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <span className={`text-sm font-bold ${th.text}`}>{title}</span>
        <span className={`text-xs ${th.textFaint}`}>{move}{when}</span>
        {selected && <button type="button" onClick={onClear} className="ml-auto text-xs text-[var(--accent,#3b82f6)] underline decoration-dotted">Clear (Esc)</button>}
      </div>
      <div className="grid grid-cols-3 sm:grid-cols-6 gap-3">
        <Stat th={th} label="P/L" value={money0(detail.pl)} sub={detail.plPctOfPremium == null ? '' : `${detail.plPctOfPremium >= 0 ? '' : '-'}${Math.abs(detail.plPctOfPremium).toFixed(0)}% of premium`} tone={detail.pl >= 0 ? 'good' : 'bad'} />
        <Stat th={th} label="CHANCE OF PROFIT" value={detail.chanceOfProfit == null ? '—' : `${Math.round(detail.chanceOfProfit * 100)}%`} sub={detail.chanceOfProfit == null ? 'result is final at expiration' : 'from here, at expiration'} />
        <Stat th={th} label="DELTA" value={signed(g.delta, 1)} sub="shares equivalent" />
        <Stat th={th} label="GAMMA" value={g.gamma.toFixed(2)} sub="delta change per $1" />
        <Stat th={th} label="THETA" value={money2(g.theta)} sub="per day" />
        <Stat th={th} label="VEGA" value={money2(g.vega)} sub="per IV point" />
      </div>
      <div className={`text-xs ${th.textFaint}`}>
        <span>{selected ? `Your legs if the stock is $${priceText(detail.price)}: ` : 'Your legs today: '}</span>
        {detail.legs.map((l, i) => (
          <span key={i}>{i > 0 ? ' | ' : ''}{l.side === 'short' ? 'Short' : 'Long'} {l.strike} {l.right === 'P' ? 'put' : 'call'} · delta {signed(l.delta, 2)}</span>
        ))}
      </div>
      <div className={`text-[11px] ${th.textFaint}`}>Model estimates (Black-Scholes, same inputs as the grid; early exercise ignored). Click a grid cell to change the scenario.</div>
    </div>
  );
}
