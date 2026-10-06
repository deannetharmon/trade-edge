// features/performance/CoachingPanel.tsx

'use client';

// PERF-AI-0001 S3 (Diane's mock v2, Ian's additions): AI coaching for the selected period. Cards and every number on
// them come from CoachingInput (computed by the app); the AI writes the words. Every AI sentence is number-checked:
// one automatic retry, then a visible "unverified figures" banner. Runs only when Dean clicks.

import { useCallback, useEffect, useRef, useState } from 'react';
import type { CoachingInput, EvidenceTier, Habit } from '@/lib/tradeLog/coachingInput';
import { answerText, buildCoachingUserMessage, buildFollowUpSystemPrompt, changeImpact, COACHING_SYSTEM_PROMPT, parseCoachingAnswer, type CoachingAnswer, type HabitKey } from '@/lib/tradeLog/coachingPrompt';
import { checkCoachingNumbers } from '@/lib/tradeLog/coachingNumberCheck';

export const PERFORMANCE_AI_MODEL = 'gpt-5.6-terra'; // AI-POLICY-0001 D3 (Dean, 2026-10-06)

interface Theme { card: string; border: string; text: string; textMuted: string; textFaint: string }
interface Msg { role: 'user' | 'assistant'; content: string; unverified?: string[] }

async function callModel(system: string, messages: { role: 'user' | 'assistant'; content: string }[], json: boolean): Promise<{ text: string; model: string | null }> {
  const res = await fetch('/api/analyze', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: PERFORMANCE_AI_MODEL, max_tokens: 8000, system, messages, ...(json ? { response_format: { type: 'json_object' } } : {}) }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error ? `${data.error}` : `AI service error ${res.status}`);
  return { text: data?.content?.find((b: { type?: string }) => b.type === 'text')?.text ?? '', model: typeof data?.model === 'string' ? data.model : null };
}

function money(v: number | null | undefined, signed = true): string {
  if (v == null || !Number.isFinite(v)) return '—';
  const abs = Math.abs(v).toLocaleString(undefined, { maximumFractionDigits: 0 });
  return v < 0 ? `−$${abs}` : `${signed ? '+' : ''}$${abs}`;
}
const tone = (v: number | null | undefined) => (v == null ? '' : v > 0 ? 'text-emerald-400' : v < 0 ? 'text-red-400' : '');

const TIER: Record<EvidenceTier, { label: string; cls: string }> = {
  RULE_BREAK: { label: 'Rule break', cls: 'bg-amber-500/15 text-amber-400' },
  FINDING: { label: 'Finding', cls: 'bg-sky-500/15 text-sky-400' },
  EARLY_SIGNAL: { label: 'Early signal', cls: 'bg-violet-500/15 text-violet-400' },
  NOT_ENOUGH_DATA: { label: 'Not enough data', cls: 'bg-white/5 text-slate-500' },
  INFORMATION: { label: 'Information', cls: 'bg-white/5 text-slate-500' },
};
function TierChip({ tier, trades }: { tier: EvidenceTier; trades?: number }) {
  const t = TIER[tier];
  return <span className={`text-[9px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full whitespace-nowrap ${t.cls}`}>{t.label}{trades != null && tier !== 'RULE_BREAK' && tier !== 'INFORMATION' ? ` · ${trades} trades` : ''}</span>;
}

function trendLine(byMonth: Record<string, number>): string | null {
  const keys = Object.keys(byMonth).sort();
  if (keys.length < 2) return null;
  return 'By month: ' + keys.map(k => `${new Date(`${k}-15T12:00:00Z`).toLocaleString('en-US', { month: 'short', timeZone: 'UTC' })} ${byMonth[k]}`).join(' · ');
}

interface CardSpec { key: HabitKey; title: string; tier: EvidenceTier; trades?: number; figure: React.ReactNode; math?: string; trend?: string | null; show: boolean }

