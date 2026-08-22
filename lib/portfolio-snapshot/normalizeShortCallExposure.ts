// lib/portfolio-snapshot/normalizeShortCallExposure.ts
//
// LCC-0001A PR 2 — short-call exposure normalization. Implements
// docs/design/LCC-0001A-technical-spec.md §8 ("normalizeShortCallExposure.ts, also verbatim").
//
// Ports lib/scans/covered-call-capacity.ts's normalizeShortCallExposure() (lines 169-213 at the
// time this ticket was specified) verbatim, with zero behavior change -- only relocated into the
// shared snapshot layer so it operates on the same raw positions array normalizeEquity.ts and the
// existing option-grouping logic already consume, rather than a second, independent fetch.
//
// Fail-closed contract, unchanged from the source module: an OPEN short option position that
// cannot be attributed to any underlying at all (no usable underlying-symbol field AND an
// unparseable/absent OCC symbol) is NEVER silently folded into any symbol's exposure count.
// hasUnattributableExposure signals that the caller must fail the entire report closed, per
// LCC-0001A technical spec §9.

import { resolveOptionType, resolveUnderlyingSymbol } from '@/lib/optionSymbol';

export interface RawPositionLike {
  'instrument-type'?: string;
  'underlying-symbol'?: string;
  symbol?: string;
  'option-type'?: string;
  quantity?: string | number;
  'quantity-direction'?: string;
  multiplier?: string | number;
  deliverable?: unknown;
}

export interface ShortCallExposureResult {
  bySymbol: Record<string, number>;
  // Symbols carrying at least one SHORT option position whose call/put classification could not
  // be determined from either an explicit, valid option-type field or the OCC symbol. Its
  // quantity IS still folded into bySymbol above (conservatively treated as a call, so
  // exposure/capacity can never be overstated by an unclassifiable position) -- this set exists
  // so callers/UI can flag "some positions could not be verified" rather than silently trusting a
  // number that is safe-by-construction but not a confirmed fact.
  unclassifiedSymbols: Set<string>;
  // True when at least one OPEN short option position (instrument-type option,
  // quantity-direction Short, quantity > 0) could not be attributed to ANY underlying symbol at
  // all -- neither a usable underlying-symbol field nor a parseable OCC symbol. Unlike
  // unclassifiedSymbols (underlying known, type unknown -- safe to reserve conservatively), this
  // case means we don't know WHICH symbol's capacity is affected, so no per-symbol fix is safe.
  // bySymbol deliberately does NOT include this position's quantity anywhere -- the caller must
  // fail the whole report closed instead.
  hasUnattributableExposure: boolean;
  warnings: string[];
  hasAdjustedOrUnknownDeliverable: boolean;
}

// Sums OPEN short equity/index call contracts per underlying symbol. Long calls never consume
// coverage (they don't create it either -- that's a separate, deliberate omission). A
// genuinely-classified short PUT is filtered out (it can never consume call coverage); a short
// option whose type can't be classified at all is conservatively counted AS a call, never
// silently treated as zero -- see resolveOptionType's doc comment for why raw broker option-type
// cannot be trusted to always be present.
export function normalizeShortCallExposure(rawPositions: RawPositionLike[]): ShortCallExposureResult {
  const out: Record<string, number> = {};
  const unclassifiedSymbols = new Set<string>();
  const warnings: string[] = [];
  let hasUnattributableExposure = false;
  let hasAdjustedOrUnknownDeliverable = false;

  for (const p of rawPositions) {
    const instrumentType = p['instrument-type'];
    if (instrumentType !== 'Equity Option' && instrumentType !== 'Index Option') continue;
    if (p['quantity-direction'] !== 'Short') continue;

    const qty = Number(p.quantity ?? 0);
    if (!(qty > 0)) continue; // not actually open exposure -- irrelevant to attribution

    const multiplier = p.multiplier == null ? 100 : Number(p.multiplier);
    if (!Number.isFinite(multiplier) || multiplier !== 100 || p.deliverable != null) {
      hasAdjustedOrUnknownDeliverable = true;
      warnings.push('Adjusted or unresolved option deliverable detected — Covered Call capacity cannot be safely verified.');
    }

    const symbol = resolveUnderlyingSymbol(p['underlying-symbol'], p.symbol);
    if (!symbol) {
      // This is a genuinely OPEN short option (confirmed instrument type, Short direction,
      // positive quantity) with no usable underlying-symbol field AND an unparseable/absent OCC
      // symbol. We cannot know which holding's capacity this affects, so it must never be
      // silently dropped -- fail the whole report closed instead of continuing past it.
      hasUnattributableExposure = true;
      warnings.push(
        `Existing short option position (symbol "${p.symbol ?? 'unknown'}") could not be attributed to an underlying holding — Covered Call capacity cannot be safely verified.`,
      );
      continue; // still never fold an unattributable qty into any symbol's bySymbol
    }

    const optionType = resolveOptionType(p['option-type'], p.symbol);
    if (optionType === 'P') continue; // confirmed put -- never consumes call coverage

    if (optionType === null) {
      // Neither the broker's option-type field nor the OCC symbol could classify this short
      // option. Reserve it conservatively (as a call) rather than silently ignoring it -- an
      // unclassifiable short option must never leave capacity looking available when it might not
      // be.
      unclassifiedSymbols.add(symbol);
    }

    out[symbol] = (out[symbol] ?? 0) + qty;
  }
  return { bySymbol: out, unclassifiedSymbols, hasUnattributableExposure, hasAdjustedOrUnknownDeliverable, warnings };
}
