// lib/exit-walk/index.ts
//
// EXIT-WALK-0001A: public surface of the exit-price walk. Unwired by design: no production caller yet (the click-to-walk
// button is EXIT-WALK-0001B and needs Diane's mock and its own approval).

export { DEFAULT_EXIT_WALK_CONFIG, buildExitWalk, isInOpeningWindow, isSpreadFlagged, nextWalkPrice, toCents } from './exitWalk';
export type {
  ExitSide,
  ExitWalkConfig,
  ExitWalkHaltReason,
  ExitWalkInput,
  ExitWalkResult,
  NextWalkPrice,
  Quote,
  WalkBasis,
  WalkState,
  WalkStep,
} from './types';
