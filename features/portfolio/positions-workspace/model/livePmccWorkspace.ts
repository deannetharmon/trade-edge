import type { PmccCampaign } from '@/lib/portfolio/pmccCampaign';
import type { PositionsWorkspaceModel } from './types';
import { buildPmccCampaignViewModels, pmccCampaignForLongPosition } from './pmccIntegration';

/**
 * Enriches an already-built Positions workspace model with authoritative PMCC
 * campaign relationships. This keeps PMCC relationship/accounting logic out
 * of React while allowing campaign persistence to load independently of the
 * broker snapshot.
 */
export function attachPmccCampaignsToWorkspaceModel(
  model: PositionsWorkspaceModel,
  campaigns: readonly PmccCampaign[],
): PositionsWorkspaceModel {
  const positions = model.analysisRows.map(row => row.position);
  const campaignViews = buildPmccCampaignViewModels(positions, campaigns);

  return {
    ...model,
    pmccCampaigns: campaignViews,
    symbolGroups: model.symbolGroups.map(group => {
      const groupCampaigns = campaignViews.filter(campaign =>
        campaign.underlying.toUpperCase() === group.symbol.toUpperCase()
        || group.options.some(position => position.key === campaign.longPositionKey)
      );
      return {
        ...group,
        pmccCampaigns: groupCampaigns,
        optionInstruments: group.optionInstruments.map(instrument => ({
          ...instrument,
          pmccCampaign: pmccCampaignForLongPosition(instrument.position, campaignViews),
        })),
      };
    }),
  };
}
