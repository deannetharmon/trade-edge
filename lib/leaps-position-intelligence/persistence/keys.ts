import { createHash } from 'crypto';

/**
 * `canonicalAccountId` is an authorized opaque server identifier. It is not a
 * broker account number. Hashing each segment makes accidental raw identity
 * leakage into Redis keys or telemetry materially harder.
 */
function segment(value: string): string {
  return createHash('sha256').update(value).digest('base64url');
}

export function mandateKey(userId: string, canonicalAccountId: string, longOccSymbol: string): string {
  return `leaps-pi:mandate:${segment(userId)}:${segment(canonicalAccountId)}:${segment(longOccSymbol)}`;
}

export function ledgerKey(userId: string, canonicalAccountId: string, longOccSymbol: string): string {
  return `leaps-pi:ledger:${segment(userId)}:${segment(canonicalAccountId)}:${segment(longOccSymbol)}`;
}

export function idempotencyKey(userId: string, canonicalAccountId: string, longOccSymbol: string, key: string): string {
  return `leaps-pi:idem:${segment(userId)}:${segment(canonicalAccountId)}:${segment(longOccSymbol)}:${segment(key)}`;
}
