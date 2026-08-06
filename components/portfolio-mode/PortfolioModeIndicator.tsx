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
//
// ── Header-placement corrective pass ────────────────────────────────────
//
// This component used to render every non-blocking state pinned to the
// viewport's top-right corner (`fixed right-4 top-4`), which visually
// collided with the theme/accent-color controls that several routes (e.g.
// Screener) already render in that same corner.
//
// Investigation before this pass confirmed there is no shared application
// header component to slot a real, document-flow "center region" into:
// app/layout.tsx renders nothing but <Providers>{children}</Providers>,
// and every primary route defines its own header markup independently --
// app/page.tsx, app/screener/page.tsx, app/portfolio/page.tsx,
// app/trade-log/page.tsx, and app/engine/page.tsx each hand-roll a nearly
// identical (but NOT shared/componentized -- e.g. ThemeToggle is a
// separate, copy-pasted local function in both app/screener/page.tsx and
// app/portfolio/page.tsx) sticky top nav bar; app/dashboard/page.tsx
// renders no comparable top nav header at all (it delegates entirely to
// <MissionControl>); app/paper-trading/page.tsx has its own, structurally
// different, non-nav header block. Retrofitting a genuine three-region
// header slot that this globally-mounted indicator could portal into would
// require editing every one of those independently-authored files --
// effectively redesigning each page's header, which is explicitly out of
// scope for this pass. A new full-width utility bar was also rejected: on
// header-less routes (Dashboard, Paper Trading) a full-width band would
// sit directly above content that already starts at the very top of the
// viewport, risking exactly the kind of collision this pass exists to fix,
// on more routes than it fixes.
//
// The chosen fix keeps the indicator's existing globally-mounted
// architecture (still rendered once, in app/providers.tsx, independent of
// any page) but recenters it horizontally: `fixed left-1/2 -translate-x-1/2`
// instead of `right-4`. This is deliberately NOT "just changing an offset
// arbitrarily calculated for one page" -- horizontal centering is
// symmetric and page-width-independent, so it lands in the same visually
// open region on every route, including ones with no header at all,
// without needing any per-page cooperation or touching any page file. It
// is visually indistinguishable from "centered in the header," which is
// the approved product decision, on every route that has a header, and on
// routes without one it simply floats near the top where nothing else is.
//
// A shared CENTER_POSITION class string is used for every non-blocking
// state so the placement rule lives in exactly one place. The full-screen
// blocking overlay (state 4, PAPER on a live-portfolio route) intentionally
// keeps `fixed inset-0` -- per the corrective directive, a safety overlay
// is exempt from this placement change.

'use client';

import { usePathname } from 'next/navigation';
import { usePortfolioMode } from './PortfolioModeProvider';

const PAPER_ONLY_ROUTE_PREFIX = '/paper-trading';

const DISABLED_PAPER_LABEL = 'PAPER — available after application integration';

// Shared top-center placement for every non-blocking state. z-[60] sits
// above the sticky page headers several routes use (those are z-50), so
// the indicator is never visually buried underneath one.
const CENTER_POSITION = 'fixed left-1/2 top-3 z-[60] -translate-x-1/2';

export function PortfolioModeIndicator() {
  const { status, mode, rawInvalidValue, setMode } = usePortfolioMode();
  const pathname = usePathname();
  const onPaperOnlyRoute = pathname?.startsWith(PAPER_ONLY_ROUTE_PREFIX) ?? false;

  if (status === 'resolving') {
    return (
      <div
        aria-hidden="true"
        className={`${CENTER_POSITION} h-7 w-24 rounded-full border border-[#2c2c2c] bg-[#141414]/80`}
      />
    );
  }

  if (status === 'invalid') {
    return (
      <div
        role="alert"
        className={`${CENTER_POSITION} flex max-w-[92vw] items-center gap-2 whitespace-nowrap rounded-lg border border-rose-500 bg-rose-950/90 px-3 py-2 text-xs text-rose-100 shadow-lg`}
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
    // Deliberately NOT recentered like the states above -- a full-viewport
    // safety overlay has no "position" to correct; it already covers
    // everything, which is the point.
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
      role="status"
      aria-label="Portfolio mode: LIVE"
      className={`${CENTER_POSITION} flex items-center gap-1.5 whitespace-nowrap rounded-full border border-amber-400 bg-amber-950/90 px-2.5 py-1 text-xs font-semibold text-amber-300 shadow-lg sm:gap-2 sm:px-3 sm:py-1.5`}
    >
      <span data-testid="portfolio-mode-label" className="tracking-wide">
        LIVE
      </span>
      {/* Mobile: compact "PAPER" pill only -- the long disabled-Paper
          explanation is never shown inline below the sm breakpoint, but
          stays available to every input method via aria-label (always,
          not hover-dependent) and title (mouse/long-press). Same real
          <button disabled aria-disabled> element at every breakpoint --
          only the visible text differs -- so disabled/aria-disabled
          semantics, focus behavior, and click-does-nothing behavior are
          identical across desktop, tablet, and mobile. */}
      <button
        type="button"
        disabled
        aria-disabled="true"
        aria-label={DISABLED_PAPER_LABEL}
        title={DISABLED_PAPER_LABEL}
        data-testid="portfolio-mode-paper-disabled"
        className="cursor-not-allowed rounded-full border border-current px-2 py-0.5 text-[10px] font-medium text-amber-300/40"
      >
        <span className="hidden sm:inline">{DISABLED_PAPER_LABEL}</span>
        <span className="sm:hidden">PAPER</span>
      </button>
    </div>
  );
}
