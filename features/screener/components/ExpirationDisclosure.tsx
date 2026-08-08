import { useId, type ReactNode } from 'react';
import { useDisclosureA11y } from '../lib/useDisclosureA11y';

export function ExpirationDisclosure({ expiration, dte, candidateCount, kind, defaultOpen, borderClassName, children }: {
  expiration: string;
  dte: number | null;
  candidateCount: number;
  kind: 'qualified' | 'disqualified';
  defaultOpen: boolean;
  borderClassName: string;
  children: ReactNode;
}) {
  const panelId = useId();
  const countLabel = `${candidateCount} ${kind} candidate${candidateCount === 1 ? '' : 's'}`;
  const accessibleName = `${expiration}, ${dte ?? 'unknown'} DTE, ${countLabel}`;
  const { open, toggle, buttonRef, liveMessage } = useDisclosureA11y(
    `${accessibleName} expanded`, `${accessibleName} collapsed`, defaultOpen,
  );
  return (
    <section className={`rounded-xl border ${borderClassName} p-2`}>
      <button ref={buttonRef} type="button" aria-expanded={open} aria-controls={panelId}
        aria-label={accessibleName} onClick={toggle}
        className="flex w-full items-center justify-between text-left text-[10px] font-bold tracking-wider text-amber-300">
        <span>{expiration} · {dte ?? '—'} DTE · {countLabel}</span>
        <span aria-hidden="true">{open ? '▾ Expanded' : '▸ Collapsed'}</span>
      </button>
      <span role="status" aria-live="polite" className="sr-only">{liveMessage}</span>
      {open && <div id={panelId} className="mt-2 space-y-2">{children}</div>}
    </section>
  );
}
