'use client';

import { useEffect, useMemo, useState } from 'react';
import type { PmccCampaign } from '@/lib/portfolio/pmccCampaign';
import type { PositionsWorkspaceModel } from './model/types';
import { attachPmccCampaignsToWorkspaceModel } from './model/livePmccWorkspace';

export interface LivePmccWorkspaceState {
  model: PositionsWorkspaceModel;
  loadStatus: 'loading' | 'ok' | 'unavailable';
  loadReason: string | null;
}

/**
 * Loads durable PMCC campaign state and enriches the already-canonical
 * Positions model. Failure is surfaced explicitly rather than converted into
 * an authoritative empty campaign set.
 */
export function useLivePmccWorkspaceModel(baseModel: PositionsWorkspaceModel): LivePmccWorkspaceState {
  const [campaigns, setCampaigns] = useState<PmccCampaign[]>([]);
  const [loadStatus, setLoadStatus] = useState<LivePmccWorkspaceState['loadStatus']>('loading');
  const [loadReason, setLoadReason] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    setLoadStatus('loading');
    setLoadReason(null);
    void import('@/lib/portfolio-data/pmccCampaignStore')
      .then(({ fetchPmccCampaignLoadResult }) => fetchPmccCampaignLoadResult())
      .then(result => {
        if (!active) return;
        if (result.status === 'ok') {
          setCampaigns(Object.values(result.campaigns));
          setLoadStatus('ok');
          setLoadReason(null);
        } else {
          setCampaigns([]);
          setLoadStatus('unavailable');
          setLoadReason(result.reason);
        }
      })
      .catch(error => {
        if (!active) return;
        setCampaigns([]);
        setLoadStatus('unavailable');
        setLoadReason(error instanceof Error ? error.message : 'PMCC campaign state is unavailable.');
      });
    return () => { active = false; };
  }, [baseModel.accountNumber, baseModel.snapshotAsOf, baseModel.quoteAsOf]);

  const model = useMemo(
    () => loadStatus === 'ok' ? attachPmccCampaignsToWorkspaceModel(baseModel, campaigns) : baseModel,
    [baseModel, campaigns, loadStatus],
  );

  return { model, loadStatus, loadReason };
}
