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

export function HeldCompareCard({ compare, symbol, th }: { compare: PmccCompare; symbol: string; th: ScanModalTheme }) {
  const [picked, setPicked] = useState<CompareStance | null>(null);
  const stance = picked ?? compare.defaultStance;
  const selected = compare.options.find(o => o.stance === stance) ?? compare.options[0];
  const q = compare.quantity;
  const call = selected.candidate;
  const cols = compare.options.filter(o => o.candidate);
  const rows = compare.options[0].scenarios;

  return (
    <section className={`mb-2 rounded-lg border ${th.border} p-3 text-xs`} data-testid="held-compare" aria-label={`Compare selling a call against your ${symbol} LEAP`}>
      <div className="grid grid-cols-3 gap-2">
        <div><span className={th.textFaint}>Paid</span><br /><b className="tabular-nums">{plain0(compare.paidTotal)}</b></div>
        <div><span className={th.textFaint}>Worth now (est.)</span><br /><b className="tabular-nums">{plain0(compare.worthTotal)}</b></div>
        <div className={compare.downVsPaid < 0 ? 'text-red-300' : 'text-emerald-300'} data-testid="held-compare-down">
          <span className={th.textFaint}>{compare.downVsPaid < 0 ? 'Down vs what you paid' : 'Up vs what you paid'}</span><br /><b className="tabular-nums">{usd0(compare.downVsPaid)}</b>
        </div>
      </div>

      <p className="mt-3 font-semibold">Sell a call against this LEAP{compare.shortDte > 0 ? ` for the next ${compare.shortDte} days` : ''}?</p>
      {picked == null && compare.defaultStance !== 'none' && (
        <p className={`text-[10px] ${th.textFaint}`}>
          {compare.underwater
            ? `Pre-selected the ${compare.defaultStance === 'bullish' ? 'farthest-strike' : ''} call because this LEAP is ${plain0(Math.abs(compare.downVsPaid))} under what you paid. Change it any time.`
            : 'Pre-selected from where this LEAP stands against what you paid. Change it any time.'}
        </p>
      )}
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
              {o.candidate && o.clearsMinimumCredit === false && <span className="block text-[10px] text-amber-300" data-testid="held-compare-below-min">Below the {money(compare.minCreditPerShare)} minimum credit</span>}
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

      {rows && cols.length > 0 && (
        <div className="mt-3 overflow-x-auto">
          <p className={`mb-1 text-[10px] ${th.textMuted}`}>Profit or loss on this LEAP vs what you paid, at the short call&apos;s expiration (model estimate{compare.ivPct != null ? `, IV ${compare.ivPct.toFixed(0)}%` : ''})</p>
          <table className="w-full text-right tabular-nums" data-testid="held-compare-table">
            <thead><tr className={th.textFaint}>
              <th className="py-1 text-left font-normal">If {symbol} is…</th><th className="px-2 font-normal">No call</th>
              {cols.map(c => <th key={c.candidate!.id} className={`px-2 ${c.stance === selected.stance ? 'font-bold text-emerald-300' : 'font-normal'}`}>Sell ${c.candidate!.strike}</th>)}
            </tr></thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={r.key} className={`border-t ${th.border}`}>
                  <td className="py-1 text-left">{r.label} · ${r.spot.toFixed(2)}</td>
                  <td className={`px-2 ${r.noCall < 0 ? 'text-red-300' : 'text-emerald-300'}`}>{usd0(r.noCall)}</td>
                  {cols.map(c => { const v = c.scenarios?.[i]?.withCall ?? null; return <td key={c.candidate!.id} className={`px-2 ${c.stance === selected.stance ? 'bg-emerald-500/10' : ''} ${v == null ? '' : v < 0 ? 'text-red-300' : 'text-emerald-300'}`}>{v == null ? '—' : usd0(v)}</td>; })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {call && <p className="mt-2" data-testid="held-compare-cap">Above ${call.strike}, additional stock gains are substantially offset until you close or roll the short call.</p>}
      <p className={`mt-2 text-[10px] ${th.textFaint}`}>
        Model estimates, not forecasts or quotes: odds are 1 − the short call&apos;s delta; values use the LEAP&apos;s own implied volatility at a 4% rate.
        Minimum credit {money(compare.minCreditPerShare)}/sh. Adjusted basis stays at what you paid until credits are tracked. Every call trades upside for income; it is not free money.
      </p>
    </section>
  );
}

export function HeldCompareForPairs({ pairs, spot, symbol, th }: { pairs: ReadonlyArray<Parameters<typeof buildHeldCompare>[0][number]>; spot: number | null | undefined; symbol: string; th: ScanModalTheme }) {
  const compare = buildHeldCompare(pairs, spot);
  return compare ? <HeldCompareCard compare={compare} symbol={symbol} th={th} /> : null;
}
