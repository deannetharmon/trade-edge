# Outstanding Work — Prioritized Cleanup Plan

**Prepared:** 2026-09-24
**Purpose:** A practical execution order for work that is actually outstanding on
`main`. This is a planning aid, not a replacement for ticket acceptance or the
historical sprint record.

## Evidence and confidence

The high-level roadmap and the sprint-status history do not completely agree
with current Git history. This plan gives priority to, in order: current `main`,
approved/ready ticket status, and explicit dependency gates. It intentionally
does not treat stale “current sprint” claims as active work.

Confidence is **high** for the first three priorities below: they have a
concrete current diff, an identified live-order safety gap, or a documented
epic dependency. The order after that is conditional on the product decision
at the end of this document.

## Do now — complete the active, narrow Screener slice

### S1 — Selected BPS/BCS spread-width bounds

**State:** Implementation is already present but uncommitted.

Finish this self-contained slice before starting unrelated work:

- Keep selected minimum/maximum width separate from the optimizer safety cap.
- Preserve the bounds in both normal candidate selection and its unfiltered
  fallback.
- Verify empty means `Any`, invalid ranges fail visibly, and the applied-rules
  receipt reports the active bounds.
- Run focused tests, type-checking, and a diff-whitespace check; then review
  and commit it as a small Screener policy/configuration change.

**Non-goal:** Do not claim that this completes `SCREENER-CONFIG-0001`; that
ticket requires a strategy criterion registry and consistent receipts across
all strategy workflows.

## Resolve next — close the known live-order safety gap

### S2 — Scope and implement ES-0003

**Why next:** `app/rinse-repeat/page.tsx` has a documented unguarded OTOCO
entry-submission path. It is a live-broker boundary, so it outranks new
features and UI expansion.

Create a focused CES/ticket before implementation. It should define the
canonical order identity, price/tick validation, quantity/leg validation,
display-to-payload checks, cancellation/replacement behavior, and fail-closed
UI states. Reuse the ES-0001/ES-0002 safety boundary patterns rather than
creating another submission path.

**Exit gate:** Dedicated unit/submission tests plus an inventory check showing
that this path is now routed through the safety boundary.

## Establish the portfolio foundation before expanding PMCC workflows

### S3 — LCC-0001A Gate A acceptance

**Why:** The approved LCC execution order makes a unified account snapshot and
equity holdings the prerequisite for coverage, capacity, PMCC, and scanner
work. That foundation is already implemented on `main`; it must be accepted
from evidence before downstream work begins.

Complete Gate A with the existing technical specification, implementation
reports, tests, and a production shadow-parity review:

- one account-scoped snapshot containing equity and option holdings;
- basis/data-quality states and broker identity rules;
- covered-call capacity parity shadow checks; and
- compatibility boundaries for existing Portfolio behavior.

Only begin LCC-0001B after Gate A is accepted. Follow the declared sequence:
`LCC-0001A → B → C → D → E`.

**Explicit deferrals until the relevant LCC gate:** PMCC launch UI
(`PMCC-0002`), scanner reframing (`LCC-0001E`), coverage allocation changes,
and Portfolio presentation changes that reinterpret positions/capacity.

## Parallelizable, lower-risk product work

### S4 — SCREENER-PREFS-0001

This is approved and bounded: user-scoped defaults for existing controls, with
no scan-policy change and no pre-scan POP/OTM fields. It may proceed alongside
LCC-0001A only if it remains isolated to preference storage/settings and does
not refactor scanner qualification behavior.

### S5 — SCREENER-CONFIG-0001 migration plan

Do not begin a broad modal rewrite. First build the criterion registry and
receipt contract for one workflow (defined-risk spreads), with executable
lifecycle/retention tests. Migrate CSP, CC, PMCC, and LEAPS only after that
vertical slice is accepted. The current S1 width work can feed this first
registry slice but is not the registry itself.

### S6 — AI-POLICY-0001A gateway foundation

This is independently approved and can run in parallel if it does not touch
the LCC or Screener workstream. Keep route enablement blocked by its stated D3
and D6 gates. Separately, the repository owner should decide whether to rotate
the OpenAI key after reviewing deployment usage, as called out by
AI-SEC-0001.

## Deliberately deferred / requires a decision

| Item | Why it should not start yet |
|---|---|
| OE-0003 opportunity context | Requires a PortfolioMode decision for `/screener`; available capital is intentionally zero today. |
| Six-surface PortfolioMode gap | Needs a surface-by-surface decision: gate each surface or formally classify it mode-independent. |
| PMCC income-readiness / PMCC-0002 launch | The former is draft; the latter should consume LCC capacity/identity foundations rather than bypass them. |
| POSITIONS-0002 / 0003 | Ready on paper, but overlap the portfolio interpretation being established in LCC-0001A. Re-triage after Gate A. |
| WA-0005 / WA-0006 material | Sprint-status describes work on a separate branch, not current `main`; review/merge it as a separate branch decision, not as implicit roadmap work. |
| PI-0015 validation | Ongoing real-market acceptance work, not a feature sprint. Record observed scenarios and corrections separately. |
| TE-0008 / TE-0009 / TE-0010 | Later product capability; do not begin ahead of safety, portfolio identity, and paper-mode sequencing. |

## Recommended operating queue

1. Finish and validate S1; commit it independently.
2. Author and approve S2’s narrow safety scope; implement it before new broker
   actions.
3. Run and review LCC-0001A Gate A evidence; accept it before LCC-0001B.
4. In parallel only where isolated, implement S4 or S6.
5. Decide whether to continue through LCC-0001B or start the controlled S5
   defined-risk registry migration. Do not start both broad changes in the same
   files at once.

## Repository hygiene follow-up

Before the next implementation branch, separately review the untracked files
with ` 2` suffixes and the `output/`/`tmp/` directories. They look like copied
planning artifacts and generated work, but must be classified as intentional
source, moved to an archival location, or removed only with explicit owner
approval.
