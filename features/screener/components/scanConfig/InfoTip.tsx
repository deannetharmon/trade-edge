'use client';

// features/screener/components/scanConfig/InfoTip.tsx
//
// SCAN-MODAL-UX-0001: the "i" beside a control or fixed rule. The full explanation stays in the page (it is
// what the old always-visible help text said) and shows on hover, keyboard focus, or tap.

import { useId, useState, type ReactNode } from 'react';

export function InfoTip({ children, placement = 'down', align = 'left' }: {
  children: ReactNode;
  placement?: 'up' | 'down';
  align?: 'left' | 'right';
}) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const place = `${placement === 'up' ? 'bottom-full mb-1' : 'top-full mt-1'} ${align === 'right' ? 'right-0' : 'left-0'}`;
  return (
    <span className="group relative ml-1 inline-flex align-middle">
      <button
        type="button"
        aria-label="More information"
        aria-describedby={id}
        aria-expanded={open}
        onClick={() => setOpen(o => !o)}
        onBlur={() => setOpen(false)}
        className="h-4 w-4 rounded-full border border-neutral-600 text-[9px] font-bold italic leading-none text-neutral-400 hover:text-neutral-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-400"
      >
        i
      </button>
      <span
        role="tooltip"
        id={id}
        className={`${open ? 'block' : 'hidden group-hover:block group-focus-within:block'} absolute z-20 w-64 rounded-md border border-neutral-600 bg-neutral-950 p-2 text-left text-[11px] font-normal normal-case leading-snug tracking-normal text-neutral-200 shadow-xl ${place}`}
      >
        {children}
      </span>
    </span>
  );
}

/** The tooltip body for a registry criterion: its full name and unit, then what the engine does with it. */
export function CriterionTipBody({ label, unit, hint }: { label: string; unit?: string; hint: string }) {
  return (
    <>
      <p className="font-bold text-neutral-100">{label}{unit ? <span className="font-normal text-neutral-400"> · {unit}</span> : null}</p>
      <p className="mt-1">{hint}</p>
    </>
  );
}
