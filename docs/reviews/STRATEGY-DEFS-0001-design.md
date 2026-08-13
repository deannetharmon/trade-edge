# STRATEGY-DEFS-0001: Canonical Strategy Type + Definition Registry

**From:** Alan (Architecture), prompted by Dean noticing the same bug shape recur four times in one week
**Confirmed by:** Quinn (the two near-miss bugs found by luck, not review, are the real risk signal)
**Status:** Design — not yet an implementation ticket

---

## 1. What's actually wrong

Not a crisis. The business logic, once fixed, has been correct every time. But there's a real, nameable structural gap, not four unrelated incidents:

**There is no canonical, type-enforced definition of what a "strategy" is.** `SpreadCandidate.strategy` — the root field nearly every strategy-specific branch in `app/screener/page.tsx` (~8,400 lines) and `app/portfolio/page.tsx` (~10,300 lines) compares against — is declared as plain `string`:

```ts
export interface SpreadCandidate {
  strategy: string; expiration: string; dte: number;
  ...
```

No union, no exhaustiveness checking. Adding a strategy means finding every scattered `if (strategy === 'X')` by hand across two enormous files, and nothing forces that search to be complete.

**This is precisely why the same bug shape recurred four times this week, not bad luck four separate times:**
- `buildOrderLegs`/`buildOrderPayload` — PMCC branch simply absent (PMCC-0007)
- The OTM-distance formula — missing PMCC in **four independently-drifted copies** before anyone touched it (PMCC-0009)
- The Filtered-mode single-strategy result-controls block — CSP had it, CC and PMCC didn't (SCREENER-RESULTS-0002)
- The Autopilot exclusion guard — correct, but only because someone remembered to add that one specific check in that one specific file (found during PMCC-0007 review)

And two more bugs (the missing PMCC OTM gate, `progressCurrent` never incrementing for any strategy) were found only because Dean happened to be watching closely — not because any review process or the type system caught them systematically.

**The working counter-example already exists in this codebase**, proving the team already knows the right pattern: `lib/screener/screenerResultOrdering.ts` defines `OiStrategy` as a real union —
```ts
export type OiStrategy = 'CSP' | 'CC' | 'BPS' | 'BCS' | 'BULL_CALL' | 'IC' | 'PMCC' | 'LEAPS';
```
— and its `getLegOiSet` switch statement ends with an exhaustiveness check (`const _exhaustive: never = strategy`) that makes the compiler error if a strategy is ever added without a case for it. **This exact pattern has never been applied to the actual root `strategy` field everywhere else branches on it.**

## 2. What this is NOT

- **Not** a case for reviving the `PMCC-0001` canonical `AutopilotStrategy`/decision-engine architecture — that solves a different problem (automated recommendations across strategies) and is a much larger lift than what's actually broken here.
- **Not** a mandate to immediately migrate every existing branch to a new system in one pass — that would be a large, risky rewrite of working code for a structural problem, not a proportionate fix.
- **Not** urgent/blocking — nothing currently in production is broken by this; it's a prevention measure for the next strategy addition (the already-planned "Find LEAPS — coming soon" scanner will hit this exact wall otherwise) and for catching the two categories of bug found by luck this week.

## 3. Proposed approach

**Phase 1 — type-level fix, small and safe:**
- Change `SpreadCandidate.strategy: string` to a real union type, `SpreadStrategy = 'BPS' | 'BCS' | 'IC' | 'CSP' | 'CC' | 'PMCC'` (matching `OiStrategy` minus `BULL_CALL`/`LEAPS`, which aren't live `SpreadCandidate` producers yet — extend when they are).
- This alone, with no other changes, will make TypeScript surface every place a strategy comparison exists — not by magic, but because many `switch`/`if`-chains that currently silently fall through can be rewritten with the same `_exhaustive: never` pattern `getLegOiSet` already proves works, and the compiler will then refuse to build if a future strategy addition misses one.
- Low risk: this is a type annotation change, not a logic change. Existing string comparisons (`c.strategy === 'BPS'`) continue to work identically; the only difference is the compiler can now check them.

**Phase 2 — opportunistic consolidation, not a rewrite:**
- Where a calculation already got consolidated this week (`calcOtmPct` in `lib/scans/rank-scoring.ts`, `getLegOiSet`/`extractOiLegsFromSpreadCandidate` in `screenerResultOrdering.ts`, `SingleStrategyResultControls`), those become the reference pattern for "how do we add a new strategy's version of X" going forward — a per-concern shared function taking `strategy` as a parameter, not a per-strategy scattered copy.
- No obligation to hunt down and consolidate every remaining scattered branch immediately. When a future ticket touches an area with the old scattered pattern, prefer consolidating it into the shared-function pattern over adding another copy — same incremental discipline already used this week, made deliberate instead of accidental.
- A short internal checklist doc (not code) listing "when adding a strategy, these are the places known to need a case: order-leg building, OI-relevant-leg definition, OTM-distance formula, result-controls, Autopilot adapter" — cheap insurance against the exact four things that went missing this week, until Phase 1's type enforcement organically surfaces the rest.

## 4. Definition of Done (Phase 1 only — Phase 2 is ongoing practice, not a single deliverable)
- `SpreadStrategy` union type defined once, exported from `lib/scans/types.ts`.
- `SpreadCandidate.strategy` retyped to it.
- `tsc --noEmit` — expect this to surface some number of pre-existing loose comparisons or unreachable branches; each one gets reviewed on its own merits, not blanket-suppressed.
- Real `npm run build`.
- Full Vitest suite, zero regressions.
- Checklist doc added to `docs/design/` or `docs/reviews/`.

## 5. Explicitly out of scope
- Any change to `AutopilotStrategy`/canonical decision-engine work.
- Migrating `app/portfolio/page.tsx`'s parallel strategy-branch patterns in this same pass — that file has its own scope (position management, not candidate-finding) and can be assessed separately once Phase 1's type change proves out in `app/screener/page.tsx`.
- Retroactively auditing every existing scattered branch for correctness — Phase 1's type change will surface genuine gaps organically; hunting for more by hand right now isn't a good use of time given nothing found this week was catastrophic.
