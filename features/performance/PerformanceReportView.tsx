// features/performance/PerformanceReportView.tsx

'use client';

// PERF-0001 -- the rebuilt Performance tab body (Diane's mock, Ian's and Paul's sign-off, 2026-10-06). Every panel reads
// the SAME PerformanceReport (lib/tradeLog/performanceMetrics.ts), so counts and totals always agree.

import type { PerformanceReport, GroupStats, MethodExit } from '@/lib/tradeLog/performanceMetrics';
import type { PeriodAccountProfit } from '@/lib/portfolio-data/balancePerformance';
import type { CoachingInput } from '@/lib/tradeLog/coachingInput';

const STRATEGY_LABEL: Record<string, string> = {
  CSP: 'Cash-secured puts', BPS: 'Bull put spreads', BCS: 'Bear call spreads', IC: 'Iron condors', SHORT_CALL: 'Short calls', SPREAD: 'Other spreads', OTHER: 'Other',
};
const EXIT_LABEL: Record<MethodExit, string> = {
  TARGET: 'Target (≥ 50% kept)', EARLY_PROFIT: 'Early profit (< 50%)', STOPPED: 'Stopped within 2×', BEYOND_STOP: 'Beyond the 2× stop', EXPIRED: 'Expired', ASSIGNED: 'Assigned',
};

function money(v: number | null | undefined, signed = true): string {
  if (v == null || !Number.isFinite(v)) return '—';
  const abs = Math.abs(v).toLocaleString(undefined, { maximumFractionDigits: 0 });
  return v < 0 ? `−$${abs}` : `${signed ? '+' : ''}$${abs}`;
}
const tone = (v: number | null | undefined) => (v == null ? '' : v > 0 ? 'text-emerald-400' : v < 0 ? 'text-red-400' : '');
const pct = (v: number | null | undefined, digits = 0) => (v == null || !Number.isFinite(v) ? '—' : `${v > 0 ? '+' : ''}${v.toFixed(digits)}%`);

interface Theme { card: string; border: string; text: string; textMuted: string; textFaint: string }

function Panel({ th, title, sub, children }: { th: Theme; title: string; sub?: string; children: React.ReactNode }) {
  return (
    <section className={`${th.card} border ${th.border} rounded-xl p-4 min-w-0`}>
      <h2 className={`text-[10px] font-bold uppercase tracking-widest ${th.textMuted}`}>{title}</h2>
      {sub && <p className={`text-[11px] ${th.textFaint} mt-1 mb-3`}>{sub}</p>}
      {children}
    </section>
  );
}

function Kpi({ th, label, value, valueClass = '', note }: { th: Theme; label: string; value: string; valueClass?: string; note?: string }) {
  return (
    <div>
      <p className={`text-[10px] uppercase tracking-wider ${th.textFaint}`}>{label}</p>
      <p className={`text-xl font-bold tabular-nums mt-1 ${valueClass || th.text}`}>{value}</p>
      {note && <p className={`text-[10px] ${th.textFaint} mt-0.5`}>{note}</p>}
    </div>
  );
}

function StatRow({ name, s }: { name: string; s: GroupStats }) {
  return (
    <tr className="border-b border-white/5">
      <td className="py-2 pr-3 text-left font-semibold">{name}</td>
      <td className="py-2 px-3 text-right tabular-nums">{s.trades}</td>
      <td className={`py-2 px-3 text-right tabular-nums ${tone(s.pnl)}`}>{money(s.pnl)}</td>
      <td className="py-2 px-3 text-right tabular-nums">{s.winRate == null ? '—' : `${s.winRate.toFixed(0)}%`}</td>
      <td className="py-2 px-3 text-right tabular-nums">{money(s.avgWin, false)} / {money(s.avgLoss)}</td>
      <td className={`py-2 px-3 text-right tabular-nums ${s.profitFactor != null && s.profitFactor < 1 ? 'text-amber-400' : ''}`}>{s.profitFactor == null ? '—' : s.profitFactor.toFixed(2)}</td>
      <td className={`py-2 px-3 text-right tabular-nums ${tone(s.expectancy)}`}>{money(s.expectancy)}</td>
      <td className={`py-2 pl-3 text-right tabular-nums ${tone(s.returnOnRiskPct)}`}>{pct(s.returnOnRiskPct, 1)}</td>
    </tr>
  );
}

