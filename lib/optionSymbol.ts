// lib/optionSymbol.ts
//
// TE-0007C corrective round: canonical, pure OCC option-symbol parser shared
// by any module that needs to classify a raw broker option leg/position when
// an explicit `option-type` field cannot be trusted to exist. Raw TastyTrade
// broker payloads do NOT reliably carry `option-type` on every position/order
// leg -- lib/portfolio-data/acquisition.ts already established this pattern
// (its own parseOptionSymbol derives put/call from the OCC symbol for every
// real position leg it processes, never from a broker-supplied option-type
// field). This module gives lib/scans/* the same safety property without
// importing acquisition.ts (a large, side-effectful portfolio module) into
// the pure lib/scans layer.
//
// Deliberately null-safe, unlike acquisition.ts's parseOptionSymbol (which
// silently defaults an unparseable symbol to `optionType: 'C', strikePrice:
// 0` -- exactly the "silently ignore an unclassifiable option" failure mode
// TE-0007C's corrective round must not repeat). An unparseable symbol here
// returns `optionType: null` so callers are forced to handle "unknown"
// explicitly rather than accidentally treating it as a real classification.

export interface ParsedOccSymbol {
  underlyingSymbol: string | null;
  optionType: 'P' | 'C' | null;
  strikePrice: number | null;
  expiry: string | null; // YYYY-MM-DD
}

// Standard OCC option symbol: root (1-6 letters, no padding required here --
// callers should strip whitespace first, which this function also does
// defensively), 6-digit date (YYMMDD), C/P, 8-digit strike (thousandths).
const OCC_SYMBOL_RE = /^([A-Z]{1,6})(\d{6})([CP])(\d{8})$/;

export function parseOccSymbol(rawSymbol: string | null | undefined): ParsedOccSymbol {
  const cleaned = String(rawSymbol ?? '').replace(/\s+/g, '').toUpperCase();
  const match = cleaned.match(OCC_SYMBOL_RE);
  if (!match) {
    return { underlyingSymbol: null, optionType: null, strikePrice: null, expiry: null };
  }
  const [, root, dateDigits, cp, strikeDigits] = match;
  const yy = dateDigits.slice(0, 2);
  const mm = dateDigits.slice(2, 4);
  const dd = dateDigits.slice(4, 6);
  return {
    underlyingSymbol: root,
    optionType: cp as 'P' | 'C',
    strikePrice: parseInt(strikeDigits, 10) / 1000,
    expiry: `20${yy}-${mm}-${dd}`,
  };
}

// Resolves an option's call/put classification with explicit-field priority:
// trust a valid broker `option-type` value ('P'/'C') when present; otherwise
// fall back to OCC-symbol parsing. Returns null (never a silent default)
// when NEITHER source yields a valid classification -- callers must treat
// null as "unknown," not as "not a call."
export function resolveOptionType(
  explicitOptionType: string | null | undefined,
  occSymbol: string | null | undefined,
): 'P' | 'C' | null {
  if (explicitOptionType === 'P' || explicitOptionType === 'C') return explicitOptionType;
  return parseOccSymbol(occSymbol).optionType;
}

// Resolves the underlying symbol with the same explicit-field-first
// priority: a verified `underlying-symbol` broker field, falling back to the
// OCC symbol's parsed root. Returns null if neither source is usable.
export function resolveUnderlyingSymbol(
  explicitUnderlying: string | null | undefined,
  occSymbol: string | null | undefined,
): string | null {
  if (explicitUnderlying) return explicitUnderlying;
  return parseOccSymbol(occSymbol).underlyingSymbol;
}
