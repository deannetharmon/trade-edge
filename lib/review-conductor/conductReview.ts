// lib/review-conductor/conductReview.ts
//
// MB-0001B: the Review Conductor's one entry point. Pure and deterministic
// -- no fetch, no clock read (uses only the caller-supplied
// `input.generatedAt`), no persistence, no React. See types.ts's module doc
// for the full architecture rationale.

import type { ConductReviewInput, ReviewLeadItem, ReviewNarrative } from './types';

const REVIEW_COMPLETE_MESSAGE =
  "No unresolved high-priority items remain. We'll continue monitoring your portfolio and notify you when something materially changes.";

export function conductReview(input: ConductReviewInput): ReviewNarrative {
  // Since Your Last Review: only commitments whose revalidation actually
  // reported a change. Order is preserved from the caller's own
  // revalidationResults order -- no new ranking is introduced here (see
  // types.ts's module doc); a future sprint may order these by commitment
  // recency if that turns out to matter narratively.
  const changes = input.revalidationResults.filter((result) => result.changed);

  // Deduplication: an Attention item whose subject a commitment change
  // above already covers this cycle is dropped from Attention Required --
  // the trader has already been told about that decision via "Since Your
  // Last Review"; repeating it there would narrate the same decision twice
  // as if it were two separate problems. Portfolio-level items (no
  // subjectId) are never deduped, since they cannot be matched to a single
  // commitment subject.
  const changedSubjectIds = new Set(
    changes
      .map((result) => result.commitment.subject.id)
      .filter((id): id is string => id !== null),
  );
  const attentionItems = input.attentionFeed.orderedActionable.filter(
    (item) => item.subjectId === null || !changedSubjectIds.has(item.subjectId),
  );

  // Interruption policy ("the one thing deserves your attention"): a
  // commitment change always leads, since the trader explicitly asked to
  // be told when it happened. Otherwise, MB-0001A's own canonical
  // topAttentionItem leads -- never re-derived independently here. When
  // changes exist, attentionItems still equals attentionFeed.orderedActionable
  // unchanged only when changedSubjectIds is empty; whenever changes are
  // present this branch is not reached for topAttentionItem, so no
  // additional reconciliation between the two is required.
  const leadItem: ReviewLeadItem | null =
    changes.length > 0
      ? { kind: 'COMMITMENT_CHANGE', result: changes[0] }
      : input.attentionFeed.topAttentionItem !== null
        ? { kind: 'ATTENTION_ITEM', item: input.attentionFeed.topAttentionItem }
        : null;

  // "Silence is a feature": new opportunities alone never demand
  // interruption -- only something requiring the trader does.
  const shouldInterrupt = changes.length > 0 || attentionItems.length > 0;

  return {
    generatedAt: input.generatedAt,
    portfolioStatus: { review: input.portfolioReview },
    sinceLastReview: { changes },
    attention: { items: attentionItems },
    newOpportunities: { items: input.opportunities },
    leadItem,
    shouldInterrupt,
    counts: {
      changes: changes.length,
      attention: attentionItems.length,
      opportunities: input.opportunities.length,
    },
    complete: {
      isComplete: !shouldInterrupt,
      message: shouldInterrupt ? '' : REVIEW_COMPLETE_MESSAGE,
    },
  };
}
