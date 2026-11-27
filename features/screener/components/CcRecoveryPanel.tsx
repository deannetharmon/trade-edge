'use client';

// features/screener/components/CcRecoveryPanel.tsx
//
// CHAIN-ALL-0002 (Recovery mode, step 1): for shares priced under their cost. A question ("Would you sell your oldest
// shares at about $N?"), a one-week payoff chart (hold / weekly call / exit now on the oldest 100 shares), and the top 3
// weekly calls by pay per day. Opt-in, this ticker only, nothing saved. The order button is off during the RSI wait and
// opens the normal order screen, which confirms the lot loss. The "chance of getting back to the cost" is NOT shown yet.

import { useEffect, useMemo, useState } from 'react';
import type { ChainRow } from '@/lib/tradeLookup/lookupTypes';
import { normalizeChainRows } from '@/lib/tradeLookup/chainRows';
import type { CcAllCallsDeps } from './CcAllCallsModal';
import { buildCcAllRows } from '@/lib/scans/ccAllCalls';
import type { CcLot } from '@/lib/scans/ccLotLoss';
import { computeCcLotLoss } from '@/lib/scans/ccLotLoss';
import { calledOneIn, CC_RECOVERY, oldestLot, recoveryCandidates, recoveryChart, recoveryGap, weeksToCover, type RecoveryCandidate } from '@/lib/scans/ccRecovery';
import { ccExpirationLabel, ccStrikeLabel } from '@/lib/scans/ccGuidance';
import { daysUntil } from '@/lib/scans/scan-utils';

const usd0 = (n: number) => `${n < 0 ? '-' : ''}$${Math.abs(Math.round(n)).toLocaleString('en-US')}`;

