'use client';

// features/screener/components/ScanModalShell.tsx
//
// Shared scan-configuration modal shell for Spreads (RunModeModal, inline in
// app/screener/page.tsx) and CSP (CspScanModal.tsx). Before this module
// existed, the two were separate, unreconciled components: CSP had real
// dialog semantics (role="dialog", a focus trap, Escape-to-close, a
// roving-tabindex mode radiogroup) that Spreads never had, while Spreads had
// theme-aware chrome (colors driven by the app's active `th` theme,
// per-mode color coding for Filter/Rank/Targeted) that CSP never had --
// CSP hardcoded its own amber/neutral palette instead. Neither difference
// was a deliberate strategy-specific product decision; the two components
// just diverged because CSP was built clean-room rather than extending
// Spreads' existing pattern. This module is the one shared shell both now
// use, so any future accessibility or theming fix lands in both places at
// once instead of drifting apart again.
//
// Strategy-specific FILTER CONTENT (rule values, preset copy, Targeted
// fields, Rank's secondary-sort field) intentionally stays with each
// consumer -- CSP's delta/DTE/OI ranges are genuinely different numbers
// than a spread's Cr-Ratio-centric presets, and that's a legitimate
// difference. Only the modal's outer shell and mode-selection pattern are
// shared.

import { useEffect, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

export interface ScanModalTheme {
  bg: string;
  card: string;
  border: string;
  text: string;
  textMuted: string;
  textFaint: string;
  input: string;
  inputBorder: string;
}

export interface ScanModalShellProps {
  th: ScanModalTheme;
  titleId: string;
  title: ReactNode;
  subtitle?: ReactNode;
  closeLabel: string;
  onClose: () => void;
  children: ReactNode;
  maxWidthClassName?: string;
}

export function ScanModalShell({
  th, titleId, title, subtitle, closeLabel, onClose, children, maxWidthClassName = 'max-w-2xl',
}: ScanModalShellProps) {
  const dialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // Priority order matters here: an explicit [data-autofocus] target,
    // then the checked radio (so reopening a modal returns focus to the
    // selected mode, not whatever happens to be first in the DOM), and
    // only then the first focusable element in general (e.g. the close
    // button, which is rendered before the body content). These must be
    // three separate lookups -- a single comma-separated selector passed
    // to querySelector() returns the first DOM-order match across all of
    // them, not the first-listed selector, which would let the close
    // button (also a <button>) win over the checked radio.
    const dialog = dialogRef.current;
    const autofocusTarget =
      dialog?.querySelector<HTMLElement>('[data-autofocus]') ??
      dialog?.querySelector<HTMLElement>('[role="radio"][aria-checked="true"]') ??
      dialog?.querySelector<HTMLElement>('button:not([disabled]), input:not([disabled]), select:not([disabled])');
    autofocusTarget?.focus();

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); onClose(); return; }
      if (event.key !== 'Tab') return;
      const focusable = Array.from(
        dialogRef.current?.querySelectorAll<HTMLElement>(
          'button:not([disabled]), input:not([disabled]), select:not([disabled]), [role="radio"][tabindex="0"]',
        ) ?? [],
      );
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  return createPortal(
    // Solid, fully opaque backdrop -- not a translucent scrim over the page
    // behind it. Uses the app's own theme background color so the modal
    // reads as its own screen rather than a see-through overlay.
    <div className={`fixed inset-0 z-[80] flex items-center justify-center ${th.bg} p-3`}>
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className={`${th.card} border ${th.border} max-h-[92vh] w-full ${maxWidthClassName} overflow-y-auto rounded-2xl p-5 shadow-2xl flex flex-col gap-5`}
      >
        <div className="relative flex items-start justify-between gap-4">
          <div>
            <h2 id={titleId} className={`text-sm font-bold tracking-widest ${th.text}`}>{title}</h2>
            {subtitle && <p className={`mt-1 text-xs ${th.textFaint}`}>{subtitle}</p>}
          </div>
          <button
            onClick={onClose}
            aria-label={closeLabel}
            className={`rounded border ${th.inputBorder} ${th.textMuted} hover:${th.text} px-2 py-1 text-lg leading-none transition-colors`}
          >
            ✕
          </button>
        </div>
        {children}
      </div>
    </div>,
    document.body,
  );
}

