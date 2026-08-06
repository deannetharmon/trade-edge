# PORTFOLIO-MODE-0001 — Portfolio Mode Indicator: Header Placement Correction

## Problem

`PortfolioModeIndicator` is a single, globally-mounted component (rendered once in `app/providers.tsx`, outside any individual page). It renders with fixed positioning pinned to the viewport's top-right corner: `fixed right-4 top-4`.

On the Screener page (and structurally on any page using the same header pattern), the theme toggle and accent-color controls already occupy that same top-right region. The indicator and those controls compete for the same screen space.

## Product decision

Move the portfolio-mode indicator out of the top-right corner into the open center portion of the application header. Desktop arrangement:

- TradeEdge identity and page context — left.
- Live/Paper portfolio mode — center.
- Help, accent-color, and theme controls — right.

## Investigation findings

No shared application header or layout component exists. `app/layout.tsx` renders nothing but `<Providers>{children}</Providers>`. Every primary route defines its own header markup independently:

- `app/page.tsx`, `app/screener/page.tsx`, `app/portfolio/page.tsx`, `app/trade-log/page.tsx`, `app/engine/page.tsx` each hand-roll a near-identical (but not componentized) sticky top nav bar — logo/title on the left, a `justify-between` sibling group (Help link, `ThemeToggle`, accent controls) on the right. `ThemeToggle` itself is a separately-defined, copy-pasted local function in both `app/screener/page.tsx` and `app/portfolio/page.tsx`, not a shared component.
- `app/dashboard/page.tsx` renders no comparable top nav header at all — it delegates entirely to `<MissionControl>`, which renders `<CommandCenterNav>` (a left-packed, non-`justify-between` link row) as the very first thing on the page.
- `app/help/page.tsx` has a simpler, single-group header (no right-side controls at all).
- `app/paper-trading/page.tsx` has its own, structurally different, non-nav header block (a title/description row, `flex-col` on mobile, `md:flex-row md:justify-between` at `md` and up).

Retrofitting a genuine, document-flow "three-region header slot" that this indicator could portal into would require editing every one of these independently-authored files — effectively redesigning each page's header, which is out of scope for this ticket.

A new full-width utility bar was considered and rejected: on header-less routes (Dashboard, and Paper Trading below the `md` breakpoint) a full-width band would sit directly above content that already starts very close to the top of the viewport, risking exactly the kind of collision this ticket exists to fix, on more routes than it fixes.

## Chosen approach

Keep the indicator's existing architecture (rendered once, globally, independent of any page) but change its horizontal position from a right-corner offset to horizontal centering: `fixed left-1/2 -translate-x-1/2` instead of `right-4`. This is deliberately not "an arbitrary offset calculated for one page" — horizontal centering is symmetric and page-width-independent, so it lands in the same visually open region on every route, including ones with no header at all, without requiring any per-page cooperation.

On routes with a real two-group (`justify-between`) header — Screener, Portfolio, Trade Log, Engine, Home, Help — the header's own layout leaves the horizontal center structurally empty, so the centered indicator lands exactly where a real center-header-region control would. No changes to those pages were needed.

On the two routes without that pattern, code-level layout inspection found a real, concrete collision risk between the indicator's vertical footprint (~12px–40px from the top of the viewport) and page content that also starts very close to the top:

- **Dashboard** — `CommandCenterNav`'s left-packed link row can reach the viewport's horizontal center within its narrow, centered `max-w-3xl` container.
- **Paper Trading** — below the `md` breakpoint, the title block stacks full-width above the "Back to TradeEdge" link and is wide enough on typical phone widths to reach center.

Both were given a small, targeted top-margin correction (documented inline in each file) sufficient to clear the indicator — a minimal spacing correction, not a header redesign.

## Desktop behavior

Full treatment: `LIVE` label plus a disabled `PAPER — available after application integration` pill, both inside one centered, bordered badge. Distinct z-index (`z-[60]`) above the common `z-50` sticky-header class so the badge is never visually buried under a page's own header.

## Mobile behavior (below the `sm` breakpoint, 640px)

The disabled-PAPER control's long inline explanation is replaced with the compact text `PAPER` (CSS-only breakpoint switch — the same `<button disabled aria-disabled>` element renders at every breakpoint; only its visible text content changes). The full explanation remains available via `aria-label` (always present to assistive technology, not hover-dependent) and `title` (mouse/long-press), per the ticket's explicitly-listed acceptable mechanisms.

## Safety behavior preserved (unchanged)

- Resolving-state neutral placeholder.
- Invalid persisted-mode forced-choice prompt, PAPER disabled.
- The full-screen blocking overlay for an unsupported persisted PAPER state — still `fixed inset-0`, unchanged, exempted from the placement change per the ticket's own allowance for safety overlays.
- The explicit "Return to LIVE" action.
- The `/paper-trading` route exemption from the blocking overlay.
- Portfolio-mode persistence (`PortfolioModeProvider`, `lib/portfolio-mode/persistence.ts`) — untouched.
- No control anywhere can set mode to PAPER.

## Accessibility

- The ready/LIVE badge is exposed with `role="status"` and `aria-label="Portfolio mode: LIVE"`.
- The invalid state keeps `role="alert"`; the blocking overlay keeps `role="alertdialog"` with an accessible name.
- The disabled PAPER control keeps accurate `disabled`/`aria-disabled="true"` at every breakpoint, and now also carries an explicit `aria-label` so its accessible name is accurate regardless of which text is visually shown.
- No state is communicated by color alone — every state also has distinct copy (`LIVE`, `PAPER — ...`, the invalid-state alert text, the blocking-overlay text).

## Scope boundaries respected

No financial/portfolio data source, recommendation, or execution behavior changed. No page header was redesigned. Theme/accent controls were not moved. No new global utility bar was introduced — the infeasibility of avoiding one in favor of true per-page header-slot participation is documented above.
