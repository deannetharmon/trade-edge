// components/portfolio-mode/PortfolioModeIndicator.tsx
//
// PT-0002A corrective round: the Product Owner rejected the original round
// specifically because this component let the application DISPLAY "PAPER"
// while every existing portfolio-dependent screen (Dashboard, Portfolio)
// kept rendering real LIVE data underneath -- an ambiguous, unsafe mismatch
// between the global indicator and actual on-screen content. See
// docs/design/PT-0002A-Global-Portfolio-Mode-Foundation.md's Corrective
// Round Addendum for the full account. PortfolioModeProvider itself,
// lib/portfolio-mode/persistence.ts, the adapters, the contract, and the
// guardrails are all UNCHANGED -- this file is the only behavior change.
//
// Four states now, matching PortfolioModeProvider's status plus a resolved
// mode check:
//
//   1. 'resolving'            -- unchanged: a neutral, textless placeholder.
//   2. 'invalid'               -- forced-choice prompt, but PAPER is now a
//                                 DISABLED option (see corrective note
//                                 below) -- only LIVE is a real choice.
//   3. 'ready', mode === 'LIVE' (the only mode any UI control in this round
//      can actually SET) -- an unmistakable LIVE badge, plus a disabled
//      "PAPER" control labeled "available after application integration"
//      (Mandatory requirement: no enabled global PAPER switch this round).
//   4. 'ready', mode === 'PAPER' -- reachable ONLY if a PAPER value was
//      already persisted before this corrective round (there is no way to
//      set it going forward -- see state 3). Never silently coerced back to
//      LIVE. Instead: on any route except the dedicated /paper-trading
//      sandbox (which never reads this context and is unaffected either
//      way -- preserved as an explicitly paper-only route per the
//      corrective directive), render a full-screen BLOCKING warning that
//      requires an explicit "Return to LIVE" click before anything else in
//      the indicator's normal state renders. This is the mechanism that
//      satisfies "require an explicit return to LIVE before presenting live
//      portfolio-dependent content" -- since PT-0002A doesn't (and, per the
//      Directive, must not yet) make individual screens mode-aware, this
//      shell-level, route-agnostic overlay is the only way to guarantee no
//      live-portfolio content is ever presented as if it were current while
//      an unsupported PAPER selection is active, without touching any page.

'use client';

import { usePathname } from 'next/navigation';
import { usePortfolioMode } from './PortfolioModeProvider';

const PAPER_ONLY_ROUTE_PREFIX = '/paper-trading';

const DISABLED_PAPER_LABEL = 'PAPER — available after application integration';

export function PortfolioModeIndicator() {
  const { status, mode, rawInvalidValue, setMode } = usePortfolioMode();
  const pathname = usePathname();
  const onPaperOnlyRoute = pathname?.startsWith(PAPER_ONLY_ROUTE_PREFIX) ?? false;

  if (status === 'resolving') {
    return (
      <div
        aria-hidden="true"
        className="fixed right-4 top-4 z-50 h-7 w-24 rounded-full border border-[#2c2c2c] bg-[#141414]/80"
      />
    );
  }

  if (status === 'invalid') {
    return (
      <div
        role="alert"
        className="fixed right-4 top-4 z-50 flex items-center gap-2 rounded-lg border border-rose-500 bg-rose-950/90 px-3 py-2 text-xs text-rose-100 shadow-lg"
      >
        <span className="font-semibold">
          Portfolio mode unknown{rawInvalidValue ? ` ("${rawInvalidValue}")` : ''} — LIVE is required to continue:
        </span>
        <button
          type="button"
          onClick={() => setMode('LIVE')}
          className="rounded border border-amber-400 px-2 py-0.5 font-semibold text-amber-300 hover:bg-amber-500/10"
        >
          LIVE
        </button>
        <button
          type="button"
          disabled
          aria-disabled="true"
          title={DISABLED_PAPER_LABEL}
          className="cursor-not-allowed rounded border border-current px-2 py-0.5 font-semibold text-rose-300/40"
        >
          PAPER
        </button>
      </div>
    );
  }

  // status === 'ready' from here on.

  if (mode === 'PAPER' && !onPaperOnlyRoute) {
    // A PAPER value was persisted before this corrective round -- never
    // silently coerced to LIVE, but never presented as an active,
    // supported application-wide mode either. Blocks the whole shell (a
    // fixed, full-viewport, pointer-capturing overlay) rather than any one
    // page, since no individual screen is mode-aware yet to gate itself.
    return (
      <div
        role="alertdialog"
        aria-modal="true"
        aria-label="Portfolio mode requires attention"
        data-testid="portfolio-mode-block"
        className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm"
      >
        <div className="max-w-md rounded-lg border border-rose-500 bg-rose-950 p-6 text-center shadow-2xl">
          <p className="text-sm font-semibold text-rose-100">
            Portfolio mode is set to PAPER, but PAPER is not yet supported application-wide.
          </p>
          <p className="mt-2 text-xs text-rose-200">
            Live portfolio screens cannot be shown while an unsupported mode is selected. Return to LIVE to continue.
          </p>
          <button
            type="button"
            onClick={() => setMode('LIVE')}
            className="mt-4 rounded border border-amber-400 px-4 py-2 text-sm font-semibold text-amber-300 hover:bg-amber-500/10"
          >
            Return to LIVE
          </button>
        </div>
      </div>
    );
  }

  if (mode === 'PAPER' && onPaperOnlyRoute) {
    // The dedicated paper-only sandbox never reads this context and is
    // unaffected either way (preserved per the corrective directive) --
    // rendering nothing here avoids obstructing the one route where a
    // stored PAPER preference is not itself a safety concern.
    return null;
  }

  // mode === 'LIVE' -- the only mode any control in this round can set.
  return (
    <div
      className="fixed right-4 top-4 z-50 flex items-center gap-2 rounded-full border border-amber-400 bg-amber-950/80 px-3 py-1.5 text-xs font-semibold text-amber-300 shadow-lg"
    >
      <span data-testid="portfolio-mode-label">LIVE</span>
      <button
        type="button"
        disabled
        aria-disabled="true"
        title={DISABLED_PAPER_LABEL}
        data-testid="portfolio-mode-paper-disabled"
        className="cursor-not-allowed rounded-full border border-current px-2 py-0.5 text-[10px] font-medium text-amber-300/40"
      >
        {DISABLED_PAPER_LABEL}
      </button>
    </div>
  );
}
