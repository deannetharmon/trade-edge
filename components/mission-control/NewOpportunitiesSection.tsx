// components/mission-control/NewOpportunitiesSection.tsx
//
// MB-0002 built this reusing the full BestOpportunitiesPanel verbatim,
// which contradicted WA-0001's binding Ownership Matrix ruling ("Mission
// Control keeps a compact count, not the panel"). WA-0005 §9/§11/§21
// operationalizes that already-binding ruling: this section now renders
// only a compact count/link into the canonical Opportunities workspace
// (/screener), never the full ranked-candidate list. The detailed ranked
// workflow is owned exclusively by /screener.
//
// Retains its own id="best-opportunity" anchor (now wrapping the compact
// count/link rather than the full panel) so any existing bookmark/link to
// /dashboard#best-opportunity does not break -- see CES §17. This is a
// different anchor than /screener's own new id="ranked-opportunities"
// anchor; no page ever has both ids, so no duplicate-id conflict exists.
//
// PO corrective round 3, Finding 1: the section heading previously read
// "New Opportunities," which claims a newness/recency property this
// component cannot prove (no snapshot-comparison mechanism exists, CES
// §5.10/§11) -- corrected to "Ranked Opportunities," matching /screener's
// own section heading and making no newness claim anywhere in this
// component's rendered text.
//
// Truthful state contract (CES §7/§11/§15, re-investigated this round
// against lib/recommendations/RecommendationService.ts and
// app/dashboard/page.tsx/MissionControl.tsx's own real signals):
//
//   1. No current ranked results -- `reviewState === 'loaded'` and
//      `generatedAt === null`: nothing has been published to the
//      Recommendation Service this session (never ran, a hard reload reset
//      it to EMPTY_STATE, or an upstream evaluation failure never reached
//      publishRecommendations). RecommendationService exposes no separate
//      error/loading signal of its own (it is a synchronous, in-memory
//      pub-sub of the *last successfully published* set only -- see
//      lib/recommendations/RecommendationService.ts) -- collapsing "never
//      ran"/"reset by reload" into one honest state remains correct, not a
//      gap; the full failure-vs-never-run distinction for the *opportunities
//      pipeline itself* belongs to /screener (CES §15), which does have the
//      data (`opportunityState`/`opportunityError`) to make it.
//   2. Empty evaluated results -- `reviewState === 'loaded'`, `generatedAt`
//      present, `items.length === 0`: a scan published and the evaluation
//      pipeline genuinely produced zero candidates. Distinct from state 1
//      and from state 3 below.
//   3. All candidates REJECTED -- `reviewState === 'loaded'`, `items.length
//      > 0`, every item's disposition is `REJECTED`: distinct, truthful
//      copy naming the REJECTED count. Previously this rendered as "0
//      ranked opportunities to review," textually indistinguishable from
//      state 2's genuinely-empty result -- corrected (Finding 1, round 2).
//   4. Current ranked results -- `reviewState === 'loaded'`, `items.length
//      > 0`, at least one non-REJECTED item: the headline count is the
//      number of non-REJECTED candidates only (RECOMMENDED +
//      ACCEPTABLE_ALTERNATIVE + WATCH) -- REJECTED candidates are never
//      counted into this headline (CES §7/AC-8), and this count is never
//      labeled "new."
//   5. Loading/refreshing -- `reviewState === 'loading'`: a REAL, already-
//      existing signal, re-investigated this round. `useCurrentRecommendations()`
//      itself is a synchronous read with no loading phase of its own (still
//      true), BUT Mission Control's OWN page-level composition-loading
//      signal (`MissionControlViewModel.state === 'loading'`, driven by
//      `usePortfolioData()`'s real `loading` boolean in
//      app/dashboard/page.tsx) is a genuine, already-computed signal that
//      previously caused MissionControl.tsx to hide this entire section
//      rather than expose a compact loading state within it. This round
//      threads that same real signal into this component (via the new
//      `reviewState` prop) instead of inventing an opportunities-specific
//      fetch flag that doesn't exist.
//   6. Unavailable / evaluation-failure-adjacent -- `reviewState === 'error'
//      || reviewState === 'unavailable'`: also a REAL, already-existing
//      signal (`MissionControlViewModel.state`, driven by
//      `usePortfolioData()`'s real `error` boolean / `!composition.portfolioReview`).
//      Investigation reconfirmed (see below) that no distinct "opportunities
//      evaluation itself failed" signal is reachable at this boundary --
//      `publishRecommendations()` is only ever called from /screener's own
//      success path, and RecommendationService never records a failure, so
//      "never ran" and "opportunities fetch failed" remain genuinely
//      indistinguishable from data alone. What IS real and distinct is "the
//      surrounding Review failed/isn't available," which is a different,
//      honestly-worded reason ranked opportunities cannot be confirmed right
//      now -- rendered with distinct copy from state 1's "nothing published"
//      message, so it is never visually or textually identical to it,
//      satisfying the requirement that these two not collapse into the same
//      copy, without fabricating an opportunities-specific failure that does
//      not exist.
//   7. Stale results -- PO corrective round 4 (Defect 1): round 3's report
//      claimed this state was "structurally unreachable," reasoning that
//      `useCurrentRecommendations()` is a live, reactive subscription to
//      the single current published set, so whatever this component
//      renders IS the current set at all times. The round 4 Product Owner
//      review found that claim incomplete, not false: it correctly
//      described `analyses`/`generatedAt` (the last SUCCESSFULLY published
//      set has no separate "snapshot" to go stale), but it ignored that
//      RecommendationService ALSO now carries a real, distinct signal for
//      the MOST RECENT EVALUATION ATTEMPT, independent of what's published
//      -- see lib/recommendations/RecommendationService.ts's `status`/
//      `error` fields, added this round. There genuinely IS a difference
//      between "the currently-published recommendations" and "a newer
//      evaluation is running/failed since that publish," and /screener's
//      own `opportunityState`/`opportunityError` already compute it in
//      real time -- this component previously had no way to observe that
//      signal at all (not merely no way to compute it). Now threaded
//      through via the `opportunityEvaluationStatus`/
//      `opportunityEvaluationError` props (routed:
//      app/screener/page.tsx's opportunityState/opportunityError ->
//      lib/recommendations/RecommendationService.ts's
//      beginRecommendationsEvaluation()/failRecommendationsEvaluation() ->
//      useCurrentRecommendations().status/.error ->
//      buildMissionControlViewModel.ts's opportunitiesEvaluationStatus/
//      opportunitiesEvaluationError -> here), this state is genuinely
//      reachable: when `opportunityEvaluationStatus === 'loading'`, a
//      newer evaluation is running RIGHT NOW while `items`/`generatedAt`
//      still show the last successfully published set underneath: when
//      `opportunityEvaluationStatus === 'error'`, the most recent attempt
//      FAILED while the last successfully published set again remains
//      visible underneath, never blanked out. Both render a distinct,
//      additional `role="status"` line alongside (not instead of) the
//      normal states 1-4 count/copy above -- the last known-good
//      presentation is never hidden or replaced by this signal, only
//      annotated with it. This is not a new evaluation engine and
//      fabricates nothing -- it is the same real state /screener already
//      tracked locally, now also announced through the existing
//      Recommendation Service pub/sub boundary.
//   8. Capital limited -- a compact, non-dismissible annotation (Finding 4,
//      corrected this round): must remain visible for every applicable
//      completed presentation where no RECOMMENDED item is present --
//      including states 2 (Empty evaluated results) and 3 (All REJECTED),
//      not only state 4. Previously gated on `nonRejectedCount > 0 &&
//      !hasRecommended`, which silently suppressed the annotation in states
//      2/3 (where `nonRejectedCount` is always 0) even though both are
//      genuine, applicable, completed evaluations with no RECOMMENDED item.
//      Corrected to `hasPublished && !hasRecommended` -- true in states 2, 3,
//      and 4, false in state 1 (nothing published yet, so "capital limited"
//      would be a premature/false claim).

