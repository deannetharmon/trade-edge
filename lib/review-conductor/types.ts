// lib/review-conductor/types.ts
//
// MB-0001B: the Review Conductor's public contract. See
// docs/design/MB-0001B-Review-Conductor-Foundation.md for the full
// architecture rationale. The Conductor is a pure composition/orchestration
// layer -- it introduces no new scoring, ranking, or actionability logic of
// its own. Every ranked list it hands out (attention items, opportunities,
// portfolio health) was already computed, in full, by an existing producer:
//
//   lib/morning-briefing   -- AttentionFeed (MB-0001A): deduplicated,
//                             globally-ordered IMMEDIATE/WATCH items, plus
//                             the canonical topAttentionItem.
//   lib/portfolioReview    -- PortfolioReviewSnapshot (PI-0012A): health,
//                             top risks, composition.
//   lib/opportunity-engine /
//   lib/recommendations    -- ranked OpportunityRecommendation[] (OE-0001/
//                             OE-0002B).
//   lib/revalidation       -- RevalidationResult[] (MB-0001B): one entry per
//                             active Trader Commitment, produced this
//                             review cycle.
//
// The Conductor's own responsibilities (ordering, prioritization,
// deduplication, interruption policy, narrative flow -- per the MB-0001B
// assignment) are implemented here as: fixed narrative section order,
// pass-through of each producer's own existing order (no re-ranking),
// removing an Attention item whose subject a Trader Commitment change
// already covers this cycle (deduplication), and a single boolean +
// message answering "does this review need to interrupt the trader at all"
// (interruption policy / "silence is a feature").

import type { AttentionFeed, AttentionItem } from '@/lib/morning-briefing';
import type { OpportunityRecommendation } from '@/lib/opportunity-engine';
import type { PortfolioReviewSnapshot } from '@/lib/portfolioReview';
import type { RevalidationResult } from '@/lib/revalidation';

export interface ConductReviewInput {
  generatedAt: string;
  // PI-0012A's composition, reused verbatim -- health, top risks, and
  // portfolio composition all already computed.
  portfolioReview: PortfolioReviewSnapshot;
  // MB-0001A's composition, reused verbatim -- already deduplicated and
  // globally ordered by score/source-precedence/id, with a canonical
  // topAttentionItem already resolved from selectTopPriority().
  attentionFeed: AttentionFeed;
  // OE-0001/OE-0002B's already-ranked candidate feed. May be empty when no
  // scan has produced one yet -- an honest empty state, not fabricated.
  opportunities: OpportunityRecommendation[];
  // One RevalidationResult per active Trader Commitment for this review
  // cycle, already produced by lib/revalidation. The Conductor does not
  // call the Revalidation Engine itself -- the caller supplies its output,
  // keeping this module's own dependency surface to data shapes only.
  revalidationResults: RevalidationResult[];
}

// "The one thing" the narrative opens with (Reading Flow: "One thing
// deserves your attention"). A commitment change always outranks a plain
// attention item here -- the trader explicitly asked to be told when a
// commitment's condition changed, which is a stronger claim on their
// attention than an item Today's Priorities surfaced on its own.
export type ReviewLeadItem =
  | { kind: 'COMMITMENT_CHANGE'; result: RevalidationResult }
  | { kind: 'ATTENTION_ITEM'; item: AttentionItem };

export interface ReviewNarrative {
  generatedAt: string;

  // Narrative section 1: Portfolio Status ("Am I okay?").
  portfolioStatus: {
    review: PortfolioReviewSnapshot;
  };

  // Narrative section 2: Since Your Last Review ("Did anything important
  // change?"). Only commitments whose revalidation actually reported a
  // change -- an empty array here is the honest, common, expected case,
  // not a missing-data problem.
  sinceLastReview: {
    changes: RevalidationResult[];
  };

  // Narrative sections 3-5: Attention Required / Recommended Actions /
  // Supporting Evidence. These three narrative beats are three facets of
  // the same underlying AttentionItem (its `headline`, `recommendedAction`,
  // and `explanation` fields respectively, all already populated by
  // MB-0001A) -- not three separate data queries. Presenting them as three
  // reading beats from one item list is a presentation-layer concern,
  // deferred to the future page refactor; the Conductor hands out one
  // deduplicated, already-ordered list. Items whose subject a commitment
  // change above already covers this cycle are removed here (see the
  // Conductor's dedup policy) so the same decision is never narrated twice.
  attention: {
    items: AttentionItem[];
  };

  // Narrative section 6: New Opportunities ("what's next"). Deliberately a
  // separate feed from `attention` -- Opportunity Engine candidates concern
  // new trades, not existing positions/objectives, and were already kept
  // as a distinct feed by OE-0002B's own design.
  newOpportunities: {
    items: OpportunityRecommendation[];
  };

  // Interruption policy / "silence is a feature": null when there is
  // genuinely nothing to lead with.
  leadItem: ReviewLeadItem | null;

  // True when anything in `sinceLastReview.changes` or `attention.items`
  // exists -- i.e., this review has something that needs the trader.
  // `newOpportunities` never triggers an interruption on its own (a new
  // opportunity is worth surfacing, not worth demanding attention for).
  shouldInterrupt: boolean;

  counts: {
    changes: number;
    attention: number;
    opportunities: number;
  };

  // Narrative section 7: Review Complete.
  complete: {
    isComplete: boolean;
    message: string;
  };
}
