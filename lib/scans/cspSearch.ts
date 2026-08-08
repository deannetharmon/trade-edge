// lib/scans/cspSearch.ts
//
// CSP-0002 — Candidate Discovery, Truthful Diagnostics, and Result Metric
// Completeness.
//
// Root cause this module exists to fix: the previous CSP path delegated to
// Wheel's findBestWheelContract() (lib/wheel/chainSearch.ts), which (1) picks
// only the single contract whose |delta| is closest to the center of the
// configured delta range, completely ignoring liquidity, then (2) findBestCsp
// rejected that ONE contract outright (returning null) if it happened to have
// low open interest or a wide bid/ask spread — even when other, perfectly
// liquid contracts existed inside the same DTE/delta window. The Screener
// then reported "No qualifying put found in delta X-Y / DTE A-B window",
// which is false whenever ANY put existed in that window; it only meant the
// single closest-to-center contract wasn't liquid enough.
//
// This module performs an EXHAUSTIVE search of the put chain, structurally
// discovering every contract inside the DTE and delta windows before any
// liquidity judgment is made, so a bad closest-to-center contract can never
// hide a better one. It stays pure/framework-free (no I/O, no React) and
// independent of lib/wheel/chainSearch.ts's findBestWheelContract — that
// function is untouched and keeps serving the Wheel page and Covered Call
// finder exactly as before (see docs/reviews/CSP-0002-Implementation-Report.md
// "Wheel compatibility" for the audit proving no other caller is affected).
//
// ── FOUR DISCOVERY STAGES ──────────────────────────────────────────────────
// Stage 1 (DTE eligibility): normalize expirations once, count how many fall
//   inside the inclusive [DTE_MIN, DTE_MAX] window. None -> reason
//   NO_EXPIRATION_IN_DTE_WINDOW.
// Stage 2 (option type + delta): put legs only, abs(delta) inclusive within
//   [DELTA_MIN, DELTA_MAX]. None -> reason NO_PUT_IN_DELTA_WINDOW.
// Stage 3 (quote validity): a candidate needs a finite, sane strike, delta,
//   bid, ask (bid <= ask, both >= 0), a usable mid (given or safely derived),
//   a valid expiration, and a finite non-negative open interest. Missing OI
//   is NEVER coerced into a passing value — it simply fails validity (and,
//   downstream, the OI threshold too) like any other missing field. None
//   valid -> reason NO_VALID_QUOTE.
// Stage 4 (liquidity evaluation): every structurally valid candidate — not
//   just one — is evaluated against OI_MIN and BID_ASK_MAX independently.
//   A bad candidate never causes the search to return null; it is preserved
//   with an honest status so the caller can still find a better candidate or
//   display the bad one for audit.
//
// ── SELECTION POLICY ────────────────────────────────────────────────────────
// CSP-0002 corrective pass — BLOCKER fix. The original version of this
// policy selected from an "ELIGIBLE" tier defined as (oiPassing &&
// bidAskPassing), while findBestCsp() (one layer up) qualifies a candidate
// on bid/ask width and capital alone — treating low OI as advisory. Those
// two policies disagreed, and the disagreement could hide a genuinely
// qualified candidate: a narrow-market, low-OI candidate (which
// findBestCsp() WOULD qualify, with a warning) could lose the selection to a
// wide-market, sufficient-OI candidate (which findBestCsp() would NOT
// qualify) simply because the old tier required both to pass. The selection
// tier below now matches the real qualification rule exactly.
//
// 1. Prefer a candidate satisfying the actual hard qualification rule —
//    bid/ask width within the configured maximum (status FULLY_QUALIFIED or
//    QUALIFIED_LOW_OI). Open interest is advisory only and never removes a
//    candidate from this tier — see findBestCsp() in csp-finder.ts, which is
//    the sole source of truth for what "qualified" means; this module's
//    selection tier exists only to agree with it, not to define its own
//    stricter standard.
// 2. Within that tier, prefer |delta| closest to the midpoint of the
//    configured delta range.
// 3. Then prefer a narrower bid/ask width.
// 4. Then, when otherwise comparable, prefer a candidate whose open interest
//    meets the configured minimum over one that doesn't (a tie-break
//    preference for the advisory signal — never a filter).
// 5. Then prefer higher raw open interest.
// 6. Then earlier expiration, then lower strike (deterministic, arbitrary
//    tie-breakers — documented here rather than left to object/array
//    iteration order).
//
// If at least one hard-qualified (bid/ask-passing) candidate exists, that's
// the selection pool — regardless of its OI. Only when NO candidate passes
// the hard bid/ask rule does the search fall back to the best structurally
// valid (but wide-market) candidate, purely for audit display. It is never
// hidden and never silently discarded.