import Link from 'next/link';
import type { THEMES, Theme } from '@/lib/theme';
import type { OpportunityRecommendation } from '@/lib/opportunity-engine';

/** Mirrors lib/mission-control/types.ts's MissionControlState -- re-declared as a narrower, string-literal prop type so this component does not need to import the full view-model module for a single field. */
export type NewOpportunitiesSectionReviewState = 'loading' | 'loaded' | 'error' | 'unavailable';

export interface NewOpportunitiesSectionProps {
  items: OpportunityRecommendation[];
  /** Null when nothing has been published to the Recommendation Service this session. */
  generatedAt: string | null;
  th: (typeof THEMES)[Theme];
  /**
   * Mission Control's own real, already-computed page-level state (CES
   * §7/§11, Finding 1). Defaults to 'loaded' for callers/tests that render
   * this section in isolation without a surrounding page state -- this
   * preserves the section's own 4-state contract (states 1-4) as the
   * default behavior when no page-level condition applies.
   */
  reviewState?: NewOpportunitiesSectionReviewState;
  /**
   * PO corrective round 4 (WA-0005 Defect 1): the Recommendation Service's
   * own real evaluation-lifecycle status for the MOST RECENT evaluation
   * attempt -- independent of `items`/`generatedAt`, which describe the
   * last SUCCESSFULLY published set. 'loading' means a newer evaluation is
   * running right now; 'error' means the most recent attempt failed.
   * Either way, `items`/`generatedAt` still show the last known-good
   * result underneath -- never cleared by this signal. Defaults to 'idle'
   * for callers/tests that render this section without a surrounding
   * evaluation-lifecycle signal (the honest "nothing newer in flight or
   * failed" default).
   */
  opportunityEvaluationStatus?: 'idle' | 'loading' | 'error';
  /** The most recent evaluation attempt's failure message, when `opportunityEvaluationStatus === 'error'`. */
  opportunityEvaluationError?: string | null;
}

