// features/screener/components/CcBasisLine.tsx
//
// CC-PMCC-GUIDANCE-0001 R3 -- every covered-call decision shows the cost basis it is judged against and where it came from.
// No basis means no call. There is no way to turn the cost-basis floor off.

import { ccFloorExplanation } from '@/lib/scans/ccBrief';

export type CcBasisInfo = { basis: number | null; source: 'typed' | 'adjusted' | 'broker' | null } | null | undefined;

const SOURCE: Record<'typed' | 'adjusted' | 'broker', string> = { typed: 'typed by you', adjusted: 'after put premium', broker: 'broker' };
const usd = (n: number) => `$${n.toFixed(2)}`;

export function ccBasisText(info: CcBasisInfo): string {
  if (!info || info.basis === null) return 'Cost basis unknown. No call without one.';
  return `Cost basis ${usd(info.basis)}${info.source ? ` (${SOURCE[info.source]})` : ''}`;
}

export function CcBasisLine({ basis, floor, price }: { basis: CcBasisInfo; floor?: number | null; price?: number | null }) {
  const why = floor !== undefined && price !== undefined ? ccFloorExplanation({ floor, price }) : null;
  return (
    <div data-testid="cc-basis-line" className="text-[13px] text-slate-300">
      <p>{ccBasisText(basis)}</p>
      {why && <p className="text-amber-300">{why}</p>}
    </div>
  );
}
