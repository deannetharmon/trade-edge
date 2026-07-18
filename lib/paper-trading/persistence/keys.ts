// lib/paper-trading/persistence/keys.ts
//
// PT-0001's own Redis key namespace for the pieces that are NOT part of the
// shared canonical account record (idempotency, audit, mutation lock). The
// ledger itself is not given its own key — it lives inside the existing
// `autopilot:paper-account:<userId>` record's new `paperTrading` field (see
// persistence/store.ts and lib/paper-trading/types.ts's module doc comment).

export function paperMutationLockKey(userId: string): string {
  return `paper-trading:mutation-lock:${userId}`;
}

export function paperIdempotencyKey(userId: string, operation: string, idempotencyKey: string): string {
  return `paper-trading:idempotency:${userId}:${operation}:${idempotencyKey}`;
}

export function paperAuditKey(userId: string): string {
  return `paper-trading:audit:${userId}`;
}
