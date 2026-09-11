import { describe, expect, it } from 'vitest';
import { PMCC_FINDER_POLICY_VERSIONS } from '@/lib/scans/pmccFinderPolicy';
import { isPmccFinderSessionEnvelope, legacyPmccSessionRequiresRescan, PMCC_FINDER_CACHE_KEYS } from '../pmccFinderSessionSchema';

const envelope = {
  schemaVersion: 2,
  workflow: 'new-pmcc',
  snapshotAsOf: '2026-09-11T12:00:00Z',
  cachedAt: '2026-09-11T12:01:00Z',
  policyVersions: { ...PMCC_FINDER_POLICY_VERSIONS },
  payload: { results: [] },
} as const;

describe('PMCC finder session schema V2 design', () => {
  it('uses distinct cache keys for every workflow', () => {
    expect(new Set(Object.values(PMCC_FINDER_CACHE_KEYS)).size).toBe(3);
  });

  it('accepts only the expected workflow', () => {
    expect(isPmccFinderSessionEnvelope(envelope, 'new-pmcc')).toBe(true);
    expect(isPmccFinderSessionEnvelope(envelope, 'leaps-short-call')).toBe(false);
    expect(isPmccFinderSessionEnvelope({ ...envelope, workflow: 'leaps-short-call' }, 'new-pmcc')).toBe(false);
    expect(isPmccFinderSessionEnvelope({ ...envelope, workflow: 'leaps' }, 'new-pmcc')).toBe(false);
  });

  it('rejects legacy versions and mismatched policy versions', () => {
    expect(isPmccFinderSessionEnvelope({ ...envelope, schemaVersion: 1 }, 'new-pmcc')).toBe(false);
    expect(isPmccFinderSessionEnvelope({ ...envelope, policyVersions: { ...envelope.policyVersions, ranking: 'old' } }, 'new-pmcc')).toBe(false);
    const { payload: _payload, ...withoutPayload } = envelope;
    expect(isPmccFinderSessionEnvelope(withoutPayload, 'new-pmcc')).toBe(false);
  });

  it('requires a rescan for the ambiguous legacy pmcc identity', () => {
    expect(legacyPmccSessionRequiresRescan({ requestedStrategy: 'pmcc' })).toBe(true);
    expect(legacyPmccSessionRequiresRescan({ requestedStrategy: 'new-pmcc' })).toBe(false);
  });
});
