import type { PmccCampaign } from '@/lib/portfolio/pmccCampaign';

export type PmccCampaignStore = Record<string, PmccCampaign>;

export type PmccCampaignLoadResult =
  | { status: 'ok'; campaigns: PmccCampaignStore; reason: null }
  | { status: 'unavailable'; campaigns: PmccCampaignStore; reason: string };

/**
 * Status-aware read used by safety-sensitive consumers. A failed read must
 * never be indistinguishable from an authoritative empty campaign store.
 */
export async function fetchPmccCampaignLoadResult(): Promise<PmccCampaignLoadResult> {
  try {
    const res = await fetch('/api/pmcc-campaigns', { cache: 'no-store' });
    if (!res.ok) {
      return { status: 'unavailable', campaigns: {}, reason: `PMCC campaign store returned ${res.status}.` };
    }
    const data = await res.json();
    const campaigns = data?.campaigns;
    if (campaigns == null || typeof campaigns !== 'object' || Array.isArray(campaigns)) {
      return { status: 'unavailable', campaigns: {}, reason: 'PMCC campaign store response was invalid.' };
    }
    return { status: 'ok', campaigns, reason: null };
  } catch (error) {
    return {
      status: 'unavailable',
      campaigns: {},
      reason: error instanceof Error ? error.message : 'PMCC campaign store is unavailable.',
    };
  }
}

/**
 * Legacy convenience read for non-safety-sensitive callers. New close/action
 * gates should use fetchPmccCampaignLoadResult so a read failure fails closed.
 */
export async function fetchPmccCampaigns(): Promise<PmccCampaignStore> {
  const result = await fetchPmccCampaignLoadResult();
  return result.campaigns;
}

export async function upsertPmccCampaigns(campaigns: PmccCampaign[]): Promise<PmccCampaignStore | null> {
  if (campaigns.length === 0) return null;
  try {
    const res = await fetch('/api/pmcc-campaigns', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ campaigns }),
    });
    if (!res.ok) return null;
    const data = await res.json();
    return data?.campaigns ?? null;
  } catch {
    return null;
  }
}

export async function deletePmccCampaign(campaignId: string): Promise<boolean> {
  if (!campaignId) return false;
  try {
    const res = await fetch(`/api/pmcc-campaigns?id=${encodeURIComponent(campaignId)}`, { method: 'DELETE' });
    return res.ok;
  } catch {
    return false;
  }
}