function cardSpecs(ci: CoachingInput): CardSpec[] {
  const h = ci.habits;
  const breach = (x: Habit) => x.trades > 0;
  return [
    { key: 'beyondStop', title: 'Lost more than the 2× stop', tier: h.beyondStop.tier, show: breach(h.beyondStop), trend: trendLine(h.beyondStop.byMonth),
      figure: <><span className="text-red-400">{h.beyondStop.trades} trades · {money(h.beyondStop.pnl)}</span><span className="block text-[11px] text-slate-400 font-normal">Closing at the stop would have saved {money(h.beyondStop.savedClosingAtStop, false)}</span></>,
      math: `saved = Σ (loss before fees − credit) = ${money(h.beyondStop.savedClosingAtStop, false)}\n${h.beyondStop.symbols.join(', ')}\nassumes a fill at the stop price; slippage not modeled` },
    { key: 'openedInside21Dte', title: 'Spreads opened inside 21 DTE', tier: h.openedInside21Dte.tier, show: breach(h.openedInside21Dte), trend: trendLine(h.openedInside21Dte.byMonth),
      figure: <><span className={tone(h.openedInside21Dte.pnl)}>{h.openedInside21Dte.trades} trades · {money(h.openedInside21Dte.pnl)}</span><span className="block text-[11px] text-slate-400 font-normal">Skipping them: {money(h.openedInside21Dte.savedBySkipping)}</span></>,
      math: `skipping = −Σ P/L of these trades = ${money(h.openedInside21Dte.savedBySkipping)}` },
    { key: 'spreadsHeldPast21Dte', title: 'Spreads held past 21 DTE', tier: h.spreadsHeldPast21Dte.tier, show: breach(h.spreadsHeldPast21Dte), trend: trendLine(h.spreadsHeldPast21Dte.byMonth),
      figure: <span className={tone(h.spreadsHeldPast21Dte.pnl)}>{h.spreadsHeldPast21Dte.trades} trades · {money(h.spreadsHeldPast21Dte.pnl)}</span> },
    { key: 'target', title: 'Closed at the 50% target', tier: h.target.tier, trades: h.target.atTarget.trades + h.target.early.trades, show: h.target.atTarget.trades + h.target.early.trades > 0,
      figure: <><span>{h.target.atTarget.trades} at target <span className={tone(h.target.atTarget.pnl)}>{money(h.target.atTarget.pnl)}</span> · {h.target.early.trades} early <span className={tone(h.target.early.pnl)}>{money(h.target.early.pnl)}</span></span>{h.target.early.avgCreditKeptPct != null && <span className="block text-[11px] text-slate-400 font-normal">Early closes kept {h.target.early.avgCreditKeptPct.toFixed(0)}% of credit on average</span>}</> },
    { key: 'creditToWidth', title: 'Credit-to-width (1/3 rule)', tier: h.creditToWidth.tier, trades: Math.min(h.creditToWidth.atOrAbove.trades, h.creditToWidth.below.trades), show: h.creditToWidth.atOrAbove.trades + h.creditToWidth.below.trades > 0,
      figure: <span>≥ 1/3: {h.creditToWidth.atOrAbove.trades} · <span className={tone(h.creditToWidth.atOrAbove.pnl)}>{money(h.creditToWidth.atOrAbove.pnl)}</span> · below: {h.creditToWidth.below.trades} · <span className={tone(h.creditToWidth.below.pnl)}>{money(h.creditToWidth.below.pnl)}</span></span> },
    { key: 'positionSize', title: `Positions over ${h.positionSize.limitPct}% of net liq`, tier: h.positionSize.tier, show: h.positionSize.trades > 0, trend: trendLine(h.positionSize.byMonth),
      figure: <span>{h.positionSize.trades} trades · {h.positionSize.oversize.map(o => `${o.symbol} ${o.pct.toFixed(0)}%`).join(', ')}</span> },
    { key: 'reentryAfterLoss', title: 'Re-entry within 2 days of a loss', tier: h.reentryAfterLoss.tier, trades: h.reentryAfterLoss.trades, show: h.reentryAfterLoss.trades > 0,
      figure: <span className={tone(h.reentryAfterLoss.pnl)}>{h.reentryAfterLoss.trades} trades · {money(h.reentryAfterLoss.pnl)}</span> },
    { key: 'lossConcentration', title: 'Losses concentrated in one ticker', tier: h.lossConcentration[0]?.tier ?? 'NOT_ENOUGH_DATA', trades: h.lossConcentration[0]?.trades, show: h.lossConcentration.length > 0,
      figure: <span>{h.lossConcentration.map(x => `${x.symbol} ${x.lossShare.toFixed(0)}% of losses (${money(-x.losses)})`).join(' · ')}</span> },
    { key: 'firstThirtyMinutes', title: 'Entries in the first 30 minutes', tier: h.firstThirtyMinutes.tier, trades: h.firstThirtyMinutes.trades, show: h.firstThirtyMinutes.trades > 0,
      figure: <span className={tone(h.firstThirtyMinutes.pnl)}>{h.firstThirtyMinutes.trades} trades · {money(h.firstThirtyMinutes.pnl)}</span> },
    { key: 'assigned', title: 'Assigned CSPs', tier: 'INFORMATION', show: h.assigned.trades > 0,
      figure: <span>{h.assigned.trades} trades · {money(h.assigned.pnl)} · acceptable under your CSP rule</span> },
  ];
}

