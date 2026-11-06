// features/screener/components/CleanCspCard.tsx
//
// CLEAN-CARD-0001 -- the Clean view of a CSP result card: one line of bare essentials, and an expanded
// grid where each fact appears once. Display only. Qualification, scoring and ordering are untouched;
// the Full card stays available behind the Clean/Full toggle.

import React from 'react';
import type { ReactNode } from 'react';
import type { ScreenResult, SpreadCandidate } from '@/lib/scans/types';
import {
  TONE_CLASS, yieldTone, popTone, distanceTone, allocTone, breakevenDistancePct, otmPct,
  fmtPct0, fmtMoney0, type AllocResult, type Tone,
} from '@/lib/scans/cleanCard';
import { calculateCspReturnThisCycle, CSP_RETURN_STATUS_META } from '@/lib/scans/cspReturnThisCycle';
import { summarizeFailReason } from '@/lib/screener/failReasonSummary';
import { SCORE_BAND_CLASS } from './CspScoreBreakdown';
import type { ScoreBand } from '@/lib/scans/scoreBands';

export interface CleanTheme { text: string; textFaint: string; label: string; border: string }

function Stat({ label, children }: { label: string; children: ReactNode }) {
  return (
    <span className="text-[13px] leading-tight shrink-0">
      <span className="block text-[10px] uppercase tracking-wider text-slate-400">{label}</span>
      {children}
    </span>
  );
}

const tone = (t: Tone) => TONE_CLASS[t];
const CAPACITY = /^Insufficient CSP capacity/i;

export function CleanCspLine({
  result, c, th, rsi14, oiBelowFloor, alloc, score, band, scoreOpen, onScore, expanded,
}: {
  result: ScreenResult; c: SpreadCandidate; th: CleanTheme; rsi14: number | null; oiBelowFloor: boolean;
  alloc: AllocResult | null; score: number | null; band: ScoreBand | null; scoreOpen: boolean; onScore: () => void;
  expanded: boolean;
}) {
  const price = result.price;
  const beDist = breakevenDistancePct({ price, breakeven: c.breakeven, strike: c.shortStrike, creditPerShare: c.credit });
  const credit = (c.totalCredit ?? c.credit) * 100;
  const hardFails = result.failReasons.filter(r => !CAPACITY.test(r));
  const funding = c.cspFunding;
  const unfunded = funding?.status === 'not_fundable' || (c.capitalBlocked && !funding);
  const availableText = funding?.usableCash != null ? `${fmtMoney0(Math.max(0, funding.usableCash))} available` : summarizeFailReason(c.capitalWarning ?? 'Not funded');
  return (
    <div data-testid="clean-csp-line" className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3">
      <span className="w-16 shrink-0 text-sm font-bold">
        <span className={th.text}>{result.symbol}</span>
        {price != null && <span className={`block text-xs font-normal ${th.label}`}>${price.toFixed(2)}</span>}
      </span>
      {score != null && band ? (
        <button type="button" data-testid="clean-score" aria-expanded={scoreOpen}
          aria-label={`Score ${score}, ${scoreOpen ? 'hide' : 'show'} scoring details`}
          onClick={(e) => { e.stopPropagation(); onScore(); }}
          className={`min-h-[44px] rounded-md border px-3 text-[15px] font-bold ${SCORE_BAND_CLASS[band]}`}>
          Score {score} <span className="text-[11px] font-normal text-slate-400">{scoreOpen ? '▴' : '▾'}</span>
        </button>
      ) : <span className={`text-xs ${th.textFaint}`}>No score</span>}
      <span data-testid="contract-box" className="flex items-center gap-2 rounded-md border border-slate-400/60 px-3 py-1.5 text-sm font-bold">
        <span className={th.text}>Put {c.shortStrike}</span><span className="text-slate-500">·</span>
        <span className={th.text}>{c.expiration}</span><span className="text-slate-500">·</span>
        <span className={th.text}>{c.dte}d</span>
      </span>
      <span className="flex-1" />
      <Stat label="Credit"><b className="font-extrabold text-emerald-400">{fmtMoney0(credit)}</b></Stat>
      <Stat label="Yield"><b className={tone(yieldTone(c.annualizedRoc))}>{c.annualizedRoc != null ? fmtPct0(c.annualizedRoc) : '—'}</b></Stat>
      <Stat label="POP"><b className={tone(popTone(c.pop))}>{c.pop != null ? fmtPct0(c.pop) : '—'}</b></Stat>
      <Stat label="BE dist"><b className={tone(distanceTone(beDist))}>{beDist != null ? `${beDist.toFixed(1)}%` : '—'}</b></Stat>
      <Stat label={`Alloc · ${result.symbol}`}>
        <b className={alloc ? tone(allocTone(alloc.afterPct)) : th.textFaint} title={alloc ? undefined : 'Allocation needs your account balance and positions'}>
          {alloc ? `${fmtPct0(alloc.currentPct)} → ${fmtPct0(alloc.afterPct)}` : '—'}
        </b>
      </Stat>
      <Stat label="OI">
        {oiBelowFloor
          ? <span className="rounded-full border border-amber-600 bg-amber-950 px-2 py-px text-xs font-bold text-amber-200" title="Below your preferred open interest (advisory)">{c.shortOI}</span>
          : <b className={th.text}>{c.shortOI ?? '—'}</b>}
      </Stat>
      <Stat label="RSI"><b className={th.text}>{rsi14 != null ? rsi14.toFixed(0) : '—'}</b></Stat>
      <Stat label="Cash needed"><b className={th.text}>{c.requiredCash != null ? fmtMoney0(c.requiredCash) : '—'}</b></Stat>
      {unfunded && <span data-testid="clean-unfunded" className="rounded-full border border-red-700 bg-red-950 px-3 py-1.5 text-xs font-bold text-red-200">{availableText}</span>}
      {!result.qualified && hardFails.length > 0 && (
        <span data-testid="clean-fails" title={hardFails.join('\n')} className="rounded-full border border-red-700 bg-red-950 px-3 py-1.5 text-xs font-bold text-red-200">
          Fails: {summarizeFailReason(hardFails[0])}
        </span>
      )}
      <span aria-hidden="true" className={`w-7 text-center text-sm ${th.textFaint}`}>{expanded ? '▲' : '▼'}</span>
    </div>
  );
}

