// lib/trader-commitments/index.ts
//
// MB-0001B: public interface for the Trader Commitment domain model.
// Consumers should import from '@/lib/trader-commitments', not from
// './types' or './store' directly.

export type {
  TraderCommitment,
  TraderCommitmentKind,
  TraderCommitmentStore,
  TraderCommitmentSubject,
  TraderCommitmentSubjectType,
  HoldUntilDteCommitment,
  MonitorCommitment,
  LetThetaWorkCommitment,
  WaitForEarningsCommitment,
  GtcWorkingCommitment,
} from './types';

export {
  createTraderCommitment,
  createTraderCommitmentId,
  upsertTraderCommitment,
  removeTraderCommitment,
  listActiveCommitments,
  commitmentsForSubject,
  parseTraderCommitmentStore,
} from './store';
export type { CreateTraderCommitmentInput } from './store';