export function PerformanceReportView({ th, report, accountProfit, periodLabel, onOpenTicker, positionSize, onMarkDeliberate }: {
  th: Theme;
  report: PerformanceReport;
  accountProfit: PeriodAccountProfit | null;
  periodLabel: string;
  onOpenTicker: (symbol: string) => void;
  /** PERF-AI-0001: 25%-of-net-liq rule (Dean); review only, never blocking, override per trade. */
  positionSize?: CoachingInput['habits']['positionSize'];
  onMarkDeliberate?: (tradeId: string) => void;
}) {
  const h = report.headline;
  const realized = h.pnl;
  const other = accountProfit?.status === 'OK' ? accountProfit.profit - realized : null;
  const months = report.byMonth.map((m) => m.month);
  const exitMax = Math.max(1, ...Object.values(report.exits).map((e) => Math.abs(e.pnl)));
  const r = report.rules;

  // By-month chart, one scale for bars and the running-total line.
  const W = 760, H = 240, padL = 64, padR = 16, padT = 20, padB = 32;
  const vals = report.byMonth.flatMap((m) => [m.stats.pnl, m.cumulativePnl, 0]);
  const vmax = Math.max(...vals, 1), vmin = Math.min(...vals, -1);
  const y = (v: number) => padT + ((vmax - v) / (vmax - vmin)) * (H - padT - padB);
  const slot = (W - padL - padR) / Math.max(1, report.byMonth.length);
  const xc = (i: number) => padL + slot * i + slot / 2;

  return (
    <div className="space-y-4">
      <Panel th={th} title="Profit for this period" sub={`${periodLabel}. Account profit is the change in account value with deposits and withdrawals taken out (the Balances "Performance" line).`}>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {accountProfit?.status === 'OK'
            ? <Kpi th={th} label="Account profit" value={money(accountProfit.profit)} valueClass={tone(accountProfit.profit)} note={`balances ${accountProfit.startDate} → ${accountProfit.endDate}${accountProfit.netMoved ? ` · ${money(accountProfit.netMoved)} moved in/out excluded` : ''}`} />
            : <Kpi th={th} label="Account profit" value="Unavailable" note={accountProfit?.reason ?? 'Loading balance history…'} />}
          <Kpi th={th} label="From closed trades" value={money(realized)} valueClass={tone(realized)} note={`realized after $${h.fees.toFixed(0)} fees · ${h.trades} trades`} />
          <Kpi th={th} label="Open positions and other" value={money(other)} valueClass={tone(other)} note="interest and account fees included" />
          <Kpi th={th} label="Return" value={accountProfit?.status === 'OK' ? pct(accountProfit.returnPct, 1) : '—'} valueClass={accountProfit?.status === 'OK' ? tone(accountProfit.returnPct) : ''} note="on account value at the start" />
        </div>
      </Panel>

      <Panel th={th} title="Closed-trade results" sub="Realized P/L after fees. Open positions are not included.">
        <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-7 gap-4">
          <Kpi th={th} label="Realized P/L" value={money(h.pnl)} valueClass={tone(h.pnl)} note={`after $${h.fees.toFixed(0)} fees`} />
          <Kpi th={th} label="Win rate" value={h.winRate == null ? '—' : `${h.winRate.toFixed(0)}%`} note={`${h.wins} W · ${h.losses} L`} />
          <Kpi th={th} label="Avg win / avg loss" value={`${money(h.avgWin, false)} / ${money(h.avgLoss)}`} />
          <Kpi th={th} label="Expectancy" value={money(h.expectancy)} valueClass={tone(h.expectancy)} note="per trade" />
          <Kpi th={th} label="Profit factor" value={h.profitFactor == null ? '—' : h.profitFactor.toFixed(2)} note="gross wins ÷ gross losses" />
          <Kpi th={th} label="Return on capital at risk" value={pct(h.returnOnRiskPct, 1)} valueClass={tone(h.returnOnRiskPct)} note="spreads on max loss, CSPs on collateral" />
          <Kpi th={th} label="Max drawdown" value={money(h.maxDrawdown)} valueClass={h.maxDrawdown < 0 ? 'text-red-400' : ''} note="realized, peak to trough" />
        </div>
      </Panel>

      <Panel th={th} title="Rule check" sub="Your rules: close at 50% of credit, stop at 2× credit, manage spreads at 21 DTE (CSPs and covered calls exempt).">
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3">
          {[
            { id: 'rule-beyondStop', t: 'Lost more than the 2× stop', n: `${r.beyondStop.trades} trades · ${money(r.beyondStop.pnl)}`, d: `${money(-r.beyondStop.excessLoss)} beyond where the stop would have closed${r.beyondStop.symbols.length ? ` · ${r.beyondStop.symbols.join(', ')}` : ''}`, alert: r.beyondStop.trades > 0, c: tone(r.beyondStop.pnl) },
            { id: 'rule-insideStop', t: 'Losses inside the 2× stop', n: `${report.exits.STOPPED.trades} trades · ${money(report.exits.STOPPED.pnl)}`, d: `average loss ${money(h.avgLoss)} vs average win ${money(h.avgWin, false)}`, alert: report.exits.STOPPED.trades > 0, c: tone(report.exits.STOPPED.pnl) },
            { id: 'rule-openedInside21Dte', t: 'Spreads opened inside 21 DTE', n: `${r.enteredInside21Dte.trades} trades · ${money(r.enteredInside21Dte.pnl)}`, d: 'entries the 21-DTE rule would not take', alert: r.enteredInside21Dte.trades > 0, c: tone(r.enteredInside21Dte.pnl) },
            { id: 'rule-target', t: 'Closed at the 50% target', n: `${r.targetHit} trades · ${money(report.exits.TARGET.pnl)}`, d: `${report.exits.EARLY_PROFIT.trades} more closed early (${money(report.exits.EARLY_PROFIT.pnl)})`, alert: false, c: tone(report.exits.TARGET.pnl) },
            { id: 'rule-creditToWidth', t: 'Spreads below 1/3 credit-to-width', n: `${r.creditToWidth.below.trades} trades · ${money(r.creditToWidth.below.pnl)}`, d: `${r.creditToWidth.atOrAbove.trades} at or above 1/3: ${money(r.creditToWidth.atOrAbove.pnl)}`, alert: r.creditToWidth.below.trades > 0, c: tone(r.creditToWidth.below.pnl) },
            { id: 'rule-spreadsHeldPast21Dte', t: 'Spreads held past 21 DTE', n: `${r.spreadsHeldPast21Dte.trades} trades · ${money(r.spreadsHeldPast21Dte.pnl)}`, d: 'held into the management window', alert: false, c: tone(r.spreadsHeldPast21Dte.pnl) },
          ].map((x) => (
            <div key={x.t} id={x.id} className={`border rounded-lg p-3 scroll-mt-32 ${x.alert ? 'border-amber-500/50' : th.border}`}>
              <p className={`text-[11px] ${th.textMuted}`}>{x.t}</p>
              <p className={`text-base font-bold tabular-nums mt-1 ${x.c}`}>{x.n}</p>
              <p className={`text-[10px] ${th.textFaint} mt-1`}>{x.d}</p>
            </div>
          ))}
          {positionSize && (
            <div id="rule-positionSize" className={`border rounded-lg p-3 scroll-mt-32 ${positionSize.trades > 0 ? 'border-amber-500/50' : th.border}`}>
              <p className={`text-[11px] ${th.textMuted}`}>Positions over {positionSize.limitPct}% of net liq</p>
              <p className={`text-base font-bold tabular-nums mt-1 ${th.text}`}>{positionSize.trades} trade{positionSize.trades === 1 ? '' : 's'}{positionSize.oversize[0] ? ` · ${positionSize.oversize[0].symbol} ${positionSize.oversize[0].pct.toFixed(0)}%` : ''}</p>
              <p className={`text-[10px] ${th.textFaint} mt-1`}>{positionSize.overridden} marked deliberate{positionSize.notChecked ? ` · ${positionSize.notChecked} not checked (no saved balance at open)` : ''}</p>
              {positionSize.oversize.length > 0 && onMarkDeliberate && (
                <details className="mt-2">
                  <summary className={`text-[10px] cursor-pointer ${th.textMuted}`}>Review</summary>
                  <ul className="mt-1 space-y-1">
                    {positionSize.oversize.map((o) => (
                      <li key={o.id} className={`flex items-center justify-between gap-2 text-[10px] ${th.textFaint}`}>
                        <span className="tabular-nums">{o.symbol} · {o.pct.toFixed(1)}% · {money(o.capital, false)} of {money(o.netLiq, false)}</span>
                        <button type="button" onClick={() => onMarkDeliberate(o.id)} className={`px-2 py-0.5 border ${th.border} rounded ${th.textMuted} hover:text-white`}>Mark deliberate</button>
                      </li>
                    ))}
                  </ul>
                </details>
              )}
            </div>
          )}
        </div>
      </Panel>

      {report.byMonth.length > 0 && (
        <Panel th={th} title="By month" sub="Bars: realized P/L in the month. Line: running total.">
          <div className="overflow-x-auto">
            <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ minWidth: 520 }} role="img" aria-label="Realized P/L by month">
              {[vmax, 0, vmin].map((v, i) => (
                <g key={i}>
                  <line x1={padL} x2={W - padR} y1={y(v)} y2={y(v)} stroke="currentColor" strokeOpacity={v === 0 ? 0.25 : 0.08} />
                  <text x={padL - 8} y={y(v) + 4} textAnchor="end" fontSize="11" fill="currentColor" fillOpacity="0.55">{money(v, v !== 0)}</text>
                </g>
              ))}
              {report.byMonth.map((m, i) => {
                const top = Math.min(y(m.stats.pnl), y(0));
                const height = Math.max(1, Math.abs(y(m.stats.pnl) - y(0)));
                return (
                  <g key={m.month}>
                    <rect x={xc(i) - slot * 0.28} y={top} width={slot * 0.56} height={height} fill={m.stats.pnl >= 0 ? '#34d399' : '#f87171'} fillOpacity="0.85" />
                    <text x={xc(i)} y={H - 10} textAnchor="middle" fontSize="11" fill="currentColor" fillOpacity="0.55">{m.month}</text>
                    <text x={xc(i)} y={m.stats.pnl >= 0 ? top - 6 : top + height + 14} textAnchor="middle" fontSize="11" fill="currentColor" fillOpacity="0.8">{money(m.stats.pnl)}</text>
                  </g>
                );
              })}
              <polyline fill="none" stroke="#60a5fa" strokeWidth="2" points={report.byMonth.map((m, i) => `${xc(i)},${y(m.cumulativePnl)}`).join(' ')} />
              {report.byMonth.length > 0 && <circle cx={xc(report.byMonth.length - 1)} cy={y(report.byMonth[report.byMonth.length - 1].cumulativePnl)} r="4" fill="#60a5fa" />}
            </svg>
          </div>
        </Panel>
      )}

      <Panel th={th} title="By strategy">
        <div className="overflow-x-auto">
          <table className={`w-full text-xs ${th.text}`}>
            <thead className={th.textFaint}><tr className="text-[10px] uppercase tracking-wider">
              <th className="pb-2 pr-3 text-left">Strategy</th><th className="pb-2 px-3 text-right">Trades</th><th className="pb-2 px-3 text-right">Realized</th><th className="pb-2 px-3 text-right">Win rate</th>
              <th className="pb-2 px-3 text-right">Avg win / loss</th><th className="pb-2 px-3 text-right">Profit factor</th><th className="pb-2 px-3 text-right">Expectancy</th><th className="pb-2 pl-3 text-right">Return on risk</th>
            </tr></thead>
            <tbody>{Object.entries(report.byStrategy).sort((a, b) => b[1].pnl - a[1].pnl).map(([k, s]) => <StatRow key={k} name={STRATEGY_LABEL[k] ?? k} s={s} />)}</tbody>
          </table>
        </div>
      </Panel>

      <Panel th={th} title="By ticker" sub="Total for the period and each month. Click a ticker to open it in the Trade Log.">
        <div className="overflow-x-auto">
          <table className={`w-full text-xs ${th.text}`}>
            <thead className={th.textFaint}><tr className="text-[10px] uppercase tracking-wider">
              <th className="pb-2 pr-3 text-left">Ticker</th><th className="pb-2 px-3 text-right">Trades</th><th className="pb-2 px-3 text-right">Total</th><th className="pb-2 px-3 text-right">Per trade</th><th className="pb-2 px-3 text-right">Win rate</th>
              {months.map((m) => <th key={m} className="pb-2 px-2 text-right">{m.slice(5)}/{m.slice(2, 4)}</th>)}
            </tr></thead>
            <tbody>
              {report.byTicker.map((t) => (
                <tr key={t.symbol} className="border-b border-white/5">
                  <td className="py-2 pr-3 text-left"><button type="button" onClick={() => onOpenTicker(t.symbol)} className="font-semibold underline decoration-dotted underline-offset-2">{t.symbol}</button></td>
                  <td className="py-2 px-3 text-right tabular-nums">{t.stats.trades}</td>
                  <td className={`py-2 px-3 text-right tabular-nums ${tone(t.stats.pnl)}`}>{money(t.stats.pnl)}</td>
                  <td className={`py-2 px-3 text-right tabular-nums ${tone(t.stats.expectancy)}`}>{money(t.stats.expectancy)}</td>
                  <td className="py-2 px-3 text-right tabular-nums">{t.stats.winRate == null ? '—' : `${t.stats.winRate.toFixed(0)}%`}</td>
                  {months.map((m) => {
                    const v = t.byMonth[m];
                    return <td key={m} className="py-2 px-2 text-right tabular-nums">{v == null ? <span className={th.textFaint}>—</span> : <span className={`inline-block min-w-[48px] rounded px-1.5 ${v >= 0 ? 'bg-emerald-500/15 text-emerald-400' : 'bg-red-500/15 text-red-400'}`}>{money(v)}</span>}</td>;
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Panel th={th} title="How trades ended" sub="Measured against your rules, after fees. Bar length: dollars, one scale.">
          <div className="space-y-2">
            {(Object.keys(EXIT_LABEL) as MethodExit[]).map((k) => {
              const e = report.exits[k];
              return (
                <div key={k} className="grid grid-cols-[150px_1fr_110px] gap-3 items-center text-xs">
                  <span className={th.textMuted}>{EXIT_LABEL[k]}</span>
                  <div className="h-2.5 rounded bg-white/5 overflow-hidden"><div className={`h-full ${e.pnl >= 0 ? 'bg-emerald-400' : 'bg-red-400'}`} style={{ width: `${(Math.abs(e.pnl) / exitMax) * 100}%` }} /></div>
                  <span className={`text-right tabular-nums ${tone(e.pnl)}`}>{e.trades} · {money(e.pnl)}</span>
                </div>
              );
            })}
          </div>
        </Panel>
        <Panel th={th} title="Needs review" sub="Not in any number above until fixed.">
          {report.incomplete.length === 0
            ? <p className={`text-xs ${th.textFaint}`}>Nothing to review: every trade in this period reconstructed cleanly.</p>
            : <ul className="space-y-2">{report.incomplete.map((t) => (
              <li key={t.id} className={`text-xs border-l-2 border-amber-500 pl-2 ${th.textMuted}`}>
                <button type="button" onClick={() => onOpenTicker(t.symbol)} className="font-semibold underline decoration-dotted underline-offset-2">{t.symbol}</button>{' '}
                {STRATEGY_LABEL[t.strategy] ?? t.strategy} opened {t.openDate}, closed {t.closeDate}: {t.anomaly === 'CREDIT_STRUCTURE_OPENED_FOR_A_DEBIT' ? `opened for a debit (${money(t.creditReceived)}), which a credit structure cannot have; its legs were likely grouped with another order.` : 'its legs did not reconstruct cleanly.'}
              </li>
            ))}</ul>}
          {report.excludedByUser > 0 && <p className={`text-[10px] ${th.textFaint} mt-3`}>{report.excludedByUser} trade(s) you excluded in the Trade Log are left out.</p>}
        </Panel>
      </div>
    </div>
  );
}
