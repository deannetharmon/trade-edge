// lib/paper-trading/http.ts
//
// PT-0001: shared error -> HTTP status mapping so every paper-trading API
// route stays thin (no accounting formulas, no ad-hoc status-code choices
// duplicated per route -- section 10: "Contain no accounting formulas").
//
// PT-0001 corrective round (fix #4): parseManualOverrideInput() below is
// the single place every route reads a client-supplied manual-fill object
// out of a request body. It reads ONLY manualPrice/reason/confirmed --
// any confirmedByUser or confirmedAt the client sends is never even looked
// at, let alone forwarded. service.ts's resolveManualOverride() is what
// actually stamps the authenticated identity and server timestamp before
// the value reaches pricing.ts or the audit trail.

import { NextResponse } from 'next/server';
import { PaperTradingError, type PaperManualFillOverrideInput, type PaperTradingErrorCode } from './types';

export function parseManualOverrideInput(body: unknown): PaperManualFillOverrideInput | null {
  const raw = (body as { manualOverride?: unknown } | null | undefined)?.manualOverride;
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  return {
    manualPrice: Number(r.manualPrice),
    reason: typeof r.reason === 'string' ? r.reason : '',
    confirmed: Boolean(r.confirmed),
  };
}

const STATUS_BY_CODE: Record<PaperTradingErrorCode, number> = {
  VALIDATION_ERROR: 400,
  INSUFFICIENT_CAPITAL: 400,
  INVALID_QUOTE: 400,
  STALE_QUOTE_CONFIRMATION_REQUIRED: 409,
  MANUAL_OVERRIDE_CONFIRMATION_REQUIRED: 409,
  IDEMPOTENCY_CONFLICT: 409,
  POSITION_NOT_FOUND: 404,
  POSITION_ALREADY_CLOSED: 409,
  UNAUTHORIZED: 401,
  LOCK_LOST: 409,
  COMMIT_FAILED: 500,
  INTEGRITY_FAILURE: 500,
  // 409, not 500: this is a retryable state (retry/reconcile using the SAME
  // idempotency key), not a server fault report -- see PaperCommitOutcomeClass's
  // doc comment in types.ts.
  OUTCOME_UNKNOWN: 409,
};

export function paperErrorResponse(e: unknown): NextResponse {
  if (e instanceof PaperTradingError) {
    return NextResponse.json(
      { error: e.message, code: e.code, details: e.details ?? null },
      { status: STATUS_BY_CODE[e.code] ?? 400 },
    );
  }
  const message = e instanceof Error ? e.message : 'Unknown error';
  return NextResponse.json({ error: message, code: 'INTERNAL_ERROR' }, { status: 500 });
}
