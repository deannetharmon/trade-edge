// lib/command-center/index.ts
//
// TC-0001: Trade Command Center composition layer public barrel.

export { buildCommandCenterViewModel } from './buildCommandCenterViewModel';
export type {
  CommandCenterViewModel,
  CommandCenterPanelState,
  CommandCenterHeaderViewModel,
  CommandCenterBriefingViewModel,
  CommandCenterPrioritiesViewModel,
  CommandCenterHealthViewModel,
  CommandCenterOpportunityViewModel,
  CommandCenterTasksViewModel,
  BuildCommandCenterViewModelInput,
} from './types';
