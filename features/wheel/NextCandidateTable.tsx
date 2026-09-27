// features/wheel/NextCandidateTable.tsx
'use client';

// WHEEL-SYSTEM-0002 (W2) -- the "Next candidate" table on the Wheel Plan tab: which name on the list to wheel next, with the
// Checks behind each verdict. Display only: nothing here places an order or changes a recommendation.
//
// The verdict column always shows the plan's own opinion (Candidate, Wait, Not yet, Skip). A contract count the trader typed
// shows in the Contracts column with a small "Yours" tag and never replaces the verdict.

import {
  creditPerContractCents,
  formatCents,
  formatPctTenths,
  formatRocBps,
  percentBelowPriceTenths,
  type PlanParams,
} from '@/lib/wheel/capitalPlan';
import { GROUP_LABEL, shortDate, type CandidateGroup, type Chip, type RankedCandidate } from '@/lib/wheel/candidateRank';
import type { PlanPut } from '@/lib/wheel/planPut';

export interface CandidateRowView {
  ranked: RankedCandidate;
  quote: number | null;
  /** Contracts the plan would place on its own (0 when it does not fit). */
  autoContracts: number;
  /** The trader's own count, when typed. */
  typedContracts: number | null;
}

export type ShorterState =
  | { status: 'loading' }
  | { status: 'done'; put: PlanPut | null; message: string | null; quote: number | null };

interface Props {
  rows: CandidateRowView[];
  leveraged: string[];
  params: PlanParams;
  shorter: Record<string, ShorterState>;
  onFindShorter: (symbol: string) => void;
  /** True when IVR and earnings dates could not be loaded for at least one symbol. */
  dataProblem: boolean;
  dataLoading: boolean;
  onRetryData: () => void;
  /** Outside regular market hours: quotes can be stale or wide, so the bid-ask gap is not checked. */
  marketClosed: boolean;
}

const CHIP_CLASS: Record<Chip['tone'], string> = {
  ok: 'border-emerald-500/30 text-emerald-300',
  warn: 'border-amber-500/40 text-amber-300',
  bad: 'border-red-500/40 text-red-300',
  note: 'border-white/15 text-white/55',
};

const VERDICT_CLASS: Record<string, string> = {
  candidate: 'border-emerald-500/40 text-emerald-300',
  wait: 'border-amber-500/40 text-amber-300',
  'not-yet': 'border-white/15 text-white/60',
  skip: 'border-white/15 text-white/60',
};
const VERDICT_LABEL: Record<string, string> = { candidate: 'Candidate', wait: 'Wait', 'not-yet': 'Not yet', skip: 'Skip' };

const GROUP_ORDER: CandidateGroup[] = ['candidate', 'candidate-flagged', 'wait', 'not-yet', 'skip'];

function ShorterLine({ row, params, state, onFind }: { row: CandidateRowView; params: PlanParams; state: ShorterState | undefined; onFind: () => void }) {
  const earnings = row.ranked.input.earnings;
  if (earnings.kind !== 'inside') return null;
  const put = state?.status === 'done' ? state.put : null;
  const otm = put && state?.status === 'done' ? percentBelowPriceTenths(state.quote, put.leg.strikePrice) : null;
  const credit = put ? creditPerContractCents(put.leg.bid) : null;
  return (
    <tr data-testid={`earnings-note-${row.ranked.input.symbol}`}>
      <td colSpan={9} className="px-3 pb-3">
        <div className="flex flex-wrap items-center gap-3 rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2 text-[11px]">
          <span>
            <b>{row.ranked.input.symbol} reports {shortDate(earnings.date)}, before this put expires {shortDate(row.ranked.input.put.expirationDate)}.</b> The price can gap.
          </span>
          <button
            type="button"
            onClick={onFind}
            disabled={state?.status === 'loading'}
            className="rounded border border-teal-400/40 px-2 py-1 text-[11px] text-teal-300 hover:bg-teal-400/10 disabled:opacity-50"
          >
            {state?.status === 'loading' ? 'Looking…' : 'Find a shorter expiry'}
          </button>
          {state?.status === 'done' && put && (
            <span className="tabular-nums" data-testid={`shorter-result-${row.ranked.input.symbol}`}>
              <b>{put.leg.strikePrice}P · {shortDate(put.expirationDate)} · {put.dte} days · Δ{(put.deltaBps / 10_000).toFixed(2)}</b>
              {otm != null && <> · {formatPctTenths(otm)} OTM</>}
              {credit != null && <> · <b>{formatCents(credit)}</b> credit</>} · <b>{formatRocBps(put.rocBps)}</b> Annual ROC
            </span>
          )}
          {state?.status === 'done' && !put && <span className="text-white/60" data-testid={`shorter-none-${row.ranked.input.symbol}`}>{state.message}</span>}
          <span className="text-white/35">Shorter than your {params.dteMin} to {params.dteMax} day window, ending before {shortDate(earnings.date)}.</span>
        </div>
      </td>
    </tr>
  );
}

