// lib/revalidation/index.ts
//
// MB-0001B: public interface for the Revalidation Engine. Consumers should
// import from '@/lib/revalidation', not from './types', './rules', or
// './revalidateCommitment' directly.

export { revalidateCommitment, revalidateCommitments } from './revalidateCommitment';
export { DEFAULT_REVALIDATION_RULES } from './rules';
export type {
  RevalidationChange,
  RevalidationContext,
  RevalidationPositionContext,
  RevalidationResult,
  RevalidationRule,
  RevalidationRuleRegistry,
} from './types';