import type { WheelChainResult } from '@/lib/wheel/chainSearch';
import { classifyCspLiquidity, type CspLiquidityClass } from './cspQualification';
import { buildCandidateId } from './candidateIdentity';

function daysUntil(dateStr: string): number {
  const [y, m, d] = dateStr.split('-').map(Number);
  const target = new Date(y, m - 1, d);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return Math.round((target.getTime() - today.getTime()) / 86_400_000);
}

export interface CspSearchRules {
  deltaMin: number;
  deltaMax: number;
  dteMin: number;
  dteMax: number;
  oiMin: number;
  bidAskMax: number;
}

// CSP-0002 corrective pass — renamed from the original ELIGIBLE /
// LOW_OPEN_INTEREST / BID_ASK_TOO_WIDE / LOW_OI_AND_WIDE_MARKET set, which
// described low OI as if it were a hard eligibility failure on par with a
// wide market. It isn't: per findBestCsp()'s qualification rule, only
// bid/ask width (and capital) disqualify a candidate — OI is advisory. The
// new names say so directly:
//   FULLY_QUALIFIED               — passes both OI and bid/ask width.
//   QUALIFIED_LOW_OI               — passes bid/ask width; OI is below the
//                                     preferred minimum (a warning, still
//                                     qualified).
//   DISQUALIFIED_WIDE_MARKET       — bid/ask width exceeds the maximum; OI
//                                     is fine. Disqualified regardless of OI.
//   DISQUALIFIED_WIDE_MARKET_LOW_OI — bid/ask width exceeds the maximum AND
//                                     OI is below the preferred minimum.
//                                     Disqualified for the width reason;
//                                     the OI shortfall is additional context.
export type CspCandidateStatus =
  | 'FULLY_QUALIFIED'
  | 'QUALIFIED_LOW_OI'
  | 'DISQUALIFIED_WIDE_MARKET'
  | 'DISQUALIFIED_WIDE_MARKET_LOW_OI';

// The structural + liquidity result for one contract. Deliberately its own
// type rather than lib/scans/types.ts's SpreadCandidate — this module is a
// pure search step; mapping into the richer, multi-strategy SpreadCandidate
// shape (with computed credit/ROC/breakeven/etc.) is csp-finder.ts's job, one
// layer up. Field names differ slightly from the ticket's illustrative
// interface for this reason; the distinctions (status, diagnostics, reason)
// are preserved exactly and are what's tested.
export interface CspRawCandidate {
  expirationDate: string;
  dte: number;
  strikePrice: number;
  /** Always the absolute value — raw put delta is negative on every real
   * chain; this is normalized exactly once, here. */
  delta: number;
  bid: number;
  ask: number;
  mid: number;
  openInterest: number;
  occSymbol: string;
  bidAskWidth: number;
  /** Width as a percentage of midpoint — e.g. 0.10 wide on a $11.05 mid is
   * ~15%, materially different from 0.10 wide on a $0.50 mid. Retained so
   * callers/reports can compare the absolute vs. percentage-of-mid policy
   * question raised in the ticket without recomputing it. */
  bidAskWidthPct: number;
  status: CspCandidateStatus;
  oiPassing: boolean;
  bidAskPassing: boolean;
  /** CSP-WORKFLOW-0001 — stable identity: valid OCC symbol when present,
   * else the validated strategy+underlying+expiration+type+strike
   * composite. See lib/scans/candidateIdentity.ts. */
  candidateId: string;
  /** CSP-WORKFLOW-0001 — relative liquidity classification (STRONG /
   * BORDERLINE / POOR), replacing the flat $0.10 rule as the primary
   * liquidity signal. bidAskPassing above is retained for backward
   * compatibility and is derived from this (POOR fails; STRONG/BORDERLINE
   * pass — BORDERLINE additionally carries a warning, applied one layer up
   * in csp-finder.ts). */
  liquidityClass: CspLiquidityClass;
}

export interface CspSearchDiagnostics {
  expirationsInDteWindow: number;
  putsInDeltaWindow: number;
  validQuoteCandidates: number;
  oiPassingCandidates: number;
  spreadPassingCandidates: number;
}

export type CspSearchFailureReason =
  | 'NO_EXPIRATION_IN_DTE_WINDOW'
  | 'NO_PUT_IN_DELTA_WINDOW'
  | 'NO_VALID_QUOTE'
  | null;

