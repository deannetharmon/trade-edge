import { PMCC_FINDER_POLICY_VERSIONS, type PmccFinderWorkflow } from '@/lib/scans/pmccFinderPolicy';

export const PMCC_FINDER_SESSION_SCHEMA_VERSION = 2 as const;
export const PMCC_FINDER_CACHE_KEYS: Record<PmccFinderWorkflow, string> = {
  leaps: 'screenerLeapsSession_v2',
  'new-pmcc': 'screenerNewPmccSession_v2',
  'leaps-short-call': 'screenerLeapsShortCallSession_v2',
};

export interface PmccFinderSessionEnvelope {
  schemaVersion: typeof PMCC_FINDER_SESSION_SCHEMA_VERSION;
  workflow: PmccFinderWorkflow;
  snapshotAsOf: string;
  cachedAt: string;
  policyVersions: Record<keyof typeof PMCC_FINDER_POLICY_VERSIONS, string>;
  payload: unknown;
}

const WORKFLOWS = new Set<PmccFinderWorkflow>(['leaps', 'new-pmcc', 'leaps-short-call']);

export function isPmccFinderSessionEnvelope(value: unknown, expectedWorkflow: PmccFinderWorkflow): value is PmccFinderSessionEnvelope {
  if (value == null || typeof value !== 'object') return false;
  const candidate = value as Partial<PmccFinderSessionEnvelope> & { workflow?: unknown; schemaVersion?: unknown };
  if (candidate.schemaVersion !== PMCC_FINDER_SESSION_SCHEMA_VERSION) return false;
  if (typeof candidate.workflow !== 'string' || !WORKFLOWS.has(candidate.workflow as PmccFinderWorkflow)) return false;
  if (candidate.workflow !== expectedWorkflow) return false;
  if (typeof candidate.snapshotAsOf !== 'string' || !Number.isFinite(Date.parse(candidate.snapshotAsOf))) return false;
  if (typeof candidate.cachedAt !== 'string' || !Number.isFinite(Date.parse(candidate.cachedAt))) return false;
  if (candidate.policyVersions == null || typeof candidate.policyVersions !== 'object') return false;
  if (!('payload' in candidate)) return false;
  return Object.entries(PMCC_FINDER_POLICY_VERSIONS).every(([key, version]) =>
    (candidate.policyVersions as Record<string, unknown>)[key] === version,
  );
}

export function legacyPmccSessionRequiresRescan(value: unknown): boolean {
  return value != null
    && typeof value === 'object'
    && (value as { requestedStrategy?: unknown }).requestedStrategy === 'pmcc';
}
