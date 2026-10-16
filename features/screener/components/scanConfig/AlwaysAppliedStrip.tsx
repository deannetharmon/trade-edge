// features/screener/components/scanConfig/AlwaysAppliedStrip.tsx
//
// SCAN-MODAL-UX-0001: the fixed rules as one read-only strip. Every rule keeps its name on screen; the full
// explanation (the text each rule always had) is in its tooltip.

import type { ReactNode } from 'react';
import type { ScanModalTheme } from '../ScanModalShell';
import { InfoTip } from './InfoTip';

export interface StripItem {
  id: string;
  label: string;
  /** Screen-reader tag text, for example "GATE · FIXED". */
  tag: string;
  tip: ReactNode;
  /** Registry data attribute, for example { 'data-cc-criterion': 'earnings' }. */
  attr: Record<string, string>;
  /** Draws the chip with an amber border: a rule that silently removes symbols. */
  emphasis?: boolean;
}

export function AlwaysAppliedStrip({ th, items }: { th: ScanModalTheme; items: StripItem[] }) {
  return (
    <section aria-label="Always applied" className={`rounded-lg border ${th.border} bg-neutral-900/50 px-3 py-2`}>
      <p className="text-[10px] font-bold uppercase tracking-wider text-neutral-300">
        Always applied <span className="font-normal normal-case tracking-normal text-neutral-500">Fixed, cannot be changed</span>
      </p>
      <ul className="mt-1.5 flex flex-wrap gap-1.5">
        {items.map((item, index) => (
          <li
            key={item.id}
            {...item.attr}
            className={`inline-flex items-center rounded-md border bg-neutral-900 py-0.5 pl-2 pr-1 text-[11px] text-neutral-100 ${item.emphasis ? 'border-amber-500/50' : th.border}`}
          >
            {item.label}
            <span className="sr-only">{item.tag}</span>
            <InfoTip placement="up" align={index >= 2 ? 'right' : 'left'}>{item.tip}</InfoTip>
          </li>
        ))}
      </ul>
    </section>
  );
}