function Cell({ label, children, toneClass }: { label: string; children: ReactNode; toneClass?: string }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wider text-slate-400">{label}</div>
      <div className={`mt-0.5 text-sm font-bold ${toneClass ?? ''}`}>{children}</div>
    </div>
  );
}

export function CleanCspDetails({
  result, c, th, bidAskMax, ivrMin, alloc, actions,
}: {
  result: ScreenResult; c: SpreadCandidate; th: CleanTheme; bidAskMax: number; ivrMin: number; alloc: AllocResult | null; actions: ReactNode;
}) {
  const price = result.price;
  const otm = otmPct(price, c.shortStrike);
  const ret = calculateCspReturnThisCycle(c);
  const meta = ret.available ? CSP_RETURN_STATUS_META[ret.status!] : null;
  const spreadOk = c.shortBid != null && c.shortAsk != null ? (c.shortAsk - c.shortBid) <= bidAskMax : null;
  const em = c.expectedMove;
  return (
    <div data-testid="clean-csp-details" className={`border-t ${th.border}`} onClick={e => e.stopPropagation()}>
      <div className="grid grid-cols-2 gap-x-6 gap-y-4 p-4 md:grid-cols-4">
        <Cell label="Bid / Ask" toneClass={spreadOk == null ? '' : spreadOk ? 'text-emerald-400' : 'text-red-400'}>
          {c.shortBid != null && c.shortAsk != null ? `$${c.shortBid.toFixed(2)} / $${c.shortAsk.toFixed(2)}` : '—'}
        </Cell>
        <Cell label="Delta">{c.shortDelta.toFixed(2)}</Cell>
        <Cell label="IV rank" toneClass={result.ivr == null ? '' : result.ivr >= ivrMin ? 'text-emerald-400' : 'text-red-400'}>
          {result.ivr != null ? `${result.ivr.toFixed(1)}%` : 'N/A'}
        </Cell>
        <Cell label="Breakeven">{c.breakeven != null ? `$${c.breakeven.toFixed(2)}` : '—'}</Cell>
        <Cell label="Expiration IV">{result.ivx != null ? `${result.ivx.toFixed(1)}%` : '—'}</Cell>
        <Cell label="Expected move">
          {em != null ? <>±${em.toFixed(2)}{price ? <span className="font-normal text-slate-400"> (±{((em / price) * 100).toFixed(1)}%)</span> : null}</> : '—'}
        </Cell>
        <Cell label="Return by expiration">{ret.available ? `${ret.cycleReturnPct!.toFixed(2)}%` : '—'}</Cell>
        <Cell label="OTM" toneClass={tone(distanceTone(otm))}>{otm != null ? `${otm.toFixed(1)}%` : '—'}</Cell>
        <Cell label="ROC">{c.roc.toFixed(1)}%</Cell>
        <Cell label="vs 30-day" toneClass={meta?.className}>
          {ret.available && meta ? <>{ret.thirtyDayEquivalentPct!.toFixed(2)}% <span className="font-normal">{meta.label}</span></> : '—'}
        </Cell>
      </div>
      {alloc && (
        <div data-testid="clean-alloc-breakdown" className={`grid grid-cols-3 gap-4 border-t ${th.border} p-4`}>
          <Cell label="Today">{fmtMoney0(alloc.currentDollars)} · {fmtPct0(alloc.currentPct)}</Cell>
          <Cell label="This trade adds">+{fmtMoney0(alloc.addDollars)} · +{fmtPct0((alloc.addDollars / alloc.netLiq) * 100)}</Cell>
          <Cell label={`After (of ${fmtMoney0(alloc.netLiq)})`} toneClass={tone(allocTone(alloc.afterPct))}>{fmtMoney0(alloc.afterDollars)} · {fmtPct0(alloc.afterPct)}</Cell>
        </div>
      )}
      <div className={`flex flex-wrap gap-2 border-t ${th.border} p-3`}>{actions}</div>
    </div>
  );
}
