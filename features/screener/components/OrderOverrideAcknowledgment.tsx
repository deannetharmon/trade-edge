// features/screener/components/OrderOverrideAcknowledgment.tsx
//
// QUAL-STATES-0001 phase 2: inside the order window, a trade that is not Qualified lists every
// failed rule and warning with its real numbers and must be acknowledged before the order can go
// through. It lives in the window (not a pop-up dialog) so it cannot be clicked through by reflex.

'use client';

import type { CheckResult } from '@/lib/scans/types';
import type { QualificationDerivation } from '@/lib/scans/qualificationState';
import { describeGate } from './QualificationBadge';

type Checks = Partial<Record<string, CheckResult | undefined>>;

/** True while the order must stay locked: the trade is not Qualified and has not been acknowledged. */
export function qualificationGateBlocking(derivation: QualificationDerivation | null | undefined, acknowledged: boolean): boolean {
  return derivation != null && derivation.state !== 'qualified' && !acknowledged;
}

/** One line per failed or warned gate: what it is, and the check's own explanation. */
export function reasonText(key: string, checks: Checks): string {
  const check = checks[key];
  return check ? `${describeGate(key, check)}: ${check.reason}` : describeGate(key, check);
}

export interface OrderOverrideAcknowledgmentProps {
  derivation: QualificationDerivation;
  checks: Checks;
  acknowledged: boolean;
  onChange: (acknowledged: boolean) => void;
}

export function OrderOverrideAcknowledgment({ derivation, checks, acknowledged, onChange }: OrderOverrideAcknowledgmentProps) {
  if (derivation.state === 'qualified') return null;
  const disqualified = derivation.state === 'disqualified';
  return (
    <div
      role="group"
      aria-label={disqualified ? 'Order overrides scan rules' : 'Order has scan warnings'}
      data-testid="order-override-ack"
      data-state={derivation.state}
      className={`mb-4 rounded-lg border p-3 ${disqualified ? 'border-red-600 bg-red-500/10' : 'border-amber-500 bg-amber-500/10'}`}
    >
      <p className={`text-[10px] font-bold tracking-widest ${disqualified ? 'text-red-400' : 'text-amber-400'}`}>
        {disqualified ? 'THIS TRADE OVERRIDES THE SCAN RULES' : 'THIS TRADE HAS WARNINGS'}
      </p>
      <ul className="mt-2 space-y-1 text-[11px]">
        {derivation.failing.map(key => <li key={`f-${key}`} className="text-red-300">✕ {reasonText(key, checks)}</li>)}
        {derivation.warning.map(key => <li key={`w-${key}`} className="text-amber-300">⚠ {reasonText(key, checks)}</li>)}
      </ul>
      <label htmlFor="order-override-ack" className="mt-3 flex items-start gap-2 text-[11px] cursor-pointer">
        <input id="order-override-ack" type="checkbox" checked={acknowledged} onChange={event => onChange(event.target.checked)} className="mt-0.5" />
        <span>I understand and want to place this order anyway.</span>
      </label>
    </div>
  );
}
