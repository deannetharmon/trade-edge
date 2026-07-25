// lib/review-conductor/index.ts
//
// MB-0001B: public interface for the Review Conductor. Consumers should
// import from '@/lib/review-conductor', not from './conductReview' or
// './types' directly.

export { conductReview } from './conductReview';
export type { ConductReviewInput, ReviewLeadItem, ReviewNarrative } from './types';
// WA-0004: the shared tracking-active/genuine-zero-change signal -- see
// trackingStatus.ts's module doc. Imported by both Mission Control and
// Briefing so neither independently hardcodes its own boolean.
export { TRADER_COMMITMENT_TRACKING_ACTIVE } from './trackingStatus';
