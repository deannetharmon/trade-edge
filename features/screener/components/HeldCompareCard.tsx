// features/screener/components/HeldCompareCard.tsx
'use client';

// PMCC-COMPARE-0001 S1 -- for a LEAP you hold: sell a short call, or sell nothing? One card per held LEAP, above its
// short-call candidates. Profit and loss are measured against what you paid; the odds are model odds, not a forecast.
// Display only: nothing here gates, ranks or places an order. It sits OUTSIDE the candidate cards (they are buttons).

import { useState } from 'react';
import { buildHeldCompare, type CompareOption, type CompareStance, type PmccCompare } from '@/lib/scans/pmccCompare';
import type { ScanModalTheme } from './ScanModalShell';

const usd0 = (n: number) => `${n < 0 ? '−' : n > 0 ? '+' : ''}$${Math.abs(Math.round(n)).toLocaleString('en-US')}`;
const plain0 = (n: number) => `$${Math.round(n).toLocaleString('en-US')}`;
const pct0 = (p: number) => `${Math.round(p * 100)}%`;
const money = (n: number) => `$${n.toFixed(2)}`;

const STANCE_LABEL: Record<CompareStance, string> = { none: 'VERY BULLISH', bullish: 'BULLISH', neutral: 'NEUTRAL', cautious: 'CAUTIOUS' };
const STANCE_NOTE: Record<CompareStance, string> = {
  none: 'Full upside. Best if you expect a strong rally.',
  bullish: 'Farthest strike. Light income, most upside kept.',
  neutral: 'Balanced income and upside.',
  cautious: 'Most income. Rally capped soonest.',
};

function optionTitle(o: CompareOption, quantity: number): string {
  return o.candidate ? `Sell ${quantity} × $${o.candidate.strike}` : 'No call';
}

function PayoffChart({ option, current, symbol }: { option: CompareOption; current: number; symbol: string }) {
  const curve = option.curve;
  const call = option.candidate;
  if (!curve || curve.length < 2 || !call) return null;
  const W = 840; const H = 300; const L = 60; const R = 20; const T = 20; const B = 36;
  const xs = curve.map(c => c.spot);
  const ys = curve.flatMap(c => [c.noCall, c.withCall, 0]);
  const x0 = Math.min(...xs); const x1 = Math.max(...xs);
  const y0 = Math.min(...ys); const y1 = Math.max(...ys);
  const X = (v: number) => L + ((v - x0) / (x1 - x0)) * (W - L - R);
  const Y = (v: number) => T + ((y1 - v) / Math.max(1, y1 - y0)) * (H - T - B);
  const line = (k: 'noCall' | 'withCall') => curve.map(c => `${X(c.spot).toFixed(1)},${Y(c[k]).toFixed(1)}`).join(' ');
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" data-testid="held-compare-chart"
      aria-label={`Profit or loss vs what you paid by ${symbol} price at expiration. With no call the line keeps rising; with the $${call.strike} call it flattens above $${call.strike}.`}>
      <line x1={L} y1={Y(0)} x2={W - R} y2={Y(0)} stroke="#5a626d" strokeDasharray="4 4" />
      <text x={L + 4} y={Y(0) - 4} fill="#a3a9b3" fontSize="11">even with what you paid</text>
      {current >= x0 && current <= x1 && <><line x1={X(current)} y1={T} x2={X(current)} y2={H - B} stroke="#8ab4f8" /><text x={X(current) + 4} y={T + 12} fill="#8ab4f8" fontSize="11">today ${current.toFixed(2)}</text></>}
      <line x1={X(call.strike)} y1={T} x2={X(call.strike)} y2={H - B} stroke="#f3d98a" strokeDasharray="4 4" />
      <text x={X(call.strike) + 4} y={T + 26} fill="#f3d98a" fontSize="11">${call.strike} strike</text>
      <polyline points={line('noCall')} fill="none" stroke="#9aa3ad" strokeWidth="3" />
      <polyline points={line('withCall')} fill="none" stroke="#5fd08a" strokeWidth="3" />
      <text x={W - R - 70} y={Y(curve[curve.length - 1].noCall) - 6} fill="#9aa3ad" fontSize="12">no call</text>
      <text x={W - R - 120} y={Y(curve[curve.length - 1].withCall) + 16} fill="#5fd08a" fontSize="12">with the call</text>
      <text x={L} y={H - 12} fill="#a3a9b3" fontSize="11">${x0.toFixed(0)}</text>
      <text x={W - R - 30} y={H - 12} fill="#a3a9b3" fontSize="11">${x1.toFixed(0)}</text>
    </svg>
  );
}