// ── Shared mode selector ────────────────────────────────────────────────
// Every scan-configuration modal in the Screener offers exactly these three
// modes. Color coding (theme-accent / purple / teal) and roving-tabindex
// arrow-key navigation are shared so Filter/Rank/Targeted look and behave
// identically regardless of which strategy's modal is open.

export type ScanMode = 'filter' | 'rank' | 'targeted';

const MODE_ORDER: ScanMode[] = ['filter', 'rank', 'targeted'];

const MODE_LABEL: Record<ScanMode, string> = { filter: 'FILTER', rank: 'RANK', targeted: 'TARGETED' };
const MODE_ICON: Record<ScanMode, string> = { filter: '⊘', rank: '⬡', targeted: '⊕' };
// Kept as a decorative, non-name-bearing prefix (rendered with aria-hidden)
// rather than folded into the accessible name -- redundant emoji in an
// accessible name is noise for screen-reader users, and keeping the name
// icon-free lets every mode's accessible name simply start with its label.
const MODE_SELECTED_CLASS: Record<ScanMode, string> = {
  filter: 'ac-bg-20 ac-btn',
  rank: 'bg-purple-500/20 border-purple-500 text-purple-400',
  targeted: 'bg-teal-500/20 border-teal-500 text-teal-300',
};

export interface ScanModeRadioGroupProps {
  th: ScanModalTheme;
  ariaLabel: string;
  value: ScanMode;
  onChange: (mode: ScanMode) => void;
  descriptions: Record<ScanMode, string>;
}

export function ScanModeRadioGroup({ th, ariaLabel, value, onChange, descriptions }: ScanModeRadioGroupProps) {
  const buttonRefs = useRef<Partial<Record<ScanMode, HTMLButtonElement | null>>>({});

  const onKeyDown = (event: React.KeyboardEvent, index: number) => {
    if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return;
    event.preventDefault();
    const delta = event.key === 'ArrowLeft' || event.key === 'ArrowUp' ? -1 : 1;
    const next = MODE_ORDER[(index + delta + MODE_ORDER.length) % MODE_ORDER.length];
    onChange(next);
    buttonRefs.current[next]?.focus();
  };

  return (
    <div role="radiogroup" aria-label={ariaLabel} className="grid grid-cols-3 gap-2">
      {MODE_ORDER.map((mode, index) => {
        const selected = value === mode;
        return (
          <button
            key={mode}
            ref={(el) => { buttonRefs.current[mode] = el; }}
            type="button"
            role="radio"
            aria-checked={selected}
            aria-label={`${MODE_LABEL[mode]} scan mode${selected ? ', selected' : ''}`}
            data-mode={mode}
            tabIndex={selected ? 0 : -1}
            onKeyDown={(event) => onKeyDown(event, index)}
            onClick={() => onChange(mode)}
            className={`flex-1 rounded-xl border p-3 text-left text-xs font-bold tracking-wider transition-all ${
              selected ? MODE_SELECTED_CLASS[mode] : `${th.card} ${th.border} ${th.textFaint} hover:${th.textMuted}`
            }`}
          >
            <span aria-hidden="true">{MODE_ICON[mode]} {selected ? '✓ ' : ''}{MODE_LABEL[mode]}</span>
            {selected && <span className="block text-[9px] font-bold">Selected</span>}
            <span className="mt-1 block text-[9px] font-normal opacity-70">{descriptions[mode]}</span>
          </button>
        );
      })}
    </div>
  );
}