export function CoachingPanel({ th, input, onClose }: { th: Theme; input: CoachingInput; onClose: () => void }) {
  const [answer, setAnswer] = useState<CoachingAnswer | null>(null);
  const [unverified, setUnverified] = useState<string[]>([]);
  const [model, setModel] = useState<string | null>(null);
  const [generatedAt, setGeneratedAt] = useState<Date | null>(null);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState('');
  const [chat, setChat] = useState<Msg[]>([]);
  const [draft, setDraft] = useState('');
  const [asking, setAsking] = useState(false);
  const [answeredFor, setAnsweredFor] = useState('');
  const inputRef = useRef(input);
  inputRef.current = input;
  const periodKey = `${input.period.from}|${input.period.to}|${input.counts.included}|${input.headline.pnl}`;

  const run = useCallback(async () => {
    const ci = inputRef.current;
    if (ci.counts.included === 0) return;
    setRunning(true); setError(''); setAnswer(null); setChat([]); setUnverified([]);
    try {
      const first = buildCoachingUserMessage(ci);
      let reply = await callModel(COACHING_SYSTEM_PROMPT, [{ role: 'user', content: first }], true);
      let parsed = parseCoachingAnswer(reply.text);
      let check = parsed ? checkCoachingNumbers(answerText(parsed), ci) : null;
      if (!parsed || !check?.ok) {
        // Quinn: one automatic retry naming the problem, then show what we have with a visible banner.
        const fix = !parsed ? 'Your answer was not the required JSON object. Answer again with only the JSON object.' : `These figures are not in DATA: ${check!.unverified.join(', ')}. Rewrite using only numbers from DATA.`;
        reply = await callModel(COACHING_SYSTEM_PROMPT, [{ role: 'user', content: first }, { role: 'assistant', content: reply.text }, { role: 'user', content: fix }], true);
        const again = parseCoachingAnswer(reply.text);
        if (again) { parsed = again; check = checkCoachingNumbers(answerText(again), ci); }
      }
      if (!parsed) throw new Error('The AI answer could not be read.');
      setAnswer(parsed); setUnverified(check?.unverified ?? []); setModel(reply.model); setGeneratedAt(new Date());
      setAnsweredFor(`${ci.period.from}|${ci.period.to}|${ci.counts.included}|${ci.headline.pnl}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'AI service error');
    } finally { setRunning(false); }
  }, []);

  useEffect(() => { void run(); }, [run]);

  const ask = async () => {
    const q = draft.trim();
    if (!q || asking) return;
    setDraft('');
    const next: Msg[] = [...chat, { role: 'user', content: q }];
    setChat(next); setAsking(true);
    try {
      const reply = await callModel(buildFollowUpSystemPrompt(inputRef.current), next.map(m => ({ role: m.role, content: m.content })), false);
      const check = checkCoachingNumbers(reply.text, inputRef.current);
      setChat(prev => [...prev, { role: 'assistant', content: reply.text, unverified: check.unverified }]);
      setModel(reply.model);
    } catch (e) {
      setChat(prev => [...prev, { role: 'assistant', content: `The AI service did not respond (${e instanceof Error ? e.message : 'error'}). Your Performance numbers are unaffected.` }]);
    } finally { setAsking(false); }
  };

  const ci = input;
  const h = ci.habits;
  const stale = answer != null && answeredFor !== periodKey; // the period or trades changed since this answer
  const shown = stale ? null : answer;
  const cards = cardSpecs(ci).filter(c => c.show);
  const leak = [{ label: 'lost more than the 2× stop', trades: h.beyondStop.trades, pnl: h.beyondStop.pnl }, { label: 'spreads opened inside 21 DTE', trades: h.openedInside21Dte.trades, pnl: h.openedInside21Dte.pnl }]
    .filter(x => x.trades > 0 && x.pnl < 0).sort((a, b) => a.pnl - b.pnl)[0];
  const jump = (key: HabitKey) => document.getElementById(`rule-${key}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  const hasRuleCard = (key: HabitKey) => ['beyondStop', 'openedInside21Dte', 'spreadsHeldPast21Dte', 'target', 'creditToWidth', 'positionSize'].indexOf(key) >= 0;

  return (
    <section className={`${th.card} border ${th.border} rounded-xl p-4 space-y-4`} aria-label="AI coaching">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className={`text-sm font-bold ${th.text}`}>AI coaching · {ci.period.label}</h2>
          <p className={`text-[11px] ${th.textFaint} mt-0.5`}>
            {ci.counts.included} closed trades · same period and trades as the tab{model ? ` · model: ${model}` : ''}{generatedAt ? ` · generated ${generatedAt.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}` : ''}
            {ci.counts.tradeLinesCapped ? ' · only the latest 400 trades were sent' : ''}
          </p>
        </div>
        <div className="flex gap-2">
          <button type="button" onClick={() => void run()} disabled={running || ci.counts.included === 0} className="text-[10px] px-3 py-1.5 border border-sky-600 text-sky-400 rounded font-bold tracking-wider disabled:opacity-40">Run again</button>
          <button type="button" onClick={onClose} className={`text-[10px] px-3 py-1.5 border ${th.border} rounded ${th.textMuted} font-bold tracking-wider`}>Close</button>
        </div>
      </div>

      {ci.counts.included === 0 && <p className={`text-xs ${th.textMuted} border ${th.border} rounded-lg p-3`}>No closed trades between {ci.period.from} and {ci.period.to}. Pick a longer period to get coaching.</p>}
      {running && <p className={`text-xs ${th.textMuted} border ${th.border} rounded-lg p-3`}>Reading {ci.counts.included} trades for {ci.period.label}… usually 20–40 seconds.</p>}
      {error && !running && <p className="text-xs border border-red-500/50 bg-red-500/10 rounded-lg p-3">The AI service did not respond ({error}). Your Performance numbers are unaffected. <button type="button" onClick={() => void run()} className="text-sky-400 underline">Try again</button></p>}
      {stale && !running && <p className={`text-xs ${th.textMuted} border ${th.border} rounded-lg p-3`}>The period changed. The cards below show the new period; <button type="button" onClick={() => void run()} className="text-sky-400 underline">run again</button> for coaching on it.</p>}
      {answer && !stale && unverified.length > 0 && <p className="text-xs border border-amber-500/50 bg-amber-500/10 rounded-lg p-3">Unverified figures: {unverified.map(u => `“${u}”`).join(', ')} are not in this period&apos;s data. Treat them as wrong. <button type="button" onClick={() => void run()} className="text-sky-400 underline">Run again</button></p>}

      {ci.counts.included > 0 && (
        <div className="grid gap-3 sm:grid-cols-3">
          <div className={`border ${th.border} rounded-lg p-3`}><p className={`text-[10px] uppercase tracking-wider ${th.textFaint}`}>Account profit</p>
            {ci.accountProfit.status === 'OK'
              ? <><p className={`text-xl font-bold tabular-nums ${tone(ci.accountProfit.profit)}`}>{money(ci.accountProfit.profit)}</p><p className={`text-[10px] ${th.textFaint}`}>balance change minus deposits and withdrawals</p></>
              : <p className={`text-[11px] ${th.textMuted} mt-1`}>{ci.accountProfit.reason}</p>}
          </div>
          <div className={`border ${th.border} rounded-lg p-3`}><p className={`text-[10px] uppercase tracking-wider ${th.textFaint}`}>From closed trades</p><p className={`text-xl font-bold tabular-nums ${tone(ci.headline.pnl)}`}>{money(ci.headline.pnl)}</p><p className={`text-[10px] ${th.textFaint}`}>{ci.headline.trades} trades after fees</p></div>
          <div className={`border ${th.border} rounded-lg p-3`}><p className={`text-[10px] uppercase tracking-wider ${th.textFaint}`}>Biggest leak</p>
            {leak ? <><p className="text-xl font-bold tabular-nums text-red-400">{money(leak.pnl)}</p><p className={`text-[10px] ${th.textFaint}`}>{leak.trades} trades {leak.label}</p></> : <p className={`text-[11px] ${th.textMuted} mt-1`}>No rule-break losses this period</p>}
          </div>
        </div>
      )}
      {shown && <p className={`text-[13px] ${th.text} max-w-3xl`}>{shown.summary}</p>}

      {ci.counts.included > 0 && cards.length > 0 && (
        <div>
          <h3 className={`text-[10px] font-bold uppercase tracking-widest ${th.textMuted}`}>Habits</h3>
          <p className={`text-[11px] ${th.textFaint} mb-2`}>Measured against your rules. Each card says how much data it rests on.</p>
          <div className="grid gap-3 md:grid-cols-2">
            {cards.map(c => (
              <div key={c.key} className={`border rounded-lg p-3 space-y-1.5 ${c.tier === 'RULE_BREAK' ? 'border-amber-500/50' : th.border}`}>
                <div className="flex items-start justify-between gap-2"><span className={`text-[12px] font-semibold ${th.text}`}>{c.title}</span><TierChip tier={c.tier} trades={c.trades} /></div>
                <div className="text-[13px] font-bold tabular-nums">{c.figure}</div>
                {shown?.habits[c.key] && <p className={`text-[12px] ${th.textMuted}`}>{shown?.habits[c.key]}</p>}
                {c.trend && <p className={`text-[10px] font-mono ${th.textFaint}`}>{c.trend}</p>}
                {c.math && <details className={`text-[10px] ${th.textFaint}`}><summary className="cursor-pointer">Show the math</summary><pre className="whitespace-pre-wrap mt-1 font-mono">{c.math}</pre></details>}
                {hasRuleCard(c.key) && <button type="button" onClick={() => jump(c.key)} className="text-[10px] text-sky-400 hover:underline">See rule card</button>}
              </div>
            ))}
          </div>
        </div>
      )}

      {ci.strategies.length > 0 && (
        <div>
          <h3 className={`text-[10px] font-bold uppercase tracking-widest ${th.textMuted}`}>Strategy</h3>
          <p className={`text-[11px] ${th.textFaint} mb-2`}>Needed = the win rate that breaks even at this strategy&apos;s average win and loss.</p>
          <div className="overflow-x-auto">
            <table className="w-full text-[12px] tabular-nums">
              <thead><tr className={`${th.textFaint} text-[10px] uppercase tracking-wider`}><th className="text-left py-1.5 pr-3">Strategy</th><th className="text-right px-3">Trades</th><th className="text-right px-3">P/L</th><th className="text-right px-3">Win rate</th><th className="text-right px-3">Needed</th><th className="text-right px-3">Return on risk</th><th className="text-left pl-3">Evidence</th></tr></thead>
              <tbody>
                {ci.strategies.map(s => (
                  <tr key={s.strategy} className="border-t border-white/5 align-top">
                    <td className="py-1.5 pr-3 font-semibold">{s.strategy}</td>
                    <td className="text-right px-3">{s.stats.trades}</td>
                    <td className={`text-right px-3 ${tone(s.stats.pnl)}`}>{money(s.stats.pnl)}</td>
                    <td className={`text-right px-3 ${s.stats.winRate != null && s.breakEvenWinRate != null ? (s.stats.winRate >= s.breakEvenWinRate ? 'text-emerald-400' : 'text-red-400') : ''}`}>{s.stats.winRate == null ? '—' : `${s.stats.winRate.toFixed(0)}%`}</td>
                    <td className="text-right px-3">{s.breakEvenWinRate == null ? '—' : `${s.breakEvenWinRate.toFixed(0)}%`}</td>
                    <td className={`text-right px-3 ${tone(s.stats.returnOnRiskPct)}`}>{s.stats.returnOnRiskPct == null ? '—' : `${s.stats.returnOnRiskPct.toFixed(1)}%`}</td>
                    <td className="pl-3"><TierChip tier={s.tier} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {shown && Object.keys(shown.strategies).length > 0 && <ul className={`mt-2 space-y-1 text-[12px] ${th.textMuted}`}>{Object.keys(shown.strategies).map(k => <li key={k}><b className={th.text}>{k}:</b> {shown.strategies[k]}</li>)}</ul>}
          {shown?.tickers && <p className={`mt-2 text-[12px] ${th.textMuted}`}><b className={th.text}>Tickers:</b> {shown.tickers}</p>}
        </div>
      )}

      {shown && shown.changes.length > 0 && (
        <div>
          <h3 className={`text-[10px] font-bold uppercase tracking-widest ${th.textMuted}`}>Three changes</h3>
          <p className={`text-[11px] ${th.textFaint} mb-2`}>Dollars are hindsight on this period, calculated by the app, not by the AI.</p>
          <ol className="space-y-2">
            {shown.changes.map((c, i) => {
              const impact = changeImpact(ci, c.habit);
              const spec = cardSpecs(ci).find(x => x.key === c.habit);
              return (
                <li key={i} className={`border ${th.border} rounded-lg p-3 grid grid-cols-[auto_1fr] gap-3`}>
                  <span className={`text-xl font-bold font-mono ${th.textFaint}`}>{i + 1}</span>
                  <div className="space-y-1 min-w-0">
                    <div className="flex flex-wrap items-start justify-between gap-2"><b className={`text-[13px] ${th.text}`}>{c.title}</b>{spec && <TierChip tier={spec.tier} trades={spec.trades} />}</div>
                    {impact.dollars != null && <p className={`text-[12px] font-mono ${tone(impact.dollars)}`}>{money(impact.dollars)} {impact.text} this period</p>}
                    {impact.dollars == null && impact.text && <p className={`text-[12px] font-mono ${th.textFaint}`}>{impact.text}</p>}
                    {c.detail && <p className={`text-[12px] ${th.textMuted}`}>{c.detail}</p>}
                    {hasRuleCard(c.habit) && <button type="button" onClick={() => jump(c.habit)} className="text-[10px] text-sky-400 hover:underline">See rule card</button>}
                  </div>
                </li>
              );
            })}
          </ol>
        </div>
      )}

      {shown && (
        <div className="space-y-2">
          <h3 className={`text-[10px] font-bold uppercase tracking-widest ${th.textMuted}`}>Ask about this period</h3>
          {chat.map((m, i) => (
            <div key={i} className={`text-[12px] rounded-lg px-3 py-2 max-w-3xl whitespace-pre-wrap ${m.role === 'user' ? 'ml-auto bg-sky-500/10' : `border ${th.border} ${th.textMuted}`}`}>
              {m.content}
              {m.unverified && m.unverified.length > 0 && <span className="block mt-1 text-[11px] text-amber-400">Unverified figures: {m.unverified.join(', ')}. Treat them as wrong.</span>}
            </div>
          ))}
          {asking && <p className={`text-[11px] ${th.textFaint}`}>Thinking…</p>}
          <div className="flex gap-2">
            <label htmlFor="perf-ai-ask" className="sr-only">Ask a follow-up about this period</label>
            <textarea id="perf-ai-ask" value={draft} onChange={e => setDraft(e.target.value)} onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void ask(); } }}
              rows={2} placeholder="Ask a follow-up about this period…" className={`flex-1 min-w-0 resize-y text-xs px-3 py-2 border ${th.border} bg-transparent ${th.text} rounded-lg focus:outline-none focus:border-sky-500`} />
            <button type="button" onClick={() => void ask()} disabled={asking || !draft.trim()} className="px-4 text-xs font-bold border border-sky-600 text-sky-400 rounded-lg disabled:opacity-40">Send</button>
          </div>
        </div>
      )}
    </section>
  );
}