export function CcRecoveryPanel(props: {
  symbol: string; token: string | null; listed: string[]; price: number; floorBasis: number; lots: CcLot[]; contracts: number | null;
  minPay: number; waiting: boolean; waitLine: string; deps: CcAllCallsDeps; onOrder: (row: RecoveryCandidate) => void;
}) {
  const { symbol, token, listed, price, floorBasis, lots, contracts, minPay, waiting, waitLine, deps, onOrder } = props;
  const weekly = useMemo(() => listed.filter(e => { const d = daysUntil(e); return d >= CC_RECOVERY.dteLo && d <= CC_RECOVERY.dteHi; }).slice(0, 4), [listed]);
  const [rows, setRows] = useState<ChainRow[][] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [picked, setPicked] = useState<string | null>(null);

  useEffect(() => {
    if (!token) return;
    let alive = true;
    setRows(null);
    Promise.all(weekly.map(e => deps.lookup.fetchChain(symbol, token, e).then(c => normalizeChainRows(c.chains))))
      .then(r => { if (alive) setRows(r); }, e => { if (alive) setError(e instanceof Error ? e.message : 'Could not load the weekly calls.'); });
    return () => { alive = false; };
  }, [token, symbol, weekly]);

  const candidates = useMemo(() => {
    if (!rows) return [];
    const all = rows.flatMap((r, i) => buildCcAllRows({ rows: r, dte: daysUntil(weekly[i]), stockPrice: price, floorBasis, lots, minPayChip: minPay }));
    return recoveryCandidates(all);
  }, [rows, weekly, price, floorBasis, lots, minPay]);

  const sel = candidates.find(c => c.occSymbol === picked) ?? candidates[0] ?? null;
  const gap = recoveryGap(lots, price);
  const oldest = oldestLot(lots);
  const weeklyPremium = sel ? sel.collect! * (contracts ?? 1) : 0;
  const weeks = weeksToCover(gap, weeklyPremium);

  return (
    <div className="space-y-3" data-testid="cc-recovery">
      <p className="text-lg font-bold" data-testid="cc-recovery-meter">
        {usd0(gap)} under water
        {sel && <span className="font-normal text-neutral-400"> · premium about {usd0(weeklyPremium)} a week{weeks !== null ? ` · about ${weeks} weeks if nothing is called` : ''}</span>}
      </p>
      {waiting && <p data-testid="cc-recovery-wait" className="rounded-lg border border-amber-400 px-3 py-2 text-sm text-amber-200">{waitLine} You can still look.</p>}
      {error && <p role="alert" className="text-sm text-red-300">{error}</p>}
      {!error && rows === null && <p data-testid="cc-recovery-loading" className="text-sm text-neutral-400">Loading the weekly calls…</p>}
      {rows !== null && !sel && <p data-testid="cc-recovery-none" className="rounded-lg border border-neutral-700 px-3 py-2 text-sm text-neutral-300">No weekly call passes your rules today.</p>}
      {rows !== null && sel && oldest && (
        <>
          <h3 className="text-xl font-bold" data-testid="cc-recovery-question">Would you sell your oldest shares at about ${Math.round(sel.salePrice)}?</h3>
          <div className="flex gap-3 text-sm">
            <p className="flex-1 rounded-lg border border-cyan-400 bg-cyan-950/40 px-3 py-2"><b className="text-cyan-300">Yes:</b> the weekly call is a better exit than today, and pays you ${Math.round(sel.collect!)} to wait.</p>
            <p className="flex-1 rounded-lg border border-emerald-400 bg-emerald-950/30 px-3 py-2"><b className="text-emerald-300">No:</b> hold. A call only caps the rebound you are waiting for.</p>
          </div>
          <RecoveryChartSvg cost={oldest.price} price={price} strike={sel.strike} premium={sel.mid!} />
          {calledOneIn(sel.delta) !== null && <p className="text-sm" data-testid="cc-recovery-called">About <b>1 in {calledOneIn(sel.delta)}</b> weeks this call is taken.</p>}
          <div className="space-y-1.5" data-testid="cc-recovery-rows">
            <div className="flex px-3 text-xs font-bold tracking-wider text-neutral-400"><div className="w-14">RANK</div><div className="w-24">STRIKE</div><div className="w-28">DATE</div><div className="w-28">YOU COLLECT</div><div className="w-32">CALLED</div><div className="flex-1">IF CALLED</div></div>
            {candidates.map((c, i) => {
              const l = computeCcLotLoss({ lots, strike: c.strike, premiumPerShare: c.mid!, contracts: 1 });
              const on = c.occSymbol === sel.occSymbol;
              return (
                <button key={c.occSymbol} type="button" onClick={() => setPicked(c.occSymbol)} aria-pressed={on} data-testid={`cc-recovery-row-${i + 1}`}
                  className={`flex w-full items-center rounded-lg border px-3 py-2 text-left text-sm ${on ? 'border-cyan-400 bg-cyan-950/40' : 'border-neutral-800 bg-neutral-900'}`}>
                  <div className="w-14"><span className="rounded-full border border-emerald-400 px-2 text-xs font-bold text-emerald-300">#{i + 1}</span></div>
                  <div className="w-24 font-bold">{ccStrikeLabel(c.strike)}</div>
                  <div className="w-28">{ccExpirationLabel(c.expiration)} · {c.dte}d</div>
                  <div className="w-28 font-bold">${Math.round(c.collect!)}</div>
                  <div className="w-32">{calledOneIn(c.delta) !== null ? `about 1 in ${calledOneIn(c.delta)}` : '—'}</div>
                  <div className="flex-1 text-red-300">{l ? usd0(l.gainWithPremium) : '—'}</div>
                </button>
              );
            })}
          </div>
          <div className="flex items-center gap-3">
            {!waiting && <button type="button" data-testid="cc-recovery-order" onClick={() => onOrder(sel)} className="rounded-lg border border-cyan-400 px-4 py-2 text-sm font-bold text-cyan-300">Review order</button>}
            <span className="text-xs text-neutral-400">{waiting ? 'Order is off until the RSI wait is over.' : 'You confirm the loss on the next screen.'}</span>
          </div>
        </>
      )}
      <p className="text-xs text-neutral-400">Opt-in, this stock only, forgets when closed. Weekly calls only: 0.15 to 0.25 delta, 5 to 21 days. The oldest shares are delivered first. Tax: ask a pro about buying back within 30 days.</p>
    </div>
  );
}

