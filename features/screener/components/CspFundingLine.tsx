// features/screener/components/CspFundingLine.tsx

// CSP-CAP-BASIS-0001A -- the funding line on a CSP result card. Same basis and figures as the order dialog's assignment
// cash panel (ASSIGN-CASH-0001). Display only: it never changes qualification, score or ranking. Figures are the
// snapshot taken when the scan started, so the time is always shown; the order dialog re-reads everything and wins.

import { fundingMoney, type CspCardFunding } from '@/lib/scans/cspCardFunding';

const clock = (ms: number) => new Date(ms).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });

export function CspFundingLine({ funding }: { funding: CspCardFunding }) {
  const asOf = `as of ${clock(funding.asOfMs)}`;
  const advisory = funding.buyingPowerAdvisory
    ? <p className="text-[9px] text-amber-400/80 pt-1" data-testid="csp-funding-advisory">{funding.buyingPowerAdvisory}</p>
    : null;

  if (funding.status === 'cannot_verify') {
    return (
      <div data-testid="csp-funding" data-status="cannot_verify">
        <p className="text-[9px] text-amber-400 font-medium pt-1">
          Cannot verify funding{funding.reasons.length > 0 ? `: ${funding.reasons.join('; ')}` : ''}. The order dialog checks again before you place anything. ({asOf})
        </p>
        {advisory}
      </div>
    );
  }

  const after = funding.assignmentCashAfter as number;
  const usable = funding.usableCash as number;
  const pct = funding.utilization == null ? null : Math.round(funding.utilization * 1000) / 10;
  const limit = funding.manualLimitApplied ? ' (scan capital limit)' : '';

  if (funding.status === 'not_fundable') {
    return (
      <div data-testid="csp-funding" data-status="not_fundable">
        <p className="text-[9px] text-red-400 font-medium pt-1">
          <span className="inline-block rounded border border-red-500/60 px-1 mr-1 text-[8px] uppercase tracking-wide">Not fundable now</span>
          Shortfall {fundingMoney(-(funding.surplusShortfall as number))}: assignment cash {fundingMoney(after)} against usable cash {fundingMoney(usable)}{limit}
          {pct != null ? ` (${pct}%)` : ''} · {asOf}
        </p>
        {advisory}
      </div>
    );
  }

  return (
    <div data-testid="csp-funding" data-status="funded">
      <p className="text-[9px] text-slate-400 pt-1">
        Funding: assignment cash {fundingMoney(after)} of {fundingMoney(usable)} usable{limit}{pct != null ? ` (${pct}%)` : ''} · {asOf}
      </p>
      {advisory}
    </div>
  );
}
