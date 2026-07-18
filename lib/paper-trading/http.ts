// lib/paper-trading/http.ts
//
// PT-0001: shared error -> HTTP status mapping so every paper-trading API
// route stays thin (no accounting formulas, no ad-hoc status-code choices
// duplicated per route -- section 10: "Contain no accounting formulas").

import { NextResponse } from 'next/server';
import { PaperTradingError, type PaperTradingErrorCode } from './types';

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