export function NewOpportunitiesSection({
  items,
  generatedAt,
  th,
  reviewState = 'loaded',
  opportunityEvaluationStatus = 'idle',
  opportunityEvaluationError = null,
}: NewOpportunitiesSectionProps) {
  const hasPublished = generatedAt !== null && generatedAt !== undefined;
  const nonRejectedCount = items.filter((item) => item.disposition !== 'REJECTED').length;
  const allRejected = hasPublished && items.length > 0 && nonRejectedCount === 0;
  const hasRecommended = items.some((item) => item.disposition === 'RECOMMENDED');
  // Finding 1/4 (corrected): compact capital-limited annotation, shown for
  // EVERY applicable completed presentation with no RECOMMENDED item --
  // states 2 (empty evaluated), 3 (all REJECTED), and 4 (current ranked
  // results without a RECOMMENDED pick) -- never only when a non-REJECTED
  // candidate happens to exist. Never shown in state 1 (nothing published
  // yet -- "capital limited" would be a premature claim about an evaluation
  // that never ran).
  const showCapitalLimitedNote = reviewState === 'loaded' && hasPublished && !hasRecommended;
  // PO corrective round 4 (Defect 1), state 7 (Stale results, now genuinely
  // reachable -- see the module doc above): only meaningful when this
  // section is otherwise rendering its normal loaded states (1-4) --
  // reviewState 'loading'/'error'/'unavailable' already take priority and
  // describe a different, page-level condition (the surrounding Review
  // itself, not the opportunities evaluation pipeline).
  const isEvaluationRefreshing = reviewState === 'loaded' && opportunityEvaluationStatus === 'loading';
  const isEvaluationFailed = reviewState === 'loaded' && opportunityEvaluationStatus === 'error';
  // Only meaningful when there is an actual previously-published set to
  // annotate as "possibly superseded" -- when nothing has ever published yet
  // (hasPublished false), this is not a "the results above may be stale"
  // annotation at all; it is the ONLY signal there is, handled separately
  // below by `isFirstEverEvaluationLoading`/`isFirstEverEvaluationFailed`.
  const showRefreshingNote = hasPublished && isEvaluationRefreshing;
  const showEvaluationFailedNote = hasPublished && isEvaluationFailed;
  // PO corrective round 5 (WA-0005 Defect 2): previously, `opportunityEvaluationStatus`/
  // `opportunityEvaluationError` were only ever consulted when `hasPublished`
  // was true (see `showRefreshingNote`/`showEvaluationFailedNote` above) --
  // so the FIRST-EVER evaluation attempt (before anything has ever been
  // published this session) had its loading/failure signal discarded
  // entirely, and this component fell back to the generic "No current
  // ranked opportunities -- run a scan" copy even while an evaluation was
  // actively running or had just failed. These two flags cover exactly that
  // gap -- they are false whenever `hasPublished` is true, since that case
  // is already fully handled by `showRefreshingNote`/`showEvaluationFailedNote`
  // above (this round does not change that established, correct behavior).
  const isFirstEverEvaluationLoading = !hasPublished && isEvaluationRefreshing;
  const isFirstEverEvaluationFailed = !hasPublished && isEvaluationFailed;

  return (
    <section id="best-opportunity" aria-label="Ranked Opportunities" className="mb-6">
      <h2 className={`mb-2 text-[12px] font-bold uppercase tracking-widest ${th.text}`}>Ranked Opportunities</h2>
      <div className={`border ${th.border} rounded-xl p-4 ${th.card} flex items-center justify-between gap-3 flex-wrap`}>
        <div className="flex flex-col gap-1">
          {reviewState === 'loading' ? (
            // Finding 1, state 5 (Loading/refreshing): a real, already-
            // computed signal (MissionControlViewModel.state === 'loading',
            // driven by usePortfolioData()'s real `loading` boolean) --
            // threaded through, not fabricated.
            <p role="status" className={`text-[11px] ${th.textFaint}`}>
              Preparing your Review — ranked opportunities will appear here once ready.
            </p>
          ) : reviewState === 'error' || reviewState === 'unavailable' ? (
            // Finding 1, state 6 (Unavailable/evaluation-failure-adjacent):
            // also a real, already-computed signal
            // (MissionControlViewModel.state === 'error'/'unavailable').
            // Deliberately distinct copy from state 1's "nothing published"
            // message -- this names the real, honest reason (the
            // surrounding Review itself failed/isn't available yet), never
            // fabricating an opportunities-specific failure that
            // RecommendationService has no way to record.
            <p role="status" className={`text-[11px] ${th.textFaint}`}>
              Ranked opportunities can't be confirmed right now — your Review data failed to load or isn't available yet.
            </p>
          ) : isFirstEverEvaluationLoading ? (
            // PO corrective round 5 (WA-0005 Defect 2): the FIRST-EVER
            // evaluation attempt this session is running right now --
            // nothing has been published yet, so there is no prior result
            // to show underneath; this replaces (not annotates) the generic
            // "No current ranked opportunities" copy while it is genuinely
            // in flight.
            <p role="status" className={`flex items-center gap-1 text-[11px] ${th.textFaint}`}>
              <span aria-hidden="true">⟳</span>
              A ranked-opportunities evaluation is running — results will appear here once it completes.
            </p>
          ) : isFirstEverEvaluationFailed ? (
            // PO corrective round 5 (WA-0005 Defect 2): the FIRST-EVER
            // evaluation attempt failed with nothing previously published to
            // preserve underneath. Uses role="alert" (not role="status"),
            // matching the established convention for genuine failures
            // elsewhere in this sprint (e.g. BestOpportunitiesPanel's
            // failure banner) -- this is a real failure notice, not a
            // passive status update.
            <p role="alert" className={`flex items-center gap-1 text-[11px] ${th.textFaint}`}>
              <span aria-hidden="true">⚠</span>
              The ranked-opportunities evaluation failed{opportunityEvaluationError ? `: ${opportunityEvaluationError}` : ''} — run a scan on Screener to try again.
            </p>
          ) : !hasPublished ? (
            <p role="status" className={`text-[11px] ${th.textFaint}`}>
              No current ranked opportunities — run a scan on Screener to see ranked candidates here.
            </p>
          ) : items.length === 0 ? (
            <p role="status" className={`text-[11px] ${th.textFaint}`}>
              The most recent scan produced no ranked opportunities.
            </p>
          ) : allRejected ? (
            <p role="status" className={`text-[11px] ${th.textFaint}`}>
              The most recent scan evaluated {items.length} candidate{items.length === 1 ? '' : 's'} — every one was rejected. 0 ranked opportunities to review; see Screener for the full detail.
            </p>
          ) : (
            <p className={`text-[12px] font-semibold ${th.text}`}>
              {nonRejectedCount} ranked opportunit{nonRejectedCount === 1 ? 'y' : 'ies'} to review
            </p>
          )}
          {showRefreshingNote && (
            // PO corrective round 4 (Defect 1), state 7 (Stale results, now
            // genuinely reachable): a newer evaluation is running RIGHT NOW
            // (RecommendationService's own real status, routed from
            // /screener's opportunityState) -- the items/count above are
            // still the last successfully published set, never cleared by
            // this in-flight signal.
            <p role="status" className={`flex items-center gap-1 text-[9px] ${th.textFaint} italic`}>
              <span aria-hidden="true">⟳</span>
              A newer ranked-opportunities evaluation is running — the results above are the last completed evaluation.
            </p>
          )}
          {showEvaluationFailedNote && (
            // PO corrective round 4 (Defect 1), state 7 (Stale results, now
            // genuinely reachable): the most recent evaluation attempt
            // failed (RecommendationService's own real status/error, routed
            // from /screener's opportunityState/opportunityError) -- the
            // items/count above remain the last successfully published set,
            // never blanked out by this failure.
            // PO corrective round 5 (WA-0005 Defect 2): role="alert" (not
            // role="status") for this genuine failure notice, matching the
            // established convention elsewhere in this sprint (e.g.
            // BestOpportunitiesPanel's failure banner) -- the prior valid
            // results remain visible/annotated underneath, unchanged from
            // round 4's correct behavior for this case.
            <p role="alert" className={`flex items-center gap-1 text-[9px] ${th.textFaint} italic`}>
              <span aria-hidden="true">⚠</span>
              The most recent ranked-opportunities evaluation attempt failed{opportunityEvaluationError ? `: ${opportunityEvaluationError}` : ''} — the results above are the last completed evaluation.
            </p>
          )}
          {showCapitalLimitedNote && (
            <p role="status" className={`flex items-center gap-1 text-[9px] ${th.textFaint} italic`}>
              <span aria-hidden="true">ℹ</span>
              Available capital is not connected, so no candidate is classified as Recommended — Watch/Acceptable Alternative candidates may still be worth reviewing.
            </p>
          )}
        </div>
        <Link
          href="/screener#ranked-opportunities"
          className={`inline-flex min-h-[44px] min-w-[44px] shrink-0 items-center justify-center text-[10px] font-bold px-3 py-1.5 border ${th.borderLight} rounded-lg ${th.textMuted} hover:${th.text} focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-1 focus-visible:ring-blue-500`}
        >
          Review →
        </Link>
      </div>
    </section>
  );
}
