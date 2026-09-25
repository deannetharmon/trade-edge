// features/screener/components/__tests__/QualificationBadge.test.tsx

import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { describeGate, qualificationBadgeText, QualificationBadge } from '../QualificationBadge';
import { AccountingSummaryBar } from '../AccountingSummaryBar';
import { QualificationCounts } from '../ScanHeaderParts';
import { countQualificationStates, deriveQualificationState, deriveSpreadQualification, RANKED_SPREAD_GATE_KEYS } from '@/lib/scans/qualificationState';
import { createScanSession } from '@/lib/screener/scanSession';
import type { CheckResult, ScreenResult } from '@/lib/scans/types';

const ck = (status: CheckResult['status'], value = 'v', reason = 'r'): CheckResult => ({ status, value, reason });
const allPass = { ivr: ck('pass'), earnings: ck('pass'), oi: ck('pass'), roc: ck('pass') };

function result(checks: Record<string, CheckResult>, extra: Partial<ScreenResult> = {}): ScreenResult {
  return {
    symbol: 'AMD', strategy: 'BPS', price: 100, ivr: 30, qualified: false, failReasons: [],
    bestCandidate: { strategy: 'BPS' } as never, checks: checks as never, ...extra,
  } as ScreenResult;
}

describe('QUAL-STATES-0001 phase 1: state badge', () => {
  it('describes each gate with its real value', () => {
    expect(describeGate('ivr', ck('fail', '3.7%'))).toBe('IVR 3.7% below the floor');
    expect(describeGate('oi', ck('warn', '208/371'))).toBe('low OI 208/371');
    expect(describeGate('roc', ck('fail', '6%'))).toBe('ROC 6% below the minimum');
    expect(describeGate('earnings', ck('fail', '34d', 'Earnings 6d after expiry, inside the 10-day buffer'))).toBe('earnings inside the 10-day buffer');
    expect(describeGate('earnings', ck('fail', '20d', "Earnings on or before this trade's expiry"))).toBe('earnings before expiry');
  });

  it('qualified, caution and disqualified read differently, with "+N more" when several apply', () => {
    const q = deriveQualificationState(allPass, RANKED_SPREAD_GATE_KEYS);
    expect(qualificationBadgeText(q, allPass)).toBe('Qualified');
    const cChecks = { ...allPass, oi: ck('warn', '208/371') };
    expect(qualificationBadgeText(deriveQualificationState(cChecks, RANKED_SPREAD_GATE_KEYS), cChecks)).toBe('Caution: low OI 208/371');
    const dChecks = { ...allPass, ivr: ck('fail', '3.7%'), earnings: ck('fail', '34d', 'inside the 10-day buffer') };
    expect(qualificationBadgeText(deriveQualificationState(dChecks, RANKED_SPREAD_GATE_KEYS), dChecks)).toBe('Disqualified: IVR 3.7% below the floor +1 more');
  });

  it('renders the state as a data attribute and lists every reason in its tooltip', () => {
    const dChecks = { ...allPass, ivr: ck('fail', '3.7%', 'Below 30% minimum'), oi: ck('warn', '208/371', 'below the 500 target') };
    render(<QualificationBadge derivation={deriveQualificationState(dChecks, RANKED_SPREAD_GATE_KEYS)} checks={dChecks} />);
    const badge = screen.getByTestId('qualification-badge');
    expect(badge).toHaveAttribute('data-state', 'disqualified');
    expect(badge.getAttribute('title')).toContain('Below 30% minimum');
    expect(badge.getAttribute('title')).toContain('below the 500 target');
  });

  it('deriveSpreadQualification handles spreads only; other strategies keep their own model', () => {
    expect(deriveSpreadQualification(result(allPass))?.state).toBe('qualified');
    expect(deriveSpreadQualification(result(allPass, { strategy: 'CSP', bestCandidate: { strategy: 'CSP' } as never }))).toBeNull();
  });

  it('counts by state from each row\'s checks, ignoring a stale qualified flag; non-spread rows use their flag', () => {
    const rows = [
      result(allPass, { qualified: false }),
      result({ ...allPass, oi: ck('warn') }),
      result({ ...allPass, ivr: ck('fail') }),
      result(allPass, { strategy: 'CSP', bestCandidate: { strategy: 'CSP' } as never, qualified: true }),
      result(allPass, { strategy: 'CC', bestCandidate: { strategy: 'CC' } as never, qualified: false }),
    ];
    expect(countQualificationStates(rows)).toEqual({ qualified: 2, caution: 1, disqualified: 2 });
  });
});

describe('QUAL-STATES-0001 phase 1: counts', () => {
  it('QualificationCounts shows a caution count only when given one', () => {
    const { rerender } = render(<div><QualificationCounts qualified={3} disqualified={5} /></div>);
    expect(screen.queryByText(/CAUTION/)).not.toBeInTheDocument();
    rerender(<div><QualificationCounts qualified={3} caution={2} disqualified={5} /></div>);
    expect(screen.getByText('2 CAUTION')).toBeInTheDocument();
  });

  it('the accounting strip shows three states when given stateCounts, and two otherwise', () => {
    const session = createScanSession({ mode: 'rank', requestedStrategy: 'spreads', scope: { universeSymbols: ['AMD'], eligibleSymbols: ['AMD'] } });
    const { rerender } = render(<AccountingSummaryBar session={session} />);
    expect(screen.queryByText(/caution/)).not.toBeInTheDocument();
    rerender(<AccountingSummaryBar session={session} stateCounts={{ qualified: 4, caution: 7, disqualified: 9 }} />);
    expect(screen.getByText('4 qualified')).toBeInTheDocument();
    expect(screen.getByText('7 caution')).toBeInTheDocument();
    expect(screen.getByText('9 disqualified')).toBeInTheDocument();
  });
});
