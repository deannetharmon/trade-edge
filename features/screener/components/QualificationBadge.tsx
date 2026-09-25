// features/screener/components/QualificationBadge.tsx
//
// QUAL-STATES-0001 phase 1: the state badge on a spread result card. The state leads the row
// (decision weight), the named reason follows, and the score becomes supporting detail.

'use client';

import type { CheckResult } from '@/lib/scans/types';
import type { QualificationDerivation } from '@/lib/scans/qualificationState';
import { EARNINGS_MIN_DAYS_AFTER_EXPIRY } from '@/lib/scans/earningsPrecheck';

/** Short, human name of the gate check that failed or warned, with its real value. */
export function describeGate(key: string, check: CheckResult | undefined): string {
  if (!check) return `${key} unavailable`;
  switch (key) {
    case 'ivr': return check.status === 'warn' ? 'IVR unavailable' : `IVR ${check.value} below the floor`;
    case 'earnings': return check.reason.includes('buffer') ? `earnings inside the ${EARNINGS_MIN_DAYS_AFTER_EXPIRY}-day buffer` : 'earnings before expiry';
    case 'oi': return `low OI ${check.value}`;
    case 'csp-market':
    case 'csp-mode':
    case 'csp-delta': return check.value;
    case 'roc': return `ROC ${check.value} below the minimum`;
    default: return `${key}: ${check.reason}`;
  }
}

const STATE_STYLE = {
  qualified: 'bg-emerald-500/15 border-emerald-500 text-emerald-400',
  caution: 'bg-amber-500/15 border-amber-500 text-amber-400',
  disqualified: 'bg-red-500/15 border-red-500 text-red-400',
} as const;

export function qualificationBadgeText(derivation: QualificationDerivation, checks: Partial<Record<string, CheckResult | undefined>>): string {
  if (derivation.state === 'qualified') return 'Qualified';
  const keys = derivation.state === 'disqualified' ? derivation.failing : derivation.warning;
  const more = keys.length > 1 ? ` +${keys.length - 1} more` : '';
  const label = derivation.state === 'disqualified' ? 'Disqualified' : 'Caution';
  return `${label}: ${describeGate(keys[0], checks[keys[0]])}${more}`;
}

export interface QualificationBadgeProps {
  derivation: QualificationDerivation;
  checks: Partial<Record<string, CheckResult | undefined>>;
}

export function QualificationBadge({ derivation, checks }: QualificationBadgeProps) {
  const keys = [...derivation.failing, ...derivation.warning];
  const title = keys.length > 0
    ? keys.map(key => `${describeGate(key, checks[key])}: ${checks[key]?.reason ?? 'no result'}`).join('\n')
    : 'Every gate check passed.';
  return (
    <span
      data-testid="qualification-badge"
      data-state={derivation.state}
      title={title}
      className={`text-[9px] px-2 py-0.5 border rounded shrink-0 font-bold ${STATE_STYLE[derivation.state]}`}
    >
      {qualificationBadgeText(derivation, checks)}
    </span>
  );
}
