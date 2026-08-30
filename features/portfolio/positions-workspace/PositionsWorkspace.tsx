'use client';

import type { ComponentProps } from 'react';
import { LeapsPmccWorkspaceSummary } from './LeapsPmccWorkspaceSummary';
import {
  PositionsWorkspace as PositionsWorkspaceBase,
  isPositionsWorkspaceV2Enabled,
  profitTargetPresentation,
} from './PositionsWorkspaceBase';
import type { WorkspaceAiAnalysis } from './PositionsWorkspaceBase';
import { useLivePmccWorkspaceModel } from './useLivePmccWorkspaceModel';

export { isPositionsWorkspaceV2Enabled, profitTargetPresentation };
export type { WorkspaceAiAnalysis };

type PositionsWorkspaceProps = ComponentProps<typeof PositionsWorkspaceBase>;

/**
 * Live wrapper around the previously-approved workspace implementation.
 * Durable PMCC campaigns are loaded independently from the broker snapshot,
 * enriched into the canonical model, and surfaced before the unchanged base
 * workspace. A failed campaign read is explicit and therefore cannot masquerade
 * as an authoritative empty relationship set.
 */
export function PositionsWorkspace(props: PositionsWorkspaceProps) {
  const live = useLivePmccWorkspaceModel(props.model);
  return <>
    <div className="px-4 pt-4 sm:px-6 sm:pt-6">
      <LeapsPmccWorkspaceSummary
        model={live.model}
        th={props.th}
        campaignLoadUnavailableReason={live.loadStatus === 'unavailable' ? live.loadReason : null}
      />
    </div>
    <PositionsWorkspaceBase {...props} model={live.model} />
  </>;
}