export interface CspSearchResult {
  /** CSP-WORKFLOW-0001 (BLOCKER-01 fix) — EVERY structurally valid,
   * classified candidate discovered in the DTE/delta window, not just the
   * single best one. This is the canonical candidate universe for the
   * symbol; nothing downstream should reduce it further before market
   * qualification/account eligibility/scoring/session recording, each of
   * which now runs independently per candidate. Always in the same
   * (ranked) order as before for convenience, but callers that only take
   * the first element are reintroducing the single-candidate defect this
   * ticket exists to fix. */
  candidates: CspRawCandidate[];
  /** @deprecated kept for backward compatibility with any caller that only
   * wants "the one best candidate" (e.g. a quick summary) — always equal to
   * candidates[0] when candidates is non-empty. New code should iterate
   * `candidates`, not read this field. */
  selectedCandidate: CspRawCandidate | null;
  /** @deprecated see selectedCandidate. */
  selectedStatus: CspCandidateStatus | null;
  diagnostics: CspSearchDiagnostics;
  reason: CspSearchFailureReason;
}

function isFiniteNumber(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

// CSP-0002 corrective pass — IMPORTANT fix. A supplied `mid` was previously
// trusted outright as long as it was finite and non-negative, even if it
// fell outside [bid, ask]. A stale or malformed midpoint silently distorts
// every downstream number derived from it (credit, premium, breakeven, ROC,
// bidAskWidthPct, and therefore candidate ranking itself). The canonical
// rule: a supplied mid is only usable when it falls within [bid, ask] for a
// valid two-sided quote (bid <= ask, both already validated by the caller);
// otherwise the midpoint is derived as (bid + ask) / 2. One rule, applied
// once, here — no caller downstream re-derives or second-guesses it.
function deriveUsableMid(bid: number, ask: number, suppliedMid: number | undefined): number {
  const canonical = (bid + ask) / 2;
  if (isFiniteNumber(suppliedMid) && suppliedMid >= bid && suppliedMid <= ask) {
    return suppliedMid;
  }
  return canonical;
}

// Stage 3 — a candidate is structurally valid only when every required field
// is present, finite, and internally consistent. This never coerces a
// missing/invalid OI into a passing (or even zero) value that would make it
// look evaluated when it wasn't; it simply excludes the leg from the valid
// set, exactly like a missing bid or ask would.
function toValidCandidate(leg: {
  strikePrice: number;
  expirationDate: string;
  delta: number | null;
  bid: number;
  ask: number;
  mid?: number;
  openInterest: number;
  occSymbol: string;
}, dte: number, underlyingSymbol: string): CspRawCandidate | null {
  if (!isFiniteNumber(leg.strikePrice) || leg.strikePrice <= 0) return null;
  if (leg.delta == null || !isFiniteNumber(leg.delta)) return null;
  if (!isFiniteNumber(leg.bid) || leg.bid < 0) return null;
  if (!isFiniteNumber(leg.ask) || leg.ask < 0) return null;
  if (leg.bid > leg.ask) return null; // crossed quote — unusable
  if (!isFiniteNumber(leg.openInterest) || leg.openInterest < 0) return null;
  if (!leg.expirationDate) return null;

  const mid = deriveUsableMid(leg.bid, leg.ask, leg.mid);
  if (!isFiniteNumber(mid) || mid < 0) return null;

  const bidAskWidth = parseFloat((leg.ask - leg.bid).toFixed(4));
  const bidAskWidthPct = mid > 0 ? parseFloat(((bidAskWidth / mid) * 100).toFixed(2)) : Infinity;
  const candidateId = buildCandidateId({
    occSymbol: leg.occSymbol,
    strategy: 'CSP',
    underlyingSymbol,
    expiration: leg.expirationDate,
    optionType: 'put',
    strike: leg.strikePrice,
  });

  return {
    expirationDate: leg.expirationDate,
    dte,
    strikePrice: leg.strikePrice,
    delta: Math.abs(leg.delta),
    bid: leg.bid,
    ask: leg.ask,
    mid,
    openInterest: leg.openInterest,
    occSymbol: leg.occSymbol,
    bidAskWidth,
    bidAskWidthPct,
    status: 'FULLY_QUALIFIED', // provisional — Stage 4 fills in the real status
    oiPassing: false,
    bidAskPassing: false,
    candidateId,
    liquidityClass: 'POOR', // provisional — Stage 4 fills in the real classification
  };
}

// CSP-WORKFLOW-0001 — classification now uses the relative liquidity policy
// (classifyCspLiquidity: strongLimit = max($0.10, 10% of mid); borderline up
// to 15% of mid; poor beyond that) instead of the flat rules.bidAskMax
// figure. `rules.bidAskMax` is retained on CspSearchRules for backward
// compatibility (some callers still read/display it) but no longer governs
// pass/fail on its own — see docs/reviews/FIND-CSP-Comprehensive-Code-Audit.md
// §8 for the audited evidence this replaces (a flat $0.10 rule fails almost
// every higher-premium CSP even when its market is proportionally tight).
function classify(candidate: CspRawCandidate, rules: CspSearchRules): CspRawCandidate {
  const oiPassing = candidate.openInterest >= rules.oiMin;
  const { liquidityClass } = classifyCspLiquidity(candidate.bidAskWidth, candidate.mid);
  const bidAskPassing = liquidityClass !== 'POOR';
  const status: CspCandidateStatus =
    oiPassing && bidAskPassing ? 'FULLY_QUALIFIED'
    : !oiPassing && !bidAskPassing ? 'DISQUALIFIED_WIDE_MARKET_LOW_OI'
    : !oiPassing ? 'QUALIFIED_LOW_OI'
    : 'DISQUALIFIED_WIDE_MARKET';
  return { ...candidate, oiPassing, bidAskPassing, status, liquidityClass };
}

// Deterministic ranking within a candidate pool (either "hard-qualified
// only" or "every structurally valid candidate") — see the module header
// for the exact policy. Returns a NEW sorted array; does not mutate its
// input.
function rankCandidates(candidates: CspRawCandidate[], deltaCenter: number): CspRawCandidate[] {
  return [...candidates].sort((a, b) => {
    // Tier 1 — candidates passing the hard qualification rule (bid/ask
    // width; POOR liquidity fails it) always rank ahead of ones that don't,
    // regardless of delta distance. This preserves CSP-0002's corrective-
    // pass selection policy (a closer-to-center but liquidity-bad candidate
    // must never outrank a farther-out, fully qualified one) now that EVERY
    // candidate — not just a pre-filtered pool — is ranked together in one
    // array (CSP-WORKFLOW-0001).
    if (a.bidAskPassing !== b.bidAskPassing) return a.bidAskPassing ? -1 : 1;
    const deltaDistA = Math.abs(a.delta - deltaCenter);
    const deltaDistB = Math.abs(b.delta - deltaCenter);
    if (deltaDistA !== deltaDistB) return deltaDistA - deltaDistB;
    if (a.bidAskWidth !== b.bidAskWidth) return a.bidAskWidth - b.bidAskWidth;
    // CSP-0002 corrective pass — requirement #3: "prefer sufficient OI when
    // otherwise comparable." This is a boolean tier (meets the configured
    // minimum or not), evaluated before falling back to the raw OI number —
    // consistent with OI being an advisory signal, not a hard filter.
    if (a.oiPassing !== b.oiPassing) return a.oiPassing ? -1 : 1;
    if (a.openInterest !== b.openInterest) return b.openInterest - a.openInterest;
    if (a.expirationDate !== b.expirationDate) return a.expirationDate < b.expirationDate ? -1 : 1;
    return a.strikePrice - b.strikePrice;
  });
}

export function searchCspCandidates(
  chain: { expirations: string[]; chains: Record<string, Array<{
    strikePrice: number; expirationDate: string; optionType: 'P' | 'C';
    delta: number | null; bid: number; ask: number; mid?: number;
    openInterest: number; occSymbol: string;
  }>> } | WheelChainResult,
  rules: CspSearchRules,
  // CSP-WORKFLOW-0001 — needed to build each candidate's stable identity
  // (composite fallback requires the underlying symbol). Optional and
  // defaults to '' so existing callers that haven't been updated yet still
  // compile; an empty underlying symbol still produces a valid, internally
  // consistent (if less useful) composite identity rather than throwing.
  underlyingSymbol: string = '',
): CspSearchResult {
  const deltaCenter = (rules.deltaMin + rules.deltaMax) / 2;

  let expirationsInDteWindow = 0;
  let putsInDeltaWindow = 0;
  const validCandidates: CspRawCandidate[] = [];

  for (const expDate of chain.expirations) {
    const dte = daysUntil(expDate);
    if (dte < rules.dteMin || dte > rules.dteMax) continue;
    expirationsInDteWindow++;

    const legs = chain.chains[expDate] ?? [];
    for (const leg of legs) {
      if ((leg as any).optionType !== 'P') continue;
      if (leg.delta == null || !isFiniteNumber(leg.delta)) continue;
      const absDelta = Math.abs(leg.delta);
      if (absDelta < rules.deltaMin || absDelta > rules.deltaMax) continue;
      putsInDeltaWindow++;

      const candidate = toValidCandidate(leg as any, dte, underlyingSymbol);
      if (candidate) validCandidates.push(candidate);
    }
  }

  if (expirationsInDteWindow === 0) {
    return {
      candidates: [],
      selectedCandidate: null,
      selectedStatus: null,
      diagnostics: { expirationsInDteWindow: 0, putsInDeltaWindow: 0, validQuoteCandidates: 0, oiPassingCandidates: 0, spreadPassingCandidates: 0 },
      reason: 'NO_EXPIRATION_IN_DTE_WINDOW',
    };
  }
  if (putsInDeltaWindow === 0) {
    return {
      candidates: [],
      selectedCandidate: null,
      selectedStatus: null,
      diagnostics: { expirationsInDteWindow, putsInDeltaWindow: 0, validQuoteCandidates: 0, oiPassingCandidates: 0, spreadPassingCandidates: 0 },
      reason: 'NO_PUT_IN_DELTA_WINDOW',
    };
  }

  const classified = validCandidates.map(c => classify(c, rules));
  const oiPassingCandidates = classified.filter(c => c.oiPassing).length;
  const spreadPassingCandidates = classified.filter(c => c.bidAskPassing).length;
  const diagnostics: CspSearchDiagnostics = {
    expirationsInDteWindow, putsInDeltaWindow,
    validQuoteCandidates: classified.length,
    oiPassingCandidates, spreadPassingCandidates,
  };

  if (classified.length === 0) {
    return { candidates: [], selectedCandidate: null, selectedStatus: null, diagnostics, reason: 'NO_VALID_QUOTE' };
  }

  // CSP-WORKFLOW-0001 (BLOCKER-01 fix) — every structurally valid,
  // classified candidate is returned, ranked for convenience but never
  // reduced. The old "select one, discard the rest" behavior is preserved
  // ONLY as the deprecated selectedCandidate/selectedStatus fields below,
  // for any caller not yet migrated — see the CspSearchResult doc comment.
  const ranked = rankCandidates(classified, deltaCenter);
  const [best] = ranked;

  return { candidates: ranked, selectedCandidate: best ?? null, selectedStatus: best?.status ?? null, diagnostics, reason: null };
}

// ── Truthful reason taxonomy ────────────────────────────────────────────────
// Every message names the actual rule and, where a candidate exists, its
// actual values — never the old generic "No qualifying put found..." message
// once a contract has genuinely been discovered.
export function describeCspSearchOutcome(result: CspSearchResult, rules: CspSearchRules): string | null {
  if (result.reason === 'NO_EXPIRATION_IN_DTE_WINDOW') {
    return `No put expiration found in the ${rules.dteMin}-${rules.dteMax} DTE window.`;
  }
  if (result.reason === 'NO_PUT_IN_DELTA_WINDOW') {
    return `Put expirations were available, but no put was found within the ${rules.deltaMin}-${rules.deltaMax} absolute-delta range.`;
  }
  if (result.reason === 'NO_VALID_QUOTE') {
    return 'Put contracts matched the DTE and delta windows, but none had a usable two-sided quote.';
  }
  const c = result.selectedCandidate;
  // FULLY_QUALIFIED and QUALIFIED_LOW_OI both pass the hard qualification
  // rule (bid/ask width) — neither is a disqualification, so this function
  // returns null for both. A QUALIFIED_LOW_OI candidate's OI warning is
  // surfaced separately (csp-finder.ts's `cspOiWarning`), not here — this
  // function only ever describes why a candidate is NOT qualified.
  if (!c || result.selectedStatus === 'FULLY_QUALIFIED' || result.selectedStatus === 'QUALIFIED_LOW_OI' || result.selectedStatus == null) {
    return null;
  }

  // IMPORTANT fix — every candidate-specific diagnostic states the actual
  // observed value and the actual configured threshold, never a generic
  // "below configured minimum" / "market too wide."
  const oiReason = `OI ${c.openInterest} is below the preferred minimum of ${rules.oiMin}`;
  const widthReason = `Bid/ask width $${c.bidAskWidth.toFixed(2)} exceeds the maximum of $${rules.bidAskMax.toFixed(2)}`;

  if (result.selectedStatus === 'DISQUALIFIED_WIDE_MARKET') {
    return `Put found in the requested DTE and delta range, but its bid/ask spread exceeded the configured maximum: ${widthReason}.`;
  }
  if (result.selectedStatus === 'DISQUALIFIED_WIDE_MARKET_LOW_OI') {
    return `Put found in the requested DTE and delta range, but it did not meet liquidity requirements: ${oiReason}; ${widthReason}.`;
  }
  return null;
}
