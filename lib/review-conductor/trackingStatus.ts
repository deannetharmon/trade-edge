// lib/review-conductor/trackingStatus.ts
//
// WA-0004 (CES section 7, 10, 11 -- binding Product Owner ruling): a single,
// shared signal distinguishing "commitment tracking has never run" from
// "commitment tracking ran and found zero changes." An empty
// ReviewNarrative.sinceLastReview.changes array is structurally identical in
// both cases -- the array alone cannot answer the question -- and this app
// must never present the former as if it were the latter (an honest, common,
// permitted outcome) when in fact no Trader Commitment persistence exists
// anywhere yet.
//
// Both Briefing (features/portfolio/briefing/DailyPortfolioBriefing.tsx) and
// Mission Control (lib/mission-control/buildMissionControlViewModel.ts,
// components/mission-control/SinceLastReviewSection.tsx,
// components/mission-control/SummaryStrip.tsx) import this exact constant
// rather than each independently hardcoding their own boolean, so the two
// surfaces can never silently drift apart on this distinction.
//
// Currently `false`: no lib/trader-commitments persistence is wired to any
// page -- both buildMissionControlViewModel.ts and Briefing's composition
// pass a hardcoded `revalidationResults: []` to conductReview(). Building
// that persistence is explicitly out of scope for WA-0004 (CES section 19);
// this file does not implement it and does not modify conductReview.ts. When
// a future, unscoped sprint wires a real commitment store, this constant
// becomes the real predicate (e.g. "was a real store, not the placeholder,
// passed to conductReview()'s caller") and both surfaces pick up the change
// simultaneously, by construction, with no further change required at either
// call site.
//
// This is a single shared boolean, not a computation -- it evaluates,
// ranks, or scores nothing.

export const TRADER_COMMITMENT_TRACKING_ACTIVE: boolean = false;
