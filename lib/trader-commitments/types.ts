// lib/trader-commitments/types.ts
//
// MB-0001B: Trader Commitment domain model -- the foundation piece behind
// the Review narrative's "Since Your Last Review" section (see
// docs/design/MB-0001B-Review-Conductor-Foundation.md). A Trader Commitment
// represents active trading intent the trader has already decided on --
// "hold until 21 DTE", "monitor", "let theta work", "wait for earnings",
// "GTC order working" -- something the Revalidation Engine
// (lib/revalidation) can later check for material change.
//
// Deliberately NOT long-term AI memory or conversation history (an explicit
// exclusion in the MB-0001B assignment): this models only the currently
// active set of commitments required for future revalidation, mirroring how
// lib/decision-review stores only what outcome tracking needs and
// lib/recommendations/RecommendationService stores only the current
// recommendation set -- no history table, no archival status, no
// generalized memory store.

export type TraderCommitmentSubjectType = 'position' | 'portfolio';

// Mirrors PortfolioObjectiveSubject's shape (lib/portfolio-intelligence) --
// deliberately, so a commitment can be matched back to the same
// position/portfolio identity every other layer in this codebase already
// uses, without importing that module's full type (this package stays
// independently testable, matching lib/todaysPriorities' and
// lib/portfolioReview's own "lean, page-agnostic input shape" convention).
export interface TraderCommitmentSubject {
  type: TraderCommitmentSubjectType;
  id: string | null;
  symbol: string | null;
  label: string;
}

interface BaseTraderCommitment {
  id: string;
  createdAt: string;
  subject: TraderCommitmentSubject;
  // The only status this foundation models -- see module doc above. A
  // commitment that is no longer relevant is removed (see store.ts's
  // removeTraderCommitment), not archived with a 'resolved'/'dismissed'
  // status, since no history/audit requirement was specified for this
  // sprint (unlike lib/decision-review, which explicitly does need that).
  status: 'active';
  // Optional trader-authored free text. `null` is an honest "no note", not
  // an empty string standing in for one.
  note: string | null;
}

export interface HoldUntilDteCommitment extends BaseTraderCommitment {
  kind: 'HOLD_UNTIL_DTE';
  targetDte: number;
}

export interface MonitorCommitment extends BaseTraderCommitment {
  kind: 'MONITOR';
  // Corrective round (post-MB-0001B foundation): MONITOR no longer implies
  // permanent silence by construction. `reviewAfter` is an explicit,
  // trader-set re-review condition -- an ISO date string meaning "check
  // this again once this date arrives" -- checked by
  // lib/revalidation/rules.ts's monitorRule against RevalidationContext.now.
  //
  // `null` is a distinct, equally explicit state: indefinite acknowledgment.
  // The trader looked at this and decided no re-review date applies at all
  // (as opposed to simply forgetting to set one) -- honest permanent
  // silence, not an unfinished field. This mirrors this codebase's existing
  // "null is an honest absence, never a stand-in for 'not implemented'"
  // convention (see `note` and GtcWorkingCommitment.orderId above).
  reviewAfter: string | null;
}

export interface LetThetaWorkCommitment extends BaseTraderCommitment {
  kind: 'LET_THETA_WORK';
}

export interface WaitForEarningsCommitment extends BaseTraderCommitment {
  kind: 'WAIT_FOR_EARNINGS';
}

export interface GtcWorkingCommitment extends BaseTraderCommitment {
  kind: 'GTC_WORKING';
  // The broker order id this commitment is tracking, when known. `null`
  // when the trader recorded the commitment without one (e.g. before the
  // order was actually placed) -- an honest gap, not a blocking error.
  orderId: string | null;
}

export type TraderCommitment =
  | HoldUntilDteCommitment
  | MonitorCommitment
  | LetThetaWorkCommitment
  | WaitForEarningsCommitment
  | GtcWorkingCommitment;

export type TraderCommitmentKind = TraderCommitment['kind'];

// Keyed by TraderCommitment.id -- the same "fetch the whole store, key by a
// stable id" shape lib/decision-review's DecisionReviewStore already uses.
export type TraderCommitmentStore = Record<string, TraderCommitment>;