export function HeldCompareCard({ compare, symbol, spot, th }: { compare: PmccCompare; symbol: string; spot?: number | null; th: ScanModalTheme }) {
  const [picked, setPicked] = useState<CompareStance | null>(null);
  const [open, setOpen] = useState(false);
  const stance = picked ?? compare.defaultStance;
  const selected = compare.options.find(o => o.stance === stance) ?? compare.options[0];
  const q = compare.quantity;
  const call = selected.candidate;
  const v = compare.verdict;

  return (
    <section className={`mb-2 rounded-lg border ${th.border} p-3 text-xs`} data-testid="held-compare" aria-label={`Compare selling a call against your ${symbol} LEAP`}>
      <div className={`rounded-lg border px-3 py-2 ${v.kind === 'sell' ? 'border-emerald-700 bg-emerald-500/10' : 'border-amber-700 bg-amber-500/10'}`} data-testid="held-compare-verdict">
        <p className={`text-sm font-bold ${v.kind === 'sell' ? 'text-emerald-300' : 'text-amber-300'}`}>{v.headline}</p>
        <p className="mt-0.5">{v.reason}</p>
      </div>
      <button type="button" aria-expanded={open} data-testid="held-compare-toggle" onClick={() => setOpen(o => !o)}
        className={`mt-2 rounded border ${th.border} px-2 py-1 text-[11px] focus:ring-2 focus:ring-cyan-400`}>{open ? 'Hide details' : 'Show details'}</button>

      {open && (
        <div data-testid="held-compare-details">
          <div className="mt-3 grid grid-cols-3 gap-2">
            <div><span className={th.textFaint}>Paid</span><br /><b className="tabular-nums">{plain0(compare.paidTotal)}</b></div>
            <div><span className={th.textFaint}>Worth now (est.)</span><br /><b className="tabular-nums">{plain0(compare.worthTotal)}</b></div>
            <div className={compare.downVsPaid < 0 ? 'text-red-300' : 'text-emerald-300'} data-testid="held-compare-down">
              <span className={th.textFaint}>{compare.downVsPaid < 0 ? 'Down vs what you paid' : 'Up vs what you paid'}</span><br /><b className="tabular-nums">{usd0(compare.downVsPaid)}</b>
            </div>
          </div>

          <p className="mt-3 font-semibold">Your choices{compare.shortDte > 0 ? ` for the next ${compare.shortDte} days` : ''}</p>
          <div className="mt-2 grid gap-2 sm:grid-cols-2 lg:grid-cols-4" role="radiogroup" aria-label="Call choice">
            {compare.options.map(o => {
              const on = o.stance === selected.stance;
              return (
                <button key={o.stance} type="button" role="radio" aria-checked={on} data-testid={`held-compare-option-${o.stance}`} onClick={() => setPicked(o.stance)}
                  className={`rounded-lg border p-2 text-left focus:ring-2 focus:ring-cyan-400 ${on ? 'border-emerald-600 bg-emerald-500/10' : th.border}`}>
                  <span className={`block text-[10px] font-bold ${on ? 'text-emerald-300' : th.textMuted}`}>{STANCE_LABEL[o.stance]}{on ? ' · SELECTED' : ''}</span>
                  <span className="block text-sm font-semibold">{optionTitle(o, q)}</span>
                  <span className="block tabular-nums">Collect <b>{plain0(o.collect)}</b></span>
                  <span className={`block text-[10px] ${th.textMuted}`}>{STANCE_NOTE[o.stance]}</span>
                  {o.candidate && o.clearsMinimumCredit === false && <span className="block text-[10px] text-amber-300" data-testid="held-compare-below-min">Below the {plain0(compare.minCreditPerShare * 100 * q)} minimum credit</span>}
                </button>
              );
            })}
          </div>

          {call && selected.oddsWorthless != null && selected.oddsAbove != null && (
            <div className="mt-3 grid gap-2 sm:grid-cols-2" data-testid="held-compare-odds">
              <div className="rounded-lg bg-emerald-500/10 p-2"><b className="text-lg text-emerald-300">About {pct0(selected.oddsWorthless)}</b><br />model odds that the call expires worthless. You keep the <b className="tabular-nums">{plain0(selected.collect)}</b> and sell again next cycle.</div>
              <div className="rounded-lg bg-amber-500/10 p-2"><b className="text-lg text-amber-300">About {pct0(selected.oddsAbove)}</b><br />model odds that {symbol} finishes above ${call.strike}. Then your gain is capped until you close or roll the call.</div>
            </div>
          )}

          {call && spot != null && (
            <div className="mt-3">
              <p className={`mb-1 text-[10px] ${th.textMuted}`}>Profit or loss vs what you paid, by {symbol}&apos;s price when the call expires (model estimate{compare.ivPct != null ? `, IV ${compare.ivPct.toFixed(0)}%` : ''})</p>
              <PayoffChart option={selected} current={spot} symbol={symbol} />
            </div>
          )}
          {call && <p className="mt-2" data-testid="held-compare-cap">Above ${call.strike}, additional stock gains are substantially offset until you close or roll the short call. The two lines are the same below ${call.strike}.</p>}
          <p className={`mt-2 text-[10px] ${th.textFaint}`}>
            Model estimates, not forecasts or quotes: odds are 1 − the short call&apos;s delta; values use the LEAP&apos;s own implied volatility at a 4% rate.
            Minimum credit {money(compare.minCreditPerShare)}/sh. Adjusted basis stays at what you paid until credits are tracked. Every call trades upside for income; it is not free money.
          </p>
        </div>
      )}
    </section>
  );
}

export function HeldCompareForPairs({ pairs, spot, symbol, th }: { pairs: ReadonlyArray<Parameters<typeof buildHeldCompare>[0][number]>; spot: number | null | undefined; symbol: string; th: ScanModalTheme }) {
  const compare = buildHeldCompare(pairs, spot);
  return compare ? <HeldCompareCard compare={compare} symbol={symbol} spot={spot} th={th} /> : null;
}
