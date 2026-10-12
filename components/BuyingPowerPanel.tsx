// components/BuyingPowerPanel.tsx
//
// BAL-0001/0002: option buying power left and used, and where it is tied up by ticker. Reg T has one option buying power
// figure, so there is no cash/margin split. Figures come straight from the broker's balances and margin requirements.

import { RED_PCT, type BpModel, type Leg, type TickerRow } from '@/lib/portfolio-data/buyingPower';

const money = (v: number): string => `${v < 0 ? '-' : ''}$${Math.abs(v).toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
const signed = (v: number): string => `${v >= 0 ? '+' : '-'}$${Math.abs(v).toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
const pct = (v: number): string => `${v.toFixed(1)}%`;

const TIER_BAR: Record<TickerRow['tier'], string> = { normal: 'bg-sky-400', amber: 'bg-amber-500', red: 'bg-red-400' };
const TIER_TEXT: Record<TickerRow['tier'], string> = { normal: 'text-white/70', amber: 'text-amber-300', red: 'text-red-400' };

function legChip(l: Leg): string {
  if (l.kind === 'shares') return 'SHARES';
  if (l.kind === 'short-option') return l.optionType === 'C' ? 'CC' : 'CSP';
  return l.optionType === 'C' ? 'LONG CALL' : 'LONG PUT';
}

function chipsFor(t: TickerRow): string[] {
  return Array.from(new Set(t.holdings.flatMap(h => h.legs.map(legChip))));
}

function Tile({ label, value, sub, valueClass = '' }: { label: string; value: string; sub: string; valueClass?: string }) {
  return (
    <div className="border border-white/10 rounded-xl p-5">
      <p className="text-[10px] text-white/40 uppercase tracking-widest mb-1">{label}</p>
      <p className={`text-2xl font-bold ${valueClass}`} style={{ fontFamily: 'var(--font-inter), system-ui, sans-serif' }}>{value}</p>
      <p className="text-[11px] text-white/40 mt-1">{sub}</p>
    </div>
  );
}

function Chip({ children, amber = false }: { children: string; amber?: boolean }) {
  return (
    <span className={`text-[9px] px-1.5 py-0.5 rounded border ${amber ? 'border-amber-700 text-amber-300' : 'border-white/20 text-white/60'}`}>{children}</span>
  );
}

function ShareBar({ pctValue, tier }: { pctValue: number; tier: TickerRow['tier'] }) {
  return (
    <div className="flex items-center gap-2">
      <div className="relative h-2 w-40 rounded bg-black/60 border border-white/10" aria-hidden="true">
        <div className={`absolute left-0 top-0 bottom-0 rounded ${TIER_BAR[tier]}`} style={{ width: `${Math.min(pctValue * 3, 100)}%` }} />
      </div>
      <span className={`text-xs tabular-nums ${TIER_TEXT[tier]} ${tier === 'normal' ? '' : 'font-semibold'}`}>{pct(pctValue)}</span>
    </div>
  );
}

export default function BuyingPowerPanel({ model }: { model: BpModel }) {
  const m = model;
  const clusterW = m.capacity ? (m.clusterRequirement / m.capacity) * 100 : 0;
  const otherUsed = Math.max(m.bpUsed - m.clusterRequirement, 0);
  const otherW = m.capacity ? (otherUsed / m.capacity) * 100 : 0;
  const leftW = m.capacity ? (m.optionBpLeft / m.capacity) * 100 : 0;
  const withReq = m.tickers.filter(t => t.requirement > 0);
  const noReq = m.tickers.filter(t => t.requirement <= 0);

  return (
    <section className="space-y-4" aria-label="Buying power">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <Tile label="Net Liquidating Value" value={money(m.netLiq)} sub={`Margin equity ${money(m.marginEquity)}`} />
        <Tile label="Option Buying Power Left" value={money(m.optionBpLeft)} sub={`${pct(100 - m.usedPct)} of capacity`} valueClass="text-sky-400" />
        <Tile label="Buying Power Used" value={money(m.bpUsed)} sub={`${pct(m.usedPct)} of capacity`} />
        <Tile label="Cash Balance" value={money(m.cashBalance)} sub={`Withdrawable ${money(m.withdrawable)}`} />
      </div>

      <div className="border border-white/10 rounded-xl p-5">
        <div className="flex items-baseline justify-between">
          <p className="text-[10px] text-white/40 uppercase tracking-widest">Buying power</p>
          <p className="text-xs text-white/70 tabular-nums">Capacity {money(m.capacity)} · used {pct(m.usedPct)}</p>
        </div>
        <div className="mt-3 flex h-5 overflow-hidden rounded bg-black/60 border border-white/10" role="img" aria-label={`Buying power: ${money(m.clusterRequirement)} leveraged ETFs, ${money(otherUsed)} other used, ${money(m.optionBpLeft)} left`}>
          <div className="bg-amber-500" style={{ width: `${clusterW}%` }} />
          <div className="bg-gray-600" style={{ width: `${otherW}%` }} />
          <div className="bg-sky-400" style={{ width: `${leftW}%` }} />
        </div>
        <div className="mt-3 flex flex-wrap gap-6 text-xs text-white/70">
          <span className="flex items-center gap-2"><span className="h-2.5 w-2.5 rounded-sm bg-amber-500" />Leveraged-ETF cluster <b className="text-white tabular-nums">{money(m.clusterRequirement)}</b></span>
          <span className="flex items-center gap-2"><span className="h-2.5 w-2.5 rounded-sm bg-gray-600" />All other used <b className="text-white tabular-nums">{money(otherUsed)}</b></span>
          <span className="flex items-center gap-2"><span className="h-2.5 w-2.5 rounded-sm bg-sky-400" />Left <b className="text-white tabular-nums">{money(m.optionBpLeft)}</b></span>
        </div>
      </div>

      <div className="border border-white/10 rounded-xl overflow-hidden">
        <div className="flex items-baseline justify-between px-5 py-3 border-b border-white/10">
          <p className="text-[10px] text-white/40 uppercase tracking-widest">By ticker</p>
          <p className="text-[11px] text-white/40">Amber at 15% of buying power used, red at {RED_PCT}%</p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-[10px] uppercase tracking-widest text-white/40 text-left">
                <th className="px-5 py-2 font-semibold">Ticker</th>
                <th className="px-2 py-2 font-semibold">Positions</th>
                <th className="px-2 py-2 font-semibold text-right">Open P/L</th>
                <th className="px-2 py-2 font-semibold text-right">BP tied up</th>
                <th className="px-5 py-2 font-semibold">Share of BP used</th>
              </tr>
            </thead>
            <tbody>
              {withReq.map(t => (
                <tr key={t.symbol} className="border-t border-white/5">
                  <td className="px-5 py-3 font-bold">{t.symbol}</td>
                  <td className="px-2 py-3"><div className="flex gap-1.5 flex-wrap">{chipsFor(t).map(c => <Chip key={c}>{c}</Chip>)}{t.inCluster && <Chip amber>ETF</Chip>}</div></td>
                  <td className={`px-2 py-3 text-right tabular-nums font-semibold ${t.openPL >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>{signed(t.openPL)}</td>
                  <td className="px-2 py-3 text-right tabular-nums">{money(t.requirement)}</td>
                  <td className="px-5 py-3"><ShareBar pctValue={t.sharePct} tier={t.tier} /></td>
                </tr>
              ))}
              {m.otherRequirement > 0.5 && (
                <tr className="border-t border-white/5 text-white/60">
                  <td className="px-5 py-3 text-[11px] uppercase tracking-widest">Other</td>
                  <td className="px-2 py-3 text-[11px] text-white/40">Balance total minus per-ticker requirements</td>
                  <td className="px-2 py-3" />
                  <td className="px-2 py-3 text-right tabular-nums">{money(m.otherRequirement)}</td>
                  <td className="px-5 py-3"><ShareBar pctValue={m.bpUsed ? (m.otherRequirement / m.bpUsed) * 100 : 0} tier="normal" /></td>
                </tr>
              )}
              {noReq.map(t => (
                <tr key={t.symbol} className="border-t border-white/5">
                  <td className="px-5 py-3 font-bold">{t.symbol}</td>
                  <td className="px-2 py-3"><div className="flex gap-1.5 flex-wrap items-center">{chipsFor(t).map(c => <Chip key={c}>{c}</Chip>)}<span className="text-[11px] text-white/40">no requirement</span></div></td>
                  <td className={`px-2 py-3 text-right tabular-nums font-semibold ${t.openPL >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>{signed(t.openPL)}</td>
                  <td className="px-2 py-3 text-right tabular-nums text-white/40">$0</td>
                  <td className="px-5 py-3" />
                </tr>
              ))}
              <tr className="border-t border-white/10 bg-white/[0.03] font-semibold">
                <td className="px-5 py-3 text-[11px] uppercase tracking-widest text-white/60">Total</td>
                <td className="px-2 py-3 text-[11px] font-normal text-white/40">{m.tickers.length} tickers · P/L from last close</td>
                <td className={`px-2 py-3 text-right tabular-nums ${m.totalOpenPL >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>{signed(m.totalOpenPL)}</td>
                <td className="px-2 py-3 text-right tabular-nums">{money(m.bpUsed)}</td>
                <td className="px-5 py-3 text-xs text-white/70">100%</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      {m.clusterSharePct >= RED_PCT && (
        <div className="rounded-lg border border-red-400/50 bg-red-400/10 px-4 py-3 text-xs text-red-200" role="status">
          <b>Leveraged ETFs hold {Math.round(m.clusterSharePct)}% of buying power used.</b>
        </div>
      )}
    </section>
  );
}
