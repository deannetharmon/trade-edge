// lib/exit-walk/index.ts
//
// EXIT-WALK-0001A/B: public surface of the exit-price walk. Unwired by design: no production caller yet (the click-to-walk
// button is EXIT-WALK-0001B steps 2-3; step 1 is the step loop in run.ts).

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
export { checkWalkStart, runExitWalk } from './run';
export type {
  ExitWalkDeps,
  ExitWalkLogEntry,
  ExitWalkLogState,
  ExitWalkOutcome,
  ExitWalkStopReason,
  RunExitWalkInput,
  WalkRefusal,
  WalkStartCheck,
  WalkStartInput,
} from './run';
export { centsToPriceString, createBrowserExitWalkDeps, createDryRunExitWalkDeps, exitQuoteFromLegs } from './browserDeps';
export type { BrowserExitWalkConfig } from './browserDeps';