function RecoveryChartSvg({ cost, price, strike, premium }: { cost: number; price: number; strike: number; premium: number }) {
  const c = recoveryChart({ cost, price, strike, premiumPerShare: premium });
  const lo = Math.floor(price * 0.72), hi = Math.ceil(cost * 1.04);
  const ys = [c.hold(lo), c.hold(hi), c.call(lo), c.call(hi), c.exitNow];
  const yMin = Math.min(...ys), yMax = Math.max(...ys, 0);
  const W = 1000, H = 300, L = 60, R = 60, T = 35, B = 30;
  const x = (s: number) => L + ((s - lo) / (hi - lo)) * (W - L - R);
  const y = (p: number) => T + ((yMax - p) / (yMax - yMin || 1)) * (H - T - B);
  const pts = (f: (s: number) => number, xs: number[]) => xs.map(s => `${x(s).toFixed(1)},${y(f(s)).toFixed(1)}`).join(' ');
  return (
    <div>
      <p className="text-xs font-bold tracking-wider text-neutral-400">YOUR OLDEST 100 SHARES, ONE WEEK FROM NOW</p>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Profit or loss on your oldest 100 shares one week from now: hold, weekly call, or exit now" data-testid="cc-recovery-chart" className="w-full rounded-lg border border-neutral-800 bg-neutral-900">
        <line x1={L} x2={W - R} y1={y(0)} y2={y(0)} stroke="#404040" />
        <text x={L - 6} y={y(0) + 4} textAnchor="end" fontSize="12" fill="#a3a3a3">$0</text>
        <line x1={x(price)} x2={x(price)} y1={T - 5} y2={H - B} stroke="#e5e5e5" strokeDasharray="4 4" />
        <text x={x(price)} y={T - 11} textAnchor="middle" fontSize="12" fill="#e5e5e5">now ${price.toFixed(2)}</text>
        <line x1={x(strike)} x2={x(strike)} y1={T - 5} y2={H - B} stroke="#22d3ee" strokeDasharray="2 4" />
        <text x={x(strike) + 6} y={T - 11} fontSize="12" fill="#67e8f9">call strike ${strike}</text>
        <polyline points={pts(c.hold, [lo, hi])} fill="none" stroke="#34d399" strokeWidth="3" />
        <polyline points={pts(c.call, [lo, strike, hi])} fill="none" stroke="#22d3ee" strokeWidth="3" />
        <polyline points={`${x(lo)},${y(c.exitNow)} ${x(hi)},${y(c.exitNow)}`} fill="none" stroke="#fbbf24" strokeWidth="3" strokeDasharray="8 5" />
        {[40, 50, 60, 70, 80].filter(s => s > lo && s < hi).map(s => <text key={s} x={x(s)} y={H - 8} textAnchor="middle" fontSize="12" fill="#a3a3a3">${s}</text>)}
        <text x={W - R + 6} y={y(c.hold(hi)) + 4} fontSize="13" fontWeight="700" fill="#34d399">Hold</text>
        <text x={W - R + 6} y={y(c.call(hi)) + 4} fontSize="13" fontWeight="700" fill="#22d3ee">Weekly call</text>
        <text x={W - R + 6} y={y(c.exitNow) + 18} fontSize="13" fontWeight="700" fill="#fbbf24">Exit now</text>
      </svg>
      <p className="text-xs text-neutral-400" data-testid="cc-recovery-crossovers">The call beats holding unless the stock ends above ${c.holdBeatsCallAbove.toFixed(2)}. Exiting now beats the call below ${c.exitBeatsCallBelow.toFixed(2)}.</p>
    </div>
  );
}