export default function NextCandidateTable({ rows, leveraged, params, shorter, onFindShorter, dataProblem, dataLoading, onRetryData, marketClosed }: Props) {
  const byGroup = new Map<CandidateGroup, CandidateRowView[]>();
  for (const row of rows) byGroup.set(row.ranked.group, [...(byGroup.get(row.ranked.group) ?? []), row]);

  if (rows.length === 0 && leveraged.length === 0) {
    return <p className="text-sm text-white/40" data-testid="next-candidate-empty">Once a put is found for a name on your list, it is ranked here with the checks behind its verdict.</p>;
  }

  return (
    <div className="space-y-2" data-testid="next-candidate-table">
      {marketClosed && (
        <p role="status" className="rounded border border-white/15 bg-white/[0.03] px-3 py-2 text-[11px] text-white/60" data-testid="market-closed-note">
          The market is closed, so option quotes can be stale or wide. Bid-ask is not checked until it opens, and Credit and Annual ROC use the last quotes and will change. Open interest is still checked.
        </p>
      )}
      {dataProblem && (
        <div role="alert" className="flex items-center gap-3 rounded border border-amber-400/40 bg-amber-400/5 p-3 text-xs text-amber-200">
          <span>IVR and earnings dates could not be loaded for some symbols. Those checks show "unavailable" or "unverified", never a pass.</span>
          <button type="button" onClick={onRetryData} className="rounded border border-amber-400/40 px-2 py-1 text-[11px] hover:bg-amber-400/10">Retry</button>
        </div>
      )}
      {dataLoading && <p className="text-[11px] text-white/40">Loading IVR, earnings dates and RSI…</p>}
      <div className="overflow-x-auto rounded-lg border border-white/10">
        <table className="w-full min-w-[1180px] text-xs">
          <thead>
            <tr className="bg-white/5 text-[10px] uppercase tracking-wider text-white/40">
              <th className="px-3 py-2 text-left">Stock</th>
              <th className="px-3 py-2 text-left">Verdict</th>
              <th className="px-3 py-2 text-left">Checks</th>
              <th className="px-3 py-2 text-left">Put</th>
              <th className="px-3 py-2 text-right">Credit</th>
              <th className="px-3 py-2 text-right">Contracts</th>
              <th className="px-3 py-2 text-right">Req. Cash</th>
              <th className="px-3 py-2 text-right">Annual ROC</th>
              <th className="px-3 py-2 text-left">Note</th>
            </tr>
          </thead>
          <tbody>
            {GROUP_ORDER.map((group) => {
              const list = byGroup.get(group) ?? [];
              const showLeveraged = group === 'skip' && leveraged.length > 0;
              if (list.length === 0 && !showLeveraged) return null;
              return (
                <GroupRows key={group} group={group} list={list} leveraged={showLeveraged ? leveraged : []} params={params} shorter={shorter} onFindShorter={onFindShorter} />
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="text-[10px] text-white/40">
        The Checks decide whether a name is a candidate; credit only decides which put, and how candidates rank. Annual ROC is the credit at the bid over the cash tied up, scaled to a year (simple, not compounded), before fees.
        A stock with earnings inside the expiry ranks after clean candidates and its return includes earnings risk. Unavailable data never counts as a pass.
      </p>
    </div>
  );
}

function GroupRows({ group, list, leveraged, params, shorter, onFindShorter }: {
  group: CandidateGroup;
  list: CandidateRowView[];
  leveraged: string[];
  params: PlanParams;
  shorter: Record<string, ShorterState>;
  onFindShorter: (symbol: string) => void;
}) {
  return (
    <>
      <tr>
        <td colSpan={9} className="bg-black/40 px-3 py-1.5 text-[10px] uppercase tracking-wider text-white/40">{GROUP_LABEL[group]}</td>
      </tr>
      {list.flatMap((row) => {
        const { ranked } = row;
        const { input, verdict } = ranked;
        const credit = creditPerContractCents(input.put.leg.bid);
        const otm = percentBelowPriceTenths(row.quote, input.put.leg.strikePrice);
        const symbol = input.symbol;
        const note =
          verdict.kind === 'candidate'
            ? ranked.includesEarningsRisk
              ? 'Includes earnings risk.'
              : ''
            : verdict.reason;
        return [
          <tr key={symbol} className="border-t border-white/5 align-top" data-testid={`candidate-row-${symbol}`}>
            <td className="px-3 py-2">
              <b>{symbol}</b>
              <div className="whitespace-nowrap text-[10px] text-white/40">{input.instrument === 'etf' ? 'ETF / index' : 'Stock'}</div>
            </td>
            <td className="px-3 py-2">
              <span className={`whitespace-nowrap rounded-full border px-2 py-0.5 text-[10px] font-bold ${VERDICT_CLASS[verdict.kind]}`}>{VERDICT_LABEL[verdict.kind]}</span>
            </td>
            <td className="min-w-[280px] max-w-[420px] px-3 py-2">
              <div className="flex flex-wrap gap-1">
                {ranked.chips.map((chip) => (
                  <span key={chip.id} className={`rounded border px-1.5 py-0.5 text-[10px] ${CHIP_CLASS[chip.tone]}`}>{chip.text}</span>
                ))}
              </div>
            </td>
            <td className="whitespace-nowrap px-3 py-2" title={`Expires ${input.put.expirationDate}`}>
              {input.put.leg.strikePrice}P · {shortDate(input.put.expirationDate)} · Δ{(input.put.deltaBps / 10_000).toFixed(2)}
              <div className="text-[10px] text-white/40">{otm == null ? '' : `${formatPctTenths(otm)} OTM`}</div>
            </td>
            <td className="px-3 py-2 text-right">
              {credit == null ? '—' : formatCents(credit)}
              {credit != null && <div className="text-[10px] text-white/40">${(credit / 10_000).toFixed(2)} a share</div>}
            </td>
            <td className="px-3 py-2 text-right">
              {row.typedContracts != null ? (
                <>
                  <b>{row.typedContracts}</b>{' '}
                  <span className="rounded-full border border-amber-500/40 px-1.5 py-0.5 text-[10px] font-bold text-amber-300">Yours</span>
                  <div className="text-[10px] text-white/40">auto: {row.autoContracts}</div>
                </>
              ) : (
                <span className="text-white/50">auto: {row.autoContracts}</span>
              )}
            </td>
            <td className="px-3 py-2 text-right">{formatCents(input.cashCents)}</td>
            <td className="px-3 py-2 text-right">
              <b>{formatRocBps(ranked.rocBps)}</b>
              {ranked.includesEarningsRisk && <div className="text-[10px] text-white/40">includes earnings risk</div>}
            </td>
            <td className="px-3 py-2 text-[11px] text-white/55">{note}</td>
          </tr>,
          <ShorterLine key={`${symbol}-earnings`} row={row} params={params} state={shorter[symbol]} onFind={() => onFindShorter(symbol)} />,
        ];
      })}
      {leveraged.map((symbol) => (
        <tr key={`lev-${symbol}`} className="border-t border-white/5" data-testid={`candidate-row-${symbol}`}>
          <td className="px-3 py-2"><b>{symbol}</b></td>
          <td className="px-3 py-2"><span className={`rounded-full border px-2 py-0.5 text-[10px] font-bold ${VERDICT_CLASS.skip}`}>Skip</span></td>
          <td colSpan={7} className="px-3 py-2 text-amber-300">Leveraged or inverse ETF: not a wheel candidate. Small put spreads only.</td>
        </tr>
      ))}
    </>
  );
}
