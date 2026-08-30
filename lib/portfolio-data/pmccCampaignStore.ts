import type { PmccCampaign } from '@/lib/portfolio/pmccCampaign';

export type PmccCampaignStore = Record<string, PmccCampaign>;

export async function fetchPmccCampaigns(): Promise<PmccCampaignStore> {
  try {
    const res = await fetch('/api/pmcc-campaigns', { cache: 'no-store' });
    if (!res.ok) return {};
    const data = await res.json();
    return data?.campaigns ?? {};
  } catch {
    return {};
  }
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
