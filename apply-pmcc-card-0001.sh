#!/bin/bash
set -e
git pull --rebase origin main
git checkout -b fix/pmcc-card-0001-decision-strip-readiness

cat > app/screener/page.tsx << 'SCRIPT_EOF'
// path: app/screener/page.tsx

'use client';
import { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import Link from 'next/link';
import { createPortal } from 'react-dom';

// ── TE-0005A: extracted to lib/scans/ ───────────────────────────────────────
// Mechanical extraction — moved, not rewritten. See docs/reviews/TE-0005A-Implementation-Report.md
import type {
  CheckResult, SpreadCandidate, TrendResult, ScreenResult,
  RankConfig, DimensionScore, RawScanEntry,
} from '@/lib/scans/types';
import type { RulesType, CspRulesType, CcRulesType } from '@/lib/scans/constants';
import {
  INDEX_IVR_MIN, RANK_SCAN_DTE_MIN, RANK_SCAN_DTE_MAX,
  DEFAULT_RULES, DEFAULT_ETF_RULES, DEFAULT_CSP_RULES, DEFAULT_CC_RULES, YAHOO_INDEX_CHART_MAP,
  BASE, CLIENT_ID, LS_ACCESS_TOKEN, LS_ACCESS_TOKEN_EXPIRY,
  ESTIMATED_EARNINGS_CYCLE_DAYS,
} from '@/lib/scans/constants';
import {
  daysUntil, normalCdf, calcSpreadPop, normalizeIv, formatDisplayDate,
  estimateNextEarningsDate, normalizeTickerToken, getWidthSteps, getBidAskMax,
} from '@/lib/scans/scan-utils';
import {
  classificationCache, ttFetch, getAccessToken, classifyUnderlying,
  getMarketMetrics, getQuote, getChain, getCspCapitalContext,
  getCoveredCallCapacityReport, type CspCapitalContext,
} from '@/lib/scans/tastytrade-client';
import {
  trySpreadAtWidth, findBestSpread, tryICSideAtWidth, findBestIC,
  findBestSpreadUnfiltered, findBestICUnfiltered,
} from '@/lib/scans/spread-finder';
import { findBestCsp, findAllCsp } from '@/lib/scans/csp-finder';
import { DEFAULT_PMCC_DTE_RANGES, classifyPmccDte, isValidPmccDteRanges } from '@/lib/scans/pmccDteRanges';
import { buildPmccFailureAuditResult, derivePmccMarketSession, runPmccSymbolProduction } from '@/lib/scans/pmccProduction';
import {
  DEFAULT_PMCC_LONG_DELTA_RANGE,
  DEFAULT_PMCC_SHORT_DELTA_RANGE,
  DEFAULT_PMCC_LONG_OI_MIN,
  DEFAULT_PMCC_SHORT_OI_MIN,
  DEFAULT_PMCC_PAIRING_LIMITS,
  DEFAULT_PMCC_QUOTE_POLICY,
} from '@/lib/scans/pmccConfig';
import type { PmccScanSnapshot, PmccPairResult, PmccOnDemandResult } from '@/lib/scans/pmccTypes';
import { evaluatePmccPairOnDemand } from '@/lib/scans/pmccPairing';
import { adaptPmccChain } from '@/lib/scans/pmccChainAdapter';
import { PmccPairLookupModal } from '@/features/screener/components/PmccPairLookupModal';
import { calculateCspScore } from '@/lib/scans/cspScore';
import { isMarketQualified, isBestOpportunitiesEligible, isOverallCspQualified } from '@/lib/scans/cspQualification';
import { buildCspRuleSnapshot } from '@/lib/scans/cspRuleSnapshot';
// TE-0007 — Unified Screener Launcher. One canonical Opportunity Universe
// (normalized, deduped, ordered ticker list) replaces the separate CSP and
// PMCC ticker boxes; every strategy launcher button reads this same array.
import {
  normalizeUniverse, saveOpportunityUniverse, parseLegacyCommaList,
  hasCanonicalUniverse, migratePrimaryTickers,
} from '@/lib/screener/opportunityUniverse';
// TE-0007C — Covered Call as a first-class Screener strategy.
import { findBestCoveredCall } from '@/lib/scans/covered-call-finder';
import type { CoveredCallCapacity } from '@/lib/scans/covered-call-capacity';
import { runChecklist } from '@/lib/scans/checklist';
import { scoreBuffer, scoreCandidate, exploreAllCandidatesForRank, getOtmWarningThreshold } from '@/lib/scans/rank-scoring';
import { getTrend } from '@/lib/scans/trend';
import { useRankedScan } from '@/features/screener/hooks/useRankedScan';
import { RankedScoreTierSummary } from '@/features/screener/components/RankedScoreTierSummary';
import {
  startScreenerJob, updateScreenerJob, completeScreenerJob, failScreenerJob,
  getScreenerJobState, useScreenerJobState,
} from '@/lib/screener/screenerJobStore';
// SCREENER-OI-0001 — canonical minimum-relevant-leg-OI filter + two-level
// sort, shared by Ranked, Filtered, and Targeted result panels. See
// lib/screener/screenerResultOrdering.ts for the full pure implementation
// and docs/tickets/SCREENER-OI-0001-oi-and-sort.md for the ticket.
import {
  computeRelevantLegOI, evaluateOiEligibility, extractOiLegsFromSpreadCandidate,
  sortItems, setPrimarySortField, setSecondarySortField, OI_PRESETS, MIN_OI_LABEL,
  MIN_OI_HELPER_TEXT, SORT_FIELDS, SORT_FIELD_LABELS,
} from '@/lib/screener/screenerResultOrdering';
import type {
  SortField, SecondarySortField, SortSpec, SortableMetrics, OiEligibilityResult,
} from '@/lib/screener/screenerResultOrdering';

// SCREENER-RESULTS-0001 — canonical scan-session model. This page owns the
// single `activeSession` React state (see the block right after the other
// top-level useState declarations below); scanSession.ts owns the shape and
// the validated transitions. See lib/screener/scanSession.ts's module
// header for the full set of invariants this wiring must honor.
import {
  createScanSession, recordSymbolEvaluated, recordSymbolFailed, recordSymbolSkipped,
  completeSession, stopSession, errorSession, isSessionStale,
  shouldGenerateRecommendationsForSession,
  computeSessionAccounting,
  validateSessionData, normalizeSymbols,
  ScanSessionConstructionError, ScanSessionTransitionError,
} from '@/lib/screener/scanSession';
import type {
  ScreenerScanSession, ScreenerScanMode, ScreenerRequestedStrategy, ScreenerScanScope,
  ScreenerReasonCode, ScreenerSessionAccounting,
} from '@/lib/screener/scanSession';
import { persistScanSession, restoreScanSession, clearScanSessionCache } from '@/lib/screener/scanSessionCache';

// ── OE-0002A: Opportunity Engine Activation ─────────────────────────────────
// Wires this page's already-real, in-memory ScreenResult[] through the
// existing, unmodified production pipeline:
//   ScreenResult[] --(POST /api/autopilot/recommendations, existing route)-->
//   DecisionAnalysis[] --(buildOpportunityRecommendations, existing TC-0001
//   adapter+ranker wrapper, unmodified)--> OpportunityRecommendation[] -->
//   BestOpportunitiesShortlist (SCREENER-UX-0001; previously
//   BestOpportunitiesPanel, OE-0001).
// No new persistence: recommendations are held in plain component state,
// derived fresh from whatever `results` currently holds, and discarded on
// unmount/navigation -- the same lifecycle `results` itself already has.
import type { OpportunityRecommendation } from '@/lib/opportunity-engine';
import type { DecisionAnalysis } from '@/lib/decision-engine';
import { opportunityRecommendationsFromApiResponse, type RecommendationsApiResponseSkippedEntry } from '@/lib/command-center/screenerOpportunityRecommendations';
// SCREENER-UX-0001: results-presentation redesign. Filtered/Ranked
// hierarchy fix (filters/OI/sort relocated above Best Opportunities) plus
// the new scan-identity, accounting, best-opportunities-shortlist,
// disqualified, and symbol-outcomes presentation components.
// BestOpportunitiesPanel (OE-0001) is no longer imported here -- every
// mode that can show Best Opportunities now uses the collapsed
// BestOpportunitiesShortlist instead; Targeted mode has no
// OpportunityRecommendation source and shows neither. See
// docs/tickets/SCREENER-UX-0001-results-presentation.md.
import { ScanIdentityHeader } from '@/features/screener/components/ScanIdentityHeader';
import { AccountingSummaryBar } from '@/features/screener/components/AccountingSummaryBar';
import { FilteredResultControls, type FilterStrategy } from '@/features/screener/components/FilteredResultControls';
import { BestOpportunitiesShortlist, pickTopOpportunityIds } from '@/features/screener/components/BestOpportunitiesShortlist';
import { buildBestOpportunityRows } from '@/features/screener/lib/bestOpportunityRows';
import { DisqualifiedSection } from '@/features/screener/components/DisqualifiedSection';
import { CspFundamentalsRow } from '@/features/screener/components/CspFundamentalsRow';
import { SymbolOutcomesDisclosure } from '@/features/screener/components/SymbolOutcomesDisclosure';
// SCREENER-LAUNCHER-0001: one consistent visual model (transparent+outlined
// when unselected, solid-fill+white-text when selected) for every enabled
// strategy-launch button, replacing four separately drifting conditional
// class strings. Selection is computed inline below from
// activeSession?.requestedStrategy -- never tracked as separate state.
import { LauncherButton, type LauncherStrategyId } from '@/features/screener/components/LauncherButton';
import { CspScanModal, type CspScanRequest, type CspScanRequestsByMode } from '@/features/screener/components/CspScanModal';
import { CcScanModal, type CcScanRequest } from '@/features/screener/components/CcScanModal';
import { PmccScanModal, type PmccScanCriteria } from '@/features/screener/components/PmccScanModal';
import { ActiveCspRules } from '@/features/screener/components/ActiveCspRules';
import { buildCspCsv } from '@/features/screener/lib/cspCsv';
import { ExpirationDisclosure } from '@/features/screener/components/ExpirationDisclosure';
import { PmccTickerDisclosure } from '@/features/screener/components/PmccTickerDisclosure';
import { ScanModalShell, ScanModeRadioGroup, type ScanMode } from '@/features/screener/components/ScanModalShell';
// CES-0001 (OE-0002B): this page is a producer, not the owner, of the
// current recommendation set -- see lib/recommendations/RecommendationService.ts.
import { publishRecommendations, clearRecommendations, failRecommendationsEvaluation, evaluateScreenResultsInBatches } from '@/lib/recommendations';

// NOTE: accent-style and DM-Sans-font <head> injection used to live here
// as module-level side effects (`if (typeof document !== 'undefined') {...}`).
// That ran document.head.appendChild() the instant the client bundle
// evaluated — i.e. during/before React's hydration pass over this same
// page. Direct DOM mutation outside React during the hydration window is
// a known cause of React error #418/#423 hydration mismatches, which can
// leave the page's event handling broken even though it looks normal.
// Moved into a useEffect inside Home() (search "ensureHeadAssets") so it
// runs strictly after React commits the initial tree.

// ── Theme ──────────────────────────────────────────────────────────────────
type Theme = 'dark' | 'medium' | 'light';
const LS_THEME = 'hunter-theme';

// ── Accent Colors ──────────────────────────────────────────────────────────
const LS_ACCENT = 'hunter-accent';

const ACCENTS = {
  electric: { hex: '#3b82f6', label: 'Electric',  tw: 'blue' },
  emerald:  { hex: '#10b981', label: 'Emerald',   tw: 'emerald' },
  amber:    { hex: '#f59e0b', label: 'Amber',     tw: 'amber' },
  violet:   { hex: '#8b5cf6', label: 'Violet',    tw: 'violet' },
  rose:     { hex: '#f43f5e', label: 'Rose',      tw: 'rose' },
  slate:    { hex: '#64748b', label: 'Slate',     tw: 'slate' },
} as const;
type Accent = keyof typeof ACCENTS;

function getSavedAccent(): Accent {
  try { const a = localStorage.getItem(LS_ACCENT); return (a && a in ACCENTS) ? a as Accent : 'electric'; }
  catch { return 'electric'; }
}

// Inject accent CSS variable into document root
function applyAccent(accent: Accent) {
  const hex = ACCENTS[accent].hex;
  if (typeof document !== 'undefined') {
    document.documentElement.style.setProperty('--accent', hex);
    // Parse hex to RGB for rgba() usage
    const r = parseInt(hex.slice(1,3),16);
    const g = parseInt(hex.slice(3,5),16);
    const b = parseInt(hex.slice(5,7),16);
    document.documentElement.style.setProperty('--accent-r', String(r));
    document.documentElement.style.setProperty('--accent-g', String(g));
    document.documentElement.style.setProperty('--accent-b', String(b));
  }
}

const THEMES: Record<Theme, {
  bg: string; sidebar: string; card: string; cardQualified: string;
  border: string; borderLight: string; header: string;
  text: string; textMuted: string; textFaint: string;
  input: string; inputBorder: string; tag: string;
  label: string;
}> = {
  dark: { bg: 'bg-[#0a0a0a]', sidebar: 'bg-[#0f0f0f]', card: 'bg-[#171717]', cardQualified: 'bg-[#1c1c1c]', border: 'border-[#2c2c2c]', borderLight: 'border-[#202020]', header: 'bg-[#0f0f0f]', text: 'text-white', textMuted: 'text-[#e0e0e0]', textFaint: 'text-[#808080]', input: 'bg-[#141414]', inputBorder: 'border-[#353535]', tag: 'bg-[#222222]', label: 'text-[#aaaaaa]' },
  medium: { bg: 'bg-[#141414]', sidebar: 'bg-[#1a1a1a]', card: 'bg-[#202020]', cardQualified: 'bg-[#252525]', border: 'border-[#333333]', borderLight: 'border-[#282828]', header: 'bg-[#1a1a1a]', text: 'text-white', textMuted: 'text-[#d8d8d8]', textFaint: 'text-[#777777]', input: 'bg-[#1e1e1e]', inputBorder: 'border-[#3a3a3a]', tag: 'bg-[#2a2a2a]', label: 'text-[#999999]' },
  light: { bg: 'bg-[#f5f5f5]', sidebar: 'bg-white', card: 'bg-white', cardQualified: 'bg-white', border: 'border-[#e0e0e0]', borderLight: 'border-[#ebebeb]', header: 'bg-[#111111]', text: 'text-[#111111]', textMuted: 'text-[#1a1a1a]', textFaint: 'text-[#666666]', input: 'bg-white', inputBorder: 'border-[#cccccc]', tag: 'bg-[#f0f0f0]', label: 'text-[#444444]' },
};

// ── Types ──────────────────────────────────────────────────────────────────



interface ExistingPosition {
  symbol: string;
  strategy: string;
  expDate: string;
  strikes: string;   // human-readable e.g. "450P/440P" or "450P/440P · 470C/480C"
  qty: number;
}

// ── Sector map ────────────────────────────────────────────────────────────
const SECTOR_MAP: Record<string, string> = {
  // Technology
  AAPL:'Technology', MSFT:'Technology', NVDA:'Technology', AMD:'Technology', INTC:'Technology',
  GOOGL:'Technology', GOOG:'Technology', META:'Technology', TSLA:'Technology', AVGO:'Technology',
  QCOM:'Technology', TXN:'Technology', MU:'Technology', AMAT:'Technology', LRCX:'Technology',
  KLAC:'Technology', MRVL:'Technology', ADBE:'Technology', CRM:'Technology', NOW:'Technology',
  ORCL:'Technology', IBM:'Technology', HPE:'Technology', DELL:'Technology', SNOW:'Technology',
  PLTR:'Technology', CRWD:'Technology', ZS:'Technology', PANW:'Technology', FTNT:'Technology',
  NET:'Technology', DDOG:'Technology', MDB:'Technology', TEAM:'Technology', SHOP:'Technology',
  // Financials
  JPM:'Financials', BAC:'Financials', GS:'Financials', MS:'Financials', WFC:'Financials',
  C:'Financials', BLK:'Financials', AXP:'Financials', V:'Financials', MA:'Financials',
  // Healthcare
  JNJ:'Healthcare', UNH:'Healthcare', PFE:'Healthcare', ABBV:'Healthcare', MRK:'Healthcare',
  LLY:'Healthcare', BMY:'Healthcare', AMGN:'Healthcare', GILD:'Healthcare', CVS:'Healthcare',
  // Consumer
  AMZN:'Consumer', WMT:'Consumer', HD:'Consumer', TGT:'Consumer', COST:'Consumer',
  NKE:'Consumer', MCD:'Consumer', SBUX:'Consumer', DIS:'Consumer', NFLX:'Consumer',
  // Energy
  XOM:'Energy', CVX:'Energy', COP:'Energy', OXY:'Energy', SLB:'Energy',
  // Industrials
  BA:'Industrials', CAT:'Industrials', GE:'Industrials', HON:'Industrials', UPS:'Industrials',
  // ETFs / Indexes (no sector concentration concern)
  SPY:'Index', QQQ:'Index', IWM:'Index', DIA:'Index', SMH:'Technology', SOXX:'Technology',
  XLF:'Financials', XLK:'Technology', XLE:'Energy', XLV:'Healthcare', XLI:'Industrials',
  XLP:'Consumer', XLY:'Consumer', GLD:'Commodity', SLV:'Commodity', TLT:'Bonds',
  // Index symbols traded directly (per project's documented index mappings:
  // SPX/NDX/RUT/VIX) — same "Index" bucket as their SPY/QQQ/IWM ETF cousins.
  SPX:'Index', NDX:'Index', RUT:'Index', VIX:'Index',
  // Leveraged ETFs — bucketed by underlying sector/index exposure, same as
  // their unleveraged cousins already above. Added after SOXL repeatedly hit
  // the live Yahoo lookup that used to live in getSector() below (removed —
  // see comment there).
  SOXL:'Technology', SOXS:'Technology', TQQQ:'Index', SQQQ:'Index',
  UPRO:'Index', SPXU:'Index', SPXL:'Index', TNA:'Index', TZA:'Index',
};

// Sector classification is static enough (SOXL doesn't change industries)
// that a live lookup isn't worth the cost or failure modes. This used to
// fall back to a direct browser call to Yahoo Finance for any symbol not in
// SECTOR_MAP, which Yahoo blocks via CORS — every miss logged a console
// error for purely cosmetic, non-blocking sector-concentration display.
// Unmapped symbols now just resolve to 'Unknown', same as a failed lookup
// always did anyway. Add new tickers to SECTOR_MAP above as they come up.
async function getSector(symbol: string): Promise<string> {
  return SECTOR_MAP[symbol] ?? 'Unknown';
}

// ── Portfolio context ──────────────────────────────────────────────────────
// Plain factual awareness only — no severity grading, no dismiss flow, no
// recommendation copy. The goal is just "don't get mixed up about what you
// already hold," not a graded risk warning system. Existing-position detail
// (strategy/strikes/expiration/qty) is shown separately by the always-visible
// "Open Position" banner — this only covers what that banner doesn't: broader
// sector concentration across the whole portfolio.
interface PortfolioRisk {
  sameSymbolCount: number;       // open positions on this exact symbol
  sectorName: string;
  sectorCount: number;           // open positions in the same sector (excluding this symbol)
}

function checkPortfolioRisk(
  symbol: string,
  candidate: SpreadCandidate | null,
  existingPositions: ExistingPosition[],
  sectorName: string,
  allSectorCounts: Record<string, number>,
): PortfolioRisk {
  const sameSymbolPositions = existingPositions.filter(p => p.symbol === symbol);
  const sectorCount = allSectorCounts[sectorName] ?? 0;
  return { sameSymbolCount: sameSymbolPositions.length, sectorName, sectorCount };
}

interface FilterSuggestion {
  priority: number; rule: keyof RulesType; currentValue: number; suggestedValue: number;
  label: string; rationale: string; tradeoff: string; wouldQualify: number;
}
interface WatchlistTicker {
  symbol: string;
  classification: 'index' | 'etf' | 'stock' | 'pending';
  active: boolean;
}
type SavedFilters = Record<string, string[]>;
type GlobalFilters = Record<string, { bps: string[]; bcs: string[]; ic: string[] }>;
type SavedWatchlists = Record<string, WatchlistTicker[]>;
interface LoadPromptState {
  show: boolean; name: string; type: 'strategy' | 'global'; onLoad?: (merge: boolean) => void;
}

// ── Helper Functions ───────────────────────────────────────────────────────

function getCreditColor(candidate: SpreadCandidate, isEtfOrIndex: boolean): string {
  // Visual quality standard: green = ideal, yellow = acceptable, red = weak.
  // Equity best practice: ideal 33%, acceptable 25%.
  // ETF/Index best practice: ideal 25%, acceptable 20%.
  const ideal = isEtfOrIndex ? 0.25 : 0.33;
  const acceptable = isEtfOrIndex ? 0.20 : 0.25;
  const ratio = candidate.creditRatio;

  if (ratio >= ideal) return 'text-emerald-400';
  if (ratio >= acceptable) return 'text-yellow-400';
  return 'text-red-400';
}

function getOiColor(legOi: number | undefined, oiMin: number): string {
  // Each leg is colored independently on its own OI — a 600/80 reading shows
  // green/red side by side, not one blended color for the whole field. This
  // keeps the display honest: a thin long leg doesn't get hidden behind a
  // liquid short leg, and vice versa.
  const oi = legOi ?? 0;
  if (oi >= oiMin) return 'text-emerald-400';
  if (oi >= oiMin * 0.6) return 'text-yellow-400';
  return 'text-red-400';
}



function getRocColor(candidate: SpreadCandidate, isEtfOrIndex: boolean): string {
  // Visual quality standard: green = ideal, yellow = acceptable, red = weak.
  // Equity best practice: ideal 33%, acceptable 25%.
  // ETF/Index best practice: ideal 25%, acceptable 20%.
  const ideal = isEtfOrIndex ? 25 : 33;
  const acceptable = isEtfOrIndex ? 20 : 25;
  const roc = candidate.roc;

  if (roc >= ideal) return 'text-emerald-400';
  if (roc >= acceptable) return 'text-yellow-400';
  return 'text-red-400';
}

function getOtmColor(otmPct: number | null, ivr: number | null, isEtfOrIndex: boolean): string {
  if (otmPct == null) return 'text-slate-500';

  const baseTarget = isEtfOrIndex ? 4 : 7;
  const ivrBoost = ivr != null && ivr >= 60 ? 2 : ivr != null && ivr >= 40 ? 1 : 0;
  const target = baseTarget + ivrBoost;

  if (otmPct >= target) return 'text-emerald-400';
  if (otmPct >= target * 0.75) return 'text-yellow-400';
  return 'text-red-400';
}

function getRsiColor(rsi: number | null | undefined): string {
  if (rsi == null) return 'text-slate-500';
  if (rsi >= 70) return 'text-red-400';
  if (rsi <= 30) return 'text-emerald-400';
  return 'text-slate-300';
}

function getIvxColor(ivx: number | null | undefined): string {
  if (ivx == null) return 'text-slate-500';
  if (ivx > 100) return 'text-red-400';       // extreme — likely binary event
  if (ivx > 70)  return 'text-yellow-400';    // elevated — verify no event
  if (ivx >= 40) return 'text-emerald-400';   // sweet spot for premium selling
  if (ivx >= 20) return 'text-slate-300';     // moderate
  return 'text-slate-500';                     // quiet — thin premium
}

function getEmClearanceColor(clearancePct: number | null): string {
  if (clearancePct == null) return 'text-slate-500';
  if (clearancePct >= 15) return 'text-emerald-400';   // well outside EM
  if (clearancePct >= 5)  return 'text-yellow-400';    // outside but close
  if (clearancePct >= 0)  return 'text-orange-400';    // barely outside
  return 'text-red-400';                                // inside EM — danger
}

function calcEmClearancePct(result: { price: number | null; bestCandidate: SpreadCandidate | null }): number | null {
  const c = result.bestCandidate;
  if (!c || c.expectedMove == null || result.price == null || result.price <= 0) return null;
  const em = c.expectedMove;
  const price = result.price;
  const emBoundary = c.strategy === 'BPS' ? price - em : price + em;
  return c.strategy === 'BPS'
    ? (emBoundary - c.shortStrike) / price * 100
    : (c.shortStrike - emBoundary) / price * 100;
}


function formatGreek(
  value: number | null | undefined,
  greek: 'delta' | 'gamma' | 'theta' | 'vega' | 'rho' | 'iv' = 'delta'
): string {
  if (value == null || Number.isNaN(value)) return '—';

  switch (greek) {
    case 'gamma':
      return value.toFixed(3);

    case 'iv':
      return value.toFixed(1);

    case 'delta':
    case 'theta':
    case 'vega':
    case 'rho':
    default:
      return value.toFixed(2);
  }
}

function findRankModeCandidatesForSymbol(
  symbol: string,
  strategy: 'BPS' | 'BCS' | 'IC',
  metrics: any,
  chainData: { expirations: string[]; chains: Record<string, any[]>; isEtfOrIndex: boolean },
  price: number | null,
  sRules: RulesType,
  trendResult: TrendResult | undefined,
  sLabel: string | undefined,
  eRules: RulesType,
  eLabel: string | undefined,
  rankConfig: RankConfig,
  strictOnly = false
): TargetedScanEntry[] {
  const results = runChecklistAllExpirations(
    symbol,
    strategy,
    metrics,
    chainData,
    price,
    sRules,
    trendResult,
    sLabel,
    eRules,
    eLabel,
    strictOnly
  );

  const entries: TargetedScanEntry[] = [];

  for (const result of results) {
    if (!result.bestCandidate) continue;

    const scored = scoreCandidate(result, rankConfig);
    const candidate = result.bestCandidate;

    entries.push({
      symbol,
      primaryStrategy: strategy,
      expiration: candidate.expiration,
      dte: candidate.dte,
      strategy,
      candidate,
      screenResult: {
        ...result,
        qualified: true,
        bestCandidate: {
          ...candidate,
          shortIv: normalizeIv(candidate.shortIv),
        },
        checks: result.checks,
        failReasons: result.failReasons.filter(
          r =>
            !r.includes('qualifying strikes') &&
            !r.includes('No 30–45 DTE')
        ),
      },
      pop: candidate.pop ?? 0,
      score: scored?.score ?? 0,
      ivr: metrics.ivRank ?? null,
      price,
      isEtf: chainData.isEtfOrIndex,
      trendResult,
      cachedEntry: {
        symbol,
        strategy,
        metrics,
        chainData,
        price,
        trendResult,
      },
      allStrategies: [],
    });
  }

  return entries.sort((a, b) => b.score - a.score);
}

function getSavedTheme(): Theme {
  try { const t = localStorage.getItem(LS_THEME); return (t === 'dark' || t === 'medium' || t === 'light') ? t as Theme : 'dark'; }
  catch { return 'dark'; }
}



function addBusinessDays(dateStr: string, days: number): Date {
const date = new Date(`${dateStr}T12:00:00`);  let added = 0;
  while (added < days) {
    date.setDate(date.getDate() + 1);
    const dow = date.getDay();
    if (dow !== 0 && dow !== 6) added++;
  }
  return date;
}

function formatCalDate(date: Date): string {
  return `${date.getFullYear()}${String(date.getMonth() + 1).padStart(2, '0')}${String(date.getDate()).padStart(2, '0')}`;
}


function toIsoDate(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function getPostEarningsRescreenDate(earningsDate: string): Date {
  return addBusinessDays(earningsDate, POST_EARNINGS_RESCREEN_DAYS);
}


function buildEarningsCalUrl(symbol: string, strategy: string, earningsDate: string, ivr: number | null): string {
  const followUp = getPostEarningsRescreenDate(earningsDate);
  const end = new Date(followUp); end.setDate(end.getDate() + 1);
  const title = encodeURIComponent(`Re-screen ${symbol}`);
  const details = encodeURIComponent(`Re-screen ${symbol} ${POST_EARNINGS_RESCREEN_DAYS} trading days after earnings (${earningsDate}). Strategy: ${strategy}${ivr != null ? ` · IVR: ${ivr.toFixed(1)}%` : ''}`);
  return `https://calendar.google.com/calendar/render?action=TEMPLATE&text=${title}&dates=${formatCalDate(followUp)}/${formatCalDate(end)}&details=${details}`;
}

function buildEntryCalUrl(result: ScreenResult, businessDays: number, directDate?: Date): string {
  const followUp = directDate ?? addBusinessDays(new Date().toISOString().split('T')[0], businessDays);
  const end = new Date(followUp); end.setDate(end.getDate() + 1);
  const title = encodeURIComponent(`Enter ${result.symbol}`);
  const details = encodeURIComponent(`Re-screen & enter ${result.symbol} — ${result.strategy} ${result.bestCandidate?.shortStrike}/${result.bestCandidate?.longStrike}`);
  return `https://calendar.google.com/calendar/render?action=TEMPLATE&text=${title}&dates=${formatCalDate(followUp)}/${formatCalDate(end)}&details=${details}`;
}

// OCR + merge helpers
//
// Important design rule:
// - Manual user-entered ticker boxes should NOT use a blacklist. If the user types KO, C, F, T, X, etc., allow it.
// - OCR should extract ticker-shaped candidates, then validate them against market data instead of guessing with a brittle blacklist.
//
// This prevents real tickers like KO, MO, C, F, T, X, V from being blocked while still keeping OCR imports clean.


function normalizeTickerInput(input: string): string[] {
  const cleaned = input
    .toUpperCase()
    .replace(/[–—]/g, '-')
    .replace(/\bBRK\s*[-.]?\s*B\b/g, 'BRK-B')
    .replace(/\bBF\s*[-.]?\s*B\b/g, 'BF-B');

  return Array.from(new Set(
    cleaned
      .split(/[,\s]+/)
      .map(normalizeTickerToken)
      .filter((t): t is string => Boolean(t))
  ));
}

async function validateTickersWithMarketData(tickers: string[]): Promise<string[]> {
  const unique = Array.from(new Set(tickers));
  if (unique.length === 0) return [];

  let token: string;
  try {
    token = await getAccessToken();
  } catch {
    // If auth is unavailable, fall back to shape-valid candidates rather than dropping everything.
    return unique;
  }

  const valid: string[] = [];

  // Validate sequentially to avoid blasting the API when OCR produces noisy text.
  // This is intentionally conservative and deterministic.
  for (const symbol of unique) {
    try {
      const quote = await getQuote(symbol, token);
      if (quote != null && quote > 0) valid.push(symbol);
    } catch {
      // Invalid/no-data symbols are ignored.
    }
  }

  return valid;
}

async function extractTickersFromImage(file: File): Promise<string[]> {
  // Convert file to base64
  const base64 = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      resolve(result.split(',')[1]);
    };
    reader.onerror = () => reject(new Error('Failed to read image file'));
    reader.readAsDataURL(file);
  });

  const mediaType = file.type || 'image/png';

  const response = await fetch('/api/ocr', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ base64, mediaType }),
  });

  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(err?.error ?? `OCR request failed: ${response.status}`);
  }

  const data = await response.json();
  const rawText: string = data?.text ?? '';

  const candidates: string[] = [];
  for (const line of rawText.split('\n')) {
    // Split each line into tokens to handle grid/badge layouts (multiple tickers per line).
    for (const token of line.split(/[\s,|•·]+/)) {
      const ticker = normalizeTickerToken(token.trim());
      if (ticker) candidates.push(ticker);
    }
  }

  // OCR is allowed to capture short real tickers like KO, C, F, T, X, V.
  // Market-data validation decides what is actually real.
  return validateTickersWithMarketData(candidates);
}

function mergeTickers(existing: string, newTickers: string[]): string {
  const existingList = normalizeTickerInput(existing);
  const normalizedNew = newTickers.map(normalizeTickerToken).filter((t): t is string => Boolean(t));
  const existingSet = new Set(existingList);
  const toAdd = normalizedNew.filter(t => !existingSet.has(t));
  return [...existingList, ...toAdd].join(', ');
}

function tickersToString(tickers: string[]): string { return tickers.join(', '); }

function generateSuggestions(results: ScreenResult[], rules: RulesType): FilterSuggestion[] {
  const suggestions: FilterSuggestion[] = [];
  const disqualified = results.filter(r => !r.qualified);
  if (disqualified.length === 0) return [];

  // Count how many fail each specific rule (excluding earnings which is a hard gate)
  const failedCredit = disqualified.filter(r => r.failReasons.some(f => f.includes('Credit') || f.includes('credit'))).length;
  const failedOI = disqualified.filter(r => r.failReasons.some(f => f.includes('OI') || f.includes('qualifying strikes'))).length;
  const failedROC = disqualified.filter(r => r.failReasons.some(f => f.includes('ROC') || f.includes('roc'))).length;
  const failedIVR = disqualified.filter(r => r.failReasons.some(f => f.includes('IVR'))).length;

  // Credit ratio suggestion
  if (failedCredit > 0 && rules.CREDIT_RATIO_MIN > 0.20) {
    const relaxed = rules.CREDIT_RATIO_MIN === 0.33 ? 0.25 : 0.20;
    suggestions.push({
      priority: 1,
      rule: 'CREDIT_RATIO_MIN',
      currentValue: rules.CREDIT_RATIO_MIN,
      suggestedValue: relaxed,
      label: `Relax credit ratio to ${(relaxed * 100).toFixed(0)}% of width`,
      rationale: `${failedCredit} stock${failedCredit !== 1 ? 's' : ''} failed credit minimum. Current premium environment is thin — ${(relaxed * 100).toFixed(0)}% is the ${relaxed === 0.25 ? 'professional floor' : 'absolute minimum'}.`,
      tradeoff: relaxed === 0.25 ? 'Slightly less cushion but mathematically sound. Still profitable if POP holds.' : 'Risk/reward becomes marginal. Only use in high IVR environments.',
      wouldQualify: failedCredit,
    });
  }

  // OI suggestion
  if (failedOI > 0 && rules.OI_MIN > 200) {
    const relaxed = rules.OI_MIN === 500 ? 300 : 200;
    suggestions.push({
      priority: 2,
      rule: 'OI_MIN',
      currentValue: rules.OI_MIN,
      suggestedValue: relaxed,
      label: `Relax OI minimum to ${relaxed}`,
      rationale: `${failedOI} stock${failedOI !== 1 ? 's' : ''} failed OI check. Lower OI means wider bid-ask fills — acceptable for smaller position sizes.`,
      tradeoff: 'Wider bid-ask spreads on entry/exit. Keep position size to 1 contract until liquidity improves.',
      wouldQualify: failedOI,
    });
  }

  // ROC suggestion
  if (failedROC > 0 && rules.ROC_MIN_SPREAD > 15) {
    const relaxed = Math.max(15, rules.ROC_MIN_SPREAD - 5);
    suggestions.push({
      priority: 3,
      rule: 'ROC_MIN_SPREAD',
      currentValue: rules.ROC_MIN_SPREAD,
      suggestedValue: relaxed,
      label: `Relax min ROC to ${relaxed}%`,
      rationale: `${failedROC} stock${failedROC !== 1 ? 's' : ''} failed ROC minimum. Current market conditions compress returns.`,
      tradeoff: 'Lower return per dollar at risk. Only worthwhile if POP is high (70%+).',
      wouldQualify: failedROC,
    });
  }

  // IVR suggestion
  if (failedIVR > 0 && rules.IVR_MIN > 20) {
    const relaxed = Math.max(20, rules.IVR_MIN - 5);
    suggestions.push({
      priority: 4,
      rule: 'IVR_MIN',
      currentValue: rules.IVR_MIN,
      suggestedValue: relaxed,
      label: `Relax IVR floor to ${relaxed}%`,
      rationale: `${failedIVR} stock${failedIVR !== 1 ? 's' : ''} failed IVR minimum. Low IV environment — less premium available across the board.`,
      tradeoff: 'Selling premium when IV is low means less cushion and smaller credits. Use smaller position sizes.',
      wouldQualify: failedIVR,
    });
  }

  return suggestions.sort((a, b) => a.priority - b.priority);
}

// ── Persistent Saved Filters (LocalStorage + API fallback) ─────────────────
async function loadFilters(strategy: string): Promise<SavedFilters | GlobalFilters | SavedWatchlists> {
  const lsKey = strategy === 'global' ? LS_GLOBAL_SESSIONS : LS_SAVED_FILTERS;
  try {
    const saved = localStorage.getItem(lsKey);
    if (saved) return JSON.parse(saved);
  } catch {}
  try {
    const res = await fetch(`/api/filters?strategy=${strategy}`);
    const data = await res.json();
    const filters = data.filters ?? {};
    localStorage.setItem(lsKey, JSON.stringify(filters));
    return filters;
  } catch {
    return {};
  }
}

async function saveFilter(
  strategy: string,
  name: string,
  payload: { tickers?: string[] | WatchlistTicker[]; bps?: string[]; bcs?: string[]; ic?: string[] },
  replace = false
): Promise<{ success?: boolean; conflict?: boolean; message?: string }> {
  const lsKey = strategy === 'global' ? LS_GLOBAL_SESSIONS : LS_SAVED_FILTERS;
  try {
    const res = await fetch('/api/filters', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ strategy, name, replace, ...payload })
    });
    const result = await res.json();
    if (result.success) {
      const current = await loadFilters(strategy) as any;
      if (strategy === 'global') {
        current[name] = { bps: payload.bps || [], bcs: payload.bcs || [], ic: payload.ic || [] };
      } else {
        current[name] = payload.tickers || [];
      }
      localStorage.setItem(lsKey, JSON.stringify(current));
    }
    return result;
  } catch {
    try {
      const current = await loadFilters(strategy) as any;
      if (strategy === 'global') {
        current[name] = { bps: payload.bps || [], bcs: payload.bcs || [], ic: payload.ic || [] };
      } else {
        current[name] = payload.tickers || [];
      }
      localStorage.setItem(lsKey, JSON.stringify(current));
      return { success: true };
    } catch (e) {
      return { success: false, message: 'Failed to save' };
    }
  }
}

async function deleteFilter(strategy: string, name: string): Promise<void> {
  const lsKey = strategy === 'global' ? LS_GLOBAL_SESSIONS : LS_SAVED_FILTERS;
  try {
    await fetch('/api/filters', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ strategy, name })
    });
  } catch {}
  try {
    const current = await loadFilters(strategy);
    delete current[name];
    localStorage.setItem(lsKey, JSON.stringify(current));
  } catch {}
}

// ── Underlying classification ────────────────────────────────────────────
// Pure API-based classification — no hardcoded ticker lists.
// Calls TastyTrade's /instruments/equities/{symbol} endpoint, which returns
// is-index and is-etf booleans. A 404 means the symbol isn't an equity at
// all (true cash-settled indexes like SPX/VIX have no shares), so we treat
// a 404 as 'index'. Results are cached in-memory for the session.



// Buffer thresholds by underlying type and DTE bucket.
// Returns a 0–1 normalized score; caller multiplies by weightBuffer.
// Negative raw score (-10pt) for critically under-buffered entries.
// ── Rules ──────────────────────────────────────────────────────────────────
// CHANGE 1: Added EARNINGS_BUFFER_DAYS and CREDIT_MIN_ABS


const PMCC_SHORT_DTE_MIN = DEFAULT_PMCC_DTE_RANGES.shortMin;
const PMCC_SHORT_DTE_MAX = DEFAULT_PMCC_DTE_RANGES.shortMax;

const PMCC_LONG_DTE_MIN = DEFAULT_PMCC_DTE_RANGES.longMin;
const PMCC_LONG_DTE_MAX = DEFAULT_PMCC_DTE_RANGES.longMax;

const PMCC_LONG_DTE_SWEET_MIN = 300;
const PMCC_LONG_DTE_SWEET_MAX = 540;


const RULE_PRESETS = [
  { key: 'course',    label: 'Course',     desc: 'Exact course rules',             color: 'ac-btn bg-blue-600/10',        rules: { IVR_MIN: 30, OI_MIN: 500, BID_ASK_MAX: 0.10, CREDIT_RATIO_MIN: 0.33, ROC_MIN_SPREAD: 20, ROC_MIN_IC: 30 } },
  { key: 'relaxed',   label: 'Relaxed',    desc: 'Wider net, still disciplined',   color: 'border-emerald-600 text-emerald-400 bg-emerald-600/10', rules: { IVR_MIN: 25, OI_MIN: 300, BID_ASK_MAX: 0.15, CREDIT_RATIO_MIN: 0.28, ROC_MIN_SPREAD: 15, ROC_MIN_IC: 25 } },
  { key: 'lowvol',    label: 'Low Vol',    desc: 'Crushed IV environments',        color: 'border-yellow-600 text-yellow-400 bg-yellow-600/10',   rules: { IVR_MIN: 20, OI_MIN: 200, BID_ASK_MAX: 0.20, CREDIT_RATIO_MIN: 0.22, ROC_MIN_SPREAD: 12, ROC_MIN_IC: 20 } },
  { key: 'strict',    label: 'Strict',     desc: 'A+ setups only',                 color: 'border-red-600 text-red-400 bg-red-600/10',            rules: { IVR_MIN: 40, OI_MIN: 500, BID_ASK_MAX: 0.10, CREDIT_RATIO_MIN: 0.35, ROC_MIN_SPREAD: 25, ROC_MIN_IC: 35 } },
  { key: 'shortterm',    label: 'Short Term',    desc: '7-14 DTE · very active management',  color: 'border-orange-500 text-orange-400 bg-orange-500/10',  rules: { IVR_MIN: 35, OI_MIN: 500, BID_ASK_MAX: 0.10, CREDIT_RATIO_MIN: 0.30, ROC_MIN_SPREAD: 15, ROC_MIN_IC: 22, DTE_MIN: 7,  DTE_MAX: 14 } },
  { key: 'intermediate', label: 'Intermediate',  desc: '15-29 DTE · active management',      color: 'border-amber-500 text-amber-400 bg-amber-500/10',     rules: { IVR_MIN: 35, OI_MIN: 500, BID_ASK_MAX: 0.10, CREDIT_RATIO_MIN: 0.30, ROC_MIN_SPREAD: 15, ROC_MIN_IC: 22, DTE_MIN: 15, DTE_MAX: 29 } },
] as const;

const RULE_LABELS: Record<string, string> = {
  IVR_MIN: 'IVR Min % (floor)',
  IVR_IC_MAX: 'IVR Max % (IC only)',
  OI_MIN: 'Open Interest Min (per leg)',
  BID_ASK_MAX: 'Bid-Ask Max $ (per leg)',
  CREDIT_RATIO_MIN: 'Min Credit — % of Width  (0.33 = course · 0.25 = floor · 0.20 = danger)',
  SPREAD_DELTA_MIN: 'Spread Delta Min',
  SPREAD_DELTA_MAX: 'Spread Delta Max',
  IC_DELTA_MIN: 'IC Delta Min',
  IC_DELTA_MAX: 'IC Delta Max',
  DTE_MIN: 'DTE Min (days)',
  DTE_MAX: 'DTE Max (days)',
  MAX_SPREAD_WIDTH: 'Max Spread Width $ (optimizer cap)',
  ROC_MIN_SPREAD: 'Min ROC % (Spread)',
  ROC_MIN_IC: 'Min ROC % (IC)',
  POP_MIN: 'Min POP % (Probability of Profit)',
};

const LS_RULES = 'hunter-rules';
const LS_RULES_ETF = 'hunter-rules-etf';
const LS_RULES_PRESET = 'hunter-rules-preset';
const LS_ACTIVE_PRESET = 'hunter-active-preset';
const LS_ACTIVE_PRESET_ETF = 'hunter-active-preset-etf';
const LS_RULES_VERSION = 'hunter-rules-v3'; // bump this when defaults change


function getSavedRules(): RulesType {
  try {
    if (!localStorage.getItem(LS_RULES_VERSION)) {
      localStorage.removeItem(LS_RULES);
      localStorage.removeItem(LS_RULES_ETF);
      localStorage.setItem(LS_RULES_VERSION, '1');
    }
    const saved = localStorage.getItem(LS_RULES);
    return saved ? { ...DEFAULT_RULES, ...JSON.parse(saved) } : { ...DEFAULT_RULES };
  } catch { return { ...DEFAULT_RULES }; }
}

function getSavedEtfRules(): RulesType {
  try {
    const saved = localStorage.getItem(LS_RULES_ETF);
    return saved ? { ...DEFAULT_ETF_RULES, ...JSON.parse(saved) } : { ...DEFAULT_ETF_RULES };
  } catch { return { ...DEFAULT_ETF_RULES }; }
}

function saveRulesToStorage(rules: RulesType) {
  try { localStorage.setItem(LS_RULES, JSON.stringify(rules)); } catch {}
}

function saveEtfRulesToStorage(rules: RulesType) {
  try { localStorage.setItem(LS_RULES_ETF, JSON.stringify(rules)); } catch {}
}
// TE-0007: LS_PMCC/LS_CSP are legacy-only as of the unified Opportunity
// Universe — read once during the one-time migration (the "universe
// migration" useEffect below, which calls migratePrimaryTickers() from
// lib/screener/opportunityUniverse.ts), never written to again. Kept
// defined (rather than deleted) purely so the migration's exact legacy
// inputs stay traceable from this file.
const LS_PMCC = 'hunter-tickers-pmcc';
const LS_PMCC_DTE = 'hunter-pmcc-dte-ranges';
const LS_CSP = 'hunter-tickers-csp';
const LS_CSP_CASH = 'hunter-csp-available-cash';
const LS_CAL = 'hunter-cal-scheduled'; // legacy — superseded by LS_FOLLOWUPS, kept only so old presence flags don't error on read
const LS_CAL_ENTRY = 'hunter-cal-entry'; // legacy — superseded by LS_FOLLOWUPS
const LS_FOLLOWUPS = 'hunter-followups';

// ── Follow-ups — unified "remind me about this candidate" record ───────────
// Replaces the old earnings-only CalendarButton + qualified-only EntryCalendarButton
// split. A follow-up can be set on any row, for any reason, regardless of mode or
// qualified status. Storage is localStorage today; the load/save functions below are
// the only place that needs to change to move this to Redis (mirror the
// /api/trading-memory route pattern — same userId-scoped GET/POST of one JSON blob).
interface FollowUp {
  id: string;
  symbol: string;
  strategy: string;
  expiration: string | null;
  shortStrike: number | null;
  longStrike: number | null;
  credit: number | null;
  pop: number | null;
  reason: string;       // optional freeform note, blank in most cases
  scheduledFor: string; // ISO date (YYYY-MM-DD)
  createdAt: string;    // ISO date
}

function loadFollowUps(): FollowUp[] {
  try {
    const raw = localStorage.getItem(LS_FOLLOWUPS);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function saveFollowUps(list: FollowUp[]): void {
  try { localStorage.setItem(LS_FOLLOWUPS, JSON.stringify(list)); } catch {}
}

function followUpKey(symbol: string, strategy: string, expiration: string | null): string {
  return `${symbol}-${strategy}-${expiration ?? 'none'}`;
}

// Same symbol + strategy + expiration already has a standing follow-up — nothing new
// to schedule, so the button should not reappear for this exact candidate.
function findExistingFollowUp(list: FollowUp[], symbol: string, strategy: string, expiration: string | null): FollowUp | null {
  const key = followUpKey(symbol, strategy, expiration);
  return list.find(f => followUpKey(f.symbol, f.strategy, f.expiration) === key) ?? null;
}

function addFollowUp(fu: Omit<FollowUp, 'id' | 'createdAt'>): FollowUp {
  const list = loadFollowUps();
  const record: FollowUp = { ...fu, id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`, createdAt: toIsoDate(new Date()) };
  list.push(record);
  saveFollowUps(list);
  return record;
}

function removeFollowUp(id: string): void {
  saveFollowUps(loadFollowUps().filter(f => f.id !== id));
}

function buildFollowUpCalUrl(fu: FollowUp): string {
  const followUp = new Date(`${fu.scheduledFor}T09:00:00`);
  const end = new Date(followUp); end.setHours(end.getHours() + 1);
  const strikes = fu.longStrike != null ? `${fu.shortStrike}/${fu.longStrike}` : fu.shortStrike != null ? `${fu.shortStrike}` : '';
  const title = encodeURIComponent(`Follow up: ${fu.symbol}${strikes ? ` ${strikes}` : ''}`);
  const detailParts = [
    `${fu.symbol} — ${fu.strategy}${strikes ? ` ${strikes}` : ''}`,
    fu.expiration ? `Exp ${fu.expiration}` : null,
    fu.credit != null ? `Credit $${fu.credit.toFixed(2)}` : null,
    fu.pop != null ? `POP ${fu.pop.toFixed(0)}%` : null,
    fu.reason ? `Note: ${fu.reason}` : null,
  ].filter(Boolean);
  const details = encodeURIComponent(detailParts.join(' · '));
  return `https://calendar.google.com/calendar/render?action=TEMPLATE&text=${title}&dates=${formatCalDate(followUp)}/${formatCalDate(end)}&details=${details}`;
}
const DTE_ALERT_THRESHOLD = 25;
const POST_EARNINGS_RESCREEN_DAYS = 3;
const HUNTER_URL = 'https://options-HUNTER-dun.vercel.app';
const LS_SAVED_FILTERS = 'hunter-saved-filters';
const LS_GLOBAL_SESSIONS = 'hunter-global-sessions';
const LS_SCREEN_MODE = 'hunter-screen-mode';
const LS_RANK_CONFIG = 'hunter-rank-config';
const LS_RESULTS_CACHE = 'hunter-results-cache';
const LS_RAW_SCAN_CACHE = 'hunter-raw-scan-cache'; // legacy localStorage key — no longer written to; rawScanCache now lives in IndexedDB (see idbGet/idbSet below) because full options-chain data can exceed localStorage's quota
const LS_RESULTS_CACHE_AT = 'hunter-results-cache-at';
const LS_TARGETED_RESULTS_CACHE_AT = 'hunter-targeted-results-cache-at'; // mirrors LS_RESULTS_CACHE_AT for Targeted mode's own freshness badge timestamp

// ── IndexedDB helper for rawScanCache ───────────────────────────────────────
// rawScanCache holds the full options chain per scanned symbol, which can
// comfortably exceed localStorage's ~5-10MB origin quota across a watchlist
// scan. A quota-exceeded write throws, and (prior to this fix) that error
// was silently swallowed, so results would appear to save successfully but
// vanish on next page load. IndexedDB has a much larger practical quota and
// is the right tool for this size of structured data.
const IDB_DB_NAME = 'hunter-db';
const IDB_STORE_NAME = 'kv';
const IDB_RAW_SCAN_KEY = 'rawScanCache';
const IDB_RESULTS_KEY = 'results'; // Rank mode's exhaustive result set can also exceed localStorage's quota
const IDB_TARGETED_RESULTS_KEY = 'targetedResults'; // Targeted mode never had any persistence at all — added here

function idbOpen(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(IDB_DB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(IDB_STORE_NAME)) {
        db.createObjectStore(IDB_STORE_NAME);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function idbSet(key: string, value: unknown): Promise<void> {
  try {
    const db = await idbOpen();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(IDB_STORE_NAME, 'readwrite');
      tx.objectStore(IDB_STORE_NAME).put(value, key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    db.close();
  } catch (e) {
    console.error('idbSet failed (non-blocking):', e);
  }
}

async function idbGet<T>(key: string): Promise<T | null> {
  try {
    const db = await idbOpen();
    const result = await new Promise<T | null>((resolve, reject) => {
      const tx = db.transaction(IDB_STORE_NAME, 'readonly');
      const req = tx.objectStore(IDB_STORE_NAME).get(key);
      req.onsuccess = () => resolve(req.result ?? null);
      req.onerror = () => reject(req.error);
    });
    db.close();
    return result;
  } catch (e) {
    console.error('idbGet failed (non-blocking):', e);
    return null;
  }
}

async function idbDel(key: string): Promise<void> {
  try {
    const db = await idbOpen();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(IDB_STORE_NAME, 'readwrite');
      tx.objectStore(IDB_STORE_NAME).delete(key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    db.close();
  } catch (e) {
    console.error('idbDel failed (non-blocking):', e);
  }
}

const DEFAULT_RANK_CONFIG: RankConfig = {
  weightMomentum: 25, weightIvr: 15, weightEmClearance: 15, weightRange: 15, weightTechnical: 10, weightLiquidity: 10, weightBuffer: 10,
  dteSweetSpot: 38, dteRange: 7,
  thresholdGreen: 75, thresholdYellow: 55, thresholdOrange: 35,
  weightCredit: 25, weightRoc: 20, weightPop: 15, weightDte: 15,
};

function getSavedRankConfig(): RankConfig {
  try { const s = localStorage.getItem(LS_RANK_CONFIG); return s ? { ...DEFAULT_RANK_CONFIG, ...JSON.parse(s) } : { ...DEFAULT_RANK_CONFIG }; }
  catch { return { ...DEFAULT_RANK_CONFIG }; }
}



function trafficLight(score: number, cfg: RankConfig): { emoji: string; label: string; color: string; border: string; bg: string } {
  if (score >= cfg.thresholdGreen)  return { emoji: '🟢', label: 'Strong',     color: 'text-emerald-400', border: 'border-emerald-600', bg: 'bg-emerald-500/10' };
  if (score >= cfg.thresholdYellow) return { emoji: '🟡', label: 'Acceptable', color: 'text-yellow-400',  border: 'border-yellow-600',  bg: 'bg-yellow-500/10'  };
  if (score >= cfg.thresholdOrange) return { emoji: '🟠', label: 'Marginal',   color: 'text-orange-400',  border: 'border-orange-600',  bg: 'bg-orange-500/10'  };
  return                                    { emoji: '🔴', label: 'Avoid',      color: 'text-red-400',     border: 'border-red-700',     bg: 'bg-red-500/5'      };
}

// ── TastyTrade API ─────────────────────────────────────────────────────────




async function loadPortfolioTickers(): Promise<{ current: string[]; historical: string[] }> {
  const token = await getAccessToken();

  // ── Current positions ─────────────────────────────────────────────────
  const current: string[] = [];
  try {
    const accountsData = await ttFetch('/customers/me/accounts', token);
    const accountNumber = accountsData?.data?.items?.[0]?.account?.['account-number'];
    if (accountNumber) {
      const posData = await ttFetch(`/accounts/${accountNumber}/positions`, token);
      for (const p of posData?.data?.items ?? []) {
        const sym = p['underlying-symbol'];
        if (sym && !current.includes(sym)) current.push(sym);
      }
    }
  } catch { /* current positions optional */ }

  // ── Historical positions (transactions) ───────────────────────────────
  const historical: string[] = [];
  try {
    const accountsData = await ttFetch('/customers/me/accounts', token);
    const accountNumber = accountsData?.data?.items?.[0]?.account?.['account-number'];
    if (accountNumber) {
      // Fetch last 2 years of transactions
      const startDate = new Date();
      startDate.setFullYear(startDate.getFullYear() - 2);
      const startStr = startDate.toISOString().split('T')[0];
      const txData = await ttFetch(`/accounts/${accountNumber}/transactions?start-date=${startStr}&per-page=500`, token);
      for (const tx of txData?.data?.items ?? []) {
        const sym = tx['underlying-symbol'] ?? tx['symbol'];
        if (sym && !historical.includes(sym) && !current.includes(sym)) {
          historical.push(sym);
        }
      }
    }
  } catch { /* historical optional */ }

  return { current, historical };
}

// Parses an OCC option symbol into components needed for position display
function parseOccForDisplay(occ: string): { optionType: 'P' | 'C' | null; strike: number } {
  const cleaned = occ.replace(/\s+/g, '');
  const m = cleaned.match(/^[A-Z]+(\d{6})([CP])(\d{8})$/);
  if (!m) return { optionType: null, strike: 0 };
  return { optionType: m[2] as 'P' | 'C', strike: parseInt(m[3], 10) / 1000 };
}

async function loadExistingPositions(): Promise<ExistingPosition[]> {
  try {
    const token = await getAccessToken();
    const accountsData = await ttFetch('/customers/me/accounts', token);
    const accountNumber = accountsData?.data?.items?.[0]?.account?.['account-number'];
    if (!accountNumber) return [];
    const posData = await ttFetch(`/accounts/${accountNumber}/positions`, token);
    const rawPositions: any[] = posData?.data?.items ?? [];
    const optionLegs = rawPositions.filter((p: any) =>
      p['instrument-type'] === 'Equity Option' || p['instrument-type'] === 'Index Option'
    );
    const groups: Record<string, any[]> = {};
    for (const leg of optionLegs) {
      const sym = leg['underlying-symbol'];
      const exp = (leg['expires-at'] ?? leg['expiration-date'] ?? 'unknown').slice(0, 10);
      const key = `${sym}::${exp}`;
      if (!groups[key]) groups[key] = [];
      groups[key].push(leg);
    }
    const positions: ExistingPosition[] = [];
    for (const [key, legs] of Object.entries(groups)) {
      const [symbol, expDate] = key.split('::');
      const shortLeg = legs.find(l => l['quantity-direction'] === 'Short');
      const qty = shortLeg ? parseInt(shortLeg['quantity'] ?? '1', 10) : 1;
      const parsed = legs.map(l => ({ ...parseOccForDisplay(l.symbol), dir: l['quantity-direction'] as string }));
      const putLegs  = parsed.filter(l => l.optionType === 'P');
      const callLegs = parsed.filter(l => l.optionType === 'C');
      let strategy = 'SPREAD';
      if (putLegs.length >= 2 && callLegs.length === 0) strategy = 'BPS';
      else if (callLegs.length >= 2 && putLegs.length === 0) strategy = 'BCS';
      else if (putLegs.length >= 2 && callLegs.length >= 2) strategy = 'IC';
      // Single-leg positions aren't spreads at all — most commonly a cash-secured put
      // (CSP) or a lone covered/naked call. These previously fell through to the
      // generic 'SPREAD' default since they don't match any 2+-leg shape above,
      // which mislabeled them in the existing-position banner.
      else if (putLegs.length === 1 && callLegs.length === 0) {
        strategy = putLegs[0].dir === 'Short' ? 'CSP' : 'LONG_PUT';
      } else if (callLegs.length === 1 && putLegs.length === 0) {
        strategy = callLegs[0].dir === 'Short' ? 'CC' : 'LONG_CALL';
      }
      const sortedPuts  = putLegs.map(l => l.strike).sort((a, b) => b - a);
      const sortedCalls = callLegs.map(l => l.strike).sort((a, b) => a - b);
      let strikes = '';
      if (strategy === 'BPS' && sortedPuts.length >= 2)
        strikes = `${sortedPuts[0]}P/${sortedPuts[1]}P`;
      else if (strategy === 'BCS' && sortedCalls.length >= 2)
        strikes = `${sortedCalls[0]}C/${sortedCalls[1]}C`;
      else if (strategy === 'IC' && sortedPuts.length >= 2 && sortedCalls.length >= 2)
        strikes = `${sortedPuts[0]}P/${sortedPuts[1]}P · ${sortedCalls[0]}C/${sortedCalls[1]}C`;
      else
        strikes = parsed.map(l => `${l.strike}${l.optionType}`).join('/');
      positions.push({ symbol, strategy, expDate, strikes, qty });
    }
    return positions;
  } catch { return []; }
}



// PMCC fetches only the two user-selected DTE windows. An expiration in an
// intentionally overlapping range remains eligible for either leg.
async function getPMCCChain(
  symbol: string,
  token: string,
  dteRanges: { shortMin: number; shortMax: number; longMin: number; longMax: number },
): Promise<{ shortExpirations: string[]; longExpirations: string[]; chains: Record<string, any[]>; isEtfOrIndex: boolean; classification: 'index' | 'etf' | 'stock' }> {
  const nested = await ttFetch(`/option-chains/${symbol}/nested`, token);
  const classification = await classifyUnderlying(symbol, token);
  const isEtfOrIndex = classification === 'index' || classification === 'etf';
  const shortExpirations: string[] = [], longExpirations: string[] = [], chains: Record<string, any[]> = {}, allOCCSymbols: string[] = [];
  const symbolMeta: Record<string, { expDate: string; strike: number; optionType: string }> = {};
  for (const expGroup of nested?.data?.items?.[0]?.expirations ?? []) {
    const expDate: string = expGroup['expiration-date']; if (!expDate) continue;
    const dte = daysUntil(expDate);
    const { isShortWindow, isLongWindow } = classifyPmccDte(dte, dteRanges);
    if (!isShortWindow && !isLongWindow) continue;
    for (const strike of expGroup.strikes ?? []) {
      const strikePrice = parseFloat(strike['strike-price'] ?? '0');
      const callSym: string = strike['call'];
      if (callSym) { allOCCSymbols.push(callSym); symbolMeta[callSym] = { expDate, strike: strikePrice, optionType: 'C' }; }
    }
    if (isShortWindow) shortExpirations.push(expDate);
    if (isLongWindow) longExpirations.push(expDate);
  }
  if (allOCCSymbols.length === 0) return { shortExpirations, longExpirations, chains, isEtfOrIndex, classification };
  for (let i = 0; i < allOCCSymbols.length; i += 100) {
    const chunk = allOCCSymbols.slice(i, i + 100);
    const qs = chunk.map(s => `equity-option=${encodeURIComponent(s)}`).join('&');
    let greeksData: any;
    try { greeksData = await ttFetch(`/market-data/by-type?${qs}`, token); } catch { continue; }
    for (const item of greeksData?.data?.items ?? []) {
      const meta = symbolMeta[item.symbol]; if (!meta) continue;
      const bid = parseFloat(item.bid ?? '0'), ask = parseFloat(item.ask ?? '0');
      const delta = item.delta != null ? parseFloat(item.delta) : null;
      const oi = parseInt(item['open-interest'] ?? '0', 10);
      if (!chains[meta.expDate]) chains[meta.expDate] = [];
      chains[meta.expDate].push({
        underlyingSymbol: symbol,
        strikePrice: meta.strike,
        expirationDate: meta.expDate,
        optionType: 'C',
        delta,
        openInterest: oi,
        bid,
        ask,
        mid: (bid + ask) / 2,
        occSymbol: item.symbol,
        quoteTimestamp: item['quote-time'] ?? item['updated-at'] ?? item.timestamp ?? null,
        delayed: item.delayed ?? item['is-delayed'] ?? null,
      });
    }
  }
  shortExpirations.sort(); longExpirations.sort();
  return { shortExpirations, longExpirations, chains, isEtfOrIndex, classification };
}

// ── HUNTER Logic ─────────────────────────────────────────────────────────



// ── Rank Mode — Unfiltered Spread Finder ──────────────────────────────────
// In rank mode we always want to show the best available spread regardless
// of rules. Only gates: delta must exist, long leg must exist, credit > 0.
function runCspChecklist(
  symbol: string,
  chainData: { expirations: string[]; chains: Record<string, any[]>; isEtfOrIndex: boolean; classification?: 'index' | 'etf' | 'stock' },
  price: number | null,
  metrics: any,
  cspRules: CspRulesType,
  // CSP-WORKFLOW-0001 core-correction (BLOCKER-02) — the structured
  // capital context (real account identifier + separately-verified
  // optionBuyingPower/cashBalance), replacing the deprecated single
  // availableCash number in the production path. findAllCsp() computes
  // min(optionBuyingPower, cashBalance) itself; this function never derives
  // capital math on its own.
  capital: CspCapitalContext,
  trendResult?: TrendResult
): ScreenResult[] {
  const ivrValue = metrics.ivRank;
  const earningsDate = metrics.earningsExpectedDate;

  // IVR — CSP is undefined-risk (assignment), so per the Prosper rule set it
  // has a hard upper cap at 70, unlike spreads which have no cap. This is
  // now a per-symbol MARKET-QUALIFICATION classifier, not a discovery gate.
  const ivrCheck: CheckResult = ivrValue == null
    ? { status: 'warn', value: 'N/A', reason: 'Not available' }
    : ivrValue < cspRules.IVR_MIN
      ? { status: 'fail' as const, value: `${ivrValue.toFixed(1)}%`, reason: `Below ${cspRules.IVR_MIN}% minimum` }
      : ivrValue > cspRules.IVR_MAX
        ? { status: 'fail' as const, value: `${ivrValue.toFixed(1)}%`, reason: `Above ${cspRules.IVR_MAX}% hard cap — undefined risk` }
        : { status: 'pass', value: `${ivrValue.toFixed(1)}%`, reason: `Within ${cspRules.IVR_MIN}-${cspRules.IVR_MAX}% CSP range` };
  const ivrMarketDisqualified = ivrCheck.status === 'fail';

  const earningsCheck: CheckResult = !earningsDate
    ? { status: 'pass', value: 'None found', reason: 'Safe to trade' }
    : (() => {
        const d = daysUntil(earningsDate);
        if (d < 0) return { status: 'pass', value: `${earningsDate} (past)`, reason: `Already reported · next est. ${formatDisplayDate(estimateNextEarningsDate(earningsDate))}` };
        if (d <= cspRules.DTE_MAX) return { status: 'fail' as const, value: `${d}d (${earningsDate})`, reason: 'Earnings within expiry window' };
        return { status: 'pass', value: `${d}d (${earningsDate})`, reason: 'Outside earnings window' };
      })();
  const earningsMarketDisqualified = earningsCheck.status === 'fail';

  // CSP-WORKFLOW-0001 — the search ALWAYS runs now (discovery before
  // classification); IVR/earnings gates are passed in so every discovered
  // candidate is correctly classified DISQUALIFIED_IVR / DISQUALIFIED_EARNINGS
  // rather than never being looked for.
  const cspFindAll = findAllCsp(chainData, price, {
    rules: cspRules, contracts: 1,
    capital: {
      accountSelected: capital.accountSelected,
      accountId: capital.accountId,
      optionBuyingPower: capital.optionBuyingPower,
      cashBalance: capital.cashBalance,
    },
    underlyingSymbol: symbol,
    ivrMarketDisqualified, earningsMarketDisqualified,
  });

  if (cspFindAll.results.length === 0) {
    // Nothing structurally discoverable at all (no expiration/delta/valid
    // quote match) — exactly one truthful ScreenResult, matching prior
    // one-per-symbol behavior for the true "nothing exists" case.
    const failReasons = [cspFindAll.disqualificationReason ?? `No put expiration found in the ${cspRules.DTE_MIN}-${cspRules.DTE_MAX} DTE window.`];
    return [{
      symbol, strategy: 'CSP', price, ivr: ivrValue,
      ivx: null, ivx30: null, ivHv30Diff: null, liquidityRating: null,
      qualified: false, bestCandidate: null, failReasons,
      earningsDate, trendResult, isEtf: chainData.isEtfOrIndex ?? false,
      underlyingType: chainData.classification ?? 'stock', ruleSetApplied: 'CSP',
      checks: { ivr: ivrCheck, earnings: earningsCheck, oi: { status: 'fail', value: 'None', reason: failReasons[0] }, delta: { status: 'pending', value: '—', reason: 'No candidate' }, credit: { status: 'pending', value: '—', reason: 'No candidate' }, roc: { status: 'pending', value: '—', reason: 'No candidate' }, pop: { status: 'pending', value: '—', reason: 'No candidate' }, iv: { status: 'pending' as const, value: '—', reason: 'N/A for CSP' }, emClearance: { status: 'pending' as const, value: '—', reason: 'N/A for CSP' } },
    }];
  }

  // One ScreenResult per discovered candidate — the core multi-candidate fix.
  return cspFindAll.results.map((r): ScreenResult => {
    const c = r.candidate;

    // CSP-WORKFLOW-0001 — attach the CSP-specific score (lib/scans/cspScore.ts).
    // Every input is candidate-specific (this contract's own strike/OI/ROC/
    // liquidity), so two contracts on the same symbol score independently.
    // Fails closed: technicalFit/ivr/eventRisk are null (not fabricated
    // neutral values) whenever the underlying data isn't available.
    const otmPct = (price != null && Number.isFinite(price) && price > 0 && Number.isFinite(c.shortStrike))
      ? ((price - c.shortStrike) / price) * 100
      : null;
    let earningsWithinExpiration: boolean | null = null;
    if (!earningsDate) {
      earningsWithinExpiration = false; // no known earnings at all
    } else {
      const d = daysUntil(earningsDate);
      earningsWithinExpiration = d < 0 ? false : d <= c.dte;
    }
    c.cspScore = calculateCspScore({
      pop: c.pop ?? null,
      otmPct,
      periodRocPct: Number.isFinite(c.roc) ? c.roc : null,
      annualizedRocPct: c.annualizedRoc ?? null,
      liquidityClass: c.cspLiquidityClass ?? null,
      openInterest: Number.isFinite(c.shortOI) ? c.shortOI : null,
      oiMin: cspRules.OI_MIN,
      technicalFit: trendResult?.scores?.total ?? null,
      ivr: ivrValue ?? null,
      earningsWithinExpiration,
    });

    const failReasons: string[] = [];
    if (r.marketQualification === 'DISQUALIFIED_IVR') failReasons.push(`IVR ${ivrValue?.toFixed?.(1) ?? '—'}% outside the ${cspRules.IVR_MIN}-${cspRules.IVR_MAX}% CSP range`);
    if (r.marketQualification === 'DISQUALIFIED_EARNINGS') failReasons.push('Earnings within expiry window — assignment risk into a binary event');
    if (r.marketQualification === 'DISQUALIFIED_POOR_LIQUIDITY') failReasons.push(c.cspLiquidityReason ?? 'Poor liquidity');
    if (r.marketQualification === 'DISQUALIFIED_FOUNDATION_INELIGIBLE') failReasons.push('Underlying market-state evidence contradicts a cash-secured put thesis for this horizon.');
    if (r.marketQualification === 'DISQUALIFIED_FOUNDATION_INSUFFICIENT_EVIDENCE') failReasons.push('Insufficient underlying market-state evidence to evaluate a cash-secured put thesis for this horizon.');
    if (r.accountEligibility === 'INSUFFICIENT_CAPITAL') failReasons.push(c.capitalWarning ?? 'Insufficient cash for this CSP');
    if (r.accountEligibility === 'CAPITAL_UNVERIFIED') failReasons.push('Capital could not be verified for the selected account.');
    if (r.accountEligibility === 'ACCOUNT_UNSELECTED') failReasons.push('No account selected — capital could not be verified.');
    failReasons.push(...r.advisoryWarnings);

    const oiCheck: CheckResult = c.cspOiPassing
      ? { status: 'pass', value: `${c.shortOI}`, reason: `≥ ${cspRules.OI_MIN} minimum` }
      : { status: 'warn', value: `${c.shortOI}`, reason: c.cspOiWarning ?? `Below ${cspRules.OI_MIN} — fills may be difficult` };
    const deltaCheck: CheckResult = { status: 'pass', value: `Δ${c.shortDelta.toFixed(2)}`, reason: `Target ${cspRules.DELTA_MIN}-${cspRules.DELTA_MAX}` };
    const creditCheck: CheckResult = { status: 'pass', value: `$${c.credit.toFixed(2)}`, reason: `Requires $${c.requiredCash?.toLocaleString() ?? '—'} cash` };
    const rocCheck: CheckResult = { status: c.roc >= 1 ? 'pass' : 'warn', value: `${c.roc.toFixed(1)}%`, reason: `Annualized ${c.annualizedRoc?.toFixed(0) ?? '—'}%` };
    const popCheck: CheckResult = { status: (c.pop ?? 0) >= 65 ? 'pass' : 'warn', value: `${c.pop?.toFixed(0) ?? '—'}%`, reason: '1 − |delta|, put side' };

    // CSP-WORKFLOW-0001 core-correction (BLOCKER-01) — `qualified` is now
    // MARKET qualification ONLY (QUALIFIED or QUALIFIED_WITH_LIQUIDITY_
    // WARNING), never conflated with account eligibility. A market-
    // qualified-but-unaffordable/unverified/no-account-selected candidate
    // remains in the qualified opportunity result set (bestCandidate is
    // never null here) with a clear account-status label carried on
    // `bestCandidate.cspAccountEligibility` — it must NOT be mislabeled as
    // market-disqualified by falling into the `!qualified` disqualified
    // bucket. Best-Opportunities-grade eligibility (strong market
    // qualification AND verified account eligibility) is a stricter,
    // separate boundary enforced downstream (see
    // isBestOpportunitiesEligible() in lib/scans/cspQualification.ts and its
    // callers) — never by this field alone.
    const qualified = isMarketQualified(r.marketQualification);

    return {
      symbol, strategy: 'CSP', price, ivr: ivrValue,
      ivx: null, ivx30: null, ivHv30Diff: null, liquidityRating: null,
      qualified, bestCandidate: c, failReasons,
      earningsDate, trendResult, isEtf: chainData.isEtfOrIndex ?? false,
      underlyingType: chainData.classification ?? 'stock', ruleSetApplied: 'CSP',
      candidateId: r.candidateId,
      checks: { ivr: ivrCheck, earnings: earningsCheck, oi: oiCheck, delta: deltaCheck, credit: creditCheck, roc: rocCheck, pop: popCheck, iv: { status: 'pending' as const, value: '—', reason: 'N/A for CSP' }, emClearance: { status: 'pending' as const, value: '—', reason: 'N/A for CSP' } },
    };
  });
}


// ── CC — Covered Call (TE-0007C) ────────────────────────────────────────────
// Same pattern as runCspChecklist above: a dedicated checklist builder, not
// forced through the spread-shaped runChecklist(). Unlike CSP, eligibility is
// gated by share-coverage CAPACITY (computed server-side by
// /api/covered-call-capacity, passed in here), not by an IVR band -- CC has
// no IVR floor/ceiling of its own. The capacity check is reported through the
// shared `checks.ivr` slot (ScreenResult's checks shape is fixed and shared
// across every strategy card; repurposing this slot avoids widening that
// shared type for a single strategy's one extra concept, and the UI's
// row-4 label already renders whatever `reason` text is supplied here).
function runCcChecklist(
  symbol: string,
  chainData: { expirations: string[]; chains: Record<string, any[]>; isEtfOrIndex: boolean; classification?: 'index' | 'etf' | 'stock' },
  price: number | null,
  metrics: any,
  ccRules: CcRulesType,
  capacity: CoveredCallCapacity,
  trendResult?: TrendResult
): ScreenResult {
  const failReasons: string[] = [];
  const ivrValue = metrics.ivRank;
  const earningsDate = metrics.earningsExpectedDate;

  const capacityCheck: CheckResult = capacity.availableCoveredContracts > 0
    ? { status: 'pass', value: `${capacity.availableCoveredContracts}`, reason: `${capacity.sharesOwned} shares owned` }
    : (() => {
        failReasons.push(capacity.oversubscribed
          ? 'Existing/working short calls already exceed share coverage'
          : 'No available covered-call capacity — shares already fully covered');
        return { status: 'fail' as const, value: '0', reason: 'No available capacity' };
      })();

  const earningsCheck: CheckResult = !earningsDate
    ? { status: 'pass', value: 'None found', reason: 'Safe to trade' }
    : (() => {
        const d = daysUntil(earningsDate);
        if (d < 0) return { status: 'pass', value: `${earningsDate} (past)`, reason: `Already reported · next est. ${formatDisplayDate(estimateNextEarningsDate(earningsDate))}` };
        if (d <= ccRules.DTE_MAX) { failReasons.push(`Earnings in ${d}d — within expiry window`); return { status: 'fail' as const, value: `${d}d (${earningsDate})`, reason: 'Earnings within expiry window' }; }
        return { status: 'pass', value: `${d}d (${earningsDate})`, reason: 'Outside earnings window' };
      })();
  const earningsWithinExpiry = earningsCheck.status === 'fail';

  const bestCandidate = capacityCheck.status !== 'fail'
    ? findBestCoveredCall(chainData, { rules: ccRules, capacity, stockPrice: price, earningsDate, earningsWithinExpiry })
    : null;
  if (!bestCandidate && !failReasons.length) failReasons.push(`No qualifying call found in delta ${ccRules.DELTA_MIN}-${ccRules.DELTA_MAX} / DTE ${ccRules.DTE_MIN}-${ccRules.DTE_MAX} window above stock price / cost basis`);

  const oiCheck: CheckResult = !bestCandidate
    ? { status: 'fail', value: 'None', reason: failReasons[failReasons.length - 1] || 'No candidate' }
    : bestCandidate.shortOI >= ccRules.OI_MIN
      ? { status: 'pass', value: `${bestCandidate.shortOI}`, reason: `≥ ${ccRules.OI_MIN} minimum` }
      : { status: 'warn', value: `${bestCandidate.shortOI}`, reason: `Below ${ccRules.OI_MIN} — fills may be difficult` };

  const deltaCheck: CheckResult = bestCandidate
    ? { status: 'pass', value: `Δ${bestCandidate.shortDelta.toFixed(2)}`, reason: `Target ${ccRules.DELTA_MIN}-${ccRules.DELTA_MAX}` }
    : { status: 'pending', value: '—', reason: 'No candidate' };

  const creditCheck: CheckResult = bestCandidate
    ? { status: 'pass', value: `$${bestCandidate.credit.toFixed(2)}`, reason: `${capacity.availableCoveredContracts} contract(s) · $${bestCandidate.ccPremiumPerContract?.toFixed(2) ?? '—'}/contract` }
    : { status: 'pending', value: '—', reason: 'No candidate' };

  const rocCheck: CheckResult = bestCandidate
    ? { status: (bestCandidate.ccPeriodYieldOnShares ?? 0) >= 0.5 ? 'pass' : 'warn', value: `${bestCandidate.ccPeriodYieldOnShares?.toFixed(2) ?? '—'}%`, reason: `Annualized ${bestCandidate.ccAnnualizedYieldOnShares?.toFixed(0) ?? '—'}%` }
    : { status: 'pending', value: '—', reason: 'No candidate' };

  const popCheck: CheckResult = bestCandidate
    ? { status: (bestCandidate.pop ?? 0) >= 65 ? 'pass' : 'warn', value: `${bestCandidate.pop?.toFixed(0) ?? '—'}%`, reason: '1 − |delta|, call side' }
    : { status: 'pending', value: '—', reason: 'No candidate' };

  const qualified = capacityCheck.status === 'pass'
    && earningsCheck.status === 'pass'
    && oiCheck.status !== 'fail'
    && bestCandidate !== null;

  return {
    symbol, strategy: 'CC', price, ivr: ivrValue,
    ivx: null, ivx30: null, ivHv30Diff: null, liquidityRating: null,
    qualified, bestCandidate, failReasons,
    earningsDate, trendResult, isEtf: chainData.isEtfOrIndex ?? false,
    underlyingType: chainData.classification ?? 'stock', ruleSetApplied: 'CC',
    checks: { ivr: capacityCheck, earnings: earningsCheck, oi: oiCheck, delta: deltaCheck, credit: creditCheck, roc: rocCheck, pop: popCheck, iv: { status: 'pending' as const, value: '—', reason: 'N/A for CC' }, emClearance: { status: 'pending' as const, value: '—', reason: 'N/A for CC' } },
  };
}


// ── UI Helpers ─────────────────────────────────────────────────────────────
const statusColor = (s: string) => s === 'pass' ? 'text-emerald-500' : s === 'fail' ? 'text-red-500' : s === 'warn' ? 'text-yellow-500' : 'text-slate-400';
const statusIcon = (s: string) => s === 'pass' ? '✓' : s === 'fail' ? '✗' : s === 'warn' ? '⚠' : '—';
const trendColor = (t: string) => t === 'uptrend' ? 'text-emerald-500' : t === 'downtrend' ? 'text-red-500' : t === 'sideways' ? 'text-blue-500' : 'text-slate-400';
const trendIcon = (t: string) => t === 'uptrend' ? '↑' : t === 'downtrend' ? '↓' : t === 'sideways' ? '→' : '?';
function dteBadgeColor(dte: number): string {
  if (dte < 7)  return 'text-red-500 border-red-700 bg-red-500/10';
  if (dte < 14) return 'text-orange-500 border-orange-700 bg-orange-500/10';
  if (dte < 21) return 'text-orange-400 border-orange-600 bg-orange-400/10';
  if (dte < 31) return 'text-yellow-400 border-yellow-600 bg-yellow-400/10';
  if (dte <= 45) return 'text-emerald-400 border-emerald-700 bg-emerald-500/10';
  return 'text-blue-400 border-blue-700 bg-blue-500/10';
}

// ── Targeted Scan Types ────────────────────────────────────────────────────
interface TargetedScanEntry {
  symbol: string;
  primaryStrategy: 'BPS' | 'BCS' | 'IC';
  expiration: string;
  dte: number;
  strategy: 'BPS' | 'BCS' | 'IC';
  candidate: SpreadCandidate;
  screenResult: ScreenResult;
  pop: number;
  score: number;
  ivr: number | null;
  price: number | null;
  isEtf: boolean;
  trendResult?: TrendResult;
  cachedEntry: RawScanEntry;
  allStrategies: { strategy: 'BPS' | 'BCS' | 'IC'; candidate: SpreadCandidate; pop: number; score: number }[];
}

function runChecklistAllExpirations(
  symbol: string, strategy: 'BPS' | 'BCS' | 'IC',
  metrics: any, chainData: { expirations: string[]; chains: Record<string, any[]>; isEtfOrIndex: boolean },
  price: number | null, sRules: RulesType, trendResult: TrendResult | undefined,
  sLabel: string | undefined, eRules: RulesType, eLabel: string | undefined,
  strictOnly = false
): ScreenResult[] {
  const validExpirations = chainData.expirations.filter(exp => daysUntil(exp) >= 7);
  const results: ScreenResult[] = [];
  for (const exp of validExpirations) {
    try {
      const singleExpChainData = { ...chainData, expirations: [exp] };
      const result = runChecklist(symbol, strategy, metrics, singleExpChainData, price, sRules, trendResult, sLabel, eRules, eLabel, strictOnly);
      if (result.bestCandidate) results.push(result);
    } catch {}
  }
  return results;
}

// ── Rank Mode — Exhaustive Candidate Exploration ───────────────────────────
// "Ranked" means every qualifying candidate, scored and sorted — not a
// single best-pick per symbol. This explores all 3 strategies (BPS/BCS/IC),
// every unique short strike, and every expiration in the rank scan window,
// the same exploration shape runTargetedScan already uses for Targeted mode
// — but with NO hard POP/OTM/credit-ratio floors. Score does the filtering;
// a weak candidate still appears, just low in the ranked list, rather than
// disappearing before you ever see it. Only two structural sanity bounds
// apply (not quality opinions): credit must be > 0 (a negative/zero-credit
// "spread" isn't a real premium-selling trade), and delta stays within
// 0.05–0.60 (outside that, it's not recognizably a credit spread anymore —
// either illiquid far-OTM or effectively stock-like deep ITM).

const strategyAccent = (s: string) => s === 'BPS' ? 'border-l-4 border-l-emerald-500' : s === 'BCS' ? 'border-l-4 border-l-red-500' : 'border-l-4 border-l-blue-500';

// ── Theme Toggle ───────────────────────────────────────────────────────────
function ThemeToggle({ theme, setTheme, accent, setAccent }: {
  theme: Theme; setTheme: (t: Theme) => void;
  accent: Accent; setAccent: (a: Accent) => void;
}) {
  const options: { value: Theme; icon: string; label: string }[] = [
    { value: 'light', icon: '☀', label: 'Light' },
    { value: 'medium', icon: '◐', label: 'Dim' },
    { value: 'dark', icon: '☾', label: 'Dark' },
  ];
  return (
    <div className="flex items-center gap-2">
      {/* Accent swatches */}
      <div className="flex items-center gap-1">
        {(Object.entries(ACCENTS) as [Accent, typeof ACCENTS[Accent]][]).map(([key, val]) => (
          <button key={key} onClick={() => { setAccent(key); applyAccent(key); try { localStorage.setItem(LS_ACCENT, key); } catch {} }}
            title={val.label}
            className={`w-3.5 h-3.5 rounded-full transition-all ${accent === key ? 'ring-2 ring-white/60 ring-offset-1 ring-offset-black scale-125' : 'opacity-60 hover:opacity-100'}`}
            style={{ backgroundColor: val.hex }}
          />
        ))}
      </div>
      <div className="w-px h-4 bg-white/20" />
      {/* Theme buttons */}
      <div className="flex items-center gap-1 bg-black/20 rounded-lg p-1">
        {options.map(o => (
          <button key={o.value} onClick={() => { setTheme(o.value); try { localStorage.setItem(LS_THEME, o.value); } catch {} }}
            title={o.label}
            className={`text-sm px-2 py-1 rounded transition-all ${theme === o.value ? 'bg-white/20 text-white' : 'text-white/50 hover:text-white/80'}`}>
            {o.icon}
          </button>
        ))}
      </div>
    </div>
  );
}

// ── Calendar Buttons ───────────────────────────────────────────────────────
function CalendarButton({ symbol, strategy, earningsDate, ivr, th }: { symbol: string; strategy: string; earningsDate: string; ivr: number | null; th: typeof THEMES[Theme] }) {
  const followUpDate = getPostEarningsRescreenDate(earningsDate);
  const followUpIso = toIsoDate(followUpDate);
  const key = `${symbol}-${earningsDate}-${followUpIso}`;
  const [scheduled, setScheduled] = useState(() => { try { const s = localStorage.getItem(LS_CAL); return s ? JSON.parse(s)[key] === true : false; } catch { return false; } });
  const handleClick = () => {
    window.open(buildEarningsCalUrl(symbol, strategy, earningsDate, ivr), '_blank');
    try { const s = localStorage.getItem(LS_CAL); const all = s ? JSON.parse(s) : {}; all[key] = true; localStorage.setItem(LS_CAL, JSON.stringify(all)); } catch {}
    setScheduled(true);
  };
  if (scheduled) return <span className="text-[9px] text-emerald-500 border border-emerald-600 rounded px-1.5 py-0.5 font-medium">✓ scheduled {formatDisplayDate(followUpDate)}</span>;
  return <button onClick={handleClick} className={`text-[9px] px-1.5 py-0.5 border ${th.inputBorder} rounded ${th.textMuted} ac-hover-border ac-hover-text transition-colors font-medium`} title={`Schedule re-screen ${POST_EARNINGS_RESCREEN_DAYS} trading days after earnings (${followUpIso})`}>📅 +{POST_EARNINGS_RESCREEN_DAYS}D post earnings · {formatDisplayDate(followUpDate)}</button>;
}
function EntryCalendarButton({ result, th }: { result: ScreenResult; th: typeof THEMES[Theme]; rules: RulesType; }) {
  const key = `entry-${result.symbol}-${result.bestCandidate?.expiration}`;
  const [scheduled, setScheduled] = useState<string | null>(() => {
    try { const s = localStorage.getItem(LS_CAL_ENTRY); const all = s ? JSON.parse(s) : {}; return all[key] || null; } catch { return null; }
  });
  const [open, setOpen] = useState(false);
  const btnRef = useRef<HTMLButtonElement>(null);
  const dateInputRef = useRef<HTMLInputElement>(null);
  const [popoverStyle, setPopoverStyle] = useState<React.CSSProperties>({});
  const postEarningsDate = result.earningsDate && daysUntil(result.earningsDate) < 0
    ? getPostEarningsRescreenDate(result.earningsDate)
    : null;

  const [selectedDate, setSelectedDate] = useState<string>(() => {
    const d = postEarningsDate ?? addBusinessDays(new Date().toISOString().split('T')[0], 2);
    return toIsoDate(d);
  });

  const presets: { label: string; days: number; hint: string; directDate?: Date }[] = [
    { label: '+1d',  days: 1,  hint: 'Tomorrow' },
    { label: '+2d',  days: 2,  hint: 'Revisit soon' },
    ...(postEarningsDate ? [{ label: `+${POST_EARNINGS_RESCREEN_DAYS}D Post Earnings`, days: 0, hint: formatDisplayDate(postEarningsDate), directDate: postEarningsDate }] : []),
    { label: '+1wk', days: 5,  hint: 'One trading week' },
    { label: '+2wk', days: 10, hint: 'Two trading weeks' },
  ];

  const handleOpen = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!open && btnRef.current) {
      const rect = btnRef.current.getBoundingClientRect();
      setPopoverStyle({
        position: 'fixed',
        top: rect.bottom + 6,
        left: rect.left,
        zIndex: 9999,
      });
    }
    setOpen(!open);
  };

  const handleSchedule = (days: number, label: string, directDate?: Date) => {
    const url = buildEntryCalUrl(result, days, directDate);
    const scheduledValue = directDate ? `${label} ${toIsoDate(directDate)}` : label;
    if (directDate) setSelectedDate(toIsoDate(directDate));
    const a = document.createElement('a'); a.href = url; a.target = '_blank'; a.rel = 'noopener noreferrer';
    document.body.appendChild(a); a.click(); setTimeout(() => document.body.removeChild(a), 100);
    try { const s = localStorage.getItem(LS_CAL_ENTRY); const all = s ? JSON.parse(s) : {}; all[key] = scheduledValue; localStorage.setItem(LS_CAL_ENTRY, JSON.stringify(all)); } catch {}
    setScheduled(scheduledValue);
    setTimeout(() => setOpen(false), 150);
  };

  const handleDatePick = (dateStr: string) => {
    if (!dateStr) return;
    setSelectedDate(dateStr);
    const d = new Date(dateStr + 'T12:00:00');
    const url = buildEntryCalUrl(result, 0, d);
    // Create anchor, append, click, then defer removal so the tab opens before DOM cleanup
    const a = document.createElement('a'); a.href = url; a.target = '_blank'; a.rel = 'noopener noreferrer';
    document.body.appendChild(a); a.click(); setTimeout(() => document.body.removeChild(a), 100);
    try { const s = localStorage.getItem(LS_CAL_ENTRY); const all = s ? JSON.parse(s) : {}; all[key] = dateStr; localStorage.setItem(LS_CAL_ENTRY, JSON.stringify(all)); } catch {}
    setScheduled(dateStr);
    setTimeout(() => setOpen(false), 150);
  };

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (btnRef.current && btnRef.current.contains(e.target as Node)) return;
      setOpen(false);
    };
    document.addEventListener('click', close);
    return () => document.removeEventListener('click', close);
  }, [open]);

  if (scheduled) return (
    <span
      className="text-[9px] text-emerald-500 border border-emerald-600 rounded px-1.5 py-0.5 font-medium cursor-pointer hover:border-emerald-400"
      onClick={(e) => { e.stopPropagation(); setScheduled(null); }}
      title="Click to reset"
    >
      ✓ re-screen {scheduled}
    </span>
  );

  return (
    <>
      <button
        ref={btnRef}
        onClick={handleOpen}
        className={`text-[9px] px-1.5 py-0.5 border ${th.inputBorder} rounded ${th.textMuted} hover:border-emerald-500 hover:text-emerald-400 transition-colors font-medium`}
      >
        📅 re-screen
      </button>
      {open && (
        <div
          onClick={e => e.stopPropagation()}
          style={popoverStyle}
          className={`${th.sidebar} border ${th.border} rounded-lg shadow-2xl p-3 w-52`}
        >
          <p className={`text-[8px] ${th.textFaint} tracking-widest mb-2 uppercase`}>Re-screen in:</p>
          {presets.map(p => (
            <button
              key={p.label}
              onClick={() => handleSchedule(p.days, p.label, p.directDate)}
              className={`w-full text-left px-2 py-2 rounded hover:bg-emerald-500/10 border border-transparent hover:border-emerald-700 transition-colors mb-1`}
            >
              <span className="text-emerald-400 font-bold text-xs">{p.label}</span>
              <span className={`text-[9px] ${th.textFaint} ml-2`}>{p.hint}</span>
            </button>
          ))}
          <div className={`mt-2 pt-2 border-t ${th.border}`}>
            <p className={`text-[8px] ${th.textFaint} tracking-widest mb-1.5 uppercase`}>Pick a date:</p>
            <label className="flex gap-1 items-center cursor-pointer">
              <input
                ref={dateInputRef}
                type="date"
                min={new Date().toISOString().split('T')[0]}
                value={selectedDate}
                onChange={e => handleDatePick(e.target.value)}
                onClick={e => e.stopPropagation()}
                className={`flex-1 ${th.input} border ${th.inputBorder} rounded px-2 py-1.5 text-xs ${th.text} focus:outline-none focus:border-emerald-500 cursor-pointer`}
              />
              <span
                onClick={e => { e.stopPropagation(); try { dateInputRef.current?.showPicker(); } catch { dateInputRef.current?.focus(); } }}
                className={`px-1.5 py-1.5 border ${th.inputBorder} rounded ${th.textFaint} hover:text-emerald-400 hover:border-emerald-600 transition-colors text-xs cursor-pointer`}
                title="Open calendar"
              >📅</span>
            </label>
          </div>
        </div>
      )}
    </>
  );
}

// ── DTE Alert Banner ───────────────────────────────────────────────────────
function DTEAlertBanner({ results, rules }: { results: ScreenResult[], rules: RulesType }) {
  const isShortTerm = rules.DTE_MAX <= 29;
  const alertThreshold = isShortTerm ? rules.DTE_MIN - 1 : 25;
  const closeTarget = isShortTerm ? Math.floor(rules.DTE_MIN / 2) : 21;
  const approaching = results.filter(r => r.qualified && r.bestCandidate && r.bestCandidate.dte <= alertThreshold);
  if (approaching.length === 0) return null;
  return (
    <div className="border border-yellow-500/50 bg-yellow-500/10 rounded-lg px-4 py-3 flex items-start gap-3">
      <span className="text-yellow-400 text-base mt-0.5">⚠</span>
      <div className="flex-1">
        <p className="text-xs text-yellow-400 font-bold tracking-wider mb-1">
          {isShortTerm ? `APPROACHING ${rules.DTE_MIN} DTE — ACTIVE MANAGEMENT REQUIRED` : 'APPROACHING 21 DTE — ACTION REQUIRED'}
        </p>
        <p className="text-[10px] text-yellow-300 mb-2">
          {isShortTerm
            ? `Short term rules active (${rules.DTE_MIN}–${rules.DTE_MAX} DTE). Monitor closely — consider closing at 50% profit or ${closeTarget} DTE.`
            : 'Close these positions regardless of profit/loss when they hit 21 DTE.'}
        </p>
        <div className="flex flex-wrap gap-2">
          {approaching.map(r => (
            <span key={r.symbol} className="text-[10px] bg-yellow-500/10 border border-yellow-600 rounded px-2 py-0.5 text-yellow-300 font-medium">
              {r.symbol} {r.bestCandidate?.expiration} — <span className={r.bestCandidate!.dte <= closeTarget ? 'text-red-400 font-bold' : 'text-yellow-400'}>{r.bestCandidate?.dte}d</span>
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}

// ── Smart Suggestions Panel ────────────────────────────────────────────────
function SmartSuggestionsPanel({ results, rules, th, onApplyAndRerun }: { results: ScreenResult[]; rules: RulesType; th: typeof THEMES[Theme]; onApplyAndRerun: (r: RulesType) => void }) {
  const [expanded, setExpanded] = useState(false);
  const disqualified = results.filter(r => !r.qualified);
  const earningsFails = disqualified.filter(r => r.failReasons.some(f => f.includes('Earnings'))).length;
  if (disqualified.length === 0 || results.length === 0) return null;
  const suggestions = generateSuggestions(results, rules);
  if (suggestions.length === 0 && earningsFails === 0) return null;
  return (
    <div className={`border ${th.border} ${th.card} rounded-lg overflow-hidden`}>
      <button onClick={() => setExpanded(!expanded)} className={`w-full px-4 py-3 flex items-center justify-between ac-hover-bg/5 transition-colors`}>
        <div className="flex items-center gap-2">
          <span className="text-blue-400 text-sm">◈</span>
          <div className="text-left">
            <p className={`text-xs font-bold tracking-wider ${th.text}`}>FILTER SUGGESTIONS</p>
            <p className={`text-[9px] ${th.textFaint}`}>{suggestions.length} suggestion{suggestions.length !== 1 ? 's' : ''} · {disqualified.length} disqualified stocks analyzed</p>
          </div>
        </div>
        <span className={`${th.textFaint} text-xs`}>{expanded ? '▲' : '▼'}</span>
      </button>
      {expanded && (
        <div className={`border-t ${th.border} px-4 py-3 space-y-3`}>
          {earningsFails > 0 && (
            <div className={`flex items-start gap-2 p-2 ${th.tag} rounded border ${th.borderLight}`}>
              <span className={`${th.textFaint} text-xs mt-0.5`}>ℹ</span>
              <div>
                <p className={`text-[10px] ${th.textMuted} font-medium`}>{earningsFails} stock{earningsFails !== 1 ? 's' : ''} blocked by upcoming earnings</p>
                <p className={`text-[9px] ${th.textFaint}`}>Earnings filter is a hard rule. Use the 📅 follow up button to schedule a re-screen.</p>
              </div>
            </div>
          )}
          {suggestions.map((s, i) => (
            <div key={i} className={`border ${th.border} rounded p-3 space-y-2`}>
              <div className="flex items-start justify-between gap-2">
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-[9px] ac-bg-20 text-blue-400 border ac-border rounded px-1.5 py-0.5 font-medium">#{s.priority}</span>
                    <p className={`text-xs ${th.text} font-medium`}>{s.label}</p>
                  </div>
                  <p className={`text-[10px] ${th.textMuted} mb-1`}>{s.rationale}</p>
                  <p className={`text-[9px] ${th.textFaint} italic`}>⚖ {s.tradeoff}</p>
                </div>
                <div className="text-right shrink-0">
                  <p className={`text-[9px] ${th.textFaint}`}>{RULE_LABELS[s.rule]}</p>
                  <p className={`text-xs ${th.textFaint} line-through`}>{s.currentValue}</p>
                  <p className="text-xs text-emerald-500 font-bold">→ {s.suggestedValue}</p>
                  <p className={`text-[9px] ${th.textFaint}`}>+{s.wouldQualify} stocks</p>
                </div>
              </div>
              <button onClick={() => onApplyAndRerun({ ...rules, [s.rule]: s.suggestedValue })} className="w-full text-[9px] py-1.5 border ac-btn rounded hover:ac-bg-10 transition-colors font-medium tracking-wider">APPLY & RE-RUN</button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Load Prompt Modal ──────────────────────────────────────────────────────
function LoadPromptModal({ state, onClose, th }: { state: LoadPromptState; onClose: () => void; th: typeof THEMES[Theme] }) {
  if (!state.show) return null;
  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50">
      <div className={`${th.sidebar} border ${th.border} rounded-xl p-5 w-80 shadow-2xl`}>
        <h3 className={`text-xs font-bold ${th.text} mb-1 tracking-wider`}>LOAD {state.type === 'global' ? 'SESSION' : 'FILTER'}</h3>
        <p className={`text-[10px] ${th.textMuted} mb-4`}>Load <span className={`${th.text} font-medium`}>"{state.name}"</span> — how should it be applied?</p>
        <div className="space-y-2 mb-4">
          <button onClick={() => { state.onLoad?.(false); onClose(); }} className={`w-full text-left px-3 py-2.5 border ${th.border} rounded-lg hover:ac-bg-10 ac-hover-border transition-colors`}>
            <p className={`text-xs ${th.text} font-medium`}>Replace</p>
            <p className={`text-[9px] ${th.textFaint} mt-0.5`}>Clear current tickers and load this {state.type === 'global' ? 'session' : 'filter'}</p>
          </button>
          <button onClick={() => { state.onLoad?.(true); onClose(); }} className={`w-full text-left px-3 py-2.5 border ${th.border} rounded-lg hover:ac-bg-10 ac-hover-border transition-colors`}>
            <p className={`text-xs ${th.text} font-medium`}>Merge</p>
            <p className={`text-[9px] ${th.textFaint} mt-0.5`}>Add tickers from this {state.type === 'global' ? 'session' : 'filter'} to existing ones</p>
          </button>
        </div>
        <button onClick={onClose} className={`w-full text-[10px] ${th.textFaint} hover:${th.textMuted} transition-colors py-1`}>Cancel</button>
      </div>
    </div>
  );
}

// ── Sessions Panel ─────────────────────────────────────────────────────────
function SessionsPanel({ tickers, onLoadAll, onLoadPrompt, th }: {
  tickers: WatchlistTicker[];
  onLoadAll: (tickers: WatchlistTicker[]) => void;
  onLoadPrompt: (state: Omit<LoadPromptState, 'show'>) => void;
  th: typeof THEMES[Theme];
}) {
  const [savedWatchlists, setSavedWatchlists] = useState<SavedWatchlists>({});
  const [showSave, setShowSave] = useState(false);
  const [showLoad, setShowLoad] = useState(false);
  const [saveName, setSaveName] = useState('');
  const [saveError, setSaveError] = useState('');
  const [loadingPortfolio, setLoadingPortfolio] = useState(false);
  const [portfolioStatus, setPortfolioStatus] = useState('');

  const handleLoadFromPortfolio = async () => {
    setLoadingPortfolio(true);
    setPortfolioStatus('Fetching positions...');
    try {
      const { current, historical } = await loadPortfolioTickers();
      const all = [...current, ...historical];
      if (all.length === 0) { setPortfolioStatus('No positions found'); setTimeout(() => setPortfolioStatus(''), 3000); return; }
      setPortfolioStatus(`Found ${current.length} current · ${historical.length} historical`);
      setTimeout(() => setPortfolioStatus(''), 4000);
      const token = await getAccessToken();
      if (tickers.length > 0) {
        onLoadPrompt({
          name: `${all.length} tickers from portfolio`,
          type: 'strategy',
          onLoad: async (doMerge: boolean) => {
            if (doMerge) onLoadAll(await mergeTickerLists(tickers, all, token));
            else onLoadAll(await mergeTickerLists([], all, token));
          },
        });
      } else {
        onLoadAll(await mergeTickerLists([], all, token));
      }
    } catch (e: any) {
      setPortfolioStatus(`Error: ${e.message}`);
      setTimeout(() => setPortfolioStatus(''), 4000);
    }
    setLoadingPortfolio(false);
  };

  const refreshWatchlists = useCallback(async () => { const w = await loadWatchlists(); setSavedWatchlists(w); }, []);
  useEffect(() => { refreshWatchlists(); }, [refreshWatchlists]);

  const handleSave = async (replace = false) => {
    if (!saveName.trim()) { setSaveError('Enter a session name'); return; }
    if (tickers.length === 0) { setSaveError('No tickers to save'); return; }
    const result = await saveWatchlistPreset(saveName.trim(), tickers, replace);
    if (result.conflict) { setSaveError(`"${saveName}" exists — replace?`); return; }
    await refreshWatchlists(); setShowSave(false); setSaveName(''); setSaveError('');
  };

  const handleLoadSelect = (name: string) => {
    const session = savedWatchlists[name]; if (!session) return; setShowLoad(false);
    if (tickers.length === 0) { onLoadAll(session); return; }
    onLoadPrompt({
      name,
      type: 'strategy',
      onLoad: async (doMerge: boolean) => {
        if (doMerge) {
          const token = await getAccessToken();
          onLoadAll(await mergeTickerLists(tickers, session.map(t => t.symbol), token));
        } else onLoadAll(session);
      },
    });
  };

  const handleDelete = async (name: string) => { await deleteWatchlistPreset(name); await refreshWatchlists(); };
  const sessionNames = Object.keys(savedWatchlists);
  return (
    <div className={`border-t ${th.border} pt-3`}>
      <p className={`text-[9px] ${th.textMuted} tracking-widest font-medium mb-2`}>TICKER LISTS</p>

      <div className="flex gap-2 mb-2">
        <button
          onClick={handleLoadFromPortfolio}
          disabled={loadingPortfolio}
          className={`w-full text-[9px] px-2 py-1.5 border border-purple-700 rounded-lg text-purple-400 hover:border-purple-500 hover:text-purple-300 transition-colors font-medium flex items-center justify-center gap-1 disabled:opacity-40`}>
          {loadingPortfolio ? '⟳ Loading...' : '📊 Load from Portfolio'}
        </button>
      </div>
      {portfolioStatus && <p className={`text-[9px] ${portfolioStatus.startsWith('Error') ? 'text-red-400' : 'text-emerald-400'} mb-2`}>{portfolioStatus}</p>}
      <div className="flex gap-2">
        <button onClick={() => onLoadAll([])} className={`text-[9px] px-2 py-1.5 border border-red-800 rounded-lg text-red-500 hover:border-red-500 hover:text-red-400 transition-colors font-medium flex items-center justify-center gap-1 shrink-0`}>✕ Clear</button>
        <div className="relative flex-1">
          <button onClick={() => { setShowSave(!showSave); setShowLoad(false); setSaveError(''); }} className={`w-full text-[9px] px-2 py-1.5 border ${th.inputBorder} rounded-lg ${th.textMuted} ac-hover-border ac-hover-text transition-colors font-medium flex items-center justify-center gap-1`}>💾 Save List</button>
          {showSave && (
            <div className={`absolute top-8 left-0 z-40 ${th.sidebar} border ${th.border} rounded-lg p-2 w-56 shadow-xl`}>
              <p className={`text-[9px] ${th.textFaint} mb-1.5`}>Saves the current watchlist as one session</p>
              <div className="flex gap-1 mb-1">
                <input type="text" value={saveName} onChange={e => { setSaveName(e.target.value); setSaveError(''); }} placeholder="Session name..." onKeyDown={e => e.key === 'Enter' && handleSave()}
                  className={`flex-1 ${th.input} border ${th.inputBorder} rounded px-2 py-1 text-[10px] ${th.text} focus:outline-none ac-focus placeholder-slate-500`} />
                <button onClick={() => handleSave()} className="text-[9px] px-2 py-1 ac-btn-solid text-white rounded font-medium transition-colors">Save</button>
              </div>
              {saveError && (<div className="flex gap-1 items-center mt-1"><span className="text-[9px] text-yellow-400">{saveError}</span>{saveError.includes('exists') && <button onClick={() => handleSave(true)} className="text-[9px] px-1.5 py-0.5 bg-yellow-600 hover:bg-yellow-500 text-white rounded font-medium">Replace</button>}</div>)}
            </div>
          )}
        </div>
        <div className="relative flex-1">
          <button onClick={() => { setShowLoad(!showLoad); setShowSave(false); if (!showLoad) refreshWatchlists(); }} className={`w-full text-[9px] px-2 py-1.5 border ${th.inputBorder} rounded-lg ${th.textMuted} ac-hover-border ac-hover-text transition-colors font-medium flex items-center justify-center gap-1`}>▼ Load List</button>
          {showLoad && (
            <div className={`absolute top-8 right-0 z-40 ${th.sidebar} border ${th.border} rounded-lg overflow-hidden w-56 shadow-xl`}>
              {sessionNames.length === 0 ? <p className={`text-[9px] ${th.textFaint} px-3 py-2`}>No saved sessions yet</p>
                : sessionNames.map(name => (
                  <div key={name} className={`flex items-center justify-between px-3 py-2 hover:ac-bg-10 group cursor-pointer`}>
                    <button onClick={() => handleLoadSelect(name)} className={`text-[10px] ${th.textMuted} hover:${th.text} text-left flex-1 font-medium`}>{name}</button>
                    <button onClick={() => handleDelete(name)} className="text-[9px] text-slate-500 hover:text-red-500 ml-2 opacity-0 group-hover:opacity-100 transition-opacity">✕</button>
                  </div>
                ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Strategy Box ──────────────────────────────────────────────────────────
// TE-0007: no longer used by the Screener page (the separate CSP/PMCC
// ticker cards it powered were replaced by the unified Opportunity
// Universe card, which reuses WatchlistBox instead). Left defined,
// unexported and dead, rather than deleted outright -- it's a nontrivial,
// working, self-contained component (OCR + named save/load over a plain
// string ticker list) that's cheap to keep for now in case a future
// strategy-specific settings panel wants the same free-form-list pattern;
// deleting it is a trivial follow-up if it's confirmed unneeded.
function StrategyBox({ label, badge, badgeColor, borderFocus, value, onChange, strategy, disabled, onLoadPrompt, th }: {
  label: string;
  badge: string;
  badgeColor: string;
  borderFocus: string;
  value: string;
  onChange: (v: string) => void;
  strategy: 'BPS' | 'BCS' | 'IC' | 'broken';
  disabled?: boolean;
  onLoadPrompt: (state: Omit<LoadPromptState, 'show'>) => void;
  th: typeof THEMES[Theme]
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const pendingTickersRef = useRef<string[]>([]);
  const [scanning, setScanning] = useState(false);
  const [savedFilters, setSavedFilters] = useState<SavedFilters>({});
  const [showSaveInput, setShowSaveInput] = useState(false);
  const [saveName, setSaveName] = useState('');
  const [saveError, setSaveError] = useState('');
  const [showLoad, setShowLoad] = useState(false);
  const [loadingFilters, setLoadingFilters] = useState(false);
  const parseTickers = normalizeTickerInput;
  const refreshFilters = useCallback(async () => { setLoadingFilters(true); const f = await loadFilters(strategy) as SavedFilters; setSavedFilters(f); setLoadingFilters(false); }, [strategy]);
  useEffect(() => { refreshFilters(); }, [refreshFilters]);

  const handleImgClick = () => {
    if (fileRef.current) fileRef.current.value = '';
    fileRef.current?.click();
  };

  const handleOCR = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]; if (!file) return; setScanning(true);
    try {
      const tickers = await extractTickersFromImage(file);
      if (tickers.length > 0) {
        const hasExisting = parseTickers(value).length > 0;
        if (hasExisting) {
          pendingTickersRef.current = tickers;
          onLoadPrompt({
            name: `${tickers.length} ticker${tickers.length !== 1 ? 's' : ''} from image`,
            type: 'strategy',
            onLoad: (doMerge: boolean) => {
              if (doMerge) onChange(mergeTickers(value, pendingTickersRef.current));
              else onChange(tickersToString(pendingTickersRef.current));
            },
          });
        } else {
          onChange(tickersToString(tickers));
        }
      } else {
        onChange('⚠ No tickers found in image');
        setTimeout(() => onChange(''), 2500);
      }
    } catch (err: any) {
      console.error(err);
      onChange(`⚠ OCR error: ${err?.message ?? 'unknown'}`);
      setTimeout(() => onChange(''), 3500);
    }
    setScanning(false);
  };

  const handleSave = async (replace = false) => {
    if (!saveName.trim()) { setSaveError('Enter a name'); return; }
    const tickers = parseTickers(value); if (tickers.length === 0) { setSaveError('No tickers to save'); return; }
    const result = await saveFilter(strategy, saveName.trim(), { tickers }, replace);
    if (result.conflict) { setSaveError(`"${saveName}" exists — replace?`); return; }
    await refreshFilters(); setShowSaveInput(false); setSaveName(''); setSaveError('');
  };
  const handleLoadSelect = (name: string) => {
    const tickers = savedFilters[name] ?? []; setShowLoad(false);
    if (!hasValue) { onChange(tickersToString(tickers)); return; }
    onLoadPrompt({ name, type: 'strategy', onLoad: (doMerge: boolean) => { if (doMerge) onChange(mergeTickers(value, tickers)); else onChange(tickersToString(tickers)); } });
  };
  const handleDelete = async (name: string) => { await deleteFilter(strategy, name); await refreshFilters(); };
  const filterNames = Object.keys(savedFilters);
  const hasValue = parseTickers(value).length > 0;

  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <div className="flex items-center gap-1.5">
          <span className={`text-[9px] px-1.5 py-0.5 border rounded-md tracking-wider font-bold ${badgeColor}`}>{badge}</span>
          <span className={`text-[10px] ${th.textMuted} font-medium tracking-wider`}>{label}</span>
        </div>
        <div className="flex items-center gap-1">
          <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={handleOCR} />
          <button onClick={handleImgClick} disabled={disabled || scanning} className={`text-[9px] px-1.5 py-0.5 border ${th.inputBorder} rounded ${th.textMuted} ac-hover-border ac-hover-text transition-colors disabled:opacity-40`}>{scanning ? '⟳' : '↑ img'}</button>
          <div className="relative">
            <button onClick={() => { setShowSaveInput(!showSaveInput); setShowLoad(false); setSaveError(''); }} disabled={disabled || !hasValue} className={`text-[9px] px-1.5 py-0.5 border ${th.inputBorder} rounded ${th.textMuted} ac-hover-border ac-hover-text transition-colors disabled:opacity-40`}>💾</button>
            {showSaveInput && (
              <div className={`absolute top-6 right-0 z-40 ${th.sidebar} border ${th.border} rounded-lg p-2 w-44 shadow-xl`}>
                <div className="flex gap-1 mb-1">
                  <input type="text" value={saveName} onChange={e => { setSaveName(e.target.value); setSaveError(''); }} placeholder="Filter name..." onKeyDown={e => e.key === 'Enter' && handleSave()}
                    className={`flex-1 ${th.input} border ${th.inputBorder} rounded px-2 py-1 text-[10px] ${th.text} focus:outline-none ac-focus placeholder-slate-500`} />
                  <button onClick={() => handleSave()} className="text-[9px] px-1.5 py-1 ac-btn-solid text-white rounded font-medium">Save</button>
                </div>
                {saveError && (<div className="flex gap-1 items-center"><span className="text-[9px] text-yellow-400">{saveError}</span>{saveError.includes('exists') && <button onClick={() => handleSave(true)} className="text-[9px] px-1 py-0.5 bg-yellow-600 text-white rounded">Replace</button>}</div>)}
              </div>
            )}
          </div>
          <div className="relative">
            <button onClick={() => { setShowLoad(!showLoad); setShowSaveInput(false); if (!showLoad) refreshFilters(); }} disabled={disabled} className={`text-[9px] px-1.5 py-0.5 border ${th.inputBorder} rounded ${th.textMuted} ac-hover-border ac-hover-text transition-colors disabled:opacity-40`}>▼</button>
            {showLoad && (
              <div className={`absolute top-6 right-0 z-40 ${th.sidebar} border ${th.border} rounded-lg overflow-hidden w-44 shadow-xl`}>
                {loadingFilters ? <p className={`text-[9px] ${th.textFaint} px-3 py-2`}>Loading...</p>
                  : filterNames.length === 0 ? <p className={`text-[9px] ${th.textFaint} px-3 py-2`}>No saved filters yet</p>
                  : filterNames.map(name => (
                    <div key={name} className={`flex items-center justify-between px-3 py-2 hover:ac-bg-10 group cursor-pointer`}>
                      <button onClick={() => handleLoadSelect(name)} className={`text-[10px] ${th.textMuted} text-left flex-1 font-medium`}>{name}</button>
                      <button onClick={() => handleDelete(name)} className="text-[9px] text-slate-500 hover:text-red-500 ml-2 opacity-0 group-hover:opacity-100 transition-opacity">✕</button>
                    </div>
                  ))}
              </div>
            )}
          </div>
        </div>
      </div>
      <textarea
        value={value}
        onChange={e => onChange(e.target.value)}
        disabled={disabled}
        placeholder={`${label} tickers...`}
        className={`w-full ${th.input} border ${th.inputBorder} rounded-lg p-2 text-xs ${th.text} h-14 resize-none focus:outline-none ${borderFocus} placeholder-slate-500 leading-relaxed disabled:opacity-40`}
      />
    </div>
  );
}

// ── Unified watchlist persistence (live list) ──────────────────────────────
// Talks to the authenticated /api/watchlist route (per-user, Redis-backed).
// Falls back to localStorage only as a read-through cache for snappy reloads;
// the server is the source of truth.
const LS_WATCHLIST = 'hunter-watchlist';

async function loadWatchlist(): Promise<WatchlistTicker[]> {
  let stored: WatchlistTicker[] = [];
  try {
    const res = await fetch('/api/watchlist');
    if (!res.ok) throw new Error(`Failed to load watchlist: ${res.status}`);
    const data = await res.json();
    stored = data?.tickers ?? [];
  } catch {
    try {
      const cached = localStorage.getItem(LS_WATCHLIST);
      if (cached) stored = JSON.parse(cached);
    } catch {}
  }
  if (stored.length === 0) return [];

  // Classification is never trusted from storage — always re-derived live
  // from TastyTrade on load, so a stale/wrong saved value can never persist
  // as the displayed truth. Symbol and active state are the only things
  // that actually need to survive a reload.
  try {
    const token = await getAccessToken();
    const classified = await Promise.all(
      stored.map(async t => ({
        symbol: t.symbol,
        active: t.active,
        classification: await classifyUnderlying(t.symbol, token).catch(() => 'stock' as const),
      }))
    );
    try { localStorage.setItem(LS_WATCHLIST, JSON.stringify(classified)); } catch {}
    return classified;
  } catch {
    // No token / offline — show stored data as-is rather than nothing,
    // but it will be re-verified the moment a token is available again.
    return stored;
  }
}

async function persistWatchlist(tickers: WatchlistTicker[]): Promise<boolean> {
  try { localStorage.setItem(LS_WATCHLIST, JSON.stringify(tickers)); } catch {}
  try {
    const res = await fetch('/api/watchlist', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tickers }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

// ── Saved watchlist presets (named, reuses existing /api/filters route) ──
// Stored under strategy key 'watchlist'. Same save/load/delete mechanics as
// the existing BPS/BCS/IC saved filters, just with the richer object shape.
async function loadWatchlists(): Promise<SavedWatchlists> {
  return (await loadFilters('watchlist')) as SavedWatchlists;
}

async function saveWatchlistPreset(
  name: string,
  tickers: WatchlistTicker[],
  replace = false
): Promise<{ success?: boolean; conflict?: boolean; message?: string }> {
  return saveFilter('watchlist', name, { tickers }, replace);
}

async function deleteWatchlistPreset(name: string): Promise<void> {
  return deleteFilter('watchlist', name);
}

// ── Merge helper (array-native replacement for mergeTickers/tickersToString) ──
// New symbols are classified automatically and added active. TE-0007: this
// used to default new tickers to inactive (opt-in via a second click)
// before the Opportunity Universe existed. Now that this same list IS the
// canonical universe every strategy button reads ("enter the companies
// you are willing to evaluate, then choose a strategy"), a ticker you just
// typed in needs to be immediately part of that universe -- requiring a
// separate activation click for something you just explicitly added would
// contradict the ticket's stated UX intent. The `active` checkbox remains
// available afterward to opt a ticker back out without removing it.
async function mergeTickerLists(existing: WatchlistTicker[], newSymbols: string[], token: string): Promise<WatchlistTicker[]> {
  const existingSymbols = new Set(existing.map(t => t.symbol));
  const symbolsToAdd = normalizeTickerInput(newSymbols.join(',')).filter(s => !existingSymbols.has(s));
  const classifications = await Promise.all(
    symbolsToAdd.map(symbol => classifyUnderlying(symbol, token).catch(() => 'stock' as const))
  );
  const toAdd: WatchlistTicker[] = symbolsToAdd.map((symbol, i) => ({
    symbol,
    classification: classifications[i],
    active: true,
  }));
  return [...existing, ...toAdd];
}

// ── WatchlistBox component ────────────────────────────────────────────────
// Replaces the three StrategyBox instances (BPS/BCS/IC). One flat list,
// grouped visually by Index/ETF/Stock classification, with a per-ticker
// active checkbox driving scan inclusion. No strategy routing here —
// strategy selection happens at scan time via trend detection (smart-skip).

function WatchlistBox({
  tickers,
  onChange,
  disabled,
  onLoadPrompt,
  sessionsPanel,
  th,
}: {
  tickers: WatchlistTicker[];
  onChange: (tickers: WatchlistTicker[]) => void;
  disabled?: boolean;
  onLoadPrompt: (state: Omit<LoadPromptState, 'show'>) => void;
  sessionsPanel?: React.ReactNode;
  th: typeof THEMES[Theme];
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const pendingSymbolsRef = useRef<string[]>([]);
  const [scanning, setScanning] = useState(false);
  const [inputValue, setInputValue] = useState('');
  const [savedWatchlists, setSavedWatchlists] = useState<SavedWatchlists>({});
  const [showSaveInput, setShowSaveInput] = useState(false);
  const [saveName, setSaveName] = useState('');
  const [saveError, setSaveError] = useState('');
  const [showLoad, setShowLoad] = useState(false);
  const [loadingPresets, setLoadingPresets] = useState(false);

  const refreshPresets = useCallback(async () => {
    setLoadingPresets(true);
    const presets = await loadWatchlists();
    setSavedWatchlists(presets);
    setLoadingPresets(false);
  }, []);
  useEffect(() => { refreshPresets(); }, [refreshPresets]);

  const handleAdd = async () => {
    if (!inputValue.trim()) return;
    const symbols = normalizeTickerInput(inputValue);
    if (symbols.length === 0) return;
    const token = await getAccessToken();
    onChange(await mergeTickerLists(tickers, symbols, token));
    setInputValue('');
  };

  // One-time fix for tickers whose classification was saved before the live
  // TastyTrade lookup existed (or saved while it was wrong). Re-runs the real
  // lookup for every ticker currently in the list and overwrites stored values.
  const [reclassifying, setReclassifying] = useState(false);
  const handleReclassifyAll = async () => {
    if (tickers.length === 0) return;
    setReclassifying(true);
    try {
      const token = await getAccessToken();
      const updated = await Promise.all(
        tickers.map(async t => ({
          ...t,
          classification: await classifyUnderlying(t.symbol, token).catch(() => t.classification),
        }))
      );
      onChange(updated);
    } finally {
      setReclassifying(false);
    }
  };

  const handleToggleActive = (symbol: string) => {
    onChange(tickers.map(t => t.symbol === symbol ? { ...t, active: !t.active } : t));
  };

  const handleRemove = (symbol: string) => {
    onChange(tickers.filter(t => t.symbol !== symbol));
  };

// Bulk select/deselect for a classification group (Indexes, ETFs, or Equities).
// Only flips `active` for tickers in the targeted group — other groups are untouched.
  const setGroupActive = (group: 'index' | 'etf' | 'stock', active: boolean) => {
    onChange(tickers.map(t => t.classification === group ? { ...t, active } : t));
  };
  const handleImgClick = () => {
    if (fileRef.current) fileRef.current.value = '';
    fileRef.current?.click();
  };

  const handleOCR = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]; if (!file) return; setScanning(true);
    try {
      const symbols = await extractTickersFromImage(file);
      if (symbols.length > 0) {
        const token = await getAccessToken();
        if (tickers.length > 0) {
          pendingSymbolsRef.current = symbols;
          onLoadPrompt({
            name: `${symbols.length} ticker${symbols.length !== 1 ? 's' : ''} from image`,
            type: 'strategy',
            onLoad: async (doMerge: boolean) => {
              if (doMerge) onChange(await mergeTickerLists(tickers, pendingSymbolsRef.current, token));
              else onChange(await mergeTickerLists([], pendingSymbolsRef.current, token));
            },
          });
        } else {
          onChange(await mergeTickerLists([], symbols, token));
        }
      }
    } catch (err: any) {
      console.error('OCR error:', err?.message ?? err);
    }
    setScanning(false);
  };

  const handleSave = async (replace = false) => {
    if (!saveName.trim()) { setSaveError('Enter a name'); return; }
    if (tickers.length === 0) { setSaveError('No tickers to save'); return; }
    const result = await saveWatchlistPreset(saveName.trim(), tickers, replace);
    if (result.conflict) { setSaveError(`"${saveName}" exists — replace?`); return; }
    await refreshPresets(); setShowSaveInput(false); setSaveName(''); setSaveError('');
  };

  const handleLoadSelect = (name: string) => {
    const preset = savedWatchlists[name] ?? []; setShowLoad(false);
    if (tickers.length === 0) { onChange(preset); return; }
    onLoadPrompt({
      name,
      type: 'strategy',
      onLoad: async (doMerge: boolean) => {
        if (doMerge) {
          const token = await getAccessToken();
          onChange(await mergeTickerLists(tickers, preset.map(t => t.symbol), token));
        } else onChange(preset);
      },
    });
  };

  const handleDeletePreset = async (name: string) => { await deleteWatchlistPreset(name); await refreshPresets(); };
  const presetNames = Object.keys(savedWatchlists);

  const indexesOnly = tickers.filter(t => t.classification === 'index');
  const etfsOnly = tickers.filter(t => t.classification === 'etf');
  const equities = tickers.filter(t => t.classification === 'stock');
  const pending = tickers.filter(t => t.classification === 'pending');

  const TickerChip = ({ t }: { t: WatchlistTicker }) => (
    <div className={`flex items-center gap-1.5 px-2 py-1 border ${th.inputBorder} rounded-md`}>
      <input
        type="checkbox"
        checked={t.active}
        onChange={() => handleToggleActive(t.symbol)}
        disabled={disabled || t.classification === 'pending'}
        className="cursor-pointer shrink-0"
      />
      <span className={`text-[11px] font-medium flex-1 ${t.active ? th.text : th.textMuted}`}>
        {t.symbol}{t.classification === 'pending' && <span className={`ml-1 ${th.textFaint}`}>⟳</span>}
      </span>
      <button
        onClick={() => handleRemove(t.symbol)}
        disabled={disabled}
        className="text-[10px] text-slate-500 hover:text-red-500 transition-colors shrink-0"
      >✕</button>
    </div>
  );

  const GroupHeader = ({
    label,
    count,
    group,
  }: {
    label: string;
    count: number;
    group: 'index' | 'etf' | 'stock';
    }) => (
      <div className="flex items-center justify-between mb-1">
      <p className={`text-[9px] ${th.textFaint} uppercase tracking-widest`}>{label} ({count})</p>
      <div className="flex items-center gap-1.5">
        <button
          onClick={() => setGroupActive(group, true)}
          disabled={disabled}
          className={`text-[9px] ${th.textMuted} ac-hover-text transition-colors disabled:opacity-40`}
        >Select All</button>
        <span className={`text-[9px] ${th.textFaint}`}>|</span>
        <button
          onClick={() => setGroupActive(group, false)}
          disabled={disabled}
          className={`text-[9px] ${th.textMuted} ac-hover-text transition-colors disabled:opacity-40`}
        >Deselect All</button>
      </div>
    </div>
  );

  return (
    <div>
      <div className="mb-2 flex items-center justify-between">
        <span className={`text-[10px] ${th.textMuted} font-medium tracking-wider`}>WATCHLIST</span>
        <button onClick={handleReclassifyAll} disabled={disabled || reclassifying || tickers.length === 0}
          title="Re-check Index/ETF/Stock type for every ticker against TastyTrade — fixes stale classifications"
          className={`text-[9px] ${th.textFaint} ac-hover-text transition-colors disabled:opacity-40`}>
          {reclassifying ? '⟳ Reclassifying...' : '↻ Reclassify All'}
        </button>
      </div>
      
      <div className={`border ${th.border} rounded-lg p-2 mb-2`}>
        <p className={`text-[9px] ${th.textMuted} tracking-widest font-medium mb-2`}>IMPORT TICKER LIST FROM IMAGE OR ADD MANUALLY</p>
        <div className="flex items-center gap-1">
          <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={handleOCR} />
          <button onClick={handleImgClick} disabled={disabled || scanning} className={`text-[9px] px-1.5 py-0.5 border ${th.inputBorder} rounded ${th.textMuted} ac-hover-border ac-hover-text transition-colors disabled:opacity-40`}>{scanning ? '⟳' : '↑ img'}</button>
          <div className="relative">
            <button onClick={() => { setShowSaveInput(!showSaveInput); setShowLoad(false); setSaveError(''); }} disabled={disabled || tickers.length === 0} className={`text-[9px] px-1.5 py-0.5 border ${th.inputBorder} rounded ${th.textMuted} ac-hover-border ac-hover-text transition-colors disabled:opacity-40`}>💾</button>
            {showSaveInput && (
              <div className={`absolute top-6 right-0 z-40 ${th.sidebar} border ${th.border} rounded-lg p-2 w-44 shadow-xl`}>
                <div className="flex gap-1 mb-1">
                  <input type="text" value={saveName} onChange={e => { setSaveName(e.target.value); setSaveError(''); }} placeholder="Watchlist name..." onKeyDown={e => e.key === 'Enter' && handleSave()}
                    className={`flex-1 ${th.input} border ${th.inputBorder} rounded px-2 py-1 text-[10px] ${th.text} focus:outline-none ac-focus placeholder-slate-500`} />
                  <button onClick={() => handleSave()} className="text-[9px] px-1.5 py-1 ac-btn-solid text-white rounded font-medium">Save</button>
                </div>
                {saveError && (<div className="flex gap-1 items-center"><span className="text-[9px] text-yellow-400">{saveError}</span>{saveError.includes('exists') && <button onClick={() => handleSave(true)} className="text-[9px] px-1 py-0.5 bg-yellow-600 text-white rounded">Replace</button>}</div>)}
              </div>
            )}
          </div>
          <div className="relative">
            <button onClick={() => { setShowLoad(!showLoad); setShowSaveInput(false); if (!showLoad) refreshPresets(); }} disabled={disabled} className={`text-[9px] px-1.5 py-0.5 border ${th.inputBorder} rounded ${th.textMuted} ac-hover-border ac-hover-text transition-colors disabled:opacity-40`}>▼</button>
            {showLoad && (
              <div className={`absolute top-6 right-0 z-40 ${th.sidebar} border ${th.border} rounded-lg overflow-hidden w-44 shadow-xl`}>
                {loadingPresets ? <p className={`text-[9px] ${th.textFaint} px-3 py-2`}>Loading...</p>
                  : presetNames.length === 0 ? <p className={`text-[9px] ${th.textFaint} px-3 py-2`}>No saved watchlists yet</p>
                  : presetNames.map(name => (
                    <div key={name} className={`flex items-center justify-between px-3 py-2 hover:ac-bg-10 group cursor-pointer`}>
                      <button onClick={() => handleLoadSelect(name)} className={`text-[10px] ${th.textMuted} text-left flex-1 font-medium`}>{name}</button>
                      <button onClick={() => handleDeletePreset(name)} className="text-[9px] text-slate-500 hover:text-red-500 ml-2 opacity-0 group-hover:opacity-100 transition-opacity">✕</button>
                    </div>
                  ))}
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="flex gap-1 mb-2">
        <input
          type="text"
          value={inputValue}
          onChange={e => setInputValue(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && handleAdd()}
          disabled={disabled}
          placeholder="Add tickers (comma-separated)..."
          className={`flex-1 ${th.input} border ${th.inputBorder} rounded-lg px-2 py-1.5 text-xs ${th.text} focus:outline-none ac-focus placeholder-slate-500 disabled:opacity-40`}
        />
        <button onClick={handleAdd} disabled={disabled || !inputValue.trim()} className="text-[10px] px-3 py-1.5 ac-btn-solid text-white rounded-lg font-medium disabled:opacity-40">Add</button>
      </div>

      {sessionsPanel && (
        <div className="mb-2">
          {sessionsPanel}
        </div>
      )}

      {tickers.length === 0 ? (
        <p className={`text-[10px] ${th.textFaint} py-3 text-center`}>No tickers yet. Add some above to get started.</p>
      ) : (
        <div className="space-y-2">
          {pending.length > 0 && (
            <div>
              <p className={`text-[9px] ${th.textFaint} uppercase tracking-widest mb-1`}>Classifying ({pending.length})</p>
              <div className="grid grid-cols-3 gap-1">
                {pending.map(t => <TickerChip key={t.symbol} t={t} />)}
              </div>
            </div>
          )}
          {indexesOnly.length > 0 && (
            <div>
              <GroupHeader label="Indexes" count={indexesOnly.length} group="index" />
              <div className="grid grid-cols-3 gap-1">
                {indexesOnly.map(t => <TickerChip key={t.symbol} t={t} />)}
              </div>
            </div>
          )}
          {etfsOnly.length > 0 && (
            <div>
              <GroupHeader label="ETFs" count={etfsOnly.length} group="etf" />
              <div className="grid grid-cols-3 gap-1">
                {etfsOnly.map(t => <TickerChip key={t.symbol} t={t} />)}
              </div>
            </div>
          )}
          {equities.length > 0 && (
            <div>
              <GroupHeader label="Equities" count={equities.length} group="stock" />
              <div className="grid grid-cols-3 gap-1">
                {equities.map(t => <TickerChip key={t.symbol} t={t} />)}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// app/screener/page.tsx

// ── Result Card ────────────────────────────────────────────────────────────

function InfoTooltip({ th, text }: { th: typeof THEMES[Theme]; text: string }) {
  const [open, setOpen] = useState(false);
  return (
    <span className="relative inline-flex items-center" onClick={e => e.stopPropagation()}>
      <button
        onMouseEnter={() => setOpen(true)}
        onMouseLeave={() => setOpen(false)}
        onClick={() => setOpen(v => !v)}
        className={`text-[9px] ${th.textFaint} hover:text-blue-400 ml-0.5 leading-none`}
      >ⓘ</button>
      {open && (
        <div className={`absolute bottom-full left-0 mb-1 z-50 ${th.sidebar} border ${th.border} rounded-lg p-2 shadow-xl`}
          style={{ width: '220px' }}>
          <p className={`text-[10px] ${th.textMuted} leading-relaxed`}>{text}</p>
        </div>
      )}
    </span>
  );
}

function StrikesDisplay({ c, th }: { c: SpreadCandidate; th: typeof THEMES[Theme] }) {
  const widthTag = (w: number) => <span className={`${th.textFaint} mx-0.5`}>{`·${w}·`}</span>;
  if (c.strategy === 'CSP') {
    return (
      <div className="text-xs shrink-0">
        <span className={th.label}>Put </span><span className={`${th.text} font-medium`}>{c.shortStrike}</span>
      </div>
    );
  }
  if (c.strategy === 'CC') {
    return (
      <div className="text-xs shrink-0">
        <span className={th.label}>Call </span><span className={`${th.text} font-medium`}>{c.shortStrike}</span>
      </div>
    );
  }
  if (c.strategy === 'PMCC') {
    return (
      <div className="text-xs shrink-0">
        <span className={th.label}>Long </span>
        <span className={th.text}>{c.longStrike}C</span>
        <span className="text-[10px] text-emerald-400 font-mono ml-0.5">
          (Δ{c.longDelta != null ? c.longDelta.toFixed(2) : '—'})
        </span>
        <span className={`${th.textFaint} mx-1`}>→</span>
        <span className={th.label}>Short </span>
        <span className={th.text}>{c.shortStrike}C</span>
        <span className="text-[10px] text-amber-400 font-mono ml-0.5">
          (Δ{c.shortDelta != null ? c.shortDelta.toFixed(2) : '—'})
        </span>
      </div>
    );
  }
  if (c.strategy === 'IC' && c.shortCallStrike != null && c.longCallStrike != null) {
    return (
      <div className="text-xs shrink-0">
        <span className={th.label}>Strikes </span>
        <span className={th.text}>{c.shortStrike}/{c.longStrike}</span>
        {widthTag(c.spreadWidth)}
        <br />
        <span className={th.text}>{c.shortCallStrike}/{c.longCallStrike}</span>
        {widthTag(c.callWidth ?? c.spreadWidth)}
      </div>
    );
  }
  return <div className="text-xs shrink-0"><span className={th.label}>Strikes </span><span className={`${th.text} font-medium`}>{c.shortStrike}/{c.longStrike}</span>{widthTag(c.spreadWidth)}</div>;
}


// ── Order Placement ────────────────────────────────────────────────────────
async function getAccountNumber(): Promise<string> {
  const token = await getAccessToken();
  const data = await ttFetch('/customers/me/accounts', token);
  const acct = data?.data?.items?.[0]?.account?.['account-number'];
  if (!acct) throw new Error('No account found');
  return acct;
}

function buildOrderLegs(result: ScreenResult, c: SpreadCandidate): any[] {
  const instrType = result.underlyingType === 'index' ? 'Index Option' : 'Equity Option';
  const legs: any[] = [];
  if (c.strategy === 'BPS') {
    legs.push({ 'instrument-type': instrType, symbol: c.shortOccSymbol!, quantity: 1, action: 'Sell to Open' });
    legs.push({ 'instrument-type': instrType, symbol: c.longOccSymbol!, quantity: 1, action: 'Buy to Open' });
  } else if (c.strategy === 'BCS') {
    legs.push({ 'instrument-type': instrType, symbol: c.shortOccSymbol!, quantity: 1, action: 'Sell to Open' });
    legs.push({ 'instrument-type': instrType, symbol: c.longOccSymbol!, quantity: 1, action: 'Buy to Open' });
  } else if (c.strategy === 'IC') {
    legs.push({ 'instrument-type': instrType, symbol: c.shortOccSymbol!, quantity: 1, action: 'Sell to Open' });
    legs.push({ 'instrument-type': instrType, symbol: c.longOccSymbol!, quantity: 1, action: 'Buy to Open' });
    legs.push({ 'instrument-type': instrType, symbol: c.shortCallOccSymbol!, quantity: 1, action: 'Sell to Open' });
    legs.push({ 'instrument-type': instrType, symbol: c.longCallOccSymbol!, quantity: 1, action: 'Buy to Open' });
  }
  return legs;
}

function buildOrderPayload(c: SpreadCandidate, quantity: number, legs: any[]): any {
  const credit = ((c.totalCredit ?? c.credit) * quantity).toFixed(2);
  return {
    'time-in-force': 'GTC',
    'order-type': 'Limit',
    price: credit,
    'price-effect': 'Credit',
    legs: legs.map(l => ({ ...l, quantity })),
  };
}

function TradeModal({ result, th, onClose }: {
  result: ScreenResult; th: typeof THEMES[Theme]; onClose: () => void;
}) {
  const c = result.bestCandidate!;
  const [quantity, setQuantity] = useState(1);
  const [phase, setPhase] = useState<'confirm' | 'dryrun' | 'placing' | 'done' | 'error'>('confirm');
  const [dryRunResult, setDryRunResult] = useState<any>(null);
  const [error, setError] = useState('');
  const [orderId, setOrderId] = useState<string>('');

  // GTC profit target (default 50%)
  const [gtcPct, setGtcPct] = useState(50);
  const creditPerContract = c.totalCredit ?? c.credit;
  const gtcBuyback = parseFloat((creditPerContract * (1 - gtcPct / 100)).toFixed(2));

  // Stop loss (default 200% of credit = 2× credit debit to close)
  const [stopPct, setStopPct] = useState(200);
  const stopPrice = parseFloat((creditPerContract * (stopPct / 100)).toFixed(2));

  // Stop-limit buffer — the stop leg must be submitted as 'Stop Limit',
  // not plain 'Stop' (TastyTrade does not support stop-market orders on
  // multi-leg spreads). This buffer sets how far above the stop-trigger
  // price the limit sits, giving the order room to actually fill once
  // triggered rather than resting unfilled on a fast move.
  const [stopLimitBufferPct, setStopLimitBufferPct] = useState(5);
  const stopLimitPrice = parseFloat((stopPrice * (1 + stopLimitBufferPct / 100)).toFixed(2));

  // Entry limit price (default = credit, can tweak)
  const [entryLimit, setEntryLimit] = useState(parseFloat(creditPerContract.toFixed(2)));

  // ── OTM proximity hard gate ────────────────────────────────────────────
  // Chasing premium on a tight-to-ITM strike is the exact mistake this is
  // meant to catch. Threshold mirrors the same buffer table the rank score
  // uses (index/etf/stock × DTE bucket), so if the score is already
  // flagging a weak buffer dimension, order entry blocks too.
  const otmPct = (() => {
    if (result.price == null) return null;
    const price = result.price;
    if (c.strategy === 'BCS') return ((c.shortStrike - price) / price) * 100;
    if (c.strategy === 'BPS') return ((price - c.shortStrike) / price) * 100;
    if (c.strategy === 'IC' && c.shortCallStrike != null) {
      return Math.min(
        ((price - c.shortStrike) / price) * 100,
        ((c.shortCallStrike - price) / price) * 100
      );
    }
    return null;
  })();
  const otmWarnThreshold = getOtmWarningThreshold(c.dte, result.underlyingType ?? 'stock');
  const otmTooTight = otmPct != null && otmPct < otmWarnThreshold;
  const [otmOverrideChecked, setOtmOverrideChecked] = useState(false);
  const otmGateBlocking = otmTooTight && !otmOverrideChecked;

  const hasOccSymbols = c.shortOccSymbol && c.longOccSymbol &&
    (c.strategy !== 'IC' || (c.shortCallOccSymbol && c.longCallOccSymbol));

  const credit = entryLimit * quantity;
  const maxLoss = (c.spreadWidth - (c.totalCredit ?? c.credit)) * quantity * 100;

  const buildOtocoPayload = (qty: number) => {
    const legs = buildOrderLegs(result, c);
    const closingLegs = legs.map((l: any) => ({
      ...l,
      quantity: qty,
      action: l.action === 'Sell to Open' ? 'Buy to Close' : 'Sell to Close',
    }));
    return {
      type: 'OTOCO',
      'trigger-order': {
        'time-in-force': 'GTC',
        'order-type': 'Limit',
        price: entryLimit.toFixed(2),
        'price-effect': 'Credit',
        legs: legs.map((l: any) => ({ ...l, quantity: qty })),
      },
      orders: [
        {
          'time-in-force': 'GTC',
          'order-type': 'Limit',
          price: gtcBuyback.toFixed(2),
          'price-effect': 'Debit',
          legs: closingLegs,
        },
        {
          // NOTE: this OCO stop child must use 'order-type': 'Stop Limit'
          // with BOTH stop-trigger and price. TastyTrade does not support
          // stop-MARKET orders on multi-leg spreads (confirmed via their
          // preflight rejection: "Orders with 2 or more legs cannot be
          // placed as 'Market' orders" — a plain 'Stop' with no price
          // executes as a market order once triggered, which is exactly
          // what's disallowed here). The dry-run never caught this
          // because TT doesn't support dry-running complex/OTOCO orders
          // at all — only the live complex-order submission validates
          // the full OTOCO structure.
          'time-in-force': 'GTC',
          'order-type': 'Stop Limit',
          'stop-trigger': stopPrice.toFixed(2),
          price: stopLimitPrice.toFixed(2),
          'price-effect': 'Debit',
          legs: closingLegs,
        },
      ],
    };
  };

  const runDryRun = async () => {
    setPhase('dryrun'); setError('');
    try {
      const token = await getAccessToken();
      const accountNumber = await getAccountNumber();
      const legs = buildOrderLegs(result, c);
      const payload = buildOrderPayload(c, quantity, legs);
      payload.price = entryLimit.toFixed(2);
      // Dry run on the entry leg only (TT doesn't support complex order dry-run)
      const res = await fetch(`https://api.tastytrade.com/accounts/${accountNumber}/orders/dry-run`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      // TEMP DEBUG -- remove once preflight failure is diagnosed
      console.log('DRY_RUN_DEBUG payload sent:', payload);
      console.log('DRY_RUN_DEBUG full response:', data);
      if (!res.ok) throw new Error(data?.error?.message ?? data?.errors?.[0]?.message ?? `Dry run failed (${res.status})`);
      setDryRunResult(data?.data);
      setPhase('confirm');
    } catch (e: any) {
      setError(e.message); setPhase('error');
    }
  };

  const placeOrder = async () => {
    setPhase('placing'); setError('');
    try {
      const token = await getAccessToken();
      const accountNumber = await getAccountNumber();
      // Single OTOCO complex order: entry → OCO (GTC profit target + stop loss)
      const payload = buildOtocoPayload(quantity);
      const res = await fetch(`https://api.tastytrade.com/accounts/${accountNumber}/complex-orders`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      // TEMP DEBUG -- remove once preflight failure is diagnosed
      console.log('PLACE_ORDER_DEBUG payload sent:', JSON.stringify(payload, null, 2));
      console.log('PLACE_ORDER_DEBUG full response:', data);
      if (!res.ok) throw new Error(data?.error?.message ?? data?.errors?.[0]?.message ?? `Order failed (${res.status})`);
      setOrderId(data?.data?.['complex-order']?.id ?? data?.data?.order?.id ?? 'submitted');
      setPhase('done');
    } catch (e: any) {
      setError(e.message); setPhase('error');
    }
  };

  const bpEffect = dryRunResult?.['buying-power-effect'];
  const bpChange = bpEffect?.['change-in-buying-power'];
  const bpEffect2 = bpEffect?.['change-in-buying-power-effect'];
  const marginReq = bpEffect?.['change-in-margin-requirement'];

  return (
    <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-[70] p-4">
      <div className={`${th.sidebar} border ${th.border} rounded-2xl p-6 w-full max-w-md max-h-[92vh] overflow-y-auto`} onClick={e => e.stopPropagation()}>
        <div className="flex justify-between items-center mb-4">
          <h2 className={`text-sm font-bold ${th.text} tracking-widest`}>PLACE ORDER — {result.symbol}</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-white text-xl">✕</button>
        </div>

        {!hasOccSymbols && (
          <div className="p-3 bg-yellow-500/10 border border-yellow-600 rounded-lg mb-4">
            <p className="text-xs text-yellow-400">OCC symbols not available for this spread — rescan to populate them.</p>
          </div>
        )}

        {otmTooTight && (
          <div className="p-3 bg-red-500/10 border border-red-600 rounded-lg mb-4 space-y-2">
            <p className="text-xs text-red-400 font-bold">
              ⚠ OTM buffer {otmPct!.toFixed(1)}% is below the {otmWarnThreshold}% threshold for this {result.underlyingType ?? 'stock'} / {c.dte}DTE setup — too close to the short strike.
            </p>
            <label className="flex items-center gap-2 text-[11px] text-red-300 cursor-pointer">
              <input type="checkbox" checked={otmOverrideChecked} onChange={e => setOtmOverrideChecked(e.target.checked)} className="accent-red-500" />
              I understand this is chasing premium on a tight strike and want to proceed anyway
            </label>
          </div>
        )}

        {/* Trade summary */}
        <div className={`${th.card} border ${th.border} rounded-xl p-4 mb-4 space-y-2`}>
          <div className="flex justify-between text-xs">
            <span className={th.textFaint}>Strategy</span>
            <span className={`font-bold ${c.strategy === 'BPS' ? 'text-emerald-400' : c.strategy === 'BCS' ? 'text-red-400' : 'text-blue-400'}`}>{c.strategy}</span>
          </div>
          <div className="flex justify-between text-xs">
            <span className={th.textFaint}>Strikes</span>
            <span className={th.text}>{c.shortStrike} / {c.longStrike}{c.strategy === 'IC' ? ` · ${c.shortCallStrike} / ${c.longCallStrike}` : ''}</span>
          </div>
          <div className="flex justify-between text-xs">
            <span className={th.textFaint}>Expiry</span>
            <span className={th.text}>{c.expiration} ({c.dte}d)</span>
          </div>
          <div className="flex justify-between text-xs">
            <span className={th.textFaint}>Next Earnings</span>
            {!result.earningsDate ? (
              <span className={th.textMuted}>No data</span>
            ) : (() => {
              const earningsDte = daysUntil(result.earningsDate);
              if (earningsDte < 0) {
                return <span className={th.textMuted}>{result.earningsDate} (past)</span>;
              }
              const fallsBeforeExpiry = earningsDte <= c.dte;
              return (
                <span className={fallsBeforeExpiry ? 'text-red-400 font-bold' : th.text}>
                  {result.earningsDate} ({earningsDte}d){fallsBeforeExpiry ? ' — before expiry' : ''}
                </span>
              );
            })()}
          </div>
          <div className="flex justify-between text-xs items-center">
            <span className={th.textFaint}>Entry limit / contract</span>
            <div className="flex items-center gap-1">
              <button onClick={() => setEntryLimit(v => parseFloat(Math.max(0.01, v - 0.05).toFixed(2)))} className={`w-5 h-5 rounded border ${th.border} ${th.textMuted} text-xs ac-hover-border`}>−</button>
              <span className="text-emerald-400 font-bold text-xs w-12 text-center">${entryLimit.toFixed(2)}</span>
              <button onClick={() => setEntryLimit(v => parseFloat((v + 0.05).toFixed(2)))} className={`w-5 h-5 rounded border ${th.border} ${th.textMuted} text-xs ac-hover-border`}>+</button>
            </div>
          </div>
          <div className="flex justify-between text-xs">
            <span className={th.textFaint}>Order type</span>
            <span className={th.text}>Limit · GTC</span>
          </div>
        </div>

        {/* Quantity */}
        <div className="flex items-center gap-3 mb-4">
          <span className={`text-xs ${th.textFaint}`}>Contracts</span>
          <div className="flex items-center gap-2">
            <button onClick={() => setQuantity(q => Math.max(1, q - 1))} className={`w-7 h-7 rounded border ${th.border} ${th.textMuted} ac-hover-border text-sm`}>−</button>
            <span className={`text-sm font-bold ${th.text} w-6 text-center`}>{quantity}</span>
            <button onClick={() => setQuantity(q => Math.min(20, q + 1))} className={`w-7 h-7 rounded border ${th.border} ${th.textMuted} ac-hover-border text-sm`}>+</button>
          </div>
          <div className="ml-auto text-right">
            <p className="text-emerald-400 font-bold text-sm">${credit.toFixed(2)} credit</p>
            <p className={`text-[10px] ${th.textFaint}`}>Max loss ~${maxLoss.toFixed(0)}</p>
          </div>
        </div>

        {/* GTC Profit Target */}
        <div className={`${th.card} border ${th.border} rounded-xl p-4 mb-3`}>
          <div className="flex items-center justify-between mb-2">
            <p className="text-[10px] font-bold tracking-widest text-emerald-400">GTC PROFIT TARGET</p>
            <span className={`text-[9px] ${th.textFaint}`}>closes at ${gtcBuyback.toFixed(2)} debit</span>
          </div>
          <div className="flex items-center gap-2">
            {[25, 50, 65, 75].map(pct => (
              <button key={pct} onClick={() => setGtcPct(pct)}
                className={`flex-1 py-1.5 rounded text-[10px] font-bold border transition-colors ${gtcPct === pct ? 'bg-emerald-600 border-emerald-500 text-white' : `${th.border} ${th.textFaint} hover:border-emerald-600`}`}>
                {pct}%
              </button>
            ))}
          </div>
          <p className={`text-[9px] ${th.textFaint} mt-2`}>Buy to close at ${gtcBuyback.toFixed(2)} when {gtcPct}% of ${creditPerContract.toFixed(2)} credit is captured</p>
        </div>

        {/* Stop Loss */}
        <div className={`${th.card} border ${th.border} rounded-xl p-4 mb-4`}>
          <div className="flex items-center justify-between mb-2">
            <p className="text-[10px] font-bold tracking-widest text-red-400">STOP LOSS</p>
            <span className={`text-[9px] ${th.textFaint}`}>triggers at ${stopPrice.toFixed(2)} debit</span>
          </div>
          <div className="flex items-center gap-2">
            {[150, 200, 250, 300].map(pct => (
              <button key={pct} onClick={() => setStopPct(pct)}
                className={`flex-1 py-1.5 rounded text-[10px] font-bold border transition-colors ${stopPct === pct ? 'bg-red-700 border-red-500 text-white' : `${th.border} ${th.textFaint} hover:border-red-700`}`}>
                {pct}%
              </button>
            ))}
          </div>
          <p className={`text-[9px] ${th.textFaint} mt-2`}>Stop triggers when spread costs ${stopPrice.toFixed(2)} to close ({stopPct}% of credit = {stopPct - 100}% loss on credit received)</p>
          <div className="flex items-center justify-between mt-3 pt-3 border-t border-red-900/30">
            <span className={`text-[9px] ${th.textFaint}`}>Stop-limit buffer</span>
            <span className={`text-[9px] ${th.textFaint}`}>limit at ${stopLimitPrice.toFixed(2)} debit</span>
          </div>
          <div className="flex items-center gap-2 mt-1.5">
            {[2, 5, 10, 15].map(pct => (
              <button key={pct} onClick={() => setStopLimitBufferPct(pct)}
                className={`flex-1 py-1 rounded text-[10px] font-bold border transition-colors ${stopLimitBufferPct === pct ? 'bg-red-700 border-red-500 text-white' : `${th.border} ${th.textFaint} hover:border-red-700`}`}>
                +{pct}%
              </button>
            ))}
          </div>
          <p className={`text-[9px] ${th.textFaint} mt-2`}>Stop submits as Stop Limit — triggers at ${stopPrice.toFixed(2)}, fills up to ${stopLimitPrice.toFixed(2)} (required: TastyTrade does not allow stop-market orders on multi-leg spreads)</p>
        </div>

        {/* Dry run result */}
        {dryRunResult && (
          <div className="p-3 bg-emerald-500/10 border border-emerald-600 rounded-lg mb-4 space-y-1">
            <p className="text-[10px] text-emerald-400 font-bold tracking-wider">DRY RUN PASSED</p>
            {bpChange && <p className="text-xs text-emerald-300">Buying power: {bpEffect2 === 'Debit' ? '−' : '+'}${parseFloat(bpChange).toFixed(2)}</p>}
            {marginReq && <p className="text-xs text-emerald-300">Margin required: ${parseFloat(marginReq).toFixed(2)}</p>}
          </div>
        )}

        {phase === 'done' && (
          <div className="p-3 bg-emerald-500/10 border border-emerald-600 rounded-lg mb-4 space-y-1">
            <p className="text-xs text-emerald-400 font-bold">✓ OTOCO order submitted — ID {orderId}</p>
            <p className="text-[10px] text-emerald-400/70">Entry + GTC profit target ({gtcPct}%) + stop loss ({stopPct}%) submitted as a single bracket order. Once entry fills, the OCO activates automatically.</p>
            <p className="text-[10px] text-emerald-400/70">Verify the complex order in TastyTrade.</p>
          </div>
        )}

        {phase === 'error' && error && (
          <div className="p-3 bg-red-500/10 border border-red-600 rounded-lg mb-4">
            <p className="text-xs text-red-400">{error}</p>
          </div>
        )}

        {phase !== 'done' && (
          <div className="flex gap-2">
            {!dryRunResult ? (
              <button onClick={runDryRun} disabled={!hasOccSymbols || phase === 'dryrun' || otmGateBlocking}
                className="flex-1 py-2.5 border ac-btn rounded-xl text-xs font-bold tracking-widest hover:ac-bg-10 transition-colors disabled:opacity-40">
                {phase === 'dryrun' ? 'VALIDATING...' : otmGateBlocking ? 'ACKNOWLEDGE OTM WARNING TO CONTINUE' : 'VALIDATE ORDER'}
              </button>
            ) : (
              <>
                <button onClick={runDryRun} disabled={phase === 'dryrun' || otmGateBlocking}
                  className={`py-2.5 px-3 border ${th.border} ${th.textFaint} rounded-xl text-xs ac-hover-border transition-colors disabled:opacity-40`}>
                  ↺
                </button>
                <button onClick={placeOrder} disabled={phase === 'placing' || otmGateBlocking}
                  className="flex-1 py-2.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl text-xs font-bold tracking-widest transition-colors disabled:opacity-40">
                  {phase === 'placing' ? 'PLACING...' : otmGateBlocking ? 'ACKNOWLEDGE OTM WARNING TO CONTINUE' : `PLACE + GTC + STOP`}
                </button>
              </>
            )}
          </div>
        )}

        {phase === 'done' && (
          <button onClick={onClose} className={`w-full py-2.5 border ${th.border} ${th.textMuted} rounded-xl text-xs font-bold tracking-widest`}>
            CLOSE
          </button>
        )}
      </div>
    </div>
  );
}


function buildPmccOrderLegs(pair: PmccPairResult): any[] {
  return [
    { 'instrument-type': 'Equity Option', symbol: pair.longLeg.occSymbol, quantity: 1, action: 'Buy to Open' },
    { 'instrument-type': 'Equity Option', symbol: pair.shortLeg.occSymbol, quantity: 1, action: 'Sell to Open' },
  ];
}

// PmccTradeModal — a real fork of TradeModal, not a shared component with
// PMCC-branch conditionals threaded through it. TradeModal's `c =
// result.bestCandidate!` assumption, its OTM gate (built for a short
// spread's strike relative to price -- doesn't apply to a diagonal's two
// strikes), and its 'price-effect': 'Credit' default are all wrong for a
// PMCC entry and would need to be disabled/bypassed at every point rather
// than reused. Two independently-correct components are safer than one
// component with logic guarding against the wrong pricing model firing on
// the wrong strategy -- exactly the kind of mistake that's cheap to
// prevent here and expensive to discover after a live order goes out
// wrong (per Paul's requirement on this ticket).
//
// v1 is deliberately entry-only, no OTOCO wrapper, no profit-target, no
// stop-loss -- per Ian's guidance: the short call gets managed like any
// covered call (its own GTC profit-target, a fast-follow ticket), the long
// LEAPS is thesis-driven and never gets a mechanical stop, and there is no
// single "close the whole diagonal" automation since that's a manual,
// two-leg decision when the trader decides it's time.
function PmccTradeModal({ result, th, onClose }: {
  result: ScreenResult; th: typeof THEMES[Theme]; onClose: () => void;
}) {
  const pair = result.pmccPair!;
  const [quantity, setQuantity] = useState(1);
  const [phase, setPhase] = useState<'confirm' | 'dryrun' | 'placing' | 'done' | 'error'>('confirm');
  const [dryRunResult, setDryRunResult] = useState<any>(null);
  const [error, setError] = useState('');
  const [orderId, setOrderId] = useState<string>('');

  const netDebit = pair.metrics?.netDebitPerShare ?? 0;
  const [entryLimit, setEntryLimit] = useState(parseFloat(netDebit.toFixed(2)));

  const hasOccSymbols = Boolean(pair.longLeg.occSymbol && pair.shortLeg.occSymbol);
  const debit = entryLimit * quantity;

  const buildPayload = (qty: number) => {
    const legs = buildPmccOrderLegs(pair);
    return {
      'time-in-force': 'GTC',
      'order-type': 'Limit',
      price: entryLimit.toFixed(2),
      'price-effect': 'Debit',
      legs: legs.map(l => ({ ...l, quantity: qty })),
    };
  };

  const runDryRun = async () => {
    setPhase('dryrun'); setError('');
    try {
      const token = await getAccessToken();
      const accountNumber = await getAccountNumber();
      const payload = buildPayload(quantity);
      const res = await fetch(`https://api.tastytrade.com/accounts/${accountNumber}/orders/dry-run`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error?.message ?? data?.errors?.[0]?.message ?? `Dry run failed (${res.status})`);
      setDryRunResult(data?.data);
      setPhase('confirm');
    } catch (e: any) {
      setError(e.message); setPhase('error');
    }
  };

  const placeOrder = async () => {
    setPhase('placing'); setError('');
    try {
      const token = await getAccessToken();
      const accountNumber = await getAccountNumber();
      const payload = buildPayload(quantity);
      const res = await fetch(`https://api.tastytrade.com/accounts/${accountNumber}/orders`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error?.message ?? data?.errors?.[0]?.message ?? `Order failed (${res.status})`);
      setOrderId(data?.data?.order?.id ?? 'submitted');
      setPhase('done');
    } catch (e: any) {
      setError(e.message); setPhase('error');
    }
  };

  const bpEffect = dryRunResult?.['buying-power-effect'];
  const bpChange = bpEffect?.['change-in-buying-power'];
  const bpEffect2 = bpEffect?.['change-in-buying-power-effect'];
  const marginReq = bpEffect?.['change-in-margin-requirement'];

  return (
    <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-[70] p-4">
      <div className={`${th.sidebar} border ${th.border} rounded-2xl p-6 w-full max-w-md max-h-[92vh] overflow-y-auto`} onClick={e => e.stopPropagation()}>
        <div className="flex justify-between items-center mb-4">
          <h2 className={`text-sm font-bold ${th.text} tracking-widest`}>PLACE PMCC ENTRY — {result.symbol}</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-white text-xl">✕</button>
        </div>

        {!hasOccSymbols && (
          <div className="p-3 bg-yellow-500/10 border border-yellow-600 rounded-lg mb-4">
            <p className="text-xs text-yellow-400">OCC symbols not available for this pair — rescan to populate them.</p>
          </div>
        )}

        <div className="p-3 bg-cyan-500/10 border border-cyan-600 rounded-lg mb-4">
          <p className="text-[10px] text-cyan-300">Entry only. No profit-target or stop-loss is submitted with this order -- the short call is managed separately (its own GTC target), and the long LEAPS leg has no mechanical exit.</p>
        </div>

        <div className={`${th.card} border ${th.border} rounded-xl p-4 mb-4 space-y-2`}>
          <div className="flex justify-between text-xs">
            <span className={th.textFaint}>Strategy</span>
            <span className="font-bold text-cyan-400">PMCC</span>
          </div>
          <div className="flex justify-between text-xs">
            <span className={th.textFaint}>Buy (long)</span>
            <span className={th.text}>{pair.longLeg.strike}C · {pair.longLeg.expiration} ({pair.longLeg.dte}d) · Δ{pair.longLeg.delta.toFixed(2)}</span>
          </div>
          <div className="flex justify-between text-xs">
            <span className={th.textFaint}>Sell (short)</span>
            <span className={th.text}>{pair.shortLeg.strike}C · {pair.shortLeg.expiration} ({pair.shortLeg.dte}d) · Δ{pair.shortLeg.delta.toFixed(2)}</span>
          </div>
          <div className="flex justify-between text-xs items-center">
            <span className={th.textFaint}>Entry limit / contract (net debit)</span>
            <div className="flex items-center gap-1">
              <button onClick={() => setEntryLimit(v => parseFloat(Math.max(0.01, v - 0.05).toFixed(2)))} className={`w-5 h-5 rounded border ${th.border} ${th.textMuted} text-xs ac-hover-border`}>−</button>
              <span className="text-cyan-400 font-bold text-xs w-12 text-center">${entryLimit.toFixed(2)}</span>
              <button onClick={() => setEntryLimit(v => parseFloat((v + 0.05).toFixed(2)))} className={`w-5 h-5 rounded border ${th.border} ${th.textMuted} text-xs ac-hover-border`}>+</button>
            </div>
          </div>
          <div className="flex justify-between text-xs">
            <span className={th.textFaint}>Order type</span>
            <span className={th.text}>Limit · GTC · Debit</span>
          </div>
        </div>

        <div className="flex items-center gap-3 mb-4">
          <span className={`text-xs ${th.textFaint}`}>Contracts</span>
          <div className="flex items-center gap-2">
            <button onClick={() => setQuantity(q => Math.max(1, q - 1))} className={`w-7 h-7 rounded border ${th.border} ${th.textMuted} ac-hover-border text-sm`}>−</button>
            <span className={`text-sm font-bold ${th.text} w-6 text-center`}>{quantity}</span>
            <button onClick={() => setQuantity(q => Math.min(20, q + 1))} className={`w-7 h-7 rounded border ${th.border} ${th.textMuted} ac-hover-border text-sm`}>+</button>
          </div>
          <div className="ml-auto text-right">
            <p className="text-cyan-400 font-bold text-sm">${debit.toFixed(2)} debit</p>
          </div>
        </div>

        {dryRunResult && (
          <div className="p-3 bg-emerald-500/10 border border-emerald-600 rounded-lg mb-4 space-y-1">
            <p className="text-[10px] text-emerald-400 font-bold tracking-wider">DRY RUN PASSED</p>
            {bpChange && <p className="text-xs text-emerald-300">Buying power: {bpEffect2 === 'Debit' ? '−' : '+'}${parseFloat(bpChange).toFixed(2)}</p>}
            {marginReq && <p className="text-xs text-emerald-300">Margin required: ${parseFloat(marginReq).toFixed(2)}</p>}
          </div>
        )}

        {phase === 'done' && (
          <div className="p-3 bg-emerald-500/10 border border-emerald-600 rounded-lg mb-4 space-y-1">
            <p className="text-xs text-emerald-400 font-bold">✓ PMCC entry submitted — ID {orderId}</p>
            <p className="text-[10px] text-emerald-400/70">No profit-target or stop-loss was attached. Manage the short call and long LEAPS separately.</p>
            <p className="text-[10px] text-emerald-400/70">Verify the order in TastyTrade.</p>
          </div>
        )}

        {phase === 'error' && error && (
          <div className="p-3 bg-red-500/10 border border-red-600 rounded-lg mb-4">
            <p className="text-xs text-red-400">{error}</p>
          </div>
        )}

        {phase !== 'done' && (
          <div className="flex gap-2">
            {!dryRunResult ? (
              <button onClick={runDryRun} disabled={!hasOccSymbols || phase === 'dryrun'}
                className="flex-1 py-2.5 border ac-btn rounded-xl text-xs font-bold tracking-widest hover:ac-bg-10 transition-colors disabled:opacity-40">
                {phase === 'dryrun' ? 'VALIDATING...' : 'VALIDATE ORDER'}
              </button>
            ) : (
              <>
                <button onClick={runDryRun} disabled={phase === 'dryrun'}
                  className={`py-2.5 px-3 border ${th.border} ${th.textFaint} rounded-xl text-xs ac-hover-border transition-colors disabled:opacity-40`}>
                  ↺
                </button>
                <button onClick={placeOrder} disabled={phase === 'placing'}
                  className="flex-1 py-2.5 bg-cyan-600 hover:bg-cyan-500 text-white rounded-xl text-xs font-bold tracking-widest transition-colors disabled:opacity-40">
                  {phase === 'placing' ? 'PLACING...' : 'PLACE PMCC ENTRY'}
                </button>
              </>
            )}
          </div>
        )}

        {phase === 'done' && (
          <button onClick={onClose} className={`w-full py-2.5 border ${th.border} ${th.textMuted} rounded-xl text-xs font-bold tracking-widest`}>
            CLOSE
          </button>
        )}
      </div>
    </div>
  );
}


// ── Stock Research Component ──────────────────────────────────────────────
interface ChatContentPart {
  type: 'text' | 'image';
  text?: string;
  source?: { type: 'base64'; media_type: string; data: string };
}
interface ChatMessage { role: 'user' | 'assistant'; content: string | ChatContentPart[]; }
interface AttachedImage { dataUrl: string; mediaType: string; data: string; name: string }

function readImageFileAsBase64(file: File): Promise<{ mediaType: string; data: string }> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      const commaIdx = result.indexOf(',');
      const data = result.slice(commaIdx + 1);
      const mediaType = result.slice(5, result.indexOf(';')) || file.type || 'image/png';
      resolve({ mediaType, data });
    };
    reader.onerror = () => reject(new Error('Failed to read image'));
    reader.readAsDataURL(file);
  });
}

async function fetchStockResearch(symbol: string, tradeContext: string, riskContext?: string): Promise<string> {
  let headlines = '';
  try {
    const newsRes = await fetch(
      `https://query1.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(symbol)}&newsCount=8&quotesCount=0`,
      { cache: 'no-store' }
    );
    const newsData = await newsRes.json();
    headlines = (newsData?.news ?? []).slice(0, 6).map((a: any) => `- ${a.title}`).join('\n');
  } catch { headlines = 'News unavailable'; }

  const prompt = `You are a professional options trader analyzing ${symbol}.

Trade setup: ${tradeContext}
Recent news:
${headlines}
${riskContext ? `\nPortfolio risk context: ${riskContext}` : ''}

Give a specific 4-sentence analysis:
1. What is driving price action right now
2. Near-term risks (earnings, macro, sector headwinds) that affect THIS specific trade setup
3. Whether the technical setup (strikes, DTE, strategy) makes sense given current conditions
4. Your overall assessment: take the trade, wait, or avoid — and why

Be direct. Reference the specific strikes and strategy. No disclaimers.`;

  const res = await fetch('/api/analyze', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'gpt-4o',
      max_tokens: 500,
      system: 'You are a concise, direct options trading analyst. Reference specific trade details. No hedging. No disclaimers.',
      messages: [{ role: 'user', content: prompt }],
    }),
  });
  if (!res.ok) throw new Error(`Research failed (${res.status})`);
  const data = await res.json();
  return data?.content?.find((b: any) => b.type === 'text')?.text ?? '';
}

async function sendChatMessage(messages: ChatMessage[], symbol: string, tradeContext: string): Promise<string> {
  const res = await fetch('/api/analyze', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'gpt-4o',
      max_tokens: 500,
      system: `You are a professional options trading analyst. The trader is analyzing ${symbol}. Trade context: ${tradeContext}. Be direct, specific, and reference the actual trade setup in your answers.`,
      messages: messages.map(m => ({ role: m.role, content: m.content })),
    }),
  });
  if (!res.ok) throw new Error(`Chat failed (${res.status})`);
  const data = await res.json();
  return data?.content?.find((b: any) => b.type === 'text')?.text ?? '';
}

// Shared state for the AI Research feature. ResultCard owns one of these per
// card so the inline button (Col 1, header row) and the full-width panel
// (bottom of card, below the Open Position banner) can stay in sync without
// the panel needing to live next to the button in the layout.
function useStockResearch(symbol: string, tradeContext: string | undefined, riskContext: string | undefined) {
  const [open, setOpen]           = useState(false);
  const [loading, setLoading]     = useState(false);
  const [initialResult, setInitialResult] = useState<string | null>(null);
  const [messages, setMessages]   = useState<ChatMessage[]>([]);
  const [input, setInput]         = useState('');
  const [chatLoading, setChatLoading] = useState(false);
  const [error, setError]         = useState('');
  const [attachedImage, setAttachedImage] = useState<AttachedImage | null>(null);
  const [imageError, setImageError] = useState('');
  const chatBottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const context = tradeContext ?? `${symbol} options analysis`;

  const handleImageFile = async (file: File) => {
    setImageError('');
    if (!file.type.startsWith('image/')) { setImageError('Only image files are supported'); return; }
    if (file.size > 8 * 1024 * 1024) { setImageError('Image must be under 8MB'); return; }
    try {
      const { mediaType, data } = await readImageFileAsBase64(file);
      setAttachedImage({ dataUrl: `data:${mediaType};base64,${data}`, mediaType, data, name: file.name });
    } catch {
      setImageError('Failed to read image');
    }
  };

  const handlePaste = (e: React.ClipboardEvent) => {
    const item = Array.from(e.clipboardData?.items ?? []).find(i => i.type.startsWith('image/'));
    if (item) {
      const file = item.getAsFile();
      if (file) { e.preventDefault(); handleImageFile(file); }
    }
  };

  const clearImage = () => { setAttachedImage(null); setImageError(''); };

  const handleToggle = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (open) { setOpen(false); return; }
    setOpen(true);
    if (initialResult) return;
    setLoading(true); setError('');
    try {
      const text = await fetchStockResearch(symbol, context, riskContext);
      setInitialResult(text);
      setMessages([{ role: 'assistant', content: text }]);
    } catch (err: any) {
      setError(err.message ?? 'Research failed');
    } finally {
      setLoading(false);
    }
  };

  const handleSend = async () => {
    const q = input.trim();
    if ((!q && !attachedImage) || chatLoading) return;
    const content: ChatMessage['content'] = attachedImage
      ? [
          ...(q ? [{ type: 'text' as const, text: q }] : []),
          { type: 'image' as const, source: { type: 'base64' as const, media_type: attachedImage.mediaType, data: attachedImage.data } },
        ]
      : q;
    const newMessages: ChatMessage[] = [...messages, { role: 'user', content }];
    setMessages(newMessages);
    setInput('');
    clearImage();
    setChatLoading(true);
    try {
      const reply = await sendChatMessage(newMessages, symbol, context);
      setMessages(prev => [...prev, { role: 'assistant', content: reply }]);
    } catch (err: any) {
      setMessages(prev => [...prev, { role: 'assistant', content: `Error: ${err.message}` }]);
    } finally {
      setChatLoading(false);
      setTimeout(() => chatBottomRef.current?.scrollIntoView({ behavior: 'smooth' }), 100);
    }
  };

  return {
    open, loading, error, messages, input, setInput, chatLoading,
    chatBottomRef, inputRef, handleToggle, handleSend,
    attachedImage, imageError, handleImageFile, handlePaste, clearImage,
  };
}

// Small inline trigger — lives in Col 1 of the ResultCard header row.
function StockResearchButton({ research, th }: {
  research: ReturnType<typeof useStockResearch>; th: typeof THEMES[Theme];
}) {
  return (
    <button onClick={research.handleToggle}
      className={`inline-flex items-center gap-1 text-[9px] px-2 py-0.5 border rounded transition-colors ${
        research.open ? 'border-indigo-500 text-indigo-400 bg-indigo-500/10'
             : `${th.border} ${th.textFaint} hover:border-indigo-500 hover:text-indigo-400`
      }`}>
      <span className="text-[8px]">◎</span> Research
    </button>
  );
}

// Full-width chat panel — rendered at the very bottom of the card, below the
// Open Position banner, so it never overlaps the strikes/credit/POP columns
// in the header row above it.
function StockResearchPanel({ symbol, th, research }: {
  symbol: string; th: typeof THEMES[Theme]; research: ReturnType<typeof useStockResearch>;
}) {
  const imageInputRef = useRef<HTMLInputElement>(null);
  if (!research.open) return null;
  return (
    <div onClick={e => e.stopPropagation()}
         className={`w-full border-t border-indigo-500/30 bg-indigo-500/5 overflow-hidden`}>
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2 border-b border-indigo-500/20">
        <p className="text-[9px] text-indigo-400 font-bold uppercase tracking-widest">◎ {symbol} — AI Research</p>
        <button onClick={(e) => { e.stopPropagation(); research.handleToggle(e); }} className={`text-[10px] ${th.textFaint} hover:text-red-400`}>✕</button>
      </div>
      {/* Chat area */}
      <div className="px-4 py-2 space-y-3 max-h-64 overflow-y-auto">
        {research.loading && (
          <div className="flex items-center gap-2 py-2">
            <div className="w-3 h-3 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin shrink-0" />
            <span className={`text-[10px] ${th.textFaint}`}>Analyzing {symbol} trade setup...</span>
          </div>
        )}
        {research.error && <p className="text-red-400 text-[10px]">{research.error}</p>}
        {research.messages.map((m, i) => {
          const parts: ChatContentPart[] = Array.isArray(m.content)
            ? m.content
            : [{ type: 'text', text: m.content }];
          return (
            <div key={i} className={`flex gap-2 ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
              {m.role === 'assistant' && (
                <span className="text-[8px] text-indigo-400 mt-1 shrink-0">◎</span>
              )}
              <div className={`text-[11px] leading-relaxed rounded-lg px-2.5 py-1.5 max-w-[80%] ${
                m.role === 'user'
                  ? 'bg-indigo-500/15 text-indigo-200 border border-indigo-500/30'
                  : `${th.card} ${th.textMuted} border ${th.borderLight}`
              }`}>
                {parts.map((p, pi) => p.type === 'image' && p.source ? (
                  <img key={pi} src={`data:${p.source.media_type};base64,${p.source.data}`}
                       alt="attached chart" className="max-w-[180px] max-h-[180px] rounded-md border border-indigo-500/30 mb-1" />
                ) : (
                  <span key={pi} className="whitespace-pre-wrap">{p.text}</span>
                ))}
              </div>
            </div>
          );
        })}
        {research.chatLoading && (
          <div className="flex gap-2">
            <span className="text-[8px] text-indigo-400 mt-1">◎</span>
            <div className={`text-[11px] ${th.card} border ${th.borderLight} rounded-lg px-2.5 py-1.5`}>
              <div className="flex gap-1">
                <span className="w-1 h-1 bg-indigo-400 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                <span className="w-1 h-1 bg-indigo-400 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                <span className="w-1 h-1 bg-indigo-400 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
              </div>
            </div>
          </div>
        )}
        <div ref={research.chatBottomRef} />
      </div>
      {/* Input */}
      <div className={`px-4 py-2 border-t border-indigo-500/20`}>
        {research.attachedImage && (
          <div className="flex items-center gap-2 mb-2">
            <img src={research.attachedImage.dataUrl} alt="attachment preview"
                 className="w-10 h-10 object-cover rounded border border-indigo-500/40" />
            <span className={`text-[9px] ${th.textFaint} truncate max-w-[140px]`}>{research.attachedImage.name}</span>
            <button onClick={research.clearImage} className="text-[10px] text-red-400 hover:text-red-300">Remove</button>
          </div>
        )}
        {research.imageError && <p className="text-red-400 text-[9px] mb-1">{research.imageError}</p>}
        <div className="flex gap-2">
          <input
            type="file"
            accept="image/*"
            ref={imageInputRef}
            className="hidden"
            onChange={e => {
              const file = e.target.files?.[0];
              if (file) research.handleImageFile(file);
              e.target.value = '';
            }}
          />
          <button
            onClick={() => imageInputRef.current?.click()}
            title="Attach a chart image"
            className={`text-[12px] px-2 py-1.5 border ${th.border} ${th.textFaint} rounded-lg hover:border-indigo-500 hover:text-indigo-400 transition-colors shrink-0`}>
            📎
          </button>
          <input
            ref={research.inputRef}
            value={research.input}
            onChange={e => research.setInput(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); research.handleSend(); } }}
            onPaste={research.handlePaste}
            placeholder="Ask about this trade... (attach or paste a chart)"
            className={`flex-1 text-[11px] ${th.input} border ${th.inputBorder} rounded-lg px-2.5 py-1.5 ${th.text} focus:outline-none focus:border-indigo-500 placeholder-slate-500`}
          />
          <button onClick={research.handleSend}
            disabled={(!research.input.trim() && !research.attachedImage) || research.chatLoading || research.loading}
            className="text-[10px] px-3 py-1.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg font-medium transition-colors disabled:opacity-40 shrink-0">
            Send
          </button>
        </div>
      </div>
    </div>
  );
}

type ResultCardProps = {
  result: ScreenResult;
  th: typeof THEMES[Theme];
  rules: RulesType;
  screenMode?: 'filter' | 'rank' | 'targeted';
  rankConfig?: RankConfig;
  onTrade?: (result: ScreenResult) => void;
  cachedEntry?: RawScanEntry;
  existingPositions?: ExistingPosition[];
};

// PMCC-CARD-0001 item 4 — reuses the exact chart/sparkline/TradingView
// pattern already shipped in GenericResultCard below, so PMCC tickers get
// the same chart link "the same way we do it on other pages" (Dean's
// framing). No new data source: same /api/chart endpoint, same sparkline
// rendering, same TradingView deep link.
function ChartLinkButton({ symbol, th, showChart, setShowChart, sparkData, setSparkData, sparkLoading, setSparkLoading }: {
  symbol: string;
  th: typeof THEMES[Theme];
  showChart: boolean;
  setShowChart: (value: boolean) => void;
  sparkData: number[] | null;
  setSparkData: (value: number[] | null) => void;
  sparkLoading: boolean;
  setSparkLoading: (value: boolean) => void;
}) {
  return (
    <div className="relative">
      <button
        onClick={e => {
          e.stopPropagation();
          if (!showChart) {
            setShowChart(true);
            if (!sparkData) {
              setSparkLoading(true);
              fetch(`/api/chart?symbol=${encodeURIComponent(symbol)}`)
                .then(r => r.json())
                .then(d => {
                  const allBars = (d?.bars ?? []).map((b: any) => b?.c).filter((v: any) => v != null);
                  setSparkData(allBars.slice(-90));
                })
                .catch(() => setSparkData([]))
                .finally(() => setSparkLoading(false));
            }
          } else {
            setShowChart(false);
          }
        }}
        className={`inline-flex items-center gap-0.5 text-[9px] transition-colors ${showChart ? 'text-blue-400' : 'text-slate-500 ac-hover-text'}`}
        title="Quick chart"
      >
        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/>
        </svg>
        <span className="tracking-wide">chart</span>
      </button>

      {showChart && (
        <div
          className={`absolute top-full left-0 mt-1 z-40 ${th.sidebar} border ${th.border} rounded-xl shadow-2xl p-3`}
          style={{ width: '280px' }}
          onClick={e => e.stopPropagation()}
        >
          <div className="mb-2">
            {sparkLoading && (
              <div className="flex items-center justify-center h-16">
                <div className="w-4 h-4 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
              </div>
            )}
            {!sparkLoading && sparkData && sparkData.length > 1 && (() => {
              const min = Math.min(...sparkData);
              const max = Math.max(...sparkData);
              const range = max - min || 1;
              const w = 256, h = 56;
              const pts = sparkData.map((v, i) => {
                const x = (i / (sparkData.length - 1)) * w;
                const y = h - ((v - min) / range) * h;
                return `${x.toFixed(1)},${y.toFixed(1)}`;
              }).join(' ');
              const isUp = sparkData[sparkData.length - 1] >= sparkData[0];
              const color = isUp ? '#10b981' : '#ef4444';
              const lastPrice = sparkData[sparkData.length - 1];
              const firstPrice = sparkData[0];
              const changePct = ((lastPrice - firstPrice) / firstPrice * 100).toFixed(1);
              return (
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <span className={`text-[10px] font-bold ${th.text}`} style={{ fontFamily: "'DM Mono', monospace" }}>{symbol}</span>
                    <span className={`text-[10px] font-bold`} style={{ color }}>
                      ${lastPrice.toFixed(2)} <span className="text-[9px]">{isUp ? '+' : ''}{changePct}% 30d</span>
                    </span>
                  </div>
                  <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} style={{ width: '100%', height: '56px' }}>
                    <defs>
                      <linearGradient id={`grad-pmcc-${symbol}`} x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor={color} stopOpacity="0.3" />
                        <stop offset="100%" stopColor={color} stopOpacity="0" />
                      </linearGradient>
                    </defs>
                    <polyline points={pts} fill="none" stroke={color} strokeWidth="1.5" strokeLinejoin="round" />
                    <polygon points={`0,${h} ${pts} ${w},${h}`} fill={`url(#grad-pmcc-${symbol})`} />
                  </svg>
                </div>
              );
            })()}
            {!sparkLoading && sparkData && sparkData.length === 0 && (
              <p className={`text-[9px] ${th.textFaint} text-center py-3`}>Chart data unavailable</p>
            )}
          </div>

          <a
            href={`https://www.tradingview.com/chart/?symbol=${symbol}`}
            target="_blank"
            rel="noopener noreferrer"
            onClick={e => e.stopPropagation()}
            className="flex items-center justify-center gap-2 w-full py-2 ac-bg-20 ac-hover-bg/30 border ac-border/40 rounded-lg text-[10px] text-blue-400 font-bold tracking-wider transition-colors"
          >
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
              <polyline points="15 3 21 3 21 9" /><line x1="10" y1="14" x2="21" y2="3" />
            </svg>
            Open in TradingView
          </a>
        </div>
      )}
    </div>
  );
}

function PmccResultCard({ result, th, onTrade }: ResultCardProps) {
  const [expanded, setExpanded] = useState(false);
  const [showPairLookup, setShowPairLookup] = useState(false);
  const [showQuoteDetail, setShowQuoteDetail] = useState(false);
  const [showAuditDetail, setShowAuditDetail] = useState(false);
  const [showChart, setShowChart] = useState(false);
  const [sparkData, setSparkData] = useState<number[] | null>(null);
  const [sparkLoading, setSparkLoading] = useState(false);
  const pair = result.pmccPair;
  const metrics = pair?.metrics;
  // PMCC-CARD-0001 — Ian/Paul-signed-off three-state readiness, replacing the
  // old binary ready/not-ready text. Disqualified (failed real criteria) is
  // visually distinct from not-ready (market/data gate): the former won't
  // clear without different strikes, the latter clears on its own once the
  // regular market session opens. No new logic -- disqualified derives from
  // pair.qualified/failureReasons, which already exist; not-ready derives
  // from the same readyInput fields the old `ready` boolean already used.
  const disqualified = Boolean(pair && (!pair.qualified || pair.failureReasons.length > 0));
  const dataNotReady = Boolean(pair && (!pair.longLeg.quote.readyInput || !pair.shortLeg.quote.readyInput));
  const readinessState: 'ready' | 'not_ready' | 'disqualified' = !pair
    ? 'disqualified'
    : disqualified
      ? 'disqualified'
      : dataNotReady
        ? 'not_ready'
        : 'ready';
  const ready = readinessState === 'ready';
  const READINESS_META: Record<typeof readinessState, { label: string; dot: string; text: string; border: string; bg: string }> = {
    ready:        { label: 'Ready',        dot: 'bg-emerald-400', text: 'text-emerald-400', border: 'border-emerald-700/70', bg: 'bg-emerald-500/5' },
    not_ready:    { label: 'Not ready',    dot: 'bg-amber-400',   text: 'text-amber-400',   border: 'border-amber-700/70',   bg: 'bg-amber-500/5' },
    disqualified: { label: 'Disqualified', dot: 'bg-red-500',     text: 'text-red-400',     border: 'border-red-700/70',     bg: 'bg-red-500/5' },
  };
  const readiness = READINESS_META[readinessState];
  const money = (value: number | null | undefined) => value == null ? '—' : `$${value.toFixed(2)}`;
  const quoteLine = (leg: NonNullable<typeof pair>['longLeg']) =>
    `Bid ${money(leg.quote.bid)} · Ask ${money(leg.quote.ask)} · Mid ${money(leg.quote.midpoint)} · Width ${money(leg.quote.width)} (${leg.quote.spreadPct?.toFixed(1) ?? '—'}%)`;
  const age = (leg: NonNullable<typeof pair>['longLeg']) => leg.quote.ageSeconds == null ? 'unknown age' : `${Math.round(leg.quote.ageSeconds)}s old`;
  const counts = result.pmccPairingCounts;
  // TE-0007E — Diane/Ian/Paul/Alan-reviewed PMCC card fields (breakeven,
  // promoted extrinsic, roll runway, annualized ROI). All four derive
  // from real, already-computed PmccPairMetrics/PmccEligibleLeg fields --
  // no new data sourcing. Roll runway and the ROI annualization both use
  // THIS pair's own shortLeg.dte as the cycle length (confirmed with the
  // team: self-consistent with what's already shown on the card, not a
  // separate assumed constant like the criteria's 21-45 DTE target
  // range, which would quietly diverge from the number on screen).
  const breakeven = metrics ? pair!.longLeg.strike + metrics.netDebitPerShare : null;
  // Ian's sanity check: a qualified pair should never have its breakeven
  // above the short strike -- that would mean max profit is already
  // structurally unreachable. Real validation, not just a display value.
  const breakevenAboveShortStrike = breakeven != null && pair && breakeven > pair.shortLeg.strike;
  const rollRunway = pair && pair.shortLeg.dte > 0
    ? Math.floor((pair.longLeg.dte - pair.shortLeg.dte) / pair.shortLeg.dte)
    : null;
  const annualizedRoi = pmccAnnualizedRoi(result);
  // TE-0007G — Ian/Paul-reviewed. Real, traced math, not invented:
  // rollRunway (above) counts ADDITIONAL rolls after the current one,
  // so total times a credit gets collected is rollRunway + 1.
  // "Total premium if every roll matches today's credit" carries the
  // exact same "assumes level rolls" honesty requirement already
  // applied to annualizedRoi -- premium generally shrinks as DTE/IV
  // change, this is an explicit, stated assumption, never a promise.
  const totalPremium = pair && rollRunway != null
    ? pair.shortLeg.executablePrice * (rollRunway + 1)
    : null;
  // "Profit if closed today at current price" -- deliberately NOT
  // "profit at breakeven": traced the math first and found that
  // reduces to exactly totalPremium by construction (breakeven is
  // defined as the price where the long call's intrinsic value
  // exactly equals what was paid for it, so the long leg always washes
  // out at that specific price, regardless of rolls) -- shipping both
  // would show two labels for one number. Current price is real,
  // live, genuinely different data, not a structural constant.
  // Intrinsic value only (ignores any remaining extrinsic value on
  // the long leg at close) -- a real, stated simplification, not a
  // promise about the actual closing price.
  const longIntrinsicAtCurrentPrice = pair && result.price != null
    ? Math.max(result.price - pair.longLeg.strike, 0)
    : null;
  const profitAtCurrentPrice = totalPremium != null && longIntrinsicAtCurrentPrice != null && pair
    ? totalPremium + longIntrinsicAtCurrentPrice - pair.longLeg.executablePrice
    : null;
  if (!pair) {
    return <article className={`rounded-xl border ${th.border} p-4`} data-testid="pmcc-audit-card">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-bold">{result.symbol}</span>
        <span className={th.textMuted}>{money(result.price)}</span>
        <ChartLinkButton symbol={result.symbol} th={th} showChart={showChart} setShowChart={setShowChart} sparkData={sparkData} setSparkData={setSparkData} sparkLoading={sparkLoading} setSparkLoading={setSparkLoading} />
        <span className="rounded border border-cyan-500 px-2 py-0.5 text-[9px] text-cyan-300">PMCC</span>
        <span className="text-red-400 text-xs">Audit result · Disqualified</span>
      </div>
      <p className={`mt-2 text-xs ${th.textMuted}`}>{result.failReasons.join(' · ')}</p>
      <p className={`mt-2 text-[10px] ${th.textFaint}`}>Scan timestamp: {result.pmccAsOf ?? '—'} · Earnings: {result.earningsDate ?? 'not available'} · Readiness: no executable pair</p>
      {counts && <p className={`mt-2 text-[10px] ${th.textFaint}`}>Eligible long/short: {counts.eligibleLongLegs}/{counts.eligibleShortLegs} · evaluated {counts.combinationsEvaluated}/{counts.potentialCombinations} combinations · safety omitted {counts.combinationsOmittedBySafetyLimit} · retention omitted {counts.qualifiedPairsOmittedByRetention + counts.nearMissPairsOmittedByRetention}</p>}
      {result.pmccIncompleteAnalysis && <p className="mt-2 text-xs font-bold text-amber-400">Incomplete analysis: some combinations were not evaluated.</p>}
      {(result.pmccLegRejections?.length ?? 0) > 0 && <details className="mt-2 text-xs"><summary>Leg rejection reasons ({result.pmccLegRejections!.length})</summary><ul className="mt-1 list-disc pl-5">{result.pmccLegRejections!.flatMap((leg, index) => leg.reasons.map((reason, reasonIndex) => <li key={`${index}-${reasonIndex}`}>{leg.role} {leg.expiration} {leg.strike}: {reason.message}</li>))}</ul></details>}
      <p className="mt-2 rounded border border-red-700 px-3 py-2 text-xs text-red-300">Disqualified — Open/Trade is blocked. No executable pair met criteria.</p>
    </article>;
  }
  // PMCC-CARD-0001 — decision-tier fields Ian/Paul signed off on: width
  // minus debit, annualized ROI, breakeven, roll runway, net delta. All
  // five already existed as computed values above; this is a JSX
  // reorganization only, no new calculations. Net debit, strike width,
  // total premium, and profit-at-current-price move into the "quote and
  // pricing detail" disclosure below -- they're supporting math, not
  // primary decision inputs.
  const decisionStrip = metrics ? [
    { label: 'Width minus debit', value: `${money(metrics.widthMinusDebitPerShare)} · ${metrics.widthMinusDebitPctOfDebit.toFixed(1)}%` },
    { label: 'Annualized ROI', value: annualizedRoi == null ? '—' : `${annualizedRoi.toFixed(1)}%` },
    { label: 'Breakeven', value: `${money(breakeven)}${breakevenAboveShortStrike ? ' ⚠' : ''}`, warn: breakevenAboveShortStrike },
    { label: 'Roll runway', value: rollRunway == null ? '—' : `~${rollRunway} roll${rollRunway === 1 ? '' : 's'}` },
    { label: 'Net delta', value: metrics.netDelta.toFixed(2), warn: disqualified },
  ] : [];
  return <article className={`rounded-xl border ${readiness.border} overflow-hidden`} data-testid="pmcc-result-card">
    <button className="w-full p-4 text-left" onClick={() => setExpanded(value => !value)} aria-label={`${expanded ? 'Collapse' : 'Expand'} ${result.symbol} PMCC details`}>
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-lg font-bold">{result.symbol}</span><span className={th.textMuted}>{money(result.price)}</span>
        <ChartLinkButton symbol={result.symbol} th={th} showChart={showChart} setShowChart={setShowChart} sparkData={sparkData} setSparkData={setSparkData} sparkLoading={sparkLoading} setSparkLoading={setSparkLoading} />
        <span className="rounded border border-cyan-500 px-2 py-0.5 text-[9px] font-bold text-cyan-300">PMCC</span>
        <span className={`text-[10px] ${th.textFaint}`}>Contract order {result.publishedOrder ?? 1}</span>
        <span className={`ml-auto flex items-center gap-1.5 text-[10px] font-bold ${readiness.text}`}>
          <span className={`inline-block w-2 h-2 rounded-full ${readiness.dot}`} />
          {readiness.label} {expanded ? '▴' : '▾'}
        </span>
      </div>
      <div className="mt-3 grid gap-3 md:grid-cols-2">
        <div className="rounded-lg bg-emerald-500/5 p-3"><b className="text-emerald-400">BUY</b> {pair.longLeg.strike}C · {pair.longLeg.expiration} · {pair.longLeg.dte} DTE · Δ{pair.longLeg.delta.toFixed(2)}<br/><span className="text-xs">Executable cost (ask) {money(pair.longLeg.executablePrice)} · OI {pair.longLeg.openInterest}</span>{metrics && <><br/><span className="text-xs text-neutral-400">Extrinsic {money(metrics.longExtrinsicPerShare)}</span></>}</div>
        <div className="rounded-lg bg-amber-500/5 p-3"><b className="text-amber-400">SELL</b> {pair.shortLeg.strike}C · {pair.shortLeg.expiration} · {pair.shortLeg.dte} DTE · Δ{pair.shortLeg.delta.toFixed(2)}<br/><span className="text-xs">Executable credit (bid) {money(pair.shortLeg.executablePrice)} · OI {pair.shortLeg.openInterest}</span></div>
      </div>
      {decisionStrip.length > 0 && <div className="mt-3 grid grid-cols-2 gap-2 text-xs md:grid-cols-5">
        {decisionStrip.map(field => (
          <span key={field.label} className={field.warn ? 'text-amber-400' : ''}>
            <span className={th.textFaint}>{field.label}</span><br/>{field.value}
          </span>
        ))}
      </div>}
      {result.earningsDate && <p className="mt-2 text-[10px] text-amber-300">Earnings: {result.earningsDate}</p>}
    </button>
    {expanded && <div className={`border-t ${th.border} p-4 text-xs space-y-3`}>
      <p className={`rounded border ${readiness.border} ${readiness.text} px-3 py-2`}>
        {readinessState === 'ready' ? 'Analysis ready.' : readinessState === 'disqualified' ? 'Disqualified — Open/Trade is blocked.' : 'Not Ready — Open/Trade is blocked.'}
      </p>

      <button
        onClick={(e) => { e.stopPropagation(); setShowQuoteDetail(value => !value); }}
        className="w-full flex items-center justify-between py-1.5 text-left"
      >
        <span>Show quote and pricing detail</span><span>{showQuoteDetail ? '▴' : '▾'}</span>
      </button>
      {showQuoteDetail && <div className={`border-t ${th.border} pt-3 space-y-3`}>
        <div><b>Long OCC:</b> {pair.longLeg.occSymbol}<br/>{quoteLine(pair.longLeg)}<br/>Quote {pair.longLeg.quote.quoteTimestamp ?? 'timestamp missing'} · {age(pair.longLeg)} · delayed {String(pair.longLeg.quote.delayed)} · readiness input {String(pair.longLeg.quote.readyInput)}</div>
        <div><b>Short OCC:</b> {pair.shortLeg.occSymbol}<br/>{quoteLine(pair.shortLeg)}<br/>Quote {pair.shortLeg.quote.quoteTimestamp ?? 'timestamp missing'} · {age(pair.shortLeg)} · delayed {String(pair.shortLeg.quote.delayed)} · readiness input {String(pair.shortLeg.quote.readyInput)}</div>
        {metrics && <div className="space-y-1">
          <p>Net debit {money(metrics.netDebitPerShare)}/share · {money(metrics.netDebitPerShare * 100)}/contract · Strike width {money(metrics.strikeWidth)}</p>
          <p>Natural price: long ask {money(pair.longLeg.quote.ask)} minus short bid {money(pair.shortLeg.quote.bid)} = {money(metrics.netDebitPerShare)}</p>
          <p>Long intrinsic {money(metrics.longIntrinsicPerShare)} · long extrinsic {money(metrics.longExtrinsicPerShare)}</p>
          <p>Short credit / net debit {metrics.shortCreditToNetDebitPct.toFixed(1)}% · short credit / long extrinsic {metrics.shortCreditToLongExtrinsicPct?.toFixed(1) ?? '—'}%</p>
          <p>Width minus debit: {money(metrics.strikeWidth)} − {money(metrics.netDebitPerShare)} = {money(metrics.widthMinusDebitPerShare)}. This is structure economics, not maximum profit.</p>
          <p>Net delta ideal range: {(DEFAULT_PMCC_LONG_DELTA_RANGE.min - DEFAULT_PMCC_SHORT_DELTA_RANGE.max).toFixed(2)}–{(DEFAULT_PMCC_LONG_DELTA_RANGE.max - DEFAULT_PMCC_SHORT_DELTA_RANGE.min).toFixed(2)}, default scan criteria.</p>
          <p>Total premium {totalPremium == null ? '—' : money(totalPremium)}, assumes level rolls. Profit {profitAtCurrentPrice == null ? '—' : money(profitAtCurrentPrice)} if closed today at current price.</p>
        </div>}
      </div>}

      <button
        onClick={(e) => { e.stopPropagation(); setShowAuditDetail(value => !value); }}
        className="w-full flex items-center justify-between py-1.5 text-left"
      >
        <span>Show qualification and audit detail</span><span>{showAuditDetail ? '▴' : '▾'}</span>
      </button>
      {showAuditDetail && <div className={`border-t ${th.border} pt-3 space-y-3`}>
        {(pair.failureReasons.length > 0 || result.failReasons.length > 0) && <div><b>Qualification and near-miss reasons:</b> {Array.from(new Set([...pair.failureReasons.map(reason => reason.message), ...result.failReasons])).join(' · ')}</div>}
        {counts && <div><b>Pairing/accounting:</b> {counts.eligibleLongLegs} eligible long · {counts.eligibleShortLegs} eligible short · {counts.combinationsEvaluated}/{counts.potentialCombinations} combinations evaluated · {counts.qualifiedPairsRetained} qualified retained · {counts.nearMissPairsRetained} near-miss retained · {counts.combinationsOmittedBySafetyLimit + counts.qualifiedPairsOmittedByRetention + counts.nearMissPairsOmittedByRetention} omitted</div>}
        {result.pmccIncompleteAnalysis && <p className="font-bold text-amber-400">Incomplete analysis: the safety limit prevented some combinations from being evaluated.</p>}
        {(result.pmccLegRejections?.length ?? 0) > 0 && <details><summary>Leg rejection reasons ({result.pmccLegRejections!.length})</summary><ul className="mt-1 list-disc pl-5">{result.pmccLegRejections!.flatMap((leg, index) => leg.reasons.map((reason, reasonIndex) => <li key={`${index}-${reasonIndex}`}>{leg.role} {leg.expiration} {leg.strike}: {reason.message}</li>))}</ul></details>}
        <p>Scan timestamp: {result.pmccAsOf ?? '—'} · Earnings: {result.earningsDate ?? 'not available'} · Trend/readiness: {result.trendResult?.trend ?? 'not available'}</p>
      </div>}

      {ready && (
        <button
          onClick={(e) => { e.stopPropagation(); onTrade?.(result); }}
          className="w-full py-2 rounded-lg border border-cyan-500 text-cyan-300 text-xs font-bold tracking-widest hover:bg-cyan-500/10 transition-colors"
        >
          ⚡ TRADE THIS
        </button>
      )}
      <button
        onClick={(e) => { e.stopPropagation(); setShowPairLookup(true); }}
        className="w-full py-1.5 rounded-lg border border-neutral-700 text-neutral-400 text-[10px] font-bold tracking-wider hover:border-neutral-500 transition-colors"
      >
        CHECK A SPECIFIC PAIR
      </button>
      {showPairLookup && (
        <PmccPairLookupModal
          th={th}
          symbol={result.symbol}
          onClose={() => setShowPairLookup(false)}
          onCheck={async ({ longStrike, longExpiration, shortStrike, shortExpiration }) => {
            const token = await getAccessToken();
            const longDte = daysUntil(longExpiration);
            const shortDte = daysUntil(shortExpiration);
            const rawChain = await getPMCCChain(result.symbol, token, {
              shortMin: 0, shortMax: shortDte + 5,
              longMin: 0, longMax: longDte + 5,
            });
            const adapted = adaptPmccChain(result.symbol, rawChain);
            const longChainLeg = adapted.longLegs.find(l => l.expiration === longExpiration && l.strike === longStrike) ?? null;
            const shortChainLeg = adapted.shortLegs.find(l => l.expiration === shortExpiration && l.strike === shortStrike) ?? null;
            const price = await getQuote(result.symbol, token);
            return evaluatePmccPairOnDemand({
              symbol: result.symbol,
              underlyingPrice: price ?? 0,
              longChainLeg, shortChainLeg,
              criteria: {
                dte: { shortMin: 0, shortMax: shortDte + 5, longMin: 0, longMax: longDte + 5 },
                longDelta: DEFAULT_PMCC_LONG_DELTA_RANGE,
                shortDelta: DEFAULT_PMCC_SHORT_DELTA_RANGE,
                longOiMin: DEFAULT_PMCC_LONG_OI_MIN,
                shortOiMin: DEFAULT_PMCC_SHORT_OI_MIN,
                requireDebitBelowWidth: true,
                quotePolicy: DEFAULT_PMCC_QUOTE_POLICY,
                limits: DEFAULT_PMCC_PAIRING_LIMITS,
              },
              asOf: new Date(),
              marketSession: derivePmccMarketSession(new Date()),
            });
          }}
        />
      )}
    </div>}
  </article>;
}

function ResultCard(props: ResultCardProps) {
  return props.result.strategy === 'PMCC' ? <PmccResultCard {...props} /> : <GenericResultCard {...props} />;
}

function GenericResultCard({ result, th, rules, screenMode, rankConfig, onTrade, cachedEntry, existingPositions }: ResultCardProps) {
  const [expanded, setExpanded] = useState(false);
  const [showBestFinder, setShowBestFinder] = useState(false);
  const [showChart, setShowChart] = useState(false);
  const [sparkData, setSparkData] = useState<number[] | null>(null);
  const [sparkLoading, setSparkLoading] = useState(false);
  const [portfolioRisk, setPortfolioRisk] = useState<PortfolioRisk | null>(null);

  const c = result.bestCandidate;
  const t = result.trendResult;
  const matchingPositions = (existingPositions ?? []).filter(p => p.symbol === result.symbol);

  // Plain factual sector note — only shown when there's something the "Open
  // Position" banner doesn't already cover (that banner handles same-symbol
  // detail; this covers broader same-sector exposure across other tickers).
  const SECTOR_LIMIT = 3;
  const showSectorNote = Boolean(
    portfolioRisk &&
    portfolioRisk.sectorName !== 'Index' &&
    portfolioRisk.sectorName !== 'Unknown' &&
    portfolioRisk.sectorCount >= SECTOR_LIMIT
  );

  // AI Research: state lives here so the Col-1 button and the full-width
  // panel at the bottom of the card can share it. See useStockResearch.
  const researchRiskContext = portfolioRisk && (portfolioRisk.sameSymbolCount > 0 || portfolioRisk.sectorCount >= SECTOR_LIMIT)
    ? [
        portfolioRisk.sameSymbolCount > 0 ? `Already holds ${portfolioRisk.sameSymbolCount} position(s) on this symbol.` : null,
        portfolioRisk.sectorCount >= SECTOR_LIMIT ? `${portfolioRisk.sectorCount} open positions in ${portfolioRisk.sectorName} sector.` : null,
      ].filter(Boolean).join(' ')
    : undefined;
  const researchTradeContext = result.bestCandidate
    ? `${result.strategy} ${result.bestCandidate.shortStrike}/${result.bestCandidate.longStrike}${result.strategy === 'IC' ? ` · ${result.bestCandidate.shortCallStrike}/${result.bestCandidate.longCallStrike}` : ''} exp ${result.bestCandidate.expiration} (${result.bestCandidate.dte}d) · credit $${(result.bestCandidate.totalCredit ?? result.bestCandidate.credit).toFixed(2)} · ROC ${result.bestCandidate.roc.toFixed(0)}% · POP ${result.bestCandidate.pop?.toFixed(0)}% · IVR ${result.ivr?.toFixed(1)}%`
    : `${result.strategy} on ${result.symbol}`;
  const research = useStockResearch(result.symbol, researchTradeContext, researchRiskContext);
  // Opening Research expands the card so the full-width panel at the bottom
  // is immediately visible; closing Research does not force a collapse.
  useEffect(() => {
    if (research.open) setExpanded(true);
  }, [research.open]);

  const otmPct = (() => {
    if (!c || result.price == null || result.price <= 0) return null;
    if (c.strategy === 'BPS' || c.strategy === 'CSP') return ((result.price - c.shortStrike) / result.price) * 100;
    if (c.strategy === 'BCS') return ((c.shortStrike - result.price) / result.price) * 100;
    if (c.strategy === 'IC' && c.shortCallStrike != null) {
      const putOtm = ((result.price - c.shortStrike) / result.price) * 100;
      const callOtm = ((c.shortCallStrike - result.price) / result.price) * 100;
      return Math.min(putOtm, callOtm);
    }
    return null;
  })();
  const deltaExposure = c
  ? Math.round(Math.abs(c.shortDelta) * 100)
  : null;

  useEffect(() => {
    if (!existingPositions || existingPositions.length === 0) return;
    // Build sector counts across all positions
    const sectorCounts: Record<string, number> = {};
    Promise.all(existingPositions.map(p => getSector(p.symbol))).then(sectors => {
      sectors.forEach(s => { if (s !== 'Index' && s !== 'Unknown') sectorCounts[s] = (sectorCounts[s] ?? 0) + 1; });
      getSector(result.symbol).then(sector => {
        // Don't count the current symbol's existing positions in the concentration check
        const adjCounts = { ...sectorCounts };
        const symSector = sector;
        existingPositions.filter(p => p.symbol === result.symbol).forEach(() => {
          if (adjCounts[symSector] > 0) adjCounts[symSector]--;
        });
        const risk = checkPortfolioRisk(result.symbol, result.bestCandidate, existingPositions, sector, adjCounts);
        setPortfolioRisk(risk);
      });
    });
  }, [existingPositions, result.symbol, result.bestCandidate]);

  // Ranking
  const scored = rankConfig ? scoreCandidate(result, rankConfig) : null;
  const light = scored ? trafficLight(scored.score, rankConfig!) : null;
  // Compute alternate strategy score for the + IC / + BPS badge
  // Compute visible strategy scores for this same symbol/expiration.
// This is diagnostic first: it lets us see whether BPS, BCS, and IC are being
// scored, rejected, or simply ranked lower.
const strategyScores = useMemo(() => {
  if (!rankConfig || !cachedEntry) return [];

  const strategies: ('BPS' | 'BCS' | 'IC')[] = ['BPS', 'BCS', 'IC'];
  const currentExp = result.bestCandidate?.expiration;

  return strategies.map(strategy => {
    try {
      const chainDataForExp = currentExp
        ? {
            ...cachedEntry.chainData,
            expirations: [currentExp],
            chains: {
              [currentExp]: cachedEntry.chainData.chains[currentExp] ?? [],
            },
          }
        : cachedEntry.chainData;

      const strategyResult =
        strategy === result.strategy
          ? result
          : runChecklist(
              cachedEntry.symbol,
              strategy,
              cachedEntry.metrics,
              chainDataForExp,
              cachedEntry.price,
              rules,
              cachedEntry.trendResult
            );

      const scoredStrategy = scoreCandidate(strategyResult, rankConfig);

      if (!scoredStrategy || !strategyResult.bestCandidate) {
        return {
          strategy,
          score: null as number | null,
          qualified: false,
          reason: 'No candidate',
          current: strategy === result.strategy,
        };
      }

      return {
        strategy,
        score: scoredStrategy.score,
        qualified: strategyResult.qualified,
        reason: strategyResult.failReasons?.[0] ?? '',
        current: strategy === result.strategy,
      };
    } catch {
      return {
        strategy,
        score: null as number | null,
        qualified: false,
        reason: 'Error',
        current: strategy === result.strategy,
      };
    }
  });
}, [cachedEntry, rankConfig, rules, result, result.strategy, result.bestCandidate?.expiration]);
  const isRankMode = screenMode === 'rank';
  const stratBadge = result.strategy === 'BPS'
    ? 'bg-emerald-500/15 border-emerald-500 text-emerald-500'
    : result.strategy === 'BCS'
    ? 'bg-red-500/15 border-red-500 text-red-500'
    : result.strategy === 'PMCC'
    ? 'bg-purple-500/15 border-purple-500 text-purple-400'
    : result.strategy === 'CSP'
    ? 'bg-amber-500/15 border-amber-500 text-amber-400'
    : result.strategy === 'CC'
    ? 'bg-cyan-500/15 border-cyan-500 text-cyan-400'
    : 'bg-blue-500/15 border-blue-500 text-blue-500';

  const isShortTerm = rules.DTE_MAX <= 29;
  const dteAlertThreshold = isShortTerm ? rules.DTE_MIN - 1 : DTE_ALERT_THRESHOLD;
  const dteCloseTarget = isShortTerm ? Math.floor(rules.DTE_MIN / 2) : 21;
  const isApproaching = c && c.dte <= dteAlertThreshold;
  const hasEarningsBlock = result.failReasons.some(f => f.includes('Earnings'))
      && result.earningsDate
      && daysUntil(result.earningsDate) >= 0;
  const hasPastEarnings = result.earningsDate && daysUntil(result.earningsDate) < 0;
  const rsi14 =
    result.trendResult?.metrics?.rsi14 ??
    cachedEntry?.trendResult?.metrics?.rsi14 ??
    (cachedEntry as any)?.metrics?.rsi14 ??
    null;

  const scoreBorderL = light
    ? light.emoji === '🟢' ? 'border-l-4 border-l-emerald-500'
    : light.emoji === '🟡' ? 'border-l-4 border-l-yellow-400'
    : light.emoji === '🟠' ? 'border-l-4 border-l-orange-400'
    : 'border-l-4 border-l-red-500'
    : strategyAccent(result.strategy);

  const cardBorder = isApproaching ? 'border-yellow-500/50' : !result.qualified ? 'border-orange-900/40' : th.border;
  const cardBg = result.qualified ? th.cardQualified : th.card;

  return (
    <div className={`border ${cardBorder} ${scoreBorderL} ${cardBg} rounded-lg cursor-pointer transition-all hover:shadow-md`}
         onClick={() => { setExpanded(!expanded); setShowChart(false); }}>

      {/* Header Row */}
      <div className="px-4 py-3 flex items-center gap-2">
        {/* Col 1: Symbol + price — fixed */}
        <div className="w-16 shrink-0">
          <p className={`font-bold ${th.text} text-sm`}>{result.symbol}</p>
          {result.price && <p className={`text-[10px] font-bold ${th.textMuted}`}>${result.price.toFixed(2)}</p>}
          {result.isEtf && (
            <p className="text-[8px] text-blue-400/70 tracking-wider leading-tight">
              {result.symbol === 'SPX' || result.symbol === 'XSP' || result.symbol === 'NDX' || result.symbol === 'RUT' ? 'index' : 'etf'}
            </p>
          )}
          <div className="relative mt-0.5">
            <button
              onClick={e => {
                e.stopPropagation();
                if (!showChart) {
                  setShowChart(true);
                  if (!sparkData) {
                    setSparkLoading(true);
                    fetch(`/api/chart?symbol=${encodeURIComponent(result.symbol)}`)
                      .then(r => r.json())
                      .then(d => {
                        const allBars = (d?.bars ?? []).map((b: any) => b?.c).filter((v: any) => v != null);
                        const closes = allBars.slice(-90);
                        setSparkData(closes);
                      })
                      .catch(() => setSparkData([]))
                      .finally(() => setSparkLoading(false));
                  }
                } else {
                  setShowChart(false);
                }
              }}
              className={`inline-flex items-center gap-0.5 text-[9px] transition-colors ${showChart ? 'text-blue-400' : 'text-slate-500 ac-hover-text'}`}
              title="Quick chart"
            >
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/>
              </svg>
              <span className="tracking-wide">chart</span>
            </button>

            {showChart && (
              <div
                className={`absolute top-full left-0 mt-1 z-40 ${th.sidebar} border ${th.border} rounded-xl shadow-2xl p-3`}
                style={{ width: '280px' }}
                onClick={e => e.stopPropagation()}
              >
                {/* Sparkline */}
                <div className="mb-2">
                  {sparkLoading && (
                    <div className="flex items-center justify-center h-16">
                      <div className="w-4 h-4 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
                    </div>
                  )}
                  {!sparkLoading && sparkData && sparkData.length > 1 && (() => {
                    const min = Math.min(...sparkData);
                    const max = Math.max(...sparkData);
                    const range = max - min || 1;
                    const w = 256, h = 56;
                    const pts = sparkData.map((v, i) => {
                      const x = (i / (sparkData.length - 1)) * w;
                      const y = h - ((v - min) / range) * h;
                      return `${x.toFixed(1)},${y.toFixed(1)}`;
                    }).join(' ');
                    const isUp = sparkData[sparkData.length - 1] >= sparkData[0];
                    const color = isUp ? '#10b981' : '#ef4444';
                    const lastPrice = sparkData[sparkData.length - 1];
                    const firstPrice = sparkData[0];
                    const changePct = ((lastPrice - firstPrice) / firstPrice * 100).toFixed(1);
                    return (
                      <div>
                        <div className="flex items-center justify-between mb-1">
                          <span className={`text-[10px] font-bold ${th.text}`} style={{ fontFamily: "'DM Mono', monospace" }}>{result.symbol}</span>
                          <span className={`text-[10px] font-bold`} style={{ color }}>
                            ${lastPrice.toFixed(2)} <span className="text-[9px]">{isUp ? '+' : ''}{changePct}% 30d</span>
                          </span>
                        </div>
                        <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} style={{ width: '100%', height: '56px' }}>
                          <defs>
                            <linearGradient id={`grad-${result.symbol}`} x1="0" y1="0" x2="0" y2="1">
                              <stop offset="0%" stopColor={color} stopOpacity="0.3" />
                              <stop offset="100%" stopColor={color} stopOpacity="0" />
                            </linearGradient>
                          </defs>
                          <polyline points={pts} fill="none" stroke={color} strokeWidth="1.5" strokeLinejoin="round" />
                          <polygon points={`0,${h} ${pts} ${w},${h}`} fill={`url(#grad-${result.symbol})`} />
                        </svg>
                      </div>
                    );
                  })()}
                  {!sparkLoading && sparkData && sparkData.length === 0 && (
                    <p className={`text-[9px] ${th.textFaint} text-center py-3`}>Chart data unavailable</p>
                  )}
                </div>

                {/* Open in TradingView button */}
                <a
                  href={`https://www.tradingview.com/chart/?symbol=${result.symbol}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={e => e.stopPropagation()}
                  className="flex items-center justify-center gap-2 w-full py-2 ac-bg-20 ac-hover-bg/30 border ac-border/40 rounded-lg text-[10px] text-blue-400 font-bold tracking-wider transition-colors"
                >
                  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
                    <polyline points="15 3 21 3 21 9" /><line x1="10" y1="14" x2="21" y2="3" />
                  </svg>
                  Open in TradingView
                </a>
              </div>
            )}
          </div>
          <StockResearchButton research={research} th={th} />
        </div>
        {/* Col 2: Badges — fixed width */}
        <div className="w-52 shrink-0 flex items-center gap-1 flex-wrap">
          {result.ruleSetApplied && (
            <span className={`text-[8px] px-1.5 py-0.5 border rounded shrink-0 font-medium tracking-wider
              ${result.ruleSetApplied.includes('ETF')
                ? 'border-blue-800 text-blue-400/80 bg-blue-500/5'
                : result.ruleSetApplied === 'Strict'
                ? 'border-red-900 text-red-400/70 bg-red-500/5'
                : result.ruleSetApplied === 'Course'
                ? 'border-slate-700 text-slate-400/70'
                : result.ruleSetApplied === 'Relaxed'
                ? 'border-emerald-900 text-emerald-400/70 bg-emerald-500/5'
                : result.ruleSetApplied === 'Low Vol'
                ? 'border-yellow-900 text-yellow-400/70 bg-yellow-500/5'
                : result.ruleSetApplied === 'Short Term'
                ? 'border-orange-900 text-orange-400/70 bg-orange-500/5'
                : result.ruleSetApplied === 'Intermediate'
                ? 'border-amber-900 text-amber-400/70 bg-amber-500/5'
                : 'border-slate-700 text-slate-500'
              }`}>
              {result.ruleSetApplied}
            </span>
          )}
          {isRankMode && scored && light && (
            <span className={`text-[9px] px-2 py-0.5 border rounded shrink-0 font-bold ${light.color} ${light.border} ${light.bg}`}>
              {light.emoji} {scored.score} — {light.label}
            </span>
          )}
          {strategyScores.length > 0 ? (() => {
            // SCREENER-UX-0001 corrective pass: this candidate's actual
            // structure (result.strategy, "current: true" below) must
            // always read as its own single primary badge -- never
            // indistinguishable from the other two strategies' scores,
            // which are diagnostic-only comparisons over the same
            // symbol/expiration, not alternate structures for this same
            // candidate. No score/qualification calculation changed here,
            // only which badge group each entry renders in and its label.
            const primary = strategyScores.find(s => s.current);
            const alternates = strategyScores.filter(s => !s.current);
            const altBadgeClass = (strategy: string) =>
              strategy === 'BPS' ? 'bg-emerald-500/15 border-emerald-500 text-emerald-500'
                : strategy === 'BCS' ? 'bg-red-500/15 border-red-500 text-red-500'
                : 'bg-blue-500/15 border-blue-500 text-blue-500';
            return (
              <>
                <span
                  title={primary && primary.score != null ? `Strategy score (this candidate): ${primary.score}` : (primary?.reason ?? undefined)}
                  className={`text-[10px] px-2 py-0.5 border rounded-md shrink-0 font-bold ${stratBadge} flex items-center gap-1`}
                >
                  {result.strategy}
                  {primary?.score != null && <span className="font-bold text-[9px]">{primary.score}</span>}
                </span>
                {alternates.length > 0 && (
                  <span className={`text-[8px] ${th.textFaint} shrink-0 tracking-wide`}>Alternative scores:</span>
                )}
                {alternates.map(s => (
                  <span
                    key={s.strategy}
                    title={s.score == null ? s.reason : `${s.strategy} alternative score ${s.score} (not this candidate's structure)`}
                    className={`text-[10px] px-2 py-0.5 border rounded-md shrink-0 font-bold flex items-center gap-1 opacity-60 ${altBadgeClass(s.strategy)}`}
                  >
                    {s.strategy}
                    <span className="font-bold text-[9px]">{s.score == null ? '—' : s.score}</span>
                  </span>
                ))}
              </>
            );
          })() : (
  <span className={`text-[10px] px-2 py-0.5 border rounded-md shrink-0 font-bold ${stratBadge} flex items-center gap-1`}>
    {result.strategy}{scored && <span className="font-bold text-[9px]">{scored.score}</span>}
  </span>
)}
        </div>
        {/* Col 3: Data fields — fixed widths */}
        <div className="flex items-center gap-3 flex-1 min-w-0">
          <div className={`text-xs ${th.label} w-20 shrink-0`}>IVR <span className={result.ivr != null && result.ivr >= 30 ? 'text-emerald-500 font-bold' : 'text-red-500 font-bold'}>{result.ivr != null ? `${result.ivr.toFixed(1)}%` : 'N/A'}</span></div>
          {c && <>
            <div className="text-xs shrink-0 w-36"><span className={th.label}>Exp </span><span className={`${th.text} font-medium`}>{c.expiration}</span><span className={`ml-1 font-medium ${c.dte <= dteCloseTarget ? 'text-red-500' : c.dte <= dteAlertThreshold ? 'text-yellow-500' : th.textFaint}`}>({c.dte}d)</span></div>
            <div className={`${c.strategy === 'IC' ? 'w-44' : 'w-28'} shrink-0`}><StrikesDisplay c={c} th={th} /></div>
            {c.strategy === 'PMCC' ? <>
              <div className="text-xs shrink-0 w-24"><span className={th.label}>Net Debit </span><span className="text-red-400 font-bold">${c.netDebit?.toFixed(2) ?? '—'}</span></div>
              <div className="text-xs shrink-0 w-24"><span className={th.label}>Short Credit </span><span className="text-emerald-500 font-bold">${c.credit.toFixed(2)}</span></div>
              <div className="text-xs shrink-0 w-20"><span className={th.label}>Extrin. </span><span className={`${th.text} font-medium`}>{c.extrinsicCapture?.toFixed(0) ?? '—'}%</span></div>
              <div className="text-xs shrink-0 w-20"><span className={th.label}>Max P </span><span className="text-emerald-400 font-bold">${c.maxProfit?.toFixed(2) ?? '—'}</span></div>
              <div className="text-xs shrink-0 w-20"><span className={th.label}>LEAPS </span><span className={`${th.text} font-medium`}>{c.longDte}d</span></div>
            </> : <>
              <div className="text-xs shrink-0 w-20">
                <div>
                  <span className={th.label}>{(c.strategy === 'CSP' || c.strategy === 'CC') ? 'Premium ' : 'Credit '}</span>
                  <span className={`${(c.strategy === 'CSP' || c.strategy === 'CC') ? 'text-emerald-400' : getCreditColor(c, result.isEtf ?? false)} font-bold`}>
                    ${(c.totalCredit ?? c.credit).toFixed(2)}
                  </span>
                </div>
                <div>
                  <span className={th.label}>{(c.strategy === 'CSP' || c.strategy === 'CC') ? 'Ann. Yield ' : c.strategy === 'PMCC' ? 'Cr/LEAP ' : 'Cr Ratio '}</span>
                  {(c.strategy === 'CSP' || c.strategy === 'CC') ? (
                    <span className={`${(c.annualizedRoc ?? 0) >= 20 ? 'text-emerald-400' : (c.annualizedRoc ?? 0) >= 10 ? 'text-yellow-400' : 'text-red-400'} font-medium`}>
                      {c.annualizedRoc != null ? `${c.annualizedRoc.toFixed(0)}%` : '—'}
                    </span>
                  ) : (
                    <span className={`${getCreditColor(c, result.isEtf ?? false)} font-medium`}>
                      {(c.creditRatio * 100).toFixed(0)}% 
                    </span>
                  )}
                </div>
              </div>
              <div className="text-xs shrink-0 w-16">
                <div><span className={th.label}>POP </span><span className={`${th.text} font-medium`}>{c.pop != null ? `${c.pop.toFixed(0)}%` : '—'}</span></div>
                  <div className="text-[10px]">
                    <span className={th.label}>ROC </span>
                    <span className={`${(c.strategy === 'CSP' || c.strategy === 'CC') ? th.text : getRocColor(c, result.isEtf ?? false)} font-medium`}>
                      {c.roc.toFixed((c.strategy === 'CSP' || c.strategy === 'CC') ? 1 : 0)}%
                    </span>
                  </div>
              </div>
              <div className="text-xs shrink-0 w-16">
                <div>
                  <span className={th.label}>Delta </span>
                  <div>
                  <span className={th.label}>Exposure </span>
                  <span className={`${deltaExposure != null && deltaExposure <= 25 ? 'text-emerald-400' : deltaExposure != null && deltaExposure <= 35 ? 'text-yellow-400' : 'text-red-400'} font-medium`}>
                    {deltaExposure != null ? deltaExposure : '—'}
                  </span>
                </div>
                  <span className={`${th.text} font-medium`}>{c.shortDelta.toFixed(2)}</span>
                </div>
                <div>
                  <span className={th.label}>RSI </span>
                  <span className={`${getRsiColor(rsi14)} font-medium`}>
                    {rsi14 != null ? rsi14.toFixed(0) : '—'}
                  </span>
                </div>
              </div>
              <div className="text-xs shrink-0 w-16">
                <div>
                  <span className={th.label}>OTM </span>
                  <span className={`font-bold ${otmPct != null ? getOtmColor(otmPct, result.ivr, result.isEtf ?? false) : th.textFaint}`}>
                    {otmPct != null ? `${otmPct.toFixed(1)}%` : '—'}
                  </span>
                </div>
              </div>
              <div className={`text-xs shrink-0 ${c.strategy === 'IC' ? 'w-28' : 'w-16'}`} title="Open interest — short leg / long leg, each colored on its own OI">
                {c.strategy === 'IC' ? (
                  <>
                    <div>
                      <span className={th.label}>OI P </span>
                      <span className={`font-bold ${getOiColor(c.shortOI, rules.OI_MIN)}`}>{c.shortOI ?? '—'}</span>
                      <span className={`font-bold ${th.textFaint}`}>/</span>
                      <span className={`font-bold ${getOiColor(c.longOI, rules.OI_MIN)}`}>{c.longOI ?? '—'}</span>
                    </div>
                    <div>
                      <span className={th.label}>OI C </span>
                      <span className={`font-bold ${getOiColor(c.shortCallOI, rules.OI_MIN)}`}>{c.shortCallOI ?? '—'}</span>
                      <span className={`font-bold ${th.textFaint}`}>/</span>
                      <span className={`font-bold ${getOiColor(c.longCallOI, rules.OI_MIN)}`}>{c.longCallOI ?? '—'}</span>
                    </div>
                  </>
                ) : c.strategy === 'CSP' ? (
                  // CSP-0002 — single-leg cash-secured put: only the short
                  // put's OI is meaningful (the "relevant leg"). No
                  // protective/long leg exists, so no second OI number
                  // belongs here — c.longOI is only ever a copy of shortOI
                  // for CSP (see csp-finder.ts), kept for shared-math safety,
                  // never for display.
                  <div>
                    <span className={th.label}>OI </span>
                    <span className={`font-bold ${getOiColor(c.shortOI, rules.OI_MIN)}`}>{c.shortOI ?? '—'}</span>
                  </div>
                ) : (
                  <div>
                    <span className={th.label}>OI </span>
                    <span className={`font-bold ${getOiColor(c.shortOI, rules.OI_MIN)}`}>{c.shortOI ?? '—'}</span>
                    <span className={`font-bold ${th.textFaint}`}>/</span>
                    <span className={`font-bold ${getOiColor(c.longOI, rules.OI_MIN)}`}>{c.longOI ?? '—'}</span>
                  </div>
                )}
              </div>
              {result.ivx != null && (
                <div className="text-xs shrink-0 w-28">
                  <div>
                    <span className={th.label}>IVx </span>
                    <span className={`${getIvxColor(result.ivx)} font-medium`}>{result.ivx.toFixed(1)}%</span>
                  </div>
                  <div>
                    <span className={th.label}>EM </span>
                    <span className={`${th.text} font-medium`}>
                      {c.expectedMove != null ? `±$${c.expectedMove.toFixed(2)}` : '—'}
                    </span>
                    {(() => {
                      const cp = calcEmClearancePct({ price: result.price, bestCandidate: c });
                      return cp != null ? (
                        <span className={`ml-1 text-[10px] font-bold ${getEmClearanceColor(cp)}`}>
                          {cp >= 0 ? `+${cp.toFixed(1)}%` : `${cp.toFixed(1)}%`}
                        </span>
                      ) : null;
                    })()}
                  </div>
                </div>
              )}
            </>}
            <span className={`text-[9px] ${th.textFaint} border ${th.borderLight} rounded px-1 py-0.5 shrink-0`}>opt</span>
            {result.qualified && <span onClick={e => e.stopPropagation()} className="shrink-0"><EntryCalendarButton result={result} th={th} rules={rules} /></span>}
            {isApproaching && <span className="text-[9px] text-yellow-500 border border-yellow-600 rounded px-1 py-0.5 shrink-0 font-medium">⚠ DTE</span>}
          </>}
          {/* CSP-WORKFLOW-0001 core correction (BLOCKER-01) — a market-
              qualified CSP result (result.qualified === true) that is NOT
              account-eligible must still show a clear, visible account-
              status label on the collapsed row, not just inside the
              expanded section below. Without this branch a capital-
              insufficient/unverified/no-account-selected CSP candidate
              would render with no summary-row indication at all that it
              isn't actually tradeable in the selected account. */}
          {(!result.qualified || (result.bestCandidate?.cspAccountEligibility != null && result.bestCandidate.cspAccountEligibility !== 'ELIGIBLE')) && result.failReasons.length > 0 && (
            <div className="flex items-center gap-2 flex-wrap">
              <span className={`text-[10px] ${result.qualified ? 'text-amber-500' : 'text-red-500'} font-medium`}>{result.failReasons.slice(0, 2).join(' · ')}</span>
              {hasEarningsBlock && result.earningsDate && <span onClick={e => e.stopPropagation()}><CalendarButton symbol={result.symbol} strategy={result.strategy} earningsDate={result.earningsDate} ivr={result.ivr} th={th} /></span>}
            </div>
          )}
        </div>
        {/* Col 4: Expand + re-screen — right aligned */}
        <div className="flex items-center gap-2 ml-auto shrink-0">
          <div className={`${th.textFaint} text-xs`}>{expanded ? '▲' : '▼'}</div>
        </div>
      </div>

      {/* CSP-0002 corrective pass — "Complete the CSP metric presentation":
          Bid/Ask/Mid/Cash required/Breakeven previously lived only inside
          the EXPANDED "CSP — Wheel Entry" section below, so a qualified CSP
          card's collapsed row didn't show them (unlike the disqualified
          audit card, which always has). Shown unconditionally here, mirroring
          DisqualifiedSection's CspFundamentalsRow, so qualified and
          disqualified CSP cards present identical fundamentals without
          requiring an expand click. */}
      {c && <CspFundamentalsRow candidate={c} price={result.price} textMutedClassName={th.textMuted} testId="csp-qualified-fundamentals" />}

      {/* Expanded Content */}
      {expanded && (
        <div className={`border-t ${th.border} px-4 py-3 space-y-3`}>
          {t && <div className={`text-[10px] ${th.textMuted} pb-2 border-b ${th.border}`}><span className={`${trendColor(t.trend)} mr-2 font-medium`}>{trendIcon(t.trend)} {t.trend.toUpperCase()}</span>{t.reason}</div>}

          {/* Score breakdown in rank mode */}
          {isRankMode && scored && light && (
            <div className={`border ${light.border} ${light.bg} rounded-lg p-3`}>
              <div className="flex items-center justify-between mb-2">
                <p className={`text-[10px] font-bold ${light.color}`}>{light.emoji} Score {scored.score}/100 — {light.label}</p>
              </div>
              <div className="grid grid-cols-7 gap-2">
                {[
                  { label: 'Momentum', val: scored.dims.momentum, max: rankConfig!.weightMomentum },
                  { label: 'IVR', val: scored.dims.ivr, max: rankConfig!.weightIvr ?? 15 },
                  { label: 'EM Clear', val: scored.dims.emClearance, max: rankConfig!.weightEmClearance ?? 15 },
                  { label: 'Range', val: scored.dims.range, max: rankConfig!.weightRange },
                  { label: 'Technical', val: scored.dims.technical, max: rankConfig!.weightTechnical },
                  { label: 'Liquidity', val: scored.dims.liquidity, max: rankConfig!.weightLiquidity ?? 10 },
                  { label: 'Buffer', val: scored.dims.buffer, max: rankConfig!.weightBuffer ?? 10 },
                ].map(d => (
                  <div key={d.label} className="text-center">
                    <p className={`text-[8px] ${th.textFaint} mb-1`}>{d.label}</p>
                    <div className={`h-1 rounded-full bg-slate-700 mb-1`}>
                      <div className={`h-full rounded-full ${light!.color.replace('text-', 'bg-')}`}
                        style={{ width: `${d.max > 0 ? (d.val / d.max) * 100 : 0}%` }} />
                    </div>
                    <p className={`text-[9px] font-bold ${th.text}`}>{d.val}<span className={`${th.textFaint} font-normal`}>/{d.max}</span></p>
                  </div>
                ))}
              </div>
            </div>
          )}
                    <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
            {Object.entries(result.checks).map(([key, check]) => {
      if (key === 'iv') {
        console.log('IV_RENDER_DEBUG', {
          symbol: result.symbol,
          strategy: result.strategy,
          valueRendered: check.value,
          reasonRendered: check.reason,
          fullIvCheck: check,
          resultChecksIv: result.checks.iv,
          shortIv: result.bestCandidate?.shortIv,
          hv30FromResult: (result as any)?.hv30,
        });
      }
    const isEarnings = key === 'earnings';
    const keyLabel: Record<string, string> = {
      iv: 'Strike Volatility',
      emClearance: 'EM Clearance',
      ivr: 'IVR',
      oi: 'OI',
      delta: 'Delta',
      credit: 'Credit',
      roc: 'ROC',
      pop: 'POP',
      earnings: 'Earnings',
    };
    const postDate = isEarnings && result.earningsDate && daysUntil(result.earningsDate) < 0
      ? getPostEarningsRescreenDate(result.earningsDate)
      : null;
    const nextEst = isEarnings && result.earningsDate && daysUntil(result.earningsDate) < 0
      ? estimateNextEarningsDate(result.earningsDate)
      : null;

    return (
      <div key={key} className={`flex items-start gap-2 ${isEarnings ? 'col-span-2 md:col-span-1' : ''}`}>
        <span className={`text-xs mt-0.5 font-bold ${statusColor(check.status)}`}>{statusIcon(check.status)}</span>
        <div>
          {(() => {
            const keyLabel: Record<string, string> = {
              iv: 'Strike Volatility',
              emClearance: 'EM Clearance',
              ivr: 'IVR', oi: 'OI', delta: 'Delta',
              credit: 'Credit', roc: 'ROC', pop: 'POP', earnings: 'Earnings',
            };
            return (
              <div className="flex items-center gap-0.5">
                <p className={`text-[10px] ${th.textFaint} uppercase tracking-wider`}>{keyLabel[key] ?? key}</p>
                {key === 'iv' && (
                  <InfoTooltip th={th} text="Compares Implied Volatility (what the market prices in) vs Historical Volatility (what the stock actually moved). When IV > HV you have statistical edge — you are being paid more than the stock historically moves. The bigger the gap, the stronger the sell edge." />
                )}
                {key === 'emClearance' && (
                  <InfoTooltip th={th} text="How far your short strike sits outside the market's expected move. Formula: Price × (IVx/100) × √(DTE/365). Strikes inside the EM have less than 68% POP by definition. Green = 15%+ beyond EM. Yellow = 5–15%. Orange = barely outside. Red = inside EM." />
                )}
              </div>
            );
          })()}

          {isEarnings && result.earningsDate && daysUntil(result.earningsDate) < 0 ? (
            <>
              <p className={`text-xs ${th.text} font-medium`}>Reported: {formatDisplayDate(result.earningsDate)}</p>
              <p className={`text-[10px] ${th.textMuted}`}>Next Est: {nextEst ? formatDisplayDate(nextEst) : '—'}</p>
              <p className={`text-[10px] text-emerald-500/80`}>
                Eligible Re-screen: {postDate ? formatDisplayDate(postDate) : '—'}
              </p>
            </>
          ) : (
            <>
              <p className={`text-xs ${th.text} font-medium`}>{check.value}</p>
              <p className={`text-[10px] ${th.textMuted}`}>{check.reason}</p>
            </>
          )}
        </div>
      </div>
    );
  })}
</div>

          {c && c.strategy === 'IC' && c.callWidth != null && c.callWidth !== c.spreadWidth && (
            <div className={`pt-2 border-t ${th.border}`}>
              <p className={`text-[10px] ${th.textMuted}`}>Asymmetric widths — Put: ${c.spreadWidth} · Call: ${c.callWidth}</p>
            </div>
          )}

          {c && c.strategy === 'PMCC' && (
            <div className={`pt-2 border-t ${th.border} space-y-1.5`}>
              <p className={`text-[9px] ${th.textFaint} uppercase tracking-widest font-medium`}>PMCC Structure</p>
              <div className="grid grid-cols-2 gap-3 text-xs">
                <div><span className={th.label}>LEAPS long call: </span><span className={th.text}>{c.longStrike}C exp {c.longExpiration} ({c.longDte}d) · cost ${c.longCost?.toFixed(2)} · Δ{c.longDelta?.toFixed(2)}</span></div>
                <div><span className={th.label}>Short call: </span><span className={th.text}>{c.shortStrike}C exp {c.expiration} ({c.dte}d) · credit ${c.credit.toFixed(2)} · Δ{c.shortDelta.toFixed(2)}</span></div>
                <div><span className={th.label}>Net debit: </span><span className="text-red-400 font-bold">${c.netDebit?.toFixed(2)}</span><span className={`${th.textFaint} ml-1 text-[10px]`}>(capital at risk)</span></div>
                <div><span className={th.label}>Max profit: </span><span className="text-emerald-400 font-bold">${c.maxProfit?.toFixed(2)}</span><span className={`${th.textFaint} ml-1 text-[10px]`}>(if stock reaches short strike)</span></div>
                <div><span className={th.label}>Extrinsic capture: </span><span className={th.text}>{c.extrinsicCapture?.toFixed(0)}%</span><span className={`${th.textFaint} ml-1 text-[10px]`}>(short credit / LEAPS extrinsic)</span></div>
                <div><span className={th.label}>ROC: </span><span className={th.text}>{c.roc.toFixed(1)}%</span><span className={`${th.textFaint} ml-1 text-[10px]`}>(short credit / net debit)</span></div>
              </div>
              <p className={`text-[9px] text-purple-400/80 pt-1`}>Roll the short call at 21 DTE or 50% profit. Never let the short call go deep ITM. Exit the LEAPS when the thesis changes.</p>
            </div>
          )}

          {c && c.strategy === 'CSP' && (
            <div className={`pt-2 border-t ${th.border} space-y-1.5`}>
              <p className={`text-[9px] ${th.textFaint} uppercase tracking-widest font-medium`}>CSP — Wheel Entry</p>
              <div className="grid grid-cols-2 gap-3 text-xs">
                <div><span className={th.label}>Put: </span><span className={th.text}>{c.shortStrike}P exp {c.expiration} ({c.dte}d) · Δ{c.shortDelta.toFixed(2)}</span></div>
                <div><span className={th.label}>Premium: </span><span className="text-emerald-400 font-bold">${c.credit.toFixed(2)}</span><span className={`${th.textFaint} ml-1 text-[10px]`}>(1 contract)</span></div>
                <div>
                  <span className={th.label}>Required cash: </span>
                  <span className={`font-bold ${c.capitalBlocked ? 'text-red-400' : th.text}`}>${c.requiredCash?.toLocaleString() ?? '—'}</span>
                  <span className={`${th.textFaint} ml-1 text-[10px]`}>(strike × 100 — no margin)</span>
                </div>
                <div><span className={th.label}>Breakeven: </span><span className={th.text}>${c.breakeven?.toFixed(2) ?? '—'}</span><span className={`${th.textFaint} ml-1 text-[10px]`}>(assignment price ${c.assignmentPrice?.toFixed(2) ?? '—'})</span></div>
                <div><span className={th.label}>ROC (period): </span><span className={th.text}>{c.roc.toFixed(1)}%</span><span className={`${th.textFaint} ml-1 text-[10px]`}>(premium / required cash)</span></div>
                <div><span className={th.label}>Annualized ROC: </span><span className={th.text}>{c.annualizedRoc?.toFixed(0) ?? '—'}%</span></div>
              </div>
              {c.capitalBlocked ? (
                <p className={`text-[9px] text-red-400 font-medium pt-1`}>⚠ {c.capitalWarning}</p>
              ) : (
                <p className={`text-[9px] text-amber-400/80 pt-1`}>Cash-secured — assignment would mean buying 100 shares/contract at ${c.shortStrike}. Only enter if owning the stock at this price is acceptable.</p>
              )}
            </div>
          )}

          {c && c.strategy === 'CC' && (
            <div className={`pt-2 border-t ${th.border} space-y-1.5`}>
              <p className={`text-[9px] ${th.textFaint} uppercase tracking-widest font-medium`}>CC — Covered Call, Written Against Owned Shares</p>
              <div className="grid grid-cols-2 gap-3 text-xs">
                <div><span className={th.label}>Call: </span><span className={th.text}>{c.shortStrike}C exp {c.expiration} ({c.dte}d) · Δ{c.shortDelta.toFixed(2)}</span></div>
                <div><span className={th.label}>Premium: </span><span className="text-emerald-400 font-bold">${c.ccPremiumPerContract?.toFixed(2) ?? '—'}</span><span className={`${th.textFaint} ml-1 text-[10px]`}>(per contract)</span></div>
                <div><span className={th.label}>Owned shares: </span><span className={th.text}>{c.ccSharesOwned ?? '—'}</span><span className={`${th.textFaint} ml-1 text-[10px]`}>(gross {c.ccGrossCoveredContracts ?? '—'} contracts)</span></div>
                <div><span className={th.label}>Existing / working short calls: </span><span className={th.text}>{c.ccExistingShortCallContracts ?? 0} / {c.ccWorkingShortCallContracts ?? 0}</span></div>
                <div><span className={th.label}>Available contracts: </span><span className="font-bold text-emerald-400">{c.ccAvailableCoveredContracts ?? '—'}</span><span className={`${th.textFaint} ml-1 text-[10px]`}>(quantity used for this candidate)</span></div>
                <div><span className={th.label}>Cost basis: </span><span className={th.text}>{c.ccCostBasis != null ? `$${c.ccCostBasis.toFixed(2)}` : 'Unavailable'}</span></div>
                <div><span className={th.label}>Strike vs stock: </span><span className={th.text}>{c.ccStrikeVsStockPct != null ? `+${c.ccStrikeVsStockPct.toFixed(1)}%` : '—'}</span></div>
                <div><span className={th.label}>Strike vs cost basis: </span><span className={th.text}>{c.ccStrikeVsCostBasisPct != null ? `${c.ccStrikeVsCostBasisPct >= 0 ? '+' : ''}${c.ccStrikeVsCostBasisPct.toFixed(1)}%` : 'Unavailable'}</span></div>
                <div><span className={th.label}>Assignment proceeds: </span><span className={th.text}>${c.ccAssignmentProceeds?.toLocaleString() ?? '—'}</span><span className={`${th.textFaint} ml-1 text-[10px]`}>(per contract, strike × 100)</span></div>
                <div><span className={th.label}>Max upside if called away: </span><span className={th.text}>{c.ccMaxUpsideIfCalledAway != null ? `$${c.ccMaxUpsideIfCalledAway.toFixed(2)}/share` : 'Unavailable'}</span></div>
                <div><span className={th.label}>Period / annualized yield: </span><span className={th.text}>{c.ccPeriodYieldOnShares?.toFixed(2) ?? '—'}% / {c.ccAnnualizedYieldOnShares?.toFixed(0) ?? '—'}%</span></div>
              </div>
              {c.ccAssignmentWarning && <p className={`text-[9px] text-yellow-400 font-medium pt-1`}>⚠ {c.ccAssignmentWarning}</p>}
              {c.ccLiquidityWarning && <p className={`text-[9px] text-yellow-400 font-medium pt-1`}>⚠ {c.ccLiquidityWarning}</p>}
              {c.ccHasUnclassifiedExposure && (
                // TE-0007C final corrective pass: same disclosure as the
                // eligible-holdings card, repeated here since a candidate
                // card may be viewed/shared independently of that card.
                <p className={`text-[9px] text-amber-400 font-medium pt-1`}>⚠ Some option exposure could not be classified. Available covered-call capacity was reduced conservatively.</p>
              )}
              <p className={`text-[9px] text-cyan-400/80 pt-1`}>Written against shares you already own. Assignment would mean selling 100 shares/contract at ${c.shortStrike}. Only enter if that's an acceptable outcome.</p>
            </div>
          )}

          {result.failReasons.length > 0 && (
            <div className={`pt-2 border-t ${th.border}`}>
              <p className="text-[10px] text-red-500 font-medium">{result.failReasons.join(' · ')}</p>
            </div>
          )}

          {/* Action Buttons */}
          <div className="flex gap-2 mt-2">
            {c && c.strategy !== 'CSP' && c.strategy !== 'CC' && (
              <button
                onClick={(e) => { e.stopPropagation(); onTrade?.(result); }}
                className="flex-1 py-2.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl text-xs font-bold tracking-widest transition-colors"
              >
                ⚡ TRADE THIS
              </button>
            )}
            {c && c.strategy !== 'CSP' && c.strategy !== 'CC' && (
              <button
                onClick={(e) => { e.stopPropagation(); setShowBestFinder(true); }}
                className="flex-1 py-2.5 border border-emerald-600 hover:bg-emerald-500/10 text-emerald-400 rounded-xl text-xs font-medium tracking-wider transition-colors"
              >
                🔍 FIND BETTER (Similar DTE)
              </button>
            )}
            {c && c.strategy === 'CSP' && (
              // TE-0007A scope: no live order placement, and BestOpportunityFinder's
              // "Find Better" is spread-specific (runs BPS/BCS/IC checklists at
              // different risk presets) — not reused here to avoid misapplying
              // spread logic to a single-leg CSP. Deferred to a follow-up ticket.
              <p className={`flex-1 text-[9px] ${th.textFaint} italic py-2.5 text-center`}>
                Manual entry only — CSP trade placement and "Find Better" are not yet wired up
              </p>
            )}
            {c && c.strategy === 'CC' && (
              // TE-0007C scope: no live order placement. A covered call has
              // different safety requirements than a spread order (proof of
              // share coverage at execution time) — that belongs to a future
              // ticket, not a reuse of the spread order flow.
              <p className={`flex-1 text-[9px] ${th.textFaint} italic py-2.5 text-center`}>
                Analysis only — CC trade placement is not yet enabled
              </p>
            )}
          </div>
        </div>
      )}

      {/* Sector concentration note — plain fact, no severity/dismiss. Same-symbol
          detail is already covered by the always-visible "Open Position" banner
          below, so this only fires for broader same-sector exposure. */}
      {showSectorNote && portfolioRisk && (
        <div className="border-t border-white/10 bg-white/[0.02] px-4 py-2 rounded-b-lg" onClick={e => e.stopPropagation()}>
          <p className={`text-[10px] ${th.textFaint}`}>
            ▸ {portfolioRisk.sectorCount} open position{portfolioRisk.sectorCount !== 1 ? 's' : ''} in {portfolioRisk.sectorName}
          </p>
        </div>
      )}

      {/* Existing position banner */}
      {matchingPositions.length > 0 && (
        <div 
          className="border-t border-l-2 border-amber-500 bg-amber-500/10 px-4 py-2 flex items-center gap-3 flex-wrap rounded-b-lg"
          onClick={e => e.stopPropagation()}
        >
          <span className="text-[9px] font-bold text-amber-400 tracking-widest shrink-0 uppercase flex items-center gap-1">
            ▸ Open Position
          </span>
          <span className="text-[9px] font-bold text-amber-400 tracking-widest shrink-0 uppercase">▸ Open Position</span>
          {matchingPositions.map((p, i) => (
            <div key={i} className="flex items-center gap-2 text-[10px]" style={{ fontFamily: "'DM Mono', monospace" }}>
              <span className={`px-1.5 py-0.5 border rounded text-[9px] font-bold ${
                p.strategy === 'BPS' ? 'border-emerald-600 text-emerald-400 bg-emerald-500/10'
                : p.strategy === 'BCS' ? 'border-red-600 text-red-400 bg-red-500/10'
                : p.strategy === 'IC' ? 'ac-btn ac-bg-10'
                : 'border-amber-600 text-amber-400 bg-amber-500/10'
              }`}>{p.strategy}</span>
              <span className="text-amber-300/90 font-medium">{p.strikes}</span>
              <span className="text-amber-500/70">exp {p.expDate}</span>
              <span className="text-amber-500/70">×{p.qty}</span>
              {i < matchingPositions.length - 1 && <span className="text-amber-700 mx-1">·</span>}
            </div>
          ))}
        </div>
      )}

      {/* AI Research panel — full width, always last, so it never overlaps
          the header row's strikes/credit/POP columns above it. */}
      <StockResearchPanel symbol={result.symbol} th={th} research={research} />

      {/* Best Opportunity Modal — rendered via portal to escape card click handler */}
      {showBestFinder && createPortal(
       <BestOpportunityFinder
          symbol={result.symbol}
          onClose={() => setShowBestFinder(false)}
          th={th}
          rules={rules}
          preferredStrategy={result.strategy as 'BPS' | 'BCS' | 'IC'}
          cachedEntry={cachedEntry}
          onTrade={onTrade}
          originalDte={result.bestCandidate?.dte}
        />,
        document.body
      )}
    </div>
  );
}

// ── Range Indicator ────────────────────────────────────────────────────────
function RangeIndicator({ value, strict, course, relaxed, lowvol, fmt }: {
  value: number; strict?: number; course?: number; relaxed?: number; lowvol?: number;
  fmt?: (v: number) => string;
}) {
  const f = fmt ?? ((v: number) => String(v));
  const points = [
    strict  != null ? { v: strict,  label: 'Strict',  color: 'bg-red-500' }    : null,
    course  != null ? { v: course,  label: 'Course',  color: 'bg-blue-500' }   : null,
    relaxed != null ? { v: relaxed, label: 'Relaxed', color: 'bg-emerald-500' }: null,
    lowvol  != null ? { v: lowvol,  label: 'Low Vol', color: 'bg-yellow-500' } : null,
  ].filter(Boolean) as { v: number; label: string; color: string }[];
  if (!points.length) return null;
  const allVals = points.map(p => p.v);
  const min = Math.min(...allVals, value) * 0.9;
  const max = Math.max(...allVals, value) * 1.1;
  const pct = (v: number) => Math.round(((v - min) / (max - min)) * 100);
  return (
    <div className="mt-1 relative h-3">
      <div className="absolute inset-x-0 top-1.5 h-px bg-slate-700 rounded" />
      {points.map(p => (
        <div key={p.label} className={`absolute w-1.5 h-1.5 rounded-full ${p.color} top-1 -translate-x-1/2`}
          style={{ left: `${pct(p.v)}%` }} title={`${p.label}: ${f(p.v)}`} />
      ))}
      <div className="absolute w-2 h-2 rounded-full bg-white border-2 border-slate-900 top-0.5 -translate-x-1/2 z-10"
        style={{ left: `${pct(value)}%` }} title={`Current: ${f(value)}`} />
    </div>
  );
}

// ── Slider ─────────────────────────────────────────────────────────────────
function Slider({ label, hint, value, min, max, step = 1, fmt, onChange, th }: {
  label: string; hint?: string; value: number; min: number; max: number; step?: number;
  fmt?: (v: number) => string; onChange: (v: number) => void; th: typeof THEMES[Theme];
}) {
  const f = fmt ?? ((v: number) => String(v));
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center justify-between">
        <p className={`text-[9px] ${th.textFaint} tracking-wider uppercase font-medium leading-tight`}>{label}</p>
        <span className={`text-[10px] font-bold ${th.text}`}>{f(value)}</span>
      </div>
      {hint && <p className={`text-[8px] ${th.textFaint} opacity-60`}>{hint}</p>}
      <input
        type="range" min={min} max={max} step={step} value={value}
        onChange={e => onChange(parseFloat(e.target.value))}
        className="w-full h-1.5 rounded-full appearance-none cursor-pointer accent-blue-500"
        style={{ background: `linear-gradient(to right, #3b82f6 ${((value - min) / (max - min)) * 100}%, #374151 0%)` }}
      />
      <div className="flex justify-between">
        <span className={`text-[8px] ${th.textFaint}`}>{f(min)}</span>
        <span className={`text-[8px] ${th.textFaint}`}>{f(max)}</span>
      </div>
    </div>
  );
}

// ── Rules Modal Subcomponents ──────────────────────────────────────────────
function RuleInput({ ruleKey, rawValues, editedRules, onRawChange, onBlur, th, label, hint }: {
  ruleKey: keyof RulesType;
  rawValues: Record<string, string>;
  editedRules: RulesType;
  onRawChange: (key: string, raw: string) => void;
  onBlur: (key: keyof RulesType, raw: string) => void;
  th: typeof THEMES[Theme];
  label?: string;
  hint?: string;
}) {
  return (
    <div className="flex flex-col">
      <p className={`text-[9px] ${th.textFaint} tracking-wider uppercase font-medium leading-tight`}>
        {label ?? RULE_LABELS[ruleKey]}
      </p>
      <p className={`text-[8px] ${th.textFaint} opacity-60 mb-1 leading-tight min-h-[12px]`}>
        {hint ?? ''}
      </p>
      <input
        type="text"
        inputMode="decimal"
        value={rawValues[ruleKey] ?? String(editedRules[ruleKey])}
        onChange={e => onRawChange(ruleKey, e.target.value)}
        onBlur={e => onBlur(ruleKey, e.target.value)}
        onFocus={e => e.target.select()}
        className={`w-full ${th.input} border ${th.inputBorder} rounded-lg px-3 py-1.5 text-xs ${th.text} focus:outline-none ac-focus font-medium`}
      />
    </div>
  );
}

function SectionHeader({ label, th }: { label: string; th: typeof THEMES[Theme] }) {
  return (
    <div className={`col-span-full pt-3 pb-1 border-b ${th.border}`}>
      <p className={`text-[9px] ${th.textFaint} tracking-widest uppercase font-bold`}>{label}</p>
    </div>
  );
}

// ── Rules Modal ────────────────────────────────────────────────────────────
// ── Run Mode Modal ─────────────────────────────────────────────────────────
const FILTER_PRESETS = [
  { key: 'strict',    label: 'Strict',      color: 'border-red-500 text-red-400',         desc: 'Tightest rules — high conviction only' },
  { key: 'course',   label: 'Course',      color: 'ac-btn',        desc: 'Baseline rules — balanced approach' },
  { key: 'relaxed',  label: 'Relaxed',     color: 'border-emerald-500 text-emerald-400',  desc: 'Looser rules — more opportunities' },
  { key: 'lowvol',   label: 'Low Vol',     color: 'border-yellow-500 text-yellow-400',    desc: 'Adapted for low IVR environments' },
  { key: 'shortterm',   label: 'Short Term',   color: 'border-orange-500 text-orange-400',  desc: '7–14 DTE — very active daily management' },
  { key: 'intermediate',label: 'Intermediate', color: 'border-amber-500 text-amber-400',    desc: '15–29 DTE — active management' },
];

function RunModeModal({ th, lastMode, lastPreset, activeRankRules, lastTargetedDteMin, lastTargetedDteMax, lastTargetedPopMin, lastTargetedOtmMin, lastTargetedPreset, onRun, onClose }: {
  th: typeof THEMES[Theme];
  lastMode: 'filter' | 'rank' | 'targeted';
  lastPreset: string;
  activeRankRules: RulesType;
  lastTargetedDteMin: number;
  lastTargetedDteMax: number;
  lastTargetedPopMin: number;
  lastTargetedOtmMin: number;
  lastTargetedPreset: string;
  onRun: (mode: 'filter' | 'rank' | 'targeted', preset?: string, targetedOpts?: { dteMin: number; dteMax: number; popMin: number; otmMin: number; preset: string }) => void;
  onClose: () => void;
}) {
  const [mode, setMode] = useState<'filter' | 'rank' | 'targeted'>(lastMode);
  const [preset, setPreset] = useState(lastPreset || 'course');
  const [tDteMin, setTDteMin] = useState(lastTargetedDteMin);
  const [tDteMax, setTDteMax] = useState(lastTargetedDteMax);
  const [tPopMin, setTPopMin] = useState(lastTargetedPopMin);
  const [tOtmMin, setTOtmMin] = useState(lastTargetedOtmMin);
  const [tPreset, setTPreset] = useState(lastTargetedPreset || 'course');

  return (
    <ScanModalShell
      th={th}
      titleId="run-mode-modal-title"
      title={<>SCAN SELECTED<br />INDEXES, ETFS, EQUITIES</>}
      closeLabel="Close scan configuration"
      onClose={onClose}
    >
      <div className="flex flex-col gap-5">
        {/* Mode selection */}
        <ScanModeRadioGroup
          th={th}
          ariaLabel="Scan mode"
          value={mode}
          onChange={setMode}
          descriptions={{
            filter: 'Gate by rules — pass/fail',
            rank: 'Score & sort all tickers',
            targeted: 'Deep scan by DTE + POP',
          }}
        />

        {/* Preset selection — filter mode */}
        {mode === 'filter' && (
          <div className="flex flex-col gap-2">
            <p className={`text-[9px] tracking-widest font-medium ${th.textFaint}`}>SELECT PRESET</p>
            {FILTER_PRESETS.map(p => (
              <button key={p.key} onClick={() => setPreset(p.key)}
                className={`flex items-center gap-3 px-3 py-2.5 rounded-lg border text-left transition-all ${
                  preset === p.key ? `${p.color} bg-white/5` : `${th.border} ${th.textFaint} hover:${th.textMuted}`
                }`}>
                <span className={`text-[10px] font-bold w-20 shrink-0 ${preset === p.key ? p.color.split(' ')[1] : ''}`}>{p.label}</span>
                <span className="text-[9px] opacity-70">{p.desc}</span>
              </button>
            ))}
            {/* TE-0007D corrective — Filter mode previously showed only the
                preset name/description, never the numbers it was about to
                apply. RulesModal remains the place to edit values; this is
                read-only visibility so a trader isn't running a scan blind
                to what it actually gates on. */}
            {(() => {
              const selected = RULE_PRESETS.find(rp => rp.key === preset);
              if (!selected) return null;
              const r = selected.rules as Record<string, number | undefined>;
              return (
                <div className={`rounded-lg border ${th.border} bg-black/20 p-2.5 text-[9px] ${th.textFaint} leading-relaxed`} data-testid="filter-preset-preview">
                  IVR ≥ {r.IVR_MIN}% · OI ≥ {r.OI_MIN} · bid/ask ≤ ${r.BID_ASK_MAX?.toFixed(2)} · credit ≥ {((r.CREDIT_RATIO_MIN ?? 0) * 100).toFixed(0)}% of width
                  {r.DTE_MIN != null && r.DTE_MAX != null ? ` · DTE ${r.DTE_MIN}–${r.DTE_MAX}` : ''}
                  {' '}· ROC ≥ {r.ROC_MIN_SPREAD}% (spread) / {r.ROC_MIN_IC}% (IC)
                </div>
              );
            })()}
          </div>
        )}

        {/* Rank mode previously showed nothing at all -- no preset selector
            (Rank has none, by design; it scores and sorts the full universe
            using the active saved ruleset rather than gating pass/fail) and
            no indication of what that active ruleset actually was. Same
            read-only visibility fix as Filter mode above. */}
        {mode === 'rank' && (
          <div className="flex flex-col gap-2">
            <p className={`text-[9px] tracking-widest font-medium ${th.textFaint}`}>ACTIVE RULESET</p>
            <p className={`text-[9px] ${th.textFaint}`}>
              Rank scores and sorts every ticker using your currently active saved rules — set via RULES, not selected here.
            </p>
            <div className={`rounded-lg border ${th.border} bg-black/20 p-2.5 text-[9px] ${th.textFaint} leading-relaxed`} data-testid="rank-active-rules-preview">
              IVR ≥ {activeRankRules.IVR_MIN}% · OI ≥ {activeRankRules.OI_MIN} · bid/ask ≤ ${activeRankRules.BID_ASK_MAX?.toFixed(2)} · credit ≥ {(activeRankRules.CREDIT_RATIO_MIN * 100).toFixed(0)}% of width
              {' '}· ROC ≥ {activeRankRules.ROC_MIN_SPREAD}% (spread) / {activeRankRules.ROC_MIN_IC}% (IC)
            </div>
          </div>
        )}

        {/* Targeted scan config */}
        {mode === 'targeted' && (
          <div className="flex flex-col gap-4">
            <p className={`text-[9px] tracking-widest font-medium ${th.textFaint}`}>SCAN CONFIG</p>

            {/* DTE range */}
            <div>
              <p className={`text-[8px] ${th.textFaint} tracking-widest mb-1.5`}>DTE RANGE</p>
              <div className="flex items-center gap-2">
                <div className="flex items-center gap-1.5">
                  <span className={`text-[9px] ${th.textFaint}`}>Min</span>
                  <input type="number" value={tDteMin} onChange={e => setTDteMin(Math.max(0, parseInt(e.target.value) || 0))}
                    className={`w-16 ${th.input} border ${th.inputBorder} rounded px-2 py-1 text-[11px] ${th.text} text-center focus:outline-none`} />
                </div>
                <span className={`text-[9px] ${th.textFaint}`}>→</span>
                <div className="flex items-center gap-1.5">
                  <span className={`text-[9px] ${th.textFaint}`}>Max</span>
                  <input type="number" value={tDteMax} onChange={e => setTDteMax(Math.max(tDteMin + 1, parseInt(e.target.value) || 45))}
                    className={`w-16 ${th.input} border ${th.inputBorder} rounded px-2 py-1 text-[11px] ${th.text} text-center focus:outline-none`} />
                </div>
                <span className={`text-[9px] ${th.textFaint}`}>days</span>
              </div>
              <div className="flex gap-1.5 mt-2 flex-wrap">
                {[
                  { label: '7–13', min: 7, max: 13 },
                  { label: '14–20', min: 14, max: 20 },
                  { label: '21–29', min: 21, max: 29 },
                  { label: '30–45', min: 30, max: 45 },
                  { label: '46–60', min: 46, max: 60 },
                  { label: '21–60', min: 21, max: 60 },
                ].map(r => (
                  <button key={r.label} onClick={() => { setTDteMin(r.min); setTDteMax(r.max); }}
                    className={`text-[9px] px-2 py-0.5 rounded border transition-colors font-bold ${
                      tDteMin === r.min && tDteMax === r.max
                        ? 'border-teal-500 text-teal-300 bg-teal-500/15'
                        : `${th.border} ${th.textFaint}`
                    }`}>{r.label}</button>
                ))}
              </div>
            </div>

            {/* POP floor */}
            <div>
              <p className={`text-[8px] ${th.textFaint} tracking-widest mb-1.5`}>MIN POP %</p>
              <div className="flex items-center gap-2">
                <input type="number" min={50} max={95} value={tPopMin} onChange={e => setTPopMin(Math.min(95, Math.max(50, parseInt(e.target.value) || 70)))}
                  className={`w-20 ${th.input} border ${th.inputBorder} rounded px-2 py-1 text-[11px] ${th.text} text-center focus:outline-none`} />
                <span className={`text-[9px] ${th.textFaint}`}>%</span>
                <div className="flex gap-1.5">
                  {[65, 70, 75, 80].map(v => (
                    <button key={v} onClick={() => setTPopMin(v)}
                      className={`text-[9px] px-2 py-0.5 rounded border transition-colors font-bold ${
                        tPopMin === v ? 'border-teal-500 text-teal-300 bg-teal-500/15' : `${th.border} ${th.textFaint}`
                      }`}>{v}%</button>
                  ))}
                </div>
              </div>
            </div>

            {/* OTM floor — hard reject below this % distance from spot. For IC,
                gates on the worse (tighter) side of put/call, matching the OTM%
                already shown in TargetedScanResultsPanel via calcTargetedEntryOtmPct. */}
            <div>
              <p className={`text-[8px] ${th.textFaint} tracking-widest mb-1.5`}>MIN OTM %</p>
              <div className="flex items-center gap-2">
                <input type="number" min={0} max={30} value={tOtmMin} onChange={e => setTOtmMin(Math.min(30, Math.max(0, parseFloat(e.target.value) || 0)))}
                  className={`w-20 ${th.input} border ${th.inputBorder} rounded px-2 py-1 text-[11px] ${th.text} text-center focus:outline-none`} />
                <span className={`text-[9px] ${th.textFaint}`}>%</span>
                <div className="flex gap-1.5">
                  {[4, 8, 12, 16, 20].map(v => (
                    <button key={v} onClick={() => setTOtmMin(v)}
                      className={`text-[9px] px-2 py-0.5 rounded border transition-colors font-bold ${
                        tOtmMin === v ? 'border-teal-500 text-teal-300 bg-teal-500/15' : `${th.border} ${th.textFaint}`
                      }`}>{v}%</button>
                  ))}
                </div>
              </div>
              <p className={`text-[8px] ${th.textFaint} mt-1`}>For Iron Condors, gates on the tighter of put/call side</p>
            </div>
          </div>
        )}

        <button onClick={() => {
          if (mode === 'targeted') {
            onRun(mode, undefined, { dteMin: tDteMin, dteMax: tDteMax, popMin: tPopMin, otmMin: tOtmMin, preset: tPreset });
          } else {
            onRun(mode, mode === 'filter' ? preset : undefined);
          }
        }}
          className="w-full ac-btn-solid text-white py-2.5 rounded-xl text-xs font-bold tracking-widest transition-colors shadow-lg border ac-border/30">
          RUN SCREENER →
        </button>
      </div>
    </ScanModalShell>
  );
}

function RulesModal({ stockRules, etfRules, rankConfig, onClose, onRun, th }: {
  stockRules: RulesType;
  etfRules: RulesType;
  rankConfig: RankConfig;
  onClose: () => void;
  onRun: (stockRules: RulesType, etfRules: RulesType, stockLabel: string, etfLabel: string, rankConfig: RankConfig) => void;
  th: typeof THEMES[Theme];
}) {
  const [stockEdited, setStockEdited] = useState<RulesType>({ ...stockRules });
  const [stockRaw, setStockRaw] = useState<Record<string, string>>(() => Object.fromEntries(Object.entries(stockRules).map(([k, v]) => [k, String(v)])));
  const [stockPreset, setStockPreset] = useState<string | null>(() => { try { return localStorage.getItem(LS_ACTIVE_PRESET); } catch { return null; } });
  const [etfEdited, setEtfEdited] = useState<RulesType>({ ...etfRules });
  const [etfRaw, setEtfRaw] = useState<Record<string, string>>(() => Object.fromEntries(Object.entries(etfRules).map(([k, v]) => [k, String(v)])));
  const [etfPreset, setEtfPreset] = useState<string | null>(() => { try { return localStorage.getItem(LS_ACTIVE_PRESET_ETF); } catch { return null; } });
  const [rankEdited, setRankEdited] = useState<RankConfig>({ ...rankConfig });

  const makeHandlers = (
    edited: RulesType,
    setEdited: React.Dispatch<React.SetStateAction<RulesType>>,
    setRaw: React.Dispatch<React.SetStateAction<Record<string, string>>>
  ) => ({
    onChange: (key: string, raw: string) => setRaw(prev => ({ ...prev, [key]: raw })),
    onBlur: (key: keyof RulesType, raw: string) => {
      const val = parseFloat(raw);
      if (!isNaN(val)) { setEdited(prev => ({ ...prev, [key]: val })); setRaw(prev => ({ ...prev, [key]: String(val) })); }
      else setRaw(prev => ({ ...prev, [key]: String(edited[key]) }));
    },
  });

  const stockHandlers = makeHandlers(stockEdited, setStockEdited, setStockRaw);
  const etfHandlers = makeHandlers(etfEdited, setEtfEdited, setEtfRaw);

  const applyPresetToStock = (p: typeof RULE_PRESETS[number]) => {
    const merged = { ...DEFAULT_RULES, ...p.rules };
    setStockEdited(merged); setStockRaw(Object.fromEntries(Object.entries(merged).map(([k, v]) => [k, String(v)])));
    setStockPreset(p.key); try { localStorage.setItem(LS_ACTIVE_PRESET, p.key); } catch {}
  };
  const applyPresetToEtf = (p: typeof RULE_PRESETS[number]) => {
    const merged = { ...DEFAULT_ETF_RULES, ...p.rules };
    setEtfEdited(merged); setEtfRaw(Object.fromEntries(Object.entries(merged).map(([k, v]) => [k, String(v)])));
    setEtfPreset(p.key); try { localStorage.setItem(LS_ACTIVE_PRESET_ETF, p.key); } catch {}
  };
  const handleResetStock = () => {
    setStockEdited({ ...DEFAULT_RULES }); setStockRaw(Object.fromEntries(Object.entries(DEFAULT_RULES).map(([k, v]) => [k, String(v)])));
    setStockPreset(null); try { localStorage.removeItem(LS_RULES); localStorage.removeItem(LS_ACTIVE_PRESET); } catch {}
  };
  const handleResetEtf = () => {
    setEtfEdited({ ...DEFAULT_ETF_RULES }); setEtfRaw(Object.fromEntries(Object.entries(DEFAULT_ETF_RULES).map(([k, v]) => [k, String(v)])));
    setEtfPreset(null); try { localStorage.removeItem(LS_RULES_ETF); localStorage.removeItem(LS_ACTIVE_PRESET_ETF); } catch {}
  };
  const handleResetRank = () => setRankEdited({ ...DEFAULT_RANK_CONFIG });

  const handleRun = () => {
    saveRulesToStorage(stockEdited); saveEtfRulesToStorage(etfEdited);
    try { localStorage.setItem(LS_RANK_CONFIG, JSON.stringify(rankEdited)); } catch {}
    const sLabel = stockPreset ? (RULE_PRESETS.find(p => p.key === stockPreset)?.label ?? 'Custom') : 'Custom';
    const eLabel = etfPreset ? (RULE_PRESETS.find(p => p.key === etfPreset)?.label ?? 'ETF Custom') : 'ETF Custom';
    onRun(stockEdited, etfEdited, sLabel, eLabel, rankEdited);
  };

  const RuleCol = ({ edited, raw, handlers, presetKey, onApplyPreset, onReset, isEtf }: {
    edited: RulesType; raw: Record<string, string>;
    handlers: { onChange: (k: string, v: string) => void; onBlur: (k: keyof RulesType, v: string) => void };
    presetKey: string | null; onApplyPreset: (p: typeof RULE_PRESETS[number]) => void; onReset: () => void; isEtf: boolean;
  }) => {
    const ri = (key: keyof RulesType, lbl?: string, hint?: string) => (
      <div>
        <RuleInput ruleKey={key} rawValues={raw} editedRules={edited} onRawChange={handlers.onChange} onBlur={handlers.onBlur} th={th} label={lbl} hint={hint} />
        <RangeIndicator
          value={edited[key] as number}
          strict={(RULE_PRESETS.find(p => p.key === 'strict')?.rules as any)?.[key]}
          course={(RULE_PRESETS.find(p => p.key === 'course')?.rules as any)?.[key]}
          relaxed={(RULE_PRESETS.find(p => p.key === 'relaxed')?.rules as any)?.[key]}
          lowvol={(RULE_PRESETS.find(p => p.key === 'lowvol')?.rules as any)?.[key]}
          fmt={(v) => String(v)}
        />
      </div>
    );
    return (
      <div className="flex-1 min-w-0">
        <div className={`px-4 py-2.5 border-b ${th.border} flex items-center justify-between ${isEtf ? 'bg-blue-500/5' : ''}`}>
          <div>
            <p className={`text-[10px] font-bold tracking-widest ${isEtf ? 'text-blue-400' : th.text}`}>{isEtf ? '🏦 ETF / INDEX' : '📈 STOCK'}</p>
            <p className={`text-[8px] ${th.textFaint} mt-0.5`}>{isEtf ? 'Auto-applied to ETFs & Indexes' : 'Auto-applied to individual stocks'}</p>
          </div>
          <button onClick={onReset} className="text-[8px] border border-yellow-700 text-yellow-600 px-2 py-0.5 rounded hover:bg-yellow-500/10 transition-colors">RESET</button>
        </div>
        <div className="px-4 py-2 border-b border-dashed border-slate-800">
          <p className="text-[8px] tracking-widest uppercase mb-1.5 opacity-40">Quick presets:</p>
          <div className="flex gap-1 flex-wrap">
            {RULE_PRESETS.map(p => (
              <button key={p.key} onClick={() => onApplyPreset(p)} title={p.desc}
                className={'px-2 py-1 rounded text-[8px] font-bold border transition-colors ' + (presetKey === p.key ? p.color : 'border-slate-700 text-slate-500 hover:border-slate-500')}>
                {p.label}
              </button>
            ))}
          </div>
        </div>
        <div className="px-4 py-3 space-y-3">
          <div>
            <p className={`text-[8px] ${th.textFaint} tracking-widest uppercase font-bold mb-2`}>① Volatility & Timing</p>
            <div className="grid grid-cols-2 gap-3">
              {ri('IVR_MIN','IVR Min %','Floor')}
              {ri('IVR_IC_MAX','IVR Max % (IC)','IC only')}
              {ri('DTE_MIN','DTE Min')}
              {ri('DTE_MAX','DTE Max')}
            </div>
          </div>
          <div>
            <p className={`text-[8px] ${th.textFaint} tracking-widest uppercase font-bold mb-2`}>② Delta</p>
            <div className="grid grid-cols-2 gap-3">
              {ri('SPREAD_DELTA_MIN','Spread δ Min')}
              {ri('SPREAD_DELTA_MAX','Spread δ Max')}
              {ri('IC_DELTA_MIN','IC δ Min')}
              {ri('IC_DELTA_MAX','IC δ Max')}
            </div>
          </div>
          <div>
            <p className={`text-[8px] ${th.textFaint} tracking-widest uppercase font-bold mb-2`}>③ Liquidity · Credit · Return</p>
            <div className="grid grid-cols-2 gap-3">
              {ri('OI_MIN','Min OI','Per leg')}
              {ri('BID_ASK_MAX','Max Bid-Ask','Per leg')}
              {ri('MAX_SPREAD_WIDTH','Max Width $','Optimizer cap')}
              {ri('CREDIT_RATIO_MIN','Min Credit Ratio','0.33=course')}
              {ri('ROC_MIN_SPREAD','Min ROC Spread')}
              {ri('ROC_MIN_IC','Min ROC IC')}
              {ri('POP_MIN','Min POP %')}
            </div>
          </div>
        </div>
      </div>
    );
  };

  const sl = (key: keyof RankConfig, label: string, hint: string, min: number, max: number, step = 1, fmt?: (v: number) => string) => (
    <Slider label={label} hint={hint} value={rankEdited[key] as number} min={min} max={max} step={step}
      fmt={fmt} onChange={v => setRankEdited(prev => ({ ...prev, [key]: v }))} th={th} />
  );

  const totalWeight = rankEdited.weightMomentum + rankEdited.weightIvr + rankEdited.weightRange + rankEdited.weightTechnical + rankEdited.weightLiquidity;


  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
      <div className={`${th.sidebar} border ${th.border} rounded-xl shadow-2xl w-full max-w-6xl max-h-[92vh] overflow-auto`}>
        <div className={`flex items-center justify-between px-6 py-4 border-b ${th.border}`}>
          <div>
            <h2 className="text-sm font-bold tracking-widest text-red-500">SCREENING RULES</h2>
            <p className={`text-[9px] ${th.textFaint} mt-0.5`}>Stock and ETF/Index rules apply automatically per ticker. Ranking config drives the score in Rank mode. Dots on inputs show preset positions.</p>
          </div>
          <button onClick={onClose} className={`${th.textFaint} hover:${th.text} text-lg`}>✕</button>
        </div>
        <div className="flex divide-x divide-slate-800">
          <RuleCol edited={stockEdited} raw={stockRaw} handlers={stockHandlers} presetKey={stockPreset} onApplyPreset={applyPresetToStock} onReset={handleResetStock} isEtf={false} />
          <RuleCol edited={etfEdited} raw={etfRaw} handlers={etfHandlers} presetKey={etfPreset} onApplyPreset={applyPresetToEtf} onReset={handleResetEtf} isEtf={true} />

          {/* Ranking config column */}
          <div className="w-72 shrink-0">
            <div className={`px-4 py-2.5 border-b ${th.border} flex items-center justify-between bg-purple-500/5`}>
              <div>
                <p className="text-[10px] font-bold tracking-widest text-purple-400">⬡ RANKING</p>
                <p className={`text-[8px] ${th.textFaint} mt-0.5`}>Scoring weights and thresholds</p>
              </div>
              <button onClick={handleResetRank} className="text-[8px] border border-yellow-700 text-yellow-600 px-2 py-0.5 rounded hover:bg-yellow-500/10 transition-colors">RESET</button>
            </div>
            <div className="px-4 py-3 space-y-4">
              <div>
                <div className="flex items-center justify-between mb-2">
                  <p className={`text-[8px] ${th.textFaint} tracking-widest uppercase font-bold`}>Scoring Weights</p>
                  <span className={`text-[8px] font-bold ${totalWeight === 100 ? 'text-emerald-400' : 'text-yellow-400'}`}>{totalWeight}/100 pts</span>
                </div>
                <div className="space-y-3">
                  {sl('weightMomentum',  'Momentum',   '14d trend strength + direction', 0, 40)}
                  {sl('weightIvr',       'IV Quality', 'IVR, peaks ~65, penalty >80',    0, 35)}
                  {sl('weightRange',     '52W Range',  'Price position vs strategy',     0, 30)}
                  {sl('weightTechnical', 'Technical',  'MA alignment + slope',           0, 25)}
                  {sl('weightLiquidity', 'Liquidity',  'OI + credit ratio quality',      0, 20)}
                </div>
              </div>
              <div>
                <p className={`text-[8px] ${th.textFaint} tracking-widest uppercase font-bold mb-3`}>DTE Sweet Spot</p>
                <div className="space-y-3">
                  {sl('dteSweetSpot', 'Center DTE',  'Full score at this DTE',         14, 45)}
                  {sl('dteRange',     '± Range',     'Days either side for full score', 1, 14)}
                </div>
              </div>
              <div>
                <p className={`text-[8px] ${th.textFaint} tracking-widest uppercase font-bold mb-3`}>Traffic Light Thresholds</p>
                <div className="space-y-3">
                  {sl('thresholdGreen',  '🟢 Green floor',  'Strong — take the trade',       40, 100)}
                  {sl('thresholdYellow', '🟡 Yellow floor', 'Acceptable — proceed with care', 20, 80)}
                  {sl('thresholdOrange', '🟠 Orange floor', 'Marginal — paper trade only',    10, 60)}
                </div>
                <p className={`text-[8px] ${th.textFaint} mt-2 leading-relaxed`}>🔴 Red = below orange floor. Earnings always blocks regardless of score.</p>
              </div>
            </div>
          </div>
        </div>
        <div className={`flex gap-3 px-6 py-4 border-t ${th.border}`}>
          <p className={`text-[9px] ${th.textFaint} flex-1 self-center`}>Stocks and ETFs/Indexes auto-apply their own rules. Ranking scores apply in Rank mode only. Dots on inputs show where each preset sits.</p>
          <button onClick={onClose} className={`border ${th.border} ${th.textMuted} py-2 px-4 rounded-lg text-xs tracking-widest ac-hover-border`}>CANCEL</button>
          <button onClick={handleRun} className="ac-btn-solid text-white py-2 px-6 rounded-lg text-xs font-bold tracking-widest transition-colors">RUN</button>
        </div>
      </div>
    </div>
  );
}

// ── Yahoo Finance getTrend vNext ────────────────────────────────────────────
// Yahoo Finance doesn't recognize cash-settled index tickers in their raw
// TastyTrade form — SPX/SPXW need ^GSPC, NDX needs ^NDX, etc. Without this
// translation, /api/chart returns ~0 closes for these symbols, getTrend
// throws "no bars", and the caller's catch-and-skip logic silently drops
// the index from results entirely — same map app/engine/page.tsx already
// uses for its own SPX/NDX/RUT/VIX chart lookups, kept in sync here.


// ── Best Opportunity Finder ────────────────────────────────────────────────
interface BestSetup {
  strategy: string;
  grade: 'A+' | 'A' | 'B' | 'C';
  setup: SpreadCandidate;
  score: number;
  notes: string[];
  result: ScreenResult;
}

interface LevelResult {
  presetKey: string;
  presetLabel: string;
  presetColor: string;
  rulesUsed: RulesType;
  ruleDiffs: string[];
  ranked: BestSetup[];
  failures: { strategy: string; reasons: string[] }[];
}

function getRuleDiffs(base: RulesType, relaxed: Partial<RulesType>): string[] {
  const labels: Record<string, string> = {
    IVR_MIN: 'IVR floor', OI_MIN: 'Min OI', BID_ASK_MAX: 'Max bid-ask',
    CREDIT_RATIO_MIN: 'Credit ratio', ROC_MIN_SPREAD: 'ROC spread', ROC_MIN_IC: 'ROC IC',
  };
  return Object.entries(relaxed)
    .filter(([k, v]) => base[k as keyof RulesType] !== v)
    .map(([k, v]) => {
      const label = labels[k] || k;
      const from = base[k as keyof RulesType];
      return `${label}: ${from} → ${v}`;
    });
}

function BestOpportunityFinder({
  symbol, onClose, th, rules, preferredStrategy, cachedEntry, onTrade, originalDte,
}: {
  symbol: string; onClose: () => void; th: typeof THEMES[Theme];
  rules: RulesType; preferredStrategy?: 'BPS' | 'BCS' | 'IC';
  cachedEntry?: RawScanEntry;
  onTrade?: (result: ScreenResult) => void;
  originalDte?: number;
}) {
  const [loading, setLoading] = useState(false);
  const [levelResults, setLevelResults] = useState<LevelResult[]>([]);
  const [error, setError] = useState('');

  // TE-0007D corrective — this used to be a second, hand-maintained preset
  // array (presetKey/presetLabel/presetColor/rules) with values duplicated
  // from the canonical RULE_PRESETS above by hand. Confirmed via the
  // fetch/scan/view filter audit: both arrays held identical numeric rule
  // values today, but nothing enforced that -- editing RULE_PRESETS wouldn't
  // have touched this copy. Rule values are now derived from RULE_PRESETS,
  // so there is exactly one source of truth for the numbers. Color classes
  // are intentionally kept local and NOT consolidated: RULE_PRESETS uses
  // -600 shades with background fills (for its own settings-modal usage),
  // while this component's buttons have always used lighter -500 borders
  // with no background. Silently adopting RULE_PRESETS' colors here would
  // be an undiscussed visual change outside this cleanup's scope.
  const PRESET_COLORS_LOCAL: Record<string, string> = {
    strict: 'border-red-500 text-red-400',
    course: 'ac-btn',
    relaxed: 'border-emerald-500 text-emerald-400',
    lowvol: 'border-yellow-500 text-yellow-400',
    shortterm: 'border-orange-500 text-orange-400',
    intermediate: 'border-amber-500 text-amber-400',
  };
  const COURSE_RULES = RULE_PRESETS.find(p => p.key === 'course')!.rules;
  const levels = RULE_PRESETS.map(p => ({
    presetKey: p.key,
    presetLabel: p.label,
    presetColor: PRESET_COLORS_LOCAL[p.key] ?? p.color,
    rules: p.rules,
  }));

  const scoreCandidateLocal = (result: ScreenResult, strat: string): BestSetup | null => {
    if (!result.qualified || !result.bestCandidate) return null;
    const c = result.bestCandidate;
    const cfg = getSavedRankConfig();
    const scored = scoreCandidate(result, cfg);
    const score = scored?.score ?? 0;
    let grade: BestSetup['grade'] = 'C';
    if (score >= 70) grade = 'A+'; else if (score >= 55) grade = 'A'; else if (score >= 40) grade = 'B';
    const notes: string[] = [];
    if (c.dte < 35) notes.push(`DTE is ${c.dte} — shorter side, watch 21 DTE closely`);
    if (c.dte < 29) notes.push(`⚠ Short term setup — active daily management required, gamma risk elevated`);
    if (result.ivr && result.ivr > 60) notes.push(`IVR ${result.ivr.toFixed(0)}% elevated — verify no binary event`);
    if (result.ivr && result.ivr < 35) notes.push(`IVR ${result.ivr.toFixed(0)}% — low volatility environment, premium is thin, size down or wait`);
    else if (result.ivr && result.ivr < 50) notes.push(`IVR ${result.ivr.toFixed(0)}% — moderate volatility, grade reflects reduced premium opportunity`);
    if (c.creditRatio > 0.45) notes.push(`Excellent credit ratio at ${(c.creditRatio * 100).toFixed(0)}% of width`);
    if (notes.length === 0) notes.push('Clean setup — all rules pass');
    return { strategy: strat, grade, setup: c, score, notes, result };
  };

  const strategiesToRun: ('BPS' | 'BCS' | 'IC')[] = preferredStrategy
    ? [preferredStrategy]
    : ['BPS', 'BCS', 'IC'];

  const findBest = async () => {
    setLoading(true); setError(''); setLevelResults([]);
    try {
      const token = await getAccessToken();
      const [metricsArray, fetchedPrice] = await Promise.all([getMarketMetrics([symbol], token), getQuote(symbol, token)]);
      const metrics = metricsArray[0] || { symbol, ivRank: null, earningsExpectedDate: null };
      const price = fetchedPrice;
      const baseChainData = await getChain(symbol, token, {
        ...rules,
        DTE_MIN: RANK_SCAN_DTE_MIN,
        DTE_MAX: RANK_SCAN_DTE_MAX,
      });
      const results: LevelResult[] = [];
      for (const level of levels) {
        const mergedRules = { ...rules, ...level.rules };
        const ruleDiffs = getRuleDiffs({ ...DEFAULT_RULES, ...COURSE_RULES }, level.rules);
        const candidates: BestSetup[] = [];
        const failures: { strategy: string; reasons: string[] }[] = [];
        for (const strat of strategiesToRun) {
          const checklistResults = runChecklistAllExpirations(
            symbol,
            strat,
            metrics,
            baseChainData,
            price,
            mergedRules,
            undefined,
            level.presetLabel,
            getSavedEtfRules(),
            level.presetLabel,
            level.presetKey === 'strict'
          );

          const rankedResults = checklistResults
            .filter(r => r.bestCandidate)
            .map(r => ({
              result: r,
              scored: scoreCandidate(r, getSavedRankConfig())
            }))
            .sort((a, b) => (b.scored?.score ?? 0) - (a.scored?.score ?? 0));

          if (rankedResults.length > 0) {
            const bestResult = rankedResults[0].result;
            const setup = scoreCandidateLocal(bestResult, strat);
            if (setup) {
              candidates.push(setup);
              continue;
            }
          }

          const diagnostic = runChecklist(symbol, strat, metrics, baseChainData, price, mergedRules);
          failures.push({
            strategy: strat,
            reasons: diagnostic.failReasons.length > 0 ? diagnostic.failReasons : ['No qualifying strikes found']
          });
        }
        results.push({ presetKey: level.presetKey, presetLabel: level.presetLabel, presetColor: level.presetColor, rulesUsed: mergedRules, ruleDiffs, ranked: candidates.sort((a, b) => b.score - a.score), failures });
      }

      // Prefer similar expirations to the original card (±8 DTE)
      let finalResults = results;
      if (originalDte != null) {
        finalResults = results
          .map(level => {
            const similar = level.ranked.filter(setup => Math.abs(setup.setup.dte - originalDte) <= 8);
            return {
              ...level,
              ranked: similar.length > 0 ? similar : level.ranked.slice(0, 1),
            };
          })
          .filter(level => level.ranked.length > 0);
      }

      setLevelResults(finalResults);
    } catch (e: any) {
      setError(e.message || 'Failed to analyze chain');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    findBest();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const gradeColor = (g: string) => g === 'A+' ? 'text-emerald-400' : g === 'A' ? 'text-emerald-500' : g === 'B' ? 'text-yellow-400' : 'text-orange-400';

  return (
    <div className="fixed inset-0 bg-black flex items-center justify-center z-[60] p-4">
      <div className={`${th.sidebar} border ${th.border} rounded-2xl w-full max-w-2xl max-h-[92vh] flex flex-col overflow-hidden`}>
        <div className="px-6 pt-6 pb-4 shrink-0">
          <div className="flex justify-between items-start mb-4">
            <div>
              <h2 className={`text-lg font-bold ${th.text}`}>Find Better — {symbol}</h2>
              <p className={`text-[9px] ${th.textFaint} mt-0.5`}>
                Similar DTE to original card. Tests rule levels with live data.
              </p>
            </div>
            <button onClick={onClose} className="text-2xl text-slate-400 hover:text-white ml-4">✕</button>
          </div>

          <button onClick={findBest} disabled={loading}
            className="w-full py-3.5 bg-emerald-600 hover:bg-emerald-500 disabled:bg-slate-700 rounded-xl font-bold text-sm tracking-widest transition-colors">
            {loading ? 'ANALYZING LIVE DATA...' : '↺ RE-ANALYZE (LIVE)'}
          </button>

          {error && <div className="p-4 bg-red-500/10 border border-red-500 rounded-xl text-red-400 text-sm mt-3">{error}</div>}
        </div>

        <div className="overflow-y-auto flex-1 px-6 pb-6">
          <div className="space-y-4">
            {levelResults.map(level => (
              <div key={level.presetKey} className={`border ${th.border} rounded-xl overflow-hidden`}>
                <div className={`flex items-center justify-between px-4 py-2.5 border-b ${th.border} ${th.card}`}>
                  <div className="flex items-center gap-2">
                    <span className={`text-[10px] font-bold tracking-widest px-2 py-0.5 border rounded ${level.presetColor}`}>{level.presetLabel.toUpperCase()}</span>
                    {level.ruleDiffs.length === 0 ? (
                      <span className={`text-[9px] ${th.textFaint}`}>Course baseline — no changes</span>
                    ) : level.presetKey === 'strict' ? (
                      <span className="text-[9px] text-red-400">Tighter: {level.ruleDiffs.join(' · ')}</span>
                    ) : level.presetKey === 'shortterm' ? (
                      <span className="text-[9px] text-orange-400">7–14 DTE · very active daily management</span>
                    ) : level.presetKey === 'intermediate' ? (
                      <span className="text-[9px] text-amber-400">15–29 DTE · active management</span>
                    ) : (
                      <span className="text-[9px] text-yellow-400">Relaxed vs Course: {level.ruleDiffs.join(' · ')}</span>
                    )}
                  </div>
                  {level.ranked.length > 0
                    ? <span className={`text-[10px] ${th.textFaint}`}>{level.ranked.length} setup{level.ranked.length !== 1 ? 's' : ''} found</span>
                    : <span className="text-[10px] text-slate-500">No setup found</span>}
                </div>

                {level.ranked.length > 0 ? (
                  <div className="divide-y divide-[inherit]" style={{ borderColor: 'inherit' }}>
                    {level.ranked.map((setup, idx) => (
                      <div key={setup.strategy} className={`p-4 ${idx === 0 ? '' : 'opacity-80'}`}>
                        <div className="flex items-center justify-between mb-3">
                          <div className="flex items-center gap-2">
                            <span className={`text-[10px] font-bold w-5 h-5 rounded-full flex items-center justify-center border ${idx === 0 ? 'border-emerald-500 text-emerald-400' : idx === 1 ? 'border-slate-500 text-slate-400' : 'border-slate-700 text-slate-500'}`}>{idx + 1}</span>
                            <span className={`text-xs font-bold px-2 py-0.5 border rounded ${setup.strategy === 'BPS' ? 'text-emerald-400 border-emerald-700' : setup.strategy === 'BCS' ? 'text-red-400 border-red-700' : 'text-blue-400 ac-border-faint'}`}>{setup.strategy}</span>
                            {preferredStrategy && setup.strategy !== preferredStrategy && (
                              <span className="text-[9px] px-2 py-0.5 rounded border border-yellow-600/60 bg-yellow-500/10 text-yellow-400 font-bold">⚠ contradicts {preferredStrategy} box</span>
                            )}
                            <span className={`text-xs font-bold ${gradeColor(setup.grade)}`}>Grade {setup.grade}</span>
                            <span className={`text-[9px] ${th.textFaint}`}>score {Math.round(setup.score)}/100</span>
                          </div>
                         <button
                            onClick={() => {
                              // Try the real handler first
                              if (typeof onTrade === 'function' && setup.result) {
                                onTrade(setup.result);
                                onClose();
                                return;
                              }
                          
                              // Fallback: manually trigger the global trade flow if possible
                              // This helps when onTrade wasn't passed properly from Targeted mode
                              if (setup.result && setup.result.bestCandidate) {
                                // Try to find the global setTradeResult if it exists on window (dev helper)
                                const globalSetTrade = (window as any).__setTradeResult;
                                if (typeof globalSetTrade === 'function') {
                                  globalSetTrade(setup.result);
                                  onClose();
                                  return;
                                }
                              }
                          
                              // Last resort: show details
                              const strikesStr = setup.strategy === 'IC' && setup.setup.shortCallStrike != null
                                ? `Puts: ${setup.setup.shortStrike}/${setup.setup.longStrike} · Calls: ${setup.setup.shortCallStrike}/${setup.setup.longCallStrike}`
                                : `${setup.setup.shortStrike}/${setup.setup.longStrike}`;
                              
                              alert(`${setup.strategy} ${symbol} [${level.presetLabel} rules]\nExp: ${setup.setup.expiration} (${setup.setup.dte}d)\nStrikes: ${strikesStr}\nCredit: $${(setup.setup.totalCredit ?? setup.setup.credit).toFixed(2)}`);
                            }}
                            className="text-[9px] px-2 py-1 border border-emerald-600 text-emerald-400 rounded hover:bg-emerald-600/10 transition-colors font-medium tracking-wider"
                          >
                            TRADE →
                          </button>
                        </div>
                        <div className="grid grid-cols-4 gap-3 mb-2">
                          <div><p className={`text-[9px] ${th.textFaint} uppercase tracking-wider`}>Expiry</p><p className={`text-xs font-bold ${th.text}`}>{setup.setup.expiration} <span className="text-slate-500">({setup.setup.dte}d)</span></p></div>
                          <div>
                            <p className={`text-[9px] ${th.textFaint} uppercase tracking-wider`}>Strikes</p>
                            {setup.strategy === 'IC' && setup.setup.shortCallStrike != null ? (
                              <p className={`text-xs font-bold ${th.text}`}>{setup.setup.shortStrike}/{setup.setup.longStrike} · {setup.setup.shortCallStrike}/{setup.setup.longCallStrike}</p>
                            ) : (
                              <p className={`text-xs font-bold ${th.text}`}>{setup.setup.shortStrike}/{setup.setup.longStrike}</p>
                            )}
                          </div>
                          <div><p className={`text-[9px] ${th.textFaint} uppercase tracking-wider`}>Credit</p><p className="text-xs font-bold text-emerald-400">${(setup.setup.totalCredit ?? setup.setup.credit).toFixed(2)}</p></div>
                          <div><p className={`text-[9px] ${th.textFaint} uppercase tracking-wider`}>ROC / POP</p><p className={`text-xs font-bold ${th.text}`}>{setup.setup.roc.toFixed(0)}% / {setup.setup.pop?.toFixed(0) ?? '—'}%</p></div>
                        </div>
                        <div className="grid grid-cols-3 gap-3 mb-2">
                          <div><p className={`text-[9px] ${th.textFaint} uppercase tracking-wider`}>50% Target</p><p className="text-xs font-bold text-emerald-400">${((setup.setup.totalCredit ?? setup.setup.credit) * 0.5).toFixed(2)}</p></div>
                          <div><p className={`text-[9px] ${th.textFaint} uppercase tracking-wider`}>Credit Ratio</p><p className={`text-xs font-bold ${th.text}`}>{(setup.setup.creditRatio * 100).toFixed(0)}% of width</p></div>
                          <div><p className={`text-[9px] ${th.textFaint} uppercase tracking-wider`}>OI Short/Long</p>
                            {setup.strategy === 'IC' && setup.setup.shortCallStrike != null ? (
                              <p className={`text-xs font-bold ${th.text}`}>Put: {setup.setup.shortOI}/{setup.setup.longOI} · Call: {setup.setup.shortOI}/{setup.setup.longOI}</p>
                            ) : (
                              <p className={`text-xs font-bold ${th.text}`}>{setup.setup.shortOI} / {setup.setup.longOI}</p>
                            )}
                          </div>
                        </div>
                        <p className={`text-[9px] ${th.textFaint}`}>{setup.notes[0]}</p>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="px-4 py-3 space-y-1.5">
                    {level.failures.map(f => (
                      <div key={f.strategy} className="flex items-start gap-2">
                        <span className={`text-[9px] px-1.5 py-0.5 border rounded font-bold shrink-0 ${f.strategy === 'BPS' ? 'text-emerald-400 border-emerald-800' : f.strategy === 'BCS' ? 'text-red-400 border-red-800' : 'text-blue-400 border-blue-800'}`}>{f.strategy}</span>
                        <p className={`text-[9px] ${th.textFaint}`}>{f.reasons.join(' · ')}</p>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Raw Scan Cache ─────────────────────────────────────────────────────────

// ── Targeted Scan Runner ──────────────────────────────────────────────────
async function runTargetedScan(
  symbols: string[],
  dteMin: number, dteMax: number, popMin: number, otmMin: number,
  rules: RulesType, etfRules: RulesType, rankConfig: RankConfig,
  setLoading: (v: boolean) => void, setStatus: (v: string) => void, setError: (v: string) => void,
  setTargetedResults: (v: TargetedScanEntry[]) => void,
  setTargetedResultsCachedAt: (v: number | null) => void,
  cancelRef: React.MutableRefObject<boolean>,
  // SCREENER-RESULTS-0001 — this function lives outside the Home() component
  // and so cannot close over its `activeSession` state/ref directly; the
  // two session-lifecycle entry points it needs are passed in instead. The
  // pure transition functions themselves (recordSymbolEvaluated, etc.) are
  // plain module-level imports and are called directly below, same as any
  // other caller in this file.
  beginSession: (scope: ScreenerScanScope) => ScreenerScanSession,
  commitSession: (session: ScreenerScanSession, onCommit?: () => void) => boolean,
  // SCREENER-RESULTS-0001 corrective — same staleness guard used by every
  // in-component scan function (isScanCurrent): a superseded Targeted scan's
  // catch/finally must not clobber a newer scan's shared loading/status/
  // error UI. Passed in for the same closure reason as beginSession/
  // commitSession above.
  isCurrent: (session: ScreenerScanSession | null) => boolean,
): Promise<void> {
  // PMCC excluded — different philosophy, not a spread strategy.
  // `primary` is a fallback label only — actual strategy exploration below
  // tries BPS/BCS/IC per ticker regardless, and live trend (fetched per
  // symbol) takes precedence over this label wherever it's available.
  const strategyMap: { symbol: string; primary: 'BPS' | 'BCS' | 'IC' }[] =
    Array.from(new Set(symbols)).map(symbol => ({ symbol, primary: 'IC' as const }));
  const allSymbols = Array.from(new Set(strategyMap.map(e => e.symbol)));

  if (allSymbols.length === 0) { setError('No active tickers in watchlist.'); return; }
  setError(''); setLoading(true); setTargetedResults([]); setTargetedResultsCachedAt(null);
  idbDel(IDB_TARGETED_RESULTS_KEY);
  try { localStorage.removeItem(LS_TARGETED_RESULTS_CACHE_AT); } catch {}
  cancelRef.current = false;

  startScreenerJob({
    kind: 'targeted', label: 'Targeted screener scan', total: strategyMap.length,
    status: 'Starting targeted scan...', resultsHref: '/screener?mode=targeted',
  });
  // Bridges progress into the app-level job store (survives navigating off
  // this page — see RankedScanTaskMirror for the same pattern on Rank mode)
  // in addition to the local status text this page already renders.
  const pushStatus = (label: string) => { setStatus(label); updateScreenerJob({ status: label, phase: 'running' }); };

  // SCREENER-RESULTS-0001 — 'spreads' session, targeted mode. No capacity-
  // style eligibility gate, so eligibleSymbols === the universe. Targeted's
  // OWN existing rendering (`entries`/`setTargetedResults`, unchanged below)
  // remains the source of the rich per-candidate cards this mode has always
  // shown; the session is a PARALLEL authoritative accounting record — see
  // the ticket's explicit instruction that Targeted keeps its established
  // filters/ordering unchanged.
  let session = beginSession({ universeSymbols: symbols, eligibleSymbols: symbols });
  const loopSymbols = session.plannedScanSymbols;
  let wasCancelled = false;

  try {
    const token = await getAccessToken();
    pushStatus('Fetching market metrics...');
    const metricsArray = await getMarketMetrics(loopSymbols, token);
    const metricsMap = Object.fromEntries(metricsArray.map((m: any) => [m.symbol, m]));

    const entries: TargetedScanEntry[] = [];

    for (let i = 0; i < loopSymbols.length; i++) {
      if (cancelRef.current) {
        pushStatus(`Stopped — ${entries.length} results loaded`);
        wasCancelled = true;
        break;
      }
      const symbol = loopSymbols[i];
      const primary: 'BPS' | 'BCS' | 'IC' = 'IC';
      pushStatus(`Scanning ${symbol} (${i + 1}/${loopSymbols.length})...`);
      updateScreenerJob({ progressCurrent: i + 1 });
      const entriesBeforeThisSymbol = entries.length;
      let symbolThrew = false;
      try {
        const classification = await classifyUnderlying(symbol, token);
        const isEtf = classification === 'index' || classification === 'etf';
        // Use real rules but with user-specified DTE range
        const appliedRules: RulesType = { ...(isEtf ? etfRules : rules), DTE_MIN: dteMin, DTE_MAX: dteMax };
        const chainRules: RulesType = {
          ...(isEtf ? etfRules : rules),
          DTE_MIN: RANK_SCAN_DTE_MIN,
          DTE_MAX: RANK_SCAN_DTE_MAX,
        };
        
        const [chainData, price] = await Promise.all([
          getChain(symbol, token, chainRules),
          getQuote(symbol, token),
        ]);
        const metrics = metricsMap[symbol] || { symbol, ivRank: null, earningsExpectedDate: null };
        let trendResult: TrendResult | undefined;
        try { trendResult = await getTrend(symbol, isEtf); } catch {}

        const validExps = chainData.expirations.filter(exp => {
          const dte = daysUntil(exp);
          return dte >= dteMin && dte <= dteMax;
        });

        for (const exp of validExps) {
          const dte = daysUntil(exp);
          const singleExpChain = { ...chainData, expirations: [exp] };
          const chainItems = chainData.chains[exp] ?? [];
          // Use trend to determine recommended strategy — not the ticker box
          // Fall back to box strategy if trend is NO_TRADE or unavailable
          const trendStrategy: 'BPS' | 'BCS' | 'IC' =
            trendResult?.strategy === 'BPS' || trendResult?.strategy === 'BCS' || trendResult?.strategy === 'IC'
              ? trendResult.strategy : primary;

          const strategies: ('BPS' | 'BCS' | 'IC')[] = ['BPS', 'BCS', 'IC'];

          for (const strat of strategies) {
            try {
              const optType = strat === 'BPS' ? 'P' : 'C';
              const legs = chainItems.filter((o: any) =>
                o.expirationDate === exp && o.optionType === (strat === 'IC' ? undefined : optType)
              );

              // For IC use the single unfiltered best — ICs are composite
              if (strat === 'IC') {
                const candidate = findBestICUnfiltered(chainItems, exp, price);
                if (!candidate || (candidate.pop ?? 0) < popMin) continue;
                if (candidate.dte < dteMin || candidate.dte > dteMax) continue;
                // OTM floor — IC gates on the tighter (worse) side of put/call,
                // matching calcTargetedEntryOtmPct's display formula.
                if (price != null && price > 0 && candidate.shortCallStrike != null) {
                  const putOtmPct = ((price - candidate.shortStrike) / price) * 100;
                  const callOtmPct = ((candidate.shortCallStrike - price) / price) * 100;
                  if (Math.min(putOtmPct, callOtmPct) < otmMin) continue;
                }
                const result = runChecklist(symbol, strat, metrics, singleExpChain, price, appliedRules, trendResult, undefined, isEtf ? etfRules : undefined, undefined, true);
                const displayResult: ScreenResult = {
                  ...result,
                  bestCandidate: result.bestCandidate ?? candidate,
                  qualified: result.checks.roc.status === 'pass' && result.checks.oi.status !== 'fail',
                  failReasons: result.failReasons.filter(r => !r.includes('qualifying strikes') && !r.includes('No 30-45 DTE')),
                };
                const scored = scoreCandidate(displayResult, rankConfig);
                const cachedEntry: RawScanEntry = { symbol, strategy: strat, metrics, chainData, price, trendResult };
                entries.push({
                  symbol, primaryStrategy: trendStrategy, expiration: exp, dte, strategy: strat,
                  candidate, screenResult: displayResult, pop: candidate.pop ?? 0,
                  score: scored?.score ?? 0, ivr: metrics.ivRank ?? null, price, isEtf, trendResult, cachedEntry,
                  allStrategies: [],
                });
                continue;
              }

              // For BPS/BCS: one entry per unique short strike that meets POP floor
              const putCallLegs = chainItems.filter((o: any) => o.expirationDate === exp && o.optionType === optType);
              const stepSize = price == null ? 5 : price >= 2000 ? 25 : 5;
              const maxWidth = price == null ? 100 : Math.min(price * 0.15, 500);

              // Collect all unique qualifying short strikes
              const seenStrikes = new Set<number>();

              for (const shortLeg of putCallLegs) {
                const delta = shortLeg.delta; if (delta == null) continue;
                const absDelta = Math.abs(delta);
                if (absDelta < 0.05 || absDelta > 0.60) continue;
                // POP is calculated after credit/width are known.
                if (seenStrikes.has(shortLeg.strikePrice)) continue;
                seenStrikes.add(shortLeg.strikePrice);

                // OTM floor — depends only on short strike + spot, not spread width,
                // so gate here once per short strike rather than per-width below.
                if (price != null && price > 0) {
                  const otmPct = strat === 'BPS'
                    ? ((price - shortLeg.strikePrice) / price) * 100
                    : ((shortLeg.strikePrice - price) / price) * 100;
                  if (otmPct < otmMin) continue;
                }

                // Find best long leg for this short strike (best credit ratio within maxWidth)
                let bestCandidate: SpreadCandidate | null = null;
                let bestCreditRatio = -1;
                for (let width = stepSize; width <= maxWidth; width += stepSize) {
                  const longStrike = strat === 'BPS' ? shortLeg.strikePrice - width : shortLeg.strikePrice + width;
                  const longLeg = putCallLegs.find((o: any) => Math.abs(o.strikePrice - longStrike) < 0.01);
                  if (!longLeg) continue;
                  const credit = parseFloat((shortLeg.mid - longLeg.mid).toFixed(2));
                  if (credit <= 0) continue;
                  const creditRatio = credit / width;
                  const maxLoss = width - credit;
                  const roc = maxLoss > 0 ? (credit / maxLoss) * 100 : 0;
                  
                  const ivForPop =
                    normalizeIv(metrics.expirationIvxMap?.[exp]) ??
                    normalizeIv(metrics.ivx) ??
                    normalizeIv(metrics.ivx30) ??
                    normalizeIv(shortLeg.iv);
                  
                  const modelPop = calcSpreadPop(
                    strat,
                    price,
                    shortLeg.strikePrice,
                    credit,
                    daysUntil(exp),
                    ivForPop
                  );
                  
                  if (modelPop == null) continue;
                  
                  const pop = modelPop;
                  if (pop < popMin) continue;
                  
                  if (creditRatio > bestCreditRatio) {
                    bestCreditRatio = creditRatio;
                    bestCandidate = {
                    strategy: strat,
                    expiration: exp,
                    dte: daysUntil(exp),
                    shortStrike: shortLeg.strikePrice,
                    longStrike,
                    shortDelta: absDelta,
                    shortOI: shortLeg.openInterest ?? 0,
                    longOI: longLeg.openInterest ?? 0,
                    credit,
                    spreadWidth: width,
                    creditRatio,
                    roc,
                    pop,
                    optimized: false,
                    shortOccSymbol: shortLeg.occSymbol,
                    longOccSymbol: longLeg.occSymbol,
                    shortIv: normalizeIv(shortLeg.iv),
                    expirationIvx: normalizeIv(metrics.expirationIvxMap?.[exp]) ?? null,
                    expectedMove: null,
                  };
                  }
                }
                if (!bestCandidate) continue;
                // Hard guard — never push entries outside user's DTE range
                if (bestCandidate.dte < dteMin || bestCandidate.dte > dteMax) continue;

                // Build display result with this specific candidate
                const syntheticChain = {
                  ...chainData,
                  expirations: [exp],
                  chains: { [exp]: chainItems },
                };
                const result = runChecklist(symbol, strat, metrics, syntheticChain, price, appliedRules, trendResult, undefined, isEtf ? etfRules : undefined, undefined, true);
                const displayResult: ScreenResult = {
                  ...result,
                  bestCandidate: bestCandidate,  // always our specific strike, never runChecklist's pick
                  qualified: result.checks.roc.status === 'pass' && result.checks.oi.status !== 'fail',
                  failReasons: result.failReasons.filter(r => !r.includes('qualifying strikes') && !r.includes('No 30-45 DTE')),
                  checks: {
                    ...result.checks,
                    credit: { status: 'pass', value: `$${bestCandidate.credit.toFixed(2)}`, reason: `${(bestCandidate.creditRatio * 100).toFixed(0)}% of width` },
                    delta: { status: 'pass', value: bestCandidate.shortDelta.toFixed(2), reason: 'Short leg delta' },
                    pop: { status: 'pass', value: `${(bestCandidate.pop ?? 0).toFixed(0)}%`, reason: `≥ ${popMin}% gate` },
                    roc: {
                      status: bestCandidate.roc >= appliedRules.ROC_MIN_SPREAD ? 'pass' : 'fail',
                      value: `${bestCandidate.roc.toFixed(0)}%`,
                      reason: `Min ${appliedRules.ROC_MIN_SPREAD}%`,
                    },                    
                    oi: (() => {
                      // Gate on the SHORT leg only -- it's the one traded twice
                      // (open + close) and the one carrying assignment risk. The
                      // long leg is protection that typically only transacts as
                      // part of the same combo order, so its OI alone rarely
                      // blocks a clean fill the way thin short-leg OI does.
                      const shortLegOi = bestCandidate.shortOI;

                      return {
                        status: shortLegOi >= appliedRules.OI_MIN ? 'pass' as const : 'fail' as const,
                        value: `${bestCandidate.shortOI}/${bestCandidate.longOI}`,
                        reason: shortLegOi >= appliedRules.OI_MIN
                          ? `Short leg ≥ ${appliedRules.OI_MIN}`
                          : `Below OI floor ${appliedRules.OI_MIN} on short leg`,
                      };
                    })(),
                  },
                };
                const scored = scoreCandidate(displayResult, rankConfig);
                const cachedEntry: RawScanEntry = { symbol, strategy: strat, metrics, chainData, price, trendResult };

                entries.push({
                  symbol, primaryStrategy: trendStrategy, expiration: exp, dte, strategy: strat,
                  candidate: bestCandidate, screenResult: displayResult,
                  pop: bestCandidate.pop ?? 0, score: scored?.score ?? 0,
                  ivr: metrics.ivRank ?? null, price, isEtf, trendResult, cachedEntry,
                  allStrategies: [],
                });
              }
            } catch {}
          }
        }
      } catch (e: any) {
        console.warn(`Targeted scan error for ${symbol}: ${e.message}`);
        symbolThrew = true;
      }

      // SCREENER-RESULTS-0001 — exactly one canonical outcome per symbol,
      // aggregating however many (expiration × strategy) entries this
      // symbol's nested loop produced. A throw partway through does NOT
      // discard candidates already found for this symbol — real, valid
      // candidates are recorded as a real evaluation, never mislabeled as a
      // failure just because a LATER expiration/strategy combination for
      // the same symbol errored.
      const symbolEntries = entries.slice(entriesBeforeThisSymbol);
      if (symbolEntries.length > 0) {
        session = recordSymbolEvaluated(session, symbol, symbolEntries.map(en => en.screenResult));
      } else if (symbolThrew) {
        session = recordSymbolFailed(session, symbol, 'MARKET_DATA_REQUEST_FAILED');
      } else {
        session = recordSymbolEvaluated(session, symbol, [], { reasonCode: 'NO_QUALIFYING_CANDIDATE' });
      }
    }

    entries.sort((a, b) => b.score - a.score);
    session = wasCancelled ? stopSession(session, 'CANCELLED') : completeSession(session);
    const finalSession = session;
    const committed = commitSession(finalSession, () => {
      setTargetedResults(entries);
      const cacheTs = Date.now();
      setTargetedResultsCachedAt(cacheTs);
      // SCREENER-RESULTS-0001 final corrective — tagged with the owning
      // session's sessionId, same rationale as rawScanCache above: on
      // restore, a valid canonical Targeted session must not be paired with
      // a DIFFERENT Targeted run's rich TargetedScanEntry[] cards just
      // because both happen to be sitting in IndexedDB.
      idbSet(IDB_TARGETED_RESULTS_KEY, { sessionId: finalSession.sessionId, entries });
      try { localStorage.setItem(LS_TARGETED_RESULTS_CACHE_AT, String(cacheTs)); } catch {}
      persistScanSession(finalSession);
      completeScreenerJob({
        resultCount: entries.length,
        status: `${entries.length} targeted result${entries.length === 1 ? '' : 's'} ready`,
        resultsHref: '/screener?mode=targeted',
      });
    });
    void committed;
  } catch (e: any) {
    // SCREENER-RESULTS-0001 corrective — same staleness guard as the other
    // scan functions: a superseded Targeted scan's catch must not clobber
    // a newer scan's loading/status/error/job state.
    if (isCurrent(session)) {
      setError(e.message);
      failScreenerJob(e.message);
    }
    if (session.status === 'running') {
      try {
        const reasonCode: ScreenerReasonCode = /token/i.test(e?.message ?? '') ? 'ACCESS_TOKEN_UNAVAILABLE' : 'MARKET_DATA_REQUEST_FAILED';
        commitSession(errorSession(session, reasonCode));
      } catch { /* session already terminal */ }
    }
  } finally {
    if (isCurrent(session)) {
      setStatus(''); setLoading(false);
    }
  }
}

function calcTargetedEntryOtmPct(entry: TargetedScanEntry): number | null {
  const c = entry.candidate;
  const price = entry.price;

  if (!c || price == null || price <= 0) return null;

  if (c.strategy === 'BPS') {
    return ((price - c.shortStrike) / price) * 100;
  }

  if (c.strategy === 'BCS') {
    return ((c.shortStrike - price) / price) * 100;
  }

  if (c.strategy === 'IC') {
    const putOtm = ((price - c.shortStrike) / price) * 100;
    const callStrike = c.shortCallStrike ?? null;

    if (callStrike == null) return putOtm;

    const callOtm = ((callStrike - price) / price) * 100;
    return Math.min(putOtm, callOtm);
  }

  return null;
}

// TE-0007H — extracted from PmccResultCard's own inline computation so
// the per-ticker summary group (below) and each individual card are
// mathematically guaranteed to agree, never a separately-maintained
// copy that could quietly drift. Same real reasoning as when this
// formula was first built: uses THIS pair's own shortLeg.dte as the
// cycle length (self-consistent with what's shown on the card), never
// a separate assumed constant.
function pmccAnnualizedRoi(result: ScreenResult): number | null {
  const pair = result.pmccPair;
  const metrics = pair?.metrics;
  return metrics && pair && pair.shortLeg.dte > 0
    ? metrics.shortCreditToNetDebitPct * (365 / pair.shortLeg.dte)
    : null;
}

// SCREENER-OI-0001 — maps a real SpreadCandidate/ScreenResult strategy
// string onto the canonical OiStrategy union. Every strategy the Screener
// actually produces candidates for today (CSP/CC/BPS/BCS/IC/PMCC) maps
// 1:1 by identical string value. Returns null for anything else (defensive
// -- e.g. a future/unknown strategy string) rather than guessing.
function toOiStrategy(strategy: string): 'CSP' | 'CC' | 'BPS' | 'BCS' | 'IC' | 'PMCC' | null {
  if (strategy === 'CSP' || strategy === 'CC' || strategy === 'BPS' || strategy === 'BCS' || strategy === 'IC' || strategy === 'PMCC') {
    return strategy;
  }
  return null;
}

// SCREENER-OI-0001 — one shared, reusable "Minimum relevant-leg OI" +
// two-level sort control block, used identically by Filtered, Ranked, and
// Targeted results panels so the OI/sort UI (and its dedup rule) lives in
// exactly one place, per the ticket's "do not duplicate OI interpretation or
// comparator logic inside React components" requirement. Accent color is the
// only thing that varies per mode, matching each panel's existing palette
// (purple=Ranked, teal=Targeted, amber=Filtered).
function OiAndSortControls({
  th, minOi, setMinOi, sort, setSort, accent, sortFields = SORT_FIELDS,
}: {
  th: typeof THEMES[Theme];
  minOi: number;
  setMinOi: (n: number) => void;
  sort: SortSpec;
  setSort: (s: SortSpec) => void;
  accent: 'purple' | 'teal' | 'amber';
  sortFields?: readonly SortField[];
}) {
  const [customOi, setCustomOi] = useState<string>('');
  const isPreset = OI_PRESETS.some(p => p.value === minOi);
  const activeCls = accent === 'purple' ? 'border-purple-500 text-purple-300 bg-purple-500/15'
    : accent === 'teal' ? 'border-teal-500 text-teal-300 bg-teal-500/15'
    : 'border-amber-500 text-amber-300 bg-amber-500/15';
  const hoverCls = accent === 'purple' ? 'hover:border-purple-500/50'
    : accent === 'teal' ? 'hover:border-teal-500/50'
    : 'hover:border-amber-500/50';

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center gap-1.5 flex-wrap">
        <span className={`text-[9px] ${th.textFaint} shrink-0`}>{MIN_OI_LABEL}</span>
        {OI_PRESETS.map(p => (
          <button key={p.label} onClick={() => { setMinOi(p.value); setCustomOi(''); }}
            className={`text-[9px] px-2 py-0.5 rounded border transition-colors font-bold ${
              isPreset && minOi === p.value ? activeCls : `${th.border} ${th.textFaint} ${hoverCls}`
            }`}>
            {p.label}
          </button>
        ))}
        <input
          type="number"
          min={0}
          placeholder="Custom"
          value={customOi}
          onChange={e => {
            setCustomOi(e.target.value);
            const n = parseInt(e.target.value, 10);
            if (Number.isFinite(n) && n >= 0) setMinOi(n);
          }}
          aria-label="Custom minimum relevant-leg OI"
          className={`w-16 ${th.input} border ${!isPreset ? activeCls.split(' ')[0] : th.inputBorder} rounded px-1.5 py-0.5 text-[9px] ${th.text} text-center focus:outline-none`}
        />
        <span className={`text-[8px] ${th.textFaint} basis-full`}>{MIN_OI_HELPER_TEXT}</span>
      </div>
      <div className="flex items-center gap-1.5 flex-wrap">
        <span className={`text-[9px] ${th.textFaint} shrink-0`}>Sort</span>
        {sortFields.map(f => (
          <button key={f} onClick={() => setSort(setPrimarySortField(sort, f))}
            className={`text-[9px] px-2 py-0.5 rounded border transition-colors font-bold ${
              sort.primary === f ? activeCls : `${th.border} ${th.textFaint} ${hoverCls}`
            }`}>
            {SORT_FIELD_LABELS[f]}
          </button>
        ))}
        <span className={`text-[9px] ${th.textFaint} shrink-0 ml-1`}>then</span>
        <select
          aria-label="Secondary sort field"
          value={sort.secondary}
          onChange={e => setSort(setSecondarySortField(sort, e.target.value as SecondarySortField))}
          className={`text-[9px] ${th.input} border ${th.inputBorder} rounded px-1.5 py-0.5 ${th.text} focus:outline-none`}
        >
          <option value="none">None</option>
          {sortFields.filter(f => f !== sort.primary).map(f => (
            <option key={f} value={f}>{SORT_FIELD_LABELS[f]}</option>
          ))}
        </select>
      </div>
    </div>
  );
}

// ── Targeted Scan Results Panel ────────────────────────────────────────────
// SCREENER-OI-0001 corrective pass: Targeted mode explicitly does NOT get
// the new canonical minimum-OI floor or two-level sort UI -- product
// direction is that Targeted keeps its own established, strategy-specific
// eligibility and ordering behavior unchanged. This local type/sort logic
// is deliberately the same shape it was before SCREENER-OI-0001 (single
// sort field, no OI floor) -- NOT a reimplementation of the canonical
// module. The canonical module remains available in lib/screener/
// screenerResultOrdering.ts for Targeted or a future scanner to adopt
// later, but nothing in this panel calls it.
type TargetedSortField = 'score' | 'pop' | 'credit' | 'creditRatio' | 'roc' | 'otm';

function TargetedScanResultsPanel({
  entries, sortBy, setSortBy, popMin, th, rankConfig, rules, etfRules, existingPositions, onTrade,
}: {
  entries: TargetedScanEntry[];
  sortBy: TargetedSortField;
  setSortBy: (v: TargetedSortField) => void;
  popMin: number;
  th: typeof THEMES[Theme];
  rankConfig: RankConfig;
  rules: RulesType;
  etfRules: RulesType;
  existingPositions: ExistingPosition[];
  onTrade?: (result: ScreenResult) => void;
}) {
  // ── State — all arrays, no Sets, no useMemo ─────────────────────────────
  const [hiddenSymbols, setHiddenSymbols]       = useState<string[]>([]);
  const [showTopN, setShowTopN]                 = useState<number>(50);
  const [activePopMin, setActivePopMin]         = useState<number>(popMin);
  const [activeOtmMin, setActiveOtmMin]         = useState<number>(0);
  const [activeCreditRatioMin, setActiveCreditRatioMin] = useState<number>(0);
  const [activeStrategies, setActiveStrategies] = useState<string[]>(['BPS', 'BCS', 'IC']);
  const [activeTrendOnly, setActiveTrendOnly]   = useState<boolean>(false);
  const [activeSort, setActiveSort]             = useState(sortBy);
  // Track scan identity so we reset filters only on genuinely new scan
  const scanIdRef = useRef(0);
  const lastLenRef = useRef(0);
  if (entries.length !== lastLenRef.current) {
    lastLenRef.current = entries.length;
    scanIdRef.current += 1;
  }
  const [resetKey, setResetKey] = useState(0);
  useEffect(() => {
    setActivePopMin(popMin);
    setActiveOtmMin(0);
    setActiveCreditRatioMin(0);
    setHiddenSymbols([]);
    setActiveStrategies(['BPS', 'BCS', 'IC']);
    setActiveTrendOnly(false);
    setActiveSort(sortBy);
    setResetKey(k => k + 1);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scanIdRef.current]);

  if (entries.length === 0) return null;

  // ── Handlers ────────────────────────────────────────────────────────────
  const toggleSymbol = (sym: string) =>
    setHiddenSymbols(prev => prev.includes(sym) ? prev.filter(s => s !== sym) : [...prev, sym]);
  const toggleStrategy = (s: string) =>
    setActiveStrategies(prev => prev.includes(s) ? (prev.length === 1 ? prev : prev.filter(x => x !== s)) : [...prev, s]);
  const changeSort = (k: typeof activeSort) => { setActiveSort(k); setSortBy(k); };

  // ── Inline filter + sort — runs every render, no caching ───────────────
  const allSymbols = Array.from(new Set(entries.map(e => e.symbol))).sort();

  let pool = entries.slice(); // shallow copy
  // 1. ticker filter
  if (hiddenSymbols.length > 0) pool = pool.filter(e => !hiddenSymbols.includes(e.symbol));
  // 2. POP floor
  pool = pool.filter(e => e.pop >= activePopMin);
  // 2b. OTM floor
  if (activeOtmMin > 0) pool = pool.filter(e => {
    const otm = calcTargetedEntryOtmPct(e);
    return otm != null && otm >= activeOtmMin;
  });
  // 2c. credit ratio floor
  if (activeCreditRatioMin > 0) pool = pool.filter(e => ((e.candidate.creditRatio ?? 0) * 100) >= activeCreditRatioMin);
  // 3. strategy filter
  pool = pool.filter(e => activeStrategies.includes(e.strategy));
  // 4. trend only
  if (activeTrendOnly) pool = pool.filter(e => e.strategy === e.primaryStrategy);
  // 5. sort — unchanged single-field sort, pre-dating SCREENER-OI-0001.
  pool.sort((a, b) => {
  if (activeSort === 'pop')         return b.pop - a.pop;
  if (activeSort === 'credit')      return (b.candidate.credit ?? 0) - (a.candidate.credit ?? 0);
  if (activeSort === 'creditRatio') return (b.candidate.creditRatio ?? 0) - (a.candidate.creditRatio ?? 0);
  if (activeSort === 'roc')         return b.candidate.roc - a.candidate.roc;
  if (activeSort === 'otm')         return (calcTargetedEntryOtmPct(b) ?? -999) - (calcTargetedEntryOtmPct(a) ?? -999);
  return b.score - a.score;
});

  const totalVisible  = pool.length;
  const display       = pool.slice(0, showTopN);
  const globalRankMap = new Map(display.map((e, i) => [`${e.symbol}-${e.strategy}-${e.expiration}-${e.candidate.shortStrike}`, i + 1]));

  const dteBuckets = [
    { label: '< 21 · Closing Zone', min: 0,  max: 20  },
    { label: '21–29 · Short Entry', min: 21, max: 29  },
    { label: '30–45 · Target Zone', min: 30, max: 45  },
    { label: '46–60 · Extended',    min: 46, max: 60  },
    { label: '> 60 · Far Out',      min: 61, max: 999 },
  ];

  const sortLabels: { key: typeof activeSort; label: string }[] = [
    { key: 'score',       label: 'Score'    },
    { key: 'pop',         label: 'POP %'    },
    { key: 'credit',      label: 'Credit $' },
    { key: 'creditRatio', label: 'Credit %' },
    { key: 'roc',         label: 'ROC %'    },
    { key: 'otm',         label: 'OTM %'    },
  ];

  return (
    <div className="flex flex-col" style={{ minHeight: 0 }}>

      {/* ── Sticky filter header ─────────────────────────────────────────── */}
      <div className={`sticky top-0 z-20 pb-3 pt-1 space-y-2 ${th.bg} border-b ${th.border}`}>

        {/* Scan title — deliberately larger/bolder than the controls below it, so the
            active scan mode is unmistakable even at a glance (small inline badges were
            too easy to miss — see the RANKED/TARGETED mixup this was built to fix). */}
        <p className="text-sm font-bold tracking-wide text-teal-400">⊕ TARGETED SCAN</p>

        {/* Row 1: count + sort + show top */}
        <div className="flex items-center gap-3 flex-wrap">
          <p className="text-[9px] text-teal-400 tracking-widest font-medium shrink-0">
            {display.length} of {totalVisible} SHOWN
          </p>
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className={`text-[9px] ${th.textFaint}`}>Sort</span>
            {sortLabels.map(sl => (
              <button key={sl.key} onClick={() => changeSort(sl.key)}
                className={`text-[9px] px-2 py-0.5 rounded border transition-colors font-bold ${
                  activeSort === sl.key
                    ? 'border-teal-500 text-teal-300 bg-teal-500/15'
                    : `${th.border} ${th.textFaint} hover:border-teal-500/50`
                }`}>
                {sl.label}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-1.5">
            <span className={`text-[9px] ${th.textFaint}`}>Show</span>
            {[25, 50, 100, 999].map(n => (
              <button key={n} onClick={() => setShowTopN(n)}
                className={`text-[9px] px-2 py-0.5 rounded border transition-colors font-bold ${
                  showTopN === n
                    ? 'border-teal-500 text-teal-300 bg-teal-500/15'
                    : `${th.border} ${th.textFaint} hover:border-teal-500/50`
                }`}>
                {n === 999 ? 'All' : n}
              </button>
            ))}
          </div>
        </div>

        {/* Row 2: POP + strategy + trend filters */}
        <div className="flex items-center gap-3 flex-wrap">
          <div className="flex items-center gap-1.5">
            <span className={`text-[9px] ${th.textFaint} shrink-0`}>POP ≥</span>
            {[65, 70, 75, 80, 85].map(v => (
              <button key={v} onClick={() => setActivePopMin(v)}
                className={`text-[9px] px-2 py-0.5 rounded border transition-colors font-bold ${
                  activePopMin === v
                    ? 'border-teal-500 text-teal-300 bg-teal-500/15'
                    : `${th.border} ${th.textFaint} hover:border-teal-500/50`
                }`}>
                {v}%
              </button>
            ))}
          </div>
          <div className={`w-px h-4 ${th.border} border-l`} />
          <div className="flex items-center gap-1.5">
            <span className={`text-[9px] ${th.textFaint} shrink-0`}>OTM ≥</span>
            {[0, 4, 8, 12, 16].map(v => (
              <button key={v} onClick={() => setActiveOtmMin(v)}
                className={`text-[9px] px-2 py-0.5 rounded border transition-colors font-bold ${
                  activeOtmMin === v
                    ? 'border-teal-500 text-teal-300 bg-teal-500/15'
                    : `${th.border} ${th.textFaint} hover:border-teal-500/50`
                }`}>
                {v === 0 ? 'Any' : `${v}%`}
              </button>
            ))}
          </div>
          <div className={`w-px h-4 ${th.border} border-l`} />
          <div className="flex items-center gap-1.5">
            <span className={`text-[9px] ${th.textFaint} shrink-0`}>Cr Ratio ≥</span>
            {[0, 15, 20, 25, 33].map(v => (
              <button key={v} onClick={() => setActiveCreditRatioMin(v)}
                className={`text-[9px] px-2 py-0.5 rounded border transition-colors font-bold ${
                  activeCreditRatioMin === v
                    ? 'border-teal-500 text-teal-300 bg-teal-500/15'
                    : `${th.border} ${th.textFaint} hover:border-teal-500/50`
                }`}>
                {v === 0 ? 'Any' : `${v}%`}
              </button>
            ))}
          </div>
          <div className={`w-px h-4 ${th.border} border-l`} />
          <div className="flex items-center gap-1.5">
            <span className={`text-[9px] ${th.textFaint} shrink-0`}>Strategy</span>
            {(['BPS', 'BCS', 'IC'] as const).map(s => {
              const on = activeStrategies.includes(s);
              const c  = s === 'BPS' ? 'border-emerald-600 text-emerald-400 bg-emerald-500/10'
                       : s === 'BCS' ? 'border-red-600 text-red-400 bg-red-500/10'
                       :               'border-blue-600 text-blue-400 bg-blue-500/10';
              return (
                <button key={s} onClick={() => toggleStrategy(s)}
                  className={`text-[9px] px-2 py-0.5 rounded border transition-colors font-bold ${
                    on ? c : `${th.border} ${th.textFaint} opacity-40`
                  }`}>
                  {s}
                </button>
              );
            })}
          </div>
          <div className={`w-px h-4 ${th.border} border-l`} />
          <button onClick={() => setActiveTrendOnly(v => !v)}
            className={`text-[9px] px-2.5 py-0.5 rounded border transition-colors font-bold ${
              activeTrendOnly
                ? 'border-emerald-500 text-emerald-400 bg-emerald-500/10'
                : `${th.border} ${th.textFaint} hover:border-emerald-500/50`
            }`}>
            ↑✓ Trend aligned only
          </button>
        </div>

        {/* Row 3: Ticker toggles */}
        {allSymbols.length > 1 && (
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className={`text-[9px] ${th.textFaint} shrink-0`}>Tickers</span>
            {allSymbols.map(sym => {
              const hidden = hiddenSymbols.includes(sym);
              return (
                <button key={sym} onClick={() => toggleSymbol(sym)}
                  className={`text-[9px] px-2 py-0.5 rounded border transition-colors font-bold ${
                    hidden
                      ? `${th.border} ${th.textFaint} line-through opacity-40`
                      : 'border-teal-600 text-teal-300 bg-teal-500/10'
                  }`}>
                  {sym} <span className="opacity-60">({entries.filter(e => e.symbol === sym).length})</span>
                </button>
              );
            })}
            {hiddenSymbols.length > 0 && (
              <button onClick={() => setHiddenSymbols([])}
                className={`text-[9px] px-2 py-0.5 rounded border ${th.border} ${th.textFaint} hover:border-teal-500/50`}>
                Show all
              </button>
            )}
          </div>
        )}
      </div>

      {/* ── Scrollable results ───────────────────────────────────────────── */}
      <div className="space-y-4 pt-3" key={`results-${resetKey}`}>
        {dteBuckets.map(bucket => {
          const bucketEntries = display.filter(e => e.dte >= bucket.min && e.dte <= bucket.max);
          if (bucketEntries.length === 0) return null;
          return (
            <div key={bucket.label}>
              <div className="flex items-center gap-2 mb-2">
                <span className={`text-[9px] px-2 py-0.5 rounded border font-bold ${dteBadgeColor(Math.round((bucket.min + Math.min(bucket.max, 60)) / 2))}`}>
                  {bucket.label}
                </span>
                <span className={`text-[9px] ${th.textFaint}`}>{bucketEntries.length} setups</span>
              </div>
              <div className="space-y-2">
                {bucketEntries.map(entry => {
                  const rk = globalRankMap.get(`${entry.symbol}-${entry.strategy}-${entry.expiration}-${entry.candidate.shortStrike}`) ?? 0;
                  const ar = entry.isEtf ? etfRules : rules;
                  const aligned = entry.strategy === entry.primaryStrategy;
                  const against = entry.trendResult?.strategy !== 'NO_TRADE' && !aligned && entry.strategy !== 'IC';
                  return (
                    <div key={`${entry.symbol}-${entry.strategy}-${entry.expiration}-${entry.candidate.shortStrike}`} className="flex items-start gap-2">
                      <div className="flex flex-col items-center gap-1 shrink-0 mt-3">
                        <span className={`text-[9px] ${th.textFaint} w-5 text-right`}>{rk}</span>
                        <span className={`text-[9px] px-1.5 py-0.5 border rounded font-bold ${dteBadgeColor(entry.dte)}`}>{entry.dte}d</span>
                        {aligned && <span className="text-[8px] text-emerald-400" title="Trend aligned">↑✓</span>}
                        {against && <span className="text-[8px] text-amber-400"   title="Against trend">⚠</span>}
                      </div>
                      <div className="flex-1">
                        <ResultCard
                          result={entry.screenResult}
                          th={th}
                          rules={ar}
                          screenMode="targeted"
                          rankConfig={rankConfig}
                          onTrade={onTrade}
                          cachedEntry={entry.cachedEntry}
                          existingPositions={existingPositions}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Main App ───────────────────────────────────────────────────────────────
export const dynamic = 'force-dynamic';
export default function Home() {
  const [theme, setTheme] = useState<Theme>(getSavedTheme);
  const [accent, setAccent] = useState<Accent>(getSavedAccent);
  const th = THEMES[theme];
  useEffect(() => { applyAccent(accent); }, [accent]);
  useEffect(() => { applyAccent(getSavedAccent()); }, []);

  // Guards any render-time Date.now() math (e.g. the "Xm ago" freshness
  // badge) from running during SSR or the first client paint, where the
  // server's clock/timezone can legitimately differ from the browser's and
  // produce a text-content hydration mismatch (React error #425/#418/#423).
  // Starts false on both server and client — only flips after hydration is
  // confirmed complete, so the live-clock text never has a chance to differ.
  const [mounted, setMounted] = useState(false);
  useEffect(() => { setMounted(true); }, []);

  // ensureHeadAssets — runs once after mount, strictly post-hydration.
  // Replaces the old module-level document.head.appendChild() side effects
  // (accent CSS vars + DM Sans font link) that used to fire at client
  // bundle-evaluation time and could race React's hydration of this page.
  useEffect(() => {
    if (!document.getElementById('hunter-accent-style')) {
      const style = document.createElement('style');
      style.id = 'hunter-accent-style';
      style.textContent = `
        :root { --accent: #3b82f6; --accent-r: 59; --accent-g: 130; --accent-b: 246; }
        .accent-border { border-color: var(--accent) !important; }
        .accent-text { color: var(--accent) !important; }
        .accent-bg { background-color: rgba(var(--accent-r), var(--accent-g), var(--accent-b), 0.1) !important; }
        .accent-ring { box-shadow: 0 0 0 1px var(--accent) !important; }
        nav a.active-nav, nav span.active-nav { background: rgba(var(--accent-r), var(--accent-g), var(--accent-b), 0.2); color: var(--accent); }
      `;
      document.head.appendChild(style);
    }
    if (!document.getElementById('hunter-font')) {
      const link = document.createElement('link');
      link.id = 'hunter-font';
      link.rel = 'stylesheet';
      link.href = 'https://fonts.googleapis.com/css2?family=DM+Sans:ital,opsz,wght@0,9..40,300;0,9..40,400;0,9..40,500;0,9..40,600;0,9..40,700&family=DM+Mono:wght@400;500&display=swap';
      document.head.appendChild(link);
    }
  }, []);

  const [tickers, setTickers] = useState<WatchlistTicker[]>([]);
  const [watchlistLoading, setWatchlistLoading] = useState(true);
  useEffect(() => {
    loadWatchlist().then(t => { setTickers(t); setWatchlistLoading(false); });
  }, []);
  const handleTickersChange = (next: WatchlistTicker[]) => {
    setTickers(next);
    clearResultsCache();
    persistWatchlist(next);
    // TE-0007: the primary ticker list IS the Opportunity Universe's
    // backing state (active tickers = "willing to evaluate"). Keep the
    // canonical mirror in sync on every change so it stays authoritative
    // and testable independent of the richer WatchlistTicker[] shape.
    saveOpportunityUniverse(next.filter(t => t.active).map(t => t.symbol));
  };
  // TE-0007: One canonical Opportunity Universe, derived from the same
  // `tickers` state the general/primary Screener list has always used.
  // "Active" here means the same thing it always has for spread scanning
  // ("include this ticker in the next run") -- it now also gates CSP/PMCC/
  // Covered-Call universe membership, giving every strategy button the
  // exact same normalized array. See lib/screener/opportunityUniverse.ts.
  const opportunityUniverse = useMemo(
    () => normalizeUniverse(tickers.filter(t => t.active).map(t => t.symbol)),
    [tickers]
  );
  const [cspCashOverride, setCspCashOverride] = useState('');
  const [pmccShortDteMin, setPmccShortDteMin] = useState(PMCC_SHORT_DTE_MIN);
  const [pmccShortDteMax, setPmccShortDteMax] = useState(PMCC_SHORT_DTE_MAX);
  const [pmccLongDteMin, setPmccLongDteMin] = useState(PMCC_LONG_DTE_MIN);
  const [pmccLongDteMax, setPmccLongDteMax] = useState(PMCC_LONG_DTE_MAX);
  useEffect(() => {
    try {
      const saved = localStorage.getItem(LS_PMCC_DTE);
      if (!saved) return;
      const parsed = JSON.parse(saved);
      if (Number.isFinite(parsed.shortMin)) setPmccShortDteMin(parsed.shortMin);
      if (Number.isFinite(parsed.shortMax)) setPmccShortDteMax(parsed.shortMax);
      if (Number.isFinite(parsed.longMin)) setPmccLongDteMin(parsed.longMin);
      if (Number.isFinite(parsed.longMax)) setPmccLongDteMax(parsed.longMax);
    } catch {}
  }, []);
  const persistPmccDteRanges = (ranges: { shortMin: number; shortMax: number; longMin: number; longMax: number }) => {
    try { localStorage.setItem(LS_PMCC_DTE, JSON.stringify(ranges)); } catch {}
  };
  // TE-0007C — CC's scan universe comes from verified account holdings, not
  // a free-form ticker list (unlike CSP/PMCC), so its state shape differs:
  // no `ccTickers` string, just the holdings the API reports plus a
  // hide-only filter that can narrow (never add to) that verified set.
  const [ccEligibleHoldings, setCcEligibleHoldings] = useState<Array<{
    symbol: string; sharesOwned: number; costBasis: number | null;
    grossCoveredContracts: number; existingShortCallContracts: number;
    workingShortCallContracts: number; availableCoveredContracts: number; oversubscribed: boolean;
    hasUnclassifiedExposure: boolean;
  }>>([]);
  const [ccBlockedHoldings, setCcBlockedHoldings] = useState<string[]>([]);
  const [ccHiddenSymbols, setCcHiddenSymbols] = useState<string[]>([]);
  const [ccHoldingsLoading, setCcHoldingsLoading] = useState(false);
  // TE-0007C final corrective pass: account-level, data-integrity blocking
  // state -- distinct from "no eligible holdings" (an ordinary empty
  // result). Set only when buildCoveredCallCapacityReport() returns
  // status:'unavailable' because open option exposure could not be matched
  // to ANY underlying holding. Must never be presented as "no eligible
  // holdings" -- see the UI block below.
  const [ccUnavailableReason, setCcUnavailableReason] = useState<string | null>(null);
  // NOTE: results/rawScanCache/resultsCachedAt/screenMode used to read
  // localStorage directly inside these useState lazy initializers. That
  // runs synchronously on first render on BOTH server (no localStorage ->
  // empty/default) and client (localStorage present -> already-populated
  // cards). The resulting first-paint mismatch is what was causing React
  // hydration error #418/#423 — confirmed via Network tab: server HTML
  // contains zero result cards, but client's first paint already shows
  // cached ones. Fix: start at plain defaults here (matches server every
  // time); the real cached values are loaded in the
  // "load cached scan state" useEffect below, strictly post-mount.
  const [results, setResults] = useState<ScreenResult[]>([]);
  const [rawScanCache, setRawScanCache] = useState<RawScanEntry[]>([]);
  const [resultsCachedAt, setResultsCachedAt] = useState<number | null>(null);
  const [targetedResultsCachedAt, setTargetedResultsCachedAt] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [status, setStatus] = useState('');
  const [scanLiveMessage, setScanLiveMessage] = useState('');
  const [showRulesModal, setShowRulesModal] = useState(false);
  const [showRunModal, setShowRunModal] = useState(false);
  const [showCspRunModal, setShowCspRunModal] = useState(false);
  const [showCcScanModal, setShowCcScanModal] = useState(false);
  // DEFAULT_CC_RULES until a modal run overrides it -- matches the "opening
  // the modal copies saved defaults into a draft, only a submitted run
  // changes what the scan actually uses" pattern from CspScanModal, minus
  // the persisted-defaults/preset layer CC intentionally doesn't have yet.
  const [ccRules, setCcRules] = useState<CcRulesType>(DEFAULT_CC_RULES);
  const [ccBypassUniverse, setCcBypassUniverse] = useState(false);
  const [showPmccScanModal, setShowPmccScanModal] = useState(false);
  const [showPmccPairLookup, setShowPmccPairLookup] = useState(false);
  const defaultCspRequest = (mode: CspScanRequest['mode']): CspScanRequest => ({
    mode, preset: 'balanced', rules: { ...DEFAULT_CSP_RULES },
    popMin: null, otmMin: null, rocMin: null, rankSecondary: 'none',
  });
  const [lastCspMode, setLastCspMode] = useState<CspScanRequest['mode']>('filter');
  const [cspRequestsByMode, setCspRequestsByMode] = useState<CspScanRequestsByMode>({
    filter: defaultCspRequest('filter'), rank: defaultCspRequest('rank'), targeted: defaultCspRequest('targeted'),
  });
  const [tradeResult, setTradeResult] = useState<ScreenResult | null>(null);
  const [loadPrompt, setLoadPrompt] = useState<LoadPromptState>({ show: false, name: '', type: 'strategy' });
  const [runtimeStockRules, setRuntimeStockRules] = useState<RulesType>(getSavedRules);
  const [runtimeEtfRules, setRuntimeEtfRules] = useState<RulesType>(getSavedEtfRules);
  const [rankConfig, setRankConfig] = useState<RankConfig>(getSavedRankConfig);
  const [screenMode, setScreenMode] = useState<'filter' | 'rank' | 'targeted'>('filter');
  // SCREENER-OI-0001 -- Filtered mode's minimum relevant-leg OI floor and
  // two-level sort, applied to the qualified section after the existing
  // qualified/IVR eligibility split (see the Filtered-mode results render
  // below). Disqualified-section ordering is unaffected -- it's already an
  // audit trail of *why* something didn't qualify, not a ranked results list.
  const [filteredMinOi, setFilteredMinOi] = useState<number>(0);
  const [filteredSort, setFilteredSort] = useState<SortSpec>({ primary: 'score', secondary: 'none' });

  // ── SCREENER-RESULTS-0001 — canonical scan-session wiring ────────────────
  // `activeSession` is the single authoritative record for the currently
  // active or most-recently-completed scan (see lib/screener/scanSession.ts
  // module header). `activeSessionIdRef` mirrors `activeSession?.sessionId`
  // in a ref so a long-running async scan function can synchronously check,
  // at any await boundary, whether a NEWER session has since superseded it
  // — React state reads inside an in-flight closure can be stale, a ref
  // cannot. `results`/`targetedResults` remain the state the render tree
  // actually reads (unchanged downstream consumers), but they are now
  // populated FROM `session.results` at each transition rather than
  // accumulated independently — see beginScanSession()/commitScanSession()
  // below. This is also the strategy-isolation fix: because a new session
  // REPLACES (never merges into) the previous one, a CSP scan's results can
  // no longer end up displayed alongside a prior BPS/BCS/IC scan's results.
  const [activeSession, setActiveSession] = useState<ScreenerScanSession | null>(null);
  const activeSessionIdRef = useRef<string | null>(null);

  // Starts a new session, immediately superseding whatever session was
  // still 'running' (if any) via the canonical stopSession('SUPERSEDED')
  // transition — never left dangling, never silently dropped. Sets the ref
  // synchronously (before any await in the caller) so isSessionStale() and
  // late-result checks are correct from the very first line of the caller.
  const beginScanSession = (args: {
    mode: ScreenerScanMode;
    requestedStrategy: ScreenerRequestedStrategy;
    scope: ScreenerScanScope;
    scopeExclusionReasonCode?: ScreenerReasonCode | ((symbol: string) => ScreenerReasonCode);
    // CSP-WORKFLOW-0001 core-correction (BLOCKER-06) — the immutable rule
    // snapshot for this session, forwarded unchanged to createScanSession().
    ruleSnapshot?: ReturnType<typeof buildCspRuleSnapshot>;
    pmccSnapshot?: PmccScanSnapshot;
  }): ScreenerScanSession => {
    setActiveSession(prev => {
      if (prev && prev.status === 'running') {
        // Best-effort supersession of a still-running prior session's React
        // state; the prior async function's own stale-check (via the ref,
        // updated below) is what actually prevents it from writing late
        // results, not this alone.
        try { stopSession(prev, 'SUPERSEDED'); } catch { /* already terminal */ }
      }
      return prev;
    });
    const session = createScanSession(args);
    activeSessionIdRef.current = session.sessionId;
    setActiveSession(session);
    return session;
  };

  // Applies a validated transition (completeSession/stopSession/errorSession
  // result) to React state IF this session is still the active one. A
  // stale/superseded session's late transition is discarded here — this is
  // the enforcement point for "ignore late results from an older session."
  // `displayResults` lets callers with a richer per-entry shape (Targeted's
  // TargetedScanEntry[]) update their own existing state in the same
  // stale-checked commit, without the session model needing to know about
  // that shape.
  const commitScanSession = (session: ScreenerScanSession, onCommit?: () => void): boolean => {
    if (isSessionStale(session.sessionId, activeSessionIdRef.current)) return false;
    setActiveSession(session);
    onCommit?.();
    // TE-0007D corrective — this capture originally ran BEFORE onCommit(),
    // but useRankedScan.ts's own commitSession callback calls
    // completeScreenerJob(...) -- the exact call that updates
    // lastResultsAffectingJobId to THIS session's own job -- from inside
    // that same callback. Capturing before onCommit() ran read the OLD,
    // pre-this-refresh value, one step behind the job that actually
    // produced the results just committed, causing a false "Superseded"
    // flash on every normal, self-initiated refresh (confirmed via a
    // genuine test regression, not assumed). Moved after onCommit() so
    // this always sees whatever the commit's own job-completion call
    // just set.
    setCommittedResultsJobId(getScreenerJobState().lastResultsAffectingJobId);
    return true;
  };

  // SCREENER-RESULTS-0001 corrective — commitScanSession() already gates the
  // SUCCESS path's results/cache writes against a stale/superseded session,
  // but every scan function's catch/finally block was still unconditionally
  // calling setLoading(false)/setStatus('')/setError()/job-status mutations
  // even when its own session had already been superseded — a slow scan's
  // late failure or cleanup could clobber a newer scan's loading/status/
  // error UI after the newer scan had already taken over. This is the same
  // identity check as commitScanSession(), reused for those shared-UI-state
  // writes. `session == null` (a real exception before this invocation ever
  // constructed a session, e.g. during Covered Call's pre-session capacity/
  // universe guards) is treated as "still current" — the page-level loading
  // gate only ever allows one scan-triggering button to be active at a time,
  // so an invocation that never got far enough to create a session was, by
  // construction, still the only one running.
  const isScanCurrent = (session: ScreenerScanSession | null): boolean =>
    session == null || !isSessionStale(session.sessionId, activeSessionIdRef.current);

  // ── OE-0002A: Best Opportunities state ────────────────────────────────────
  // Purely derived, in-memory state -- never persisted, never fabricated.
  // 'idle' before any real scan results exist; 'loading' while the existing
  // recommendation pipeline runs; 'loaded'/'error' after it returns.
  const [opportunityRecommendations, setOpportunityRecommendations] = useState<OpportunityRecommendation[]>([]);
  const [opportunityGeneratedAt, setOpportunityGeneratedAt] = useState<string | undefined>(undefined);
  const [opportunityState, setOpportunityState] = useState<'idle' | 'loading' | 'loaded' | 'error'>('idle');
  const [opportunityError, setOpportunityError] = useState('');
  // TE-0007D corrective — Finding 3 added `skipped` as a real, typed
  // pass-through field (opportunityRecommendationsFromApiResponse's
  // return value) but nothing ever read it at this call site; the
  // plumbing was complete, the disclosure UI was the missing step.
  const [opportunitySkipped, setOpportunitySkipped] = useState<RecommendationsApiResponseSkippedEntry[]>([]);
  // TE-0007D corrective — the real total submitted for evaluation
  // (qualifiedResults.length), captured because that variable is scoped
  // inside the recommendations effect and not reachable from the render
  // body; needed so the partial-evaluation disclosure's denominator is
  // the true total, not reconstructed from output counts (which would be
  // wrong if the adapter also silently drops a candidate for a reason
  // other than the server's own `skipped` list).
  const [opportunityEvaluatedCount, setOpportunityEvaluatedCount] = useState(0);
  // TE-0007D corrective — the job identity captured at commit time (see
  // commitScanSession), compared reactively below against the live store
  // to detect a newer, results-affecting scan (from another tab/session)
  // completing while this presentation is still showing.
  const [committedResultsJobId, setCommittedResultsJobId] = useState<string | null>(null);
  const liveJobState = useScreenerJobState();
  // TE-0007D corrective — the `!== null` guard on committedResultsJobId
  // was a real bug in this fix's own first pass: a cache-restored session
  // (page reload) legitimately captures null as its baseline (no job has
  // completed yet in this browser session). Requiring the baseline to be
  // non-null meant the FIRST job completing afterward could never be
  // detected as newer, since the guard stayed false forever. The correct
  // check is simply whether the live value differs from what was
  // captured -- true even when the baseline was null.
  const isPresentationStale = activeSession != null
    && liveJobState.lastResultsAffectingJobId !== committedResultsJobId;

  // ── RF-0001: Ranked Scan orchestration extracted to features/screener/
  // (see docs/reviews/RF-0001-Implementation-Report.md). Mechanical move —
  // same task-reconnect/mirror/start behavior TE-0005A added, now living in
  // useRankedScan(). Filter/Targeted are untouched: they still call
  // runScreen()/runTargetedScan() directly in this file, as before.
  const { startRankedScan } = useRankedScan({
    screenMode, tickers, rankConfig, hasPriorResults: results.length > 0,
    setResults, setRawScanCache, setResultsCachedAt,
    setLoading, setStatus, setError,
    beginSession: (scope) => beginScanSession({ mode: 'rank', requestedStrategy: 'spreads', scope }),
    commitSession: commitScanSession,
  });

  const [stockPresetLabel, setStockPresetLabel] = useState<string>(() => {
    try { const k = localStorage.getItem(LS_ACTIVE_PRESET); return RULE_PRESETS.find(p => p.key === k)?.label ?? 'Custom'; } catch { return 'Custom'; }
  });
  const [etfPresetLabel, setEtfPresetLabel] = useState<string>(() => {
    try { const k = localStorage.getItem(LS_ACTIVE_PRESET_ETF); return RULE_PRESETS.find(p => p.key === k)?.label ?? 'ETF Custom'; } catch { return 'ETF Custom'; }
  });
  const [rankTopN, setRankTopN] = useState<number>(20);
  const [rankDteMin, setRankDteMin] = useState<number>(0);
  const [rankDteMax, setRankDteMax] = useState<number>(999);
  // Post-scan, client-side filters — consistent with Targeted mode's POP/strategy
  // filters (same pattern, same default-off floors). Filtering happens entirely
  // over the already-fetched `results` array; no rescan needed to loosen these,
  // unlike the old hard floors that used to live inside the scan loop itself.
  const [rankPopMin, setRankPopMin] = useState<number>(0);
  const [rankOtmMin, setRankOtmMin] = useState<number>(0);
  const [rankCreditRatioMin, setRankCreditRatioMin] = useState<number>(0);
  const [rankStrategies, setRankStrategies] = useState<string[]>(['BPS', 'BCS', 'IC']);
  const toggleRankStrategy = (s: string) =>
    setRankStrategies(prev => prev.includes(s) ? (prev.length === 1 ? prev : prev.filter(x => x !== s)) : [...prev, s]);
  // Per-ticker breakdown/toggle -- same pattern as Targeted mode's ticker chips.
  const [rankHiddenSymbols, setRankHiddenSymbols] = useState<string[]>([]);
  const toggleRankSymbol = (sym: string) =>
    setRankHiddenSymbols(prev => prev.includes(sym) ? prev.filter(s => s !== sym) : [...prev, sym]);
  // SCREENER-OI-0001 -- minimum relevant-leg OI floor + two-level sort,
  // canonical across Ranked/Filtered/Targeted (see lib/screener/
  // screenerResultOrdering.ts). 0 == "Any" (no floor).
  const [rankMinOi, setRankMinOi] = useState<number>(0);
  const [rankSort, setRankSort] = useState<SortSpec>({ primary: 'score', secondary: 'none' });

  // ── Targeted Scan state ────────────────────────────────────────────────────
  const [targetedDteMin, setTargetedDteMin] = useState<number>(21);
  const [targetedDteMax, setTargetedDteMax] = useState<number>(45);
  const [targetedPopMin, setTargetedPopMin] = useState<number>(70);
  const [targetedOtmMin, setTargetedOtmMin] = useState<number>(6); // matches Income Engine OTM floor default
  // SCREENER-OI-0001 corrective pass: Targeted mode explicitly keeps its
  // pre-existing, established single-field sort and does NOT get the new
  // canonical minimum-OI floor or secondary sort -- see the note above
  // TargetedScanResultsPanel.
  const [targetedSortBy, setTargetedSortBy] = useState<TargetedSortField>('score');
  const [targetedResults, setTargetedResults] = useState<TargetedScanEntry[]>([]);
  const [targetedPreset, setTargetedPreset] = useState<string>('course');
  const targetedCancelRef = useRef<boolean>(false);
  const [existingPositions, setExistingPositions] = useState<ExistingPosition[]>([]);
  useEffect(() => {
    loadExistingPositions().then(setExistingPositions).catch(() => {});
  }, []);
  useEffect(() => {
    try {
      setCspCashOverride(localStorage.getItem(LS_CSP_CASH) || '');
    } catch {}
  }, []);

  // TE-0007 corrective pass (required correction 1): one-time Opportunity
  // Universe migration. Runs only after the primary ticker list has
  // finished loading (so `tickers` reflects the real loaded state, not a
  // possibly-stale localStorage snapshot) and only when the canonical key
  // doesn't exist yet (hasCanonicalUniverse()). The actual merge decision
  // -- which legacy symbols get added, which get reactivated -- is made by
  // migratePrimaryTickers(), the ONE canonical migration algorithm (see
  // lib/screener/opportunityUniverse.ts); this effect only supplies inputs
  // (tickers + the two legacy comma lists), resolves classification for
  // any newly-added symbols, and applies the result. Guarded by a ref so
  // it only ever runs once per mount.
  //
  // Fixes the exact defect from the corrective pass: a symbol already
  // present in the primary list but inactive (e.g. MU) is reactivated when
  // it's also found in a legacy CSP/PMCC list, instead of being silently
  // left out of the migrated universe just because "it already existed."
  const universeMigrationRanRef = useRef(false);
  useEffect(() => {
    if (watchlistLoading) return;
    if (universeMigrationRanRef.current) return;
    universeMigrationRanRef.current = true;
    (async () => {
      try {
        if (hasCanonicalUniverse()) return; // already migrated
        const legacyCsp = parseLegacyCommaList(localStorage.getItem(LS_CSP));
        const legacyPmcc = parseLegacyCommaList(localStorage.getItem(LS_PMCC));

        const migrated = migratePrimaryTickers<WatchlistTicker>(
          tickers,
          { csp: legacyCsp, pmcc: legacyPmcc },
          symbol => ({ symbol, classification: 'pending', active: true })
        );

        const changed = migrated.length !== tickers.length || migrated.some((t, i) => t !== tickers[i]);
        if (!changed) {
          // Nothing to fold in -- still persist the mirror so this
          // migration doesn't re-run on the next load.
          saveOpportunityUniverse(tickers.filter(t => t.active).map(t => t.symbol));
          return;
        }

        // Resolve real classification for newly-added ('pending') entries
        // only -- reactivated existing entries already have a real
        // classification and are left untouched.
        const token = await getAccessToken();
        const resolved = await Promise.all(
          migrated.map(async t =>
            t.classification === 'pending'
              ? { ...t, classification: await classifyUnderlying(t.symbol, token).catch(() => 'stock' as const) }
              : t
          )
        );
        handleTickersChange(resolved);
      } catch {
        // best-effort — worst case the canonical key stays unset and this
        // migration is retried on the next load.
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [watchlistLoading]);

  // load cached scan state — runs once, strictly after mount/hydration.
  // This is the post-hydration counterpart to the plain-default
  // useState calls above for results/rawScanCache/resultsCachedAt/
  // screenMode. Keeping the localStorage reads here (instead of inside
  // the initializers) guarantees the first client render always matches
  // the server's render, eliminating the #418/#423 hydration mismatch.
  useEffect(() => {
    try {
      const s = localStorage.getItem(LS_RESULTS_CACHE_AT);
      if (s) setResultsCachedAt(parseInt(s, 10));
    } catch {}
    try {
      const s = localStorage.getItem(LS_TARGETED_RESULTS_CACHE_AT);
      if (s) setTargetedResultsCachedAt(parseInt(s, 10));
    } catch {}
    try {
      const m = localStorage.getItem(LS_SCREEN_MODE);
      if (m === 'filter' || m === 'rank' || m === 'targeted') setScreenMode(m);
    } catch {}
  }, []);

  // TE-0005B: the global Task Status Bar's "Open Results" action links to
  // /screener?mode=<kind> so a completed scan's toast reliably lands the
  // person on the mode that actually holds its results, regardless of
  // whichever mode was last stored in localStorage above. Originally only
  // handled 'rank' (ranked-scan reconnect); broadened here to also handle
  // 'filter' and 'targeted', since CSP/PMCC/CC/BPS-BCS-IC filter-mode scans
  // all set resultsHref: '/screener?mode=filter' and were silently landing
  // on whatever mode was last active instead. Additive only — doesn't
  // change default behavior for anyone arriving without this param.
  useEffect(() => {
    try {
      if (typeof window === 'undefined') return;
      const modeParam = new URLSearchParams(window.location.search).get('mode');
      if (modeParam === 'filter' || modeParam === 'rank' || modeParam === 'targeted') {
        setScreenMode(modeParam);
      }
    } catch {}
  }, []);

  // rawScanCache + results + targetedResults restore — IndexedDB access is
  // async, unlike the synchronous localStorage reads above. rawScanCache
  // (the full per-symbol chain cache, used only for instant re-filtering,
  // never for accounting) and Targeted's own rich per-candidate
  // TargetedScanEntry[] cache are restored exactly as before. SCREENER-
  // RESULTS-0001: `results` (Filtered/Ranked/CSP/CC/PMCC) is now restored
  // via the canonical session cache instead of its own independent
  // IDB_RESULTS_KEY blob — restoreScanSession() runs validateSessionData()
  // internally, so a malformed, cross-strategy, or unknown-schema cached
  // session is rejected and cleared rather than silently trusted. A
  // restored session is marked with cacheProvenance 'idb-cache' by
  // persistScanSession() at write time, so the UI can honestly show it was
  // restored from cache rather than just produced live.
  useEffect(() => {
    // SCREENER-RESULTS-0001 final corrective — both auxiliary IndexedDB
    // caches (rawScanCache and Targeted's own TargetedScanEntry[] cache) used
    // to restore either independently of the canonical session (rawScanCache,
    // unconditionally, before this effect even knew whether a session would
    // validate) or gated only on session MODE (Targeted's cache — "some
    // valid targeted-mode session exists" is not the same guarantee as
    // "THIS specific completed scan's session exists"). Either gap lets a
    // valid, still-current session restore alongside a DIFFERENT run's
    // cached data. Both caches are now written as {sessionId, entries} and
    // restored only when the stored sessionId exactly matches the validated,
    // still-current session's own sessionId — nothing is restored
    // independently of, or merely "compatible with," the canonical session.
    restoreScanSession().then(session => {
      if (!session) return;
      // A scan may have already started (and begun superseding) before
      // this async restore resolves; never let a restored session clobber
      // an already-active one.
      if (activeSessionIdRef.current != null) return;
      activeSessionIdRef.current = session.sessionId;
      setActiveSession(session);
      // TE-0007D corrective — same capture as commitScanSession's own
      // fix; a cache-restored session (page reload, tab reopen) bypasses
      // commitScanSession entirely via this direct setActiveSession call,
      // so without this, a restored session's staleness could never be
      // detected at all -- committedResultsJobId would stay null forever.
      setCommittedResultsJobId(getScreenerJobState().lastResultsAffectingJobId);
      if (session.requestedStrategy === 'csp' && session.mode === 'rank' && session.ruleSnapshot) {
        setFilteredSort({ primary: 'score', secondary: session.ruleSnapshot.rankSecondary });
      }
      // rawScanCache feeds applyRules() directly — executable state, not
      // just display — so an exact sessionId match is required regardless
      // of mode. SCREENER-RESULTS-0001 final corrective (race) — these
      // idbGet() reads are async and can resolve well after this restore
      // effect returns. A new scan may start (and supersede `session`) in
      // that window; comparing only cached.sessionId === session.sessionId
      // is not enough, because `session` is a closed-over local — it never
      // changes even after activeSessionIdRef.current has moved on to a
      // newer scan. Each callback must also re-check
      // activeSessionIdRef.current === session.sessionId at resolution time,
      // the same live check commitScanSession/isScanCurrent use elsewhere,
      // so a since-superseded restore can never adopt its own stale cache.
      // Array.isArray(...entries) guards against a malformed/corrupted
      // IndexedDB record being trusted as real cache data.
      idbGet<{ sessionId: string; entries: RawScanEntry[] }>(IDB_RAW_SCAN_KEY).then(cached => {
        if (
          cached &&
          Array.isArray(cached.entries) &&
          cached.sessionId === session.sessionId &&
          activeSessionIdRef.current === session.sessionId
        ) {
          setRawScanCache(cached.entries);
        }
      });
      if (session.mode === 'targeted' && session.requestedStrategy === 'spreads') {
        idbGet<{ sessionId: string; entries: TargetedScanEntry[] }>(IDB_TARGETED_RESULTS_KEY).then(cachedTargeted => {
          if (
            cachedTargeted &&
            Array.isArray(cachedTargeted.entries) &&
            cachedTargeted.sessionId === session.sessionId &&
            activeSessionIdRef.current === session.sessionId
          ) {
            setTargetedResults(cachedTargeted.entries);
          }
        });
      } else {
        setResults(session.results);
        if (session.cachedAt != null) setResultsCachedAt(session.cachedAt);
      }
    });
  }, []);

  // ── OE-0002A/B: activate the existing Opportunity Engine foundation, and
  // publish to the Recommendation Service ──────────────────────────────────
  // Runs whenever `results` changes -- i.e. after runScreen/runPMCCScan/
  // runCspScan complete a real scan (or the cache-restore effect above loads
  // a previous real scan). Sends the real, current ScreenResult[] through
  // the existing, unmodified /api/autopilot/recommendations route to get a
  // real DecisionAnalysis[], then through the existing, unmodified
  // buildOpportunityRecommendations() (OE-0001's adapter + ranker,
  // untouched) for this page's own display. No mock/fixture data, no new
  // scoring -- this effect only orchestrates already-approved production
  // code.
  //
  // CES-0001 (OE-0002B): this page is a *producer* of recommendations, not
  // their owner (Architectural Principle 6) -- it announces the same real,
  // unranked DecisionAnalysis[] to lib/recommendations/RecommendationService
  // so any consumer (today, the Dashboard) can read the current set without
  // this page knowing that consumer exists. Publishing is a side effect of
  // this page's own existing pipeline, not a second computation of it.
  // SCREENER-RESULTS-0001 — Best Opportunities trust boundary. Two changes
  // from the prior version: (1) the trigger/gate is
  // shouldGenerateRecommendationsForSession(activeSession, activeSessionId)
  // — never for a running, stopped, errored, stale, empty, or restored-
  // invalid session, so a superseded or still-in-flight scan can never
  // populate this panel; (2) only QUALIFIED results from that same
  // completed session are sent, never the full qualified+disqualified
  // `results` array the previous version sent — a disqualified/rejected
  // candidate must never be able to surface here. The financial
  // scoring/ranking itself (the API route, buildOpportunityRecommendations)
  // is completely unmodified; only which results may reach it changed.
  useEffect(() => {
    let cancelled = false;
    const eligible = shouldGenerateRecommendationsForSession(activeSession, activeSessionIdRef.current);

    // TE-0007D corrective — this used to unconditionally clear
    // opportunityRecommendations the instant eligible became false for
    // ANY reason, including "activeSession.status === 'running'" (a
    // refresh of the same session in flight). That's the exact same
    // user-facing defect this file's own comments already document as
    // "now fixed" for an older version of this UI (stale/prior valid
    // results should stay visible during a refresh), reintroduced here.
    // This does NOT weaken the real safety rule
    // shouldGenerateRecommendationsForSession enforces (never GENERATE
    // new recommendations for a running session's own in-flight data) --
    // it only avoids WIPING already-valid prior recommendations while
    // that new session is still running. Explicitly excludes PMCC (which
    // shouldGenerateRecommendationsForSession always excludes regardless
    // of status) from the bypass -- switching directly into a PMCC scan
    // must still clear immediately, not leave stale non-PMCC
    // recommendations visible for the scan's duration.
    const isJustRefreshing = activeSession?.status === 'running' && activeSession.requestedStrategy !== 'pmcc';
    if (!eligible && !isJustRefreshing) {
      setOpportunityRecommendations([]);
      setOpportunityGeneratedAt(undefined);
      setOpportunitySkipped([]);
      setOpportunityState('idle');
      setOpportunityError('');
      clearRecommendations();
      return;
    }
    if (!eligible || !activeSession || activeSession.requestedStrategy === 'pmcc') {
      return;
    }

    // CSP-WORKFLOW-0001 core correction (BLOCKER-01) — Best Opportunities
    // requires BOTH strong market qualification (strict QUALIFIED, not the
    // QUALIFIED_WITH_LIQUIDITY_WARNING borderline-liquidity tier) AND
    // verified account eligibility (ELIGIBLE). A market-qualified-but-
    // unaffordable/unverified/no-account-selected CSP contract stays
    // `qualified: true` (visible in the ordinary Qualified list — see
    // runCspChecklist) but must not be sent into the recommendation
    // pipeline that feeds Best Opportunities. Other strategies are
    // unaffected: cspMarketQualification/cspAccountEligibility are
    // undefined for them, so this filter reduces to the prior
    // `r.qualified` behavior exactly.
    const qualifiedResults = activeSession.results.filter(r => {
      if (!r.qualified) return false;
      const c = r.bestCandidate;
      if (c?.cspMarketQualification === undefined) return true; // non-CSP strategy, unchanged
      return isBestOpportunitiesEligible(
        c.cspMarketQualification,
        c.cspAccountEligibility ?? 'CAPITAL_UNVERIFIED',
        c.cspModeQualification ?? 'NOT_APPLICABLE',
      );
    });
    if (qualifiedResults.length === 0) {
      setOpportunityRecommendations([]);
      setOpportunityGeneratedAt(undefined);
      setOpportunitySkipped([]);
      setOpportunityState('idle');
      setOpportunityError('');
      clearRecommendations();
      return;
    }

    setOpportunityState('loading');
    setOpportunityError('');
    const abortController = new AbortController();

    (async () => {
      try {
        // WA-0005: adapt once, then send compact byte-bounded batches so an
        // exhaustive scan cannot exceed the deployment request-body limit.
        // The modern scan-session gate above remains authoritative: only the
        // qualified/account-eligible results from this completed session are
        // submitted.
        const body = await evaluateScreenResultsInBatches(qualifiedResults, {
          signal: abortController.signal,
        });

        const { recommendations, generatedAt, skipped } = opportunityRecommendationsFromApiResponse(body);
        const rawAnalyses: DecisionAnalysis[] = body?.result?.recommendations ?? [];

        // The session may have been superseded while this request was in
        // flight — a stale response must never publish through to a newer
        // session's display.
        if (!cancelled && shouldGenerateRecommendationsForSession(activeSession, activeSessionIdRef.current)) {
          setOpportunityRecommendations(recommendations);
          setOpportunityGeneratedAt(generatedAt);
          setOpportunitySkipped(skipped);
          setOpportunityEvaluatedCount(qualifiedResults.length);
          setOpportunityState('loaded');
          publishRecommendations(rawAnalyses, generatedAt);
        }
      } catch (e: any) {
        if (!cancelled && e?.name !== 'AbortError') {
          // TE-0007D corrective — this used to unconditionally clear both
          // the local opportunityRecommendations state AND
          // RecommendationService's separate module-level state on ANY
          // fetch failure, including a refresh's recommendation fetch
          // failing while its own raw scan succeeded. That wiped prior
          // valid recommendations the real Ranked Scan orchestration test
          // explicitly requires stay visible alongside a genuine failure
          // notice. Local state: only clear when there's nothing valid to
          // preserve in the first place. RecommendationService: always
          // publish the real failure via failRecommendationsEvaluation
          // (not clearRecommendations, which resets to idle/no-error) --
          // that service is a separate consumer-facing signal (used
          // elsewhere in the app) and must always accurately reflect a
          // genuine failure, regardless of this component's own local
          // display/preservation logic.
          if (opportunityRecommendations.length === 0) {
            setOpportunityRecommendations([]);
            setOpportunityGeneratedAt(undefined);
            setOpportunitySkipped([]);
          }
          const message = e?.message ?? 'Unable to load ranked opportunities.';
          setOpportunityError(message);
          setOpportunityState('error');
          failRecommendationsEvaluation(message);
        }
      }
    })();

    return () => { cancelled = true; abortController.abort(); };
  }, [activeSession]);

  const clearResultsCache = () => {
    setResults([]); setRawScanCache([]); setResultsCachedAt(null); setTargetedResults([]); setTargetedResultsCachedAt(null);
    // SCREENER-RESULTS-0001 corrective — this used to clear every OTHER
    // cache key (raw scan, legacy results, targeted results) but never the
    // canonical session cache itself, and never the in-memory
    // activeSession/activeSessionIdRef either. A "cleared" scan's session
    // could therefore still be sitting in IndexedDB and reappear — with its
    // now-stale accounting summary and launcher highlight still attached —
    // on the very next page load's restore effect, even though every other
    // trace of that scan had just been wiped.
    setActiveSession(null);
    activeSessionIdRef.current = null;
    clearScanSessionCache();
    try { localStorage.removeItem(LS_RESULTS_CACHE_AT); localStorage.removeItem(LS_TARGETED_RESULTS_CACHE_AT); } catch {}
    idbDel(IDB_RAW_SCAN_KEY);
    idbDel(IDB_RESULTS_KEY);
    idbDel(IDB_TARGETED_RESULTS_KEY);
  };
  // TE-0007: handlePmccChange/handleCspChange removed — there is no
  // separate PMCC/CSP ticker state left to change; both strategies read
  // `opportunityUniverse`, updated via handleTickersChange above.
  const handleCspCashChange = (v: string) => { setCspCashOverride(v); try { localStorage.setItem(LS_CSP_CASH, v); } catch {} };
  // Hide-only toggle: can only narrow ccEligibleHoldings (verified by the
  // API), never introduce a symbol that lacks verified coverage -- the
  // ticket's "manual symbol filter must never add an uncovered symbol."
  const toggleCcSymbol = (symbol: string) => {
    setCcHiddenSymbols(prev => prev.includes(symbol) ? prev.filter(s => s !== symbol) : [...prev, symbol]);
  };
  // TE-0007: whether the Opportunity Universe is currently narrowing the CC
  // scan below what's actually eligible -- drives the explicit "Scan all
  // eligible holdings" override control (never invented capacity, only
  // ever a wider view of the SAME verified `ccEligibleHoldings`).
  const ccAllScannableHoldings = useMemo(
    () => ccEligibleHoldings.filter(h => h.availableCoveredContracts > 0 && !ccHiddenSymbols.includes(h.symbol)),
    [ccEligibleHoldings, ccHiddenSymbols]
  );
  const ccUniverseNarrowsCc = useMemo(
    () => opportunityUniverse.length > 0 && ccAllScannableHoldings.some(h => !opportunityUniverse.includes(h.symbol)),
    [opportunityUniverse, ccAllScannableHoldings]
  );
  const showLoadPrompt = (state: Omit<LoadPromptState, 'show'>) => { setLoadPrompt({ show: true, ...state }); };

  const parseTickers = normalizeTickerInput;

  const downloadCSV = () => {
    const csv = (value: unknown) => `"${String(value ?? '').replace(/"/g, '""')}"`;
    if (activeSession?.requestedStrategy === 'csp') {
      const blob = new Blob([buildCspCsv(results, activeSession)], { type: 'text/csv' });
      const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `csp-screen-${new Date().toISOString().split('T')[0]}.csv`; a.click();
      return;
    }
    // CSP-WORKFLOW-0001 core-correction (BLOCKER-04) — Candidate ID is the
    // canonical ScreenResult.candidateId, so a CSV row for one CSP contract
    // is unambiguously traceable back to it even when other columns alone
    // wouldn't disambiguate (e.g. two rows with the same strike text but
    // different expirations after manual sorting/filtering downstream).
    const headers = ['Candidate ID','Symbol','Strategy','Trend','Trend Subtype','Trend Confidence','Qualified','Price','IVR','Expiration','DTE','Short Put Strike','Long Put Strike','Put Width','Short Call Strike','Long Call Strike','Call Width','Short Delta','Credit','ROC%','POP%','Short OI','Long OI','Total Credit','Earnings Date','Fail Reasons'];
    const rows = results.map(r => { const c = r.bestCandidate; return [r.candidateId||'',r.symbol,r.strategy,r.trendResult?.trend||'',r.trendResult?.subtype||'',r.trendResult?.confidence!=null?r.trendResult.confidence.toFixed(0)+'%':'',r.qualified?'YES':'NO',r.price?.toFixed(2)||'',r.ivr?.toFixed(1)||'',c?.expiration||'',c?.dte||'',c?.shortStrike||'',c?.longStrike||'',c?.spreadWidth||'',c?.shortCallStrike||'',c?.longCallStrike||'',c?.callWidth||'',c?.shortDelta?.toFixed(2)||'',c?.credit?.toFixed(2)||'',c?.roc?.toFixed(0)||'',c?.pop?.toFixed(0)||'',c?.shortOI||'',c?.longOI||'',c?.totalCredit?.toFixed(2)||'',r.earningsDate||'',r.failReasons.join('; ')].map(csv).join(','); });
    const blob = new Blob([[headers.join(','),...rows].join('\n')], { type: 'text/csv' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `hunter-screen-${new Date().toISOString().split('T')[0]}.csv`; a.click();
  };

    // ── Apply rules client-side against cached raw scan data ──────────────────
  // Called instead of runScreen when rules change but tickers haven't changed.
  // Zero API calls — instant re-filter.
    // ── Apply rules client-side against cached raw scan data ──────────────────
  // SCREENER-RESULTS-0001 — this was the clearest case of an "independent
  // page-level result collection that can disagree with the session": it
  // called setResults() directly from a recompute over rawScanCache,
  // entirely bypassing session accounting. It now derives a fresh session
  // from the SAME scope/plan as whatever session is currently active
  // (rules changed, not the universe), so the accounting bar stays correct
  // through a rules-only re-filter. A plannedScanSymbols member NOT present
  // in rawScanCache (it never successfully raw-scanned originally — either
  // a trend-gate zero-candidate evaluation or a real chain-fetch failure)
  // carries forward that SAME original outcome, since new rules cannot
  // retroactively change whether a chain fetch that already happened
  // succeeded.
  const applyRules = useCallback((sRules: RulesType, eRules: RulesType, sLabel?: string, eLabel?: string) => {
    if (rawScanCache.length === 0) return;
    const priorSession = activeSession;
    if (!priorSession || priorSession.mode !== 'filter' || priorSession.requestedStrategy !== 'spreads') return;

    let session = beginScanSession({ mode: 'filter', requestedStrategy: 'spreads', scope: priorSession.scope });
    const rawBySymbol = new Map(rawScanCache.map(entry => [entry.symbol, entry]));
    for (const symbol of session.plannedScanSymbols) {
      const entry = rawBySymbol.get(symbol);
      if (entry) {
        try {
          const result = runChecklist(entry.symbol, entry.strategy, entry.metrics, entry.chainData, entry.price, sRules, entry.trendResult, sLabel, eRules, eLabel);
          session = recordSymbolEvaluated(session, symbol, [result]);
        } catch (e: any) {
          session = recordSymbolFailed(session, symbol, 'MARKET_DATA_REQUEST_FAILED');
        }
      } else {
        const priorOutcome = priorSession.symbolOutcomes.find(o => o.symbol === symbol);
        if (priorOutcome?.status === 'failed') {
          session = recordSymbolFailed(session, symbol, priorOutcome.reasonCode ?? 'MARKET_DATA_REQUEST_FAILED');
        } else {
          session = recordSymbolEvaluated(session, symbol, [], { reasonCode: 'NO_QUALIFYING_CANDIDATE' });
        }
      }
    }

    session = completeSession(session);
    const finalSession = session;
    commitScanSession(finalSession, () => {
      const sortedResults = [...finalSession.results].sort((a, b) => {
        if (a.qualified && !b.qualified) return -1;
        if (!a.qualified && b.qualified) return 1;
        // CSP-WORKFLOW-0001 core-correction (BLOCKER-03) — for CSP results,
        // cspScore.total is the authoritative sort key, not ivr. A missing
        // (UNAVAILABLE) score sorts after any available score, never as if
        // it scored 0.
        const aCsp = a.bestCandidate?.strategy === 'CSP' ? a.bestCandidate.cspScore : undefined;
        const bCsp = b.bestCandidate?.strategy === 'CSP' ? b.bestCandidate.cspScore : undefined;
        if (aCsp || bCsp) {
          const aScore = aCsp?.scoreStatus === 'AVAILABLE' ? aCsp.total : null;
          const bScore = bCsp?.scoreStatus === 'AVAILABLE' ? bCsp.total : null;
          if (aScore == null && bScore == null) return (b.ivr ?? 0) - (a.ivr ?? 0);
          if (aScore == null) return 1;
          if (bScore == null) return -1;
          return bScore - aScore;
        }
        return (b.ivr ?? 0) - (a.ivr ?? 0);
      });
      setResults(sortedResults);
      const applyTs = Date.now();
      setResultsCachedAt(applyTs);
      persistScanSession(finalSession);
      try {
        localStorage.setItem(LS_RESULTS_CACHE_AT, String(applyTs));
      } catch {}
    });
  }, [rawScanCache, activeSession]);

  // Live update when rules change
  useEffect(() => {
    if (rawScanCache.length > 0 && screenMode === 'filter') {
      applyRules(runtimeStockRules, runtimeEtfRules, stockPresetLabel, etfPresetLabel);
    }
  }, [runtimeStockRules, runtimeEtfRules, rawScanCache, screenMode, stockPresetLabel, etfPresetLabel, applyRules]);
  const runScreen = async (sRules: RulesType, eRules: RulesType, sLabel?: string, eLabel?: string, modeOverride?: 'filter' | 'rank' | 'targeted') => {    setError('');
    setResults([]); setResultsCachedAt(null);
    try { localStorage.removeItem(LS_RESULTS_CACHE_AT); } catch {}
    idbDel(IDB_RESULTS_KEY);

    const activeSymbols = tickers.filter(t => t.active).map(t => t.symbol);

    if (!activeSymbols.length) {
      setError('No active tickers in watchlist. Check the box next to a ticker to include it in the scan.');
      return;
    }

    setRuntimeStockRules(sRules);
    setRuntimeEtfRules(eRules);
    setLoading(true);

    // Rank mode now runs through startRankedScan (useRankedScan) with its own
    // task-manager-backed job tracking; this function's only live caller path
    // today is Filter mode, so the job is tagged 'filter' here.
    startScreenerJob({
      kind: 'filter', label: 'Screener scan', total: activeSymbols.length,
      status: 'Starting scan...', resultsHref: '/screener?mode=filter',
    });
    const pushStatus = (label: string) => { setStatus(label); updateScreenerJob({ status: label, phase: 'running' }); };

    // SCREENER-RESULTS-0001 — 'spreads' session; a whole-watchlist scan has
    // no capacity-style eligibility gate, so eligibleSymbols === the
    // universe itself (every selected symbol is planned). `session` is
    // threaded through the loop below as a local variable (never touched
    // directly by page.tsx — only via the validated transition functions)
    // and only committed to React state at completion/error, via
    // commitScanSession()'s stale check.
    const sessionMode: ScreenerScanMode = modeOverride === 'rank' ? 'rank' : 'filter';
    let session = beginScanSession({
      mode: sessionMode,
      requestedStrategy: 'spreads',
      scope: { universeSymbols: activeSymbols, eligibleSymbols: activeSymbols },
    });
    const loopSymbols = session.plannedScanSymbols;

    try {
      pushStatus('Getting access token...');
      const token = await getAccessToken();

      pushStatus('Fetching market metrics...');
      const metricsArray = await getMarketMetrics(loopSymbols, token);

      const metricsMap = Object.fromEntries(metricsArray.map((m: any) => [m.symbol, m]));

      const scanCache: RawScanEntry[] = [];

      // getChain uses the appropriate rule set for DTE filtering — pass stock rules as base,
      // runChecklist will auto-select ETF rules internally per ticker
      const getChainRules = (isEtfTicker: boolean) => isEtfTicker ? eRules : sRules;

      // Scan active watchlist tickers — one loop, but Filter and Rank modes
      // diverge in shape: Filter still uses the trend-gated "smart skip" (one
      // recommended strategy per ticker, NO_TRADE skips it entirely). Rank
      // mode is exhaustive — every strategy, every qualifying strike, every
      // expiration, no trend gate — because "ranked" means score sorts the
      // full candidate set rather than a single curated pick per symbol.
      // Trend is still fetched for Rank mode (used for the trend-alignment
      // badge and momentum scoring) but never used to skip a ticker.
      const isRankMode = (modeOverride ?? screenMode) === 'rank';
      for (let i = 0; i < loopSymbols.length; i++) {
        const symbol = loopSymbols[i];
        pushStatus(`Scanning ${symbol} (${i + 1}/${loopSymbols.length})...`);
        updateScreenerJob({ progressCurrent: i + 1 });
        const classification = await classifyUnderlying(symbol, token);
        const isEtfTicker = classification === 'index' || classification === 'etf';
        let trendResult: TrendResult | undefined;
        try { trendResult = await getTrend(symbol, isEtfTicker); } catch (e) { console.warn(e); }

        // NO_TRADE (or trend fetch failure) means the chart didn't qualify —
        // skip this ticker entirely in Filter mode. Rank mode explores
        // regardless; a NO_TRADE chart can still have a real credit spread,
        // and score (not the trend gate) decides where it lands. This is a
        // genuine evaluated-with-zero-candidates outcome (trend WAS
        // checked), not a scope exclusion or a failure.
        if (!isRankMode && (!trendResult || trendResult.strategy === 'NO_TRADE')) {
          session = recordSymbolEvaluated(session, symbol, [], { reasonCode: 'NO_QUALIFYING_CANDIDATE' });
          continue;
        }

        try {
          const metrics = metricsMap[symbol] || { symbol, ivRank: null, earningsExpectedDate: null };
          const rankDteWindow = isRankMode ? { min: RANK_SCAN_DTE_MIN, max: RANK_SCAN_DTE_MAX } : undefined;
          const [chainData, price] = await Promise.all([
            getChain(symbol, token, getChainRules(isEtfTicker), rankDteWindow),
            getQuote(symbol, token),
          ]);
          if (isRankMode) {
            scanCache.push({ symbol, strategy: trendResult?.strategy === 'NO_TRADE' ? 'BPS' : (trendResult?.strategy ?? 'BPS'), metrics, chainData, price, trendResult });
            const candidates = exploreAllCandidatesForRank(symbol, metrics, chainData, price, sRules, trendResult, isEtfTicker, eRules, sLabel, eLabel);
            session = candidates.length > 0
              ? recordSymbolEvaluated(session, symbol, candidates)
              : recordSymbolEvaluated(session, symbol, [], { reasonCode: 'NO_QUALIFYING_CANDIDATE' });
          } else if (trendResult) {
            const s = trendResult.strategy as 'BPS' | 'BCS' | 'IC';
            scanCache.push({ symbol, strategy: s, metrics, chainData, price, trendResult });
            const result = runChecklist(symbol, s, metrics, chainData, price, sRules, trendResult, sLabel, eRules, eLabel);
            session = recordSymbolEvaluated(session, symbol, [result]);
          }
        } catch (e: any) {
          // Real acquisition failure — recorded as 'failed' with an explicit
          // reason, never fabricated into a synthetic ScreenResult that
          // would silently sit alongside genuine evaluations.
          session = recordSymbolFailed(session, symbol, 'MARKET_DATA_REQUEST_FAILED');
        }
      }

      session = completeSession(session);
      const sortedResults = [...session.results];
      if (sessionMode === 'rank') {
        // Sort by score descending; no-candidate results go to the bottom
        sortedResults.sort((a, b) => {
          const sA = scoreCandidate(a, rankConfig)?.score ?? 0;
          const sB = scoreCandidate(b, rankConfig)?.score ?? 0;
          return sB - sA;
        });
      } else {
        sortedResults.sort((a, b) => {
          if (a.qualified && !b.qualified) return -1;
          if (!a.qualified && b.qualified) return 1;
          // CSP-WORKFLOW-0001 core-correction (BLOCKER-03) — cspScore.total
          // is the authoritative CSP sort key; a missing (UNAVAILABLE) score
          // sorts after any available score, never as if it scored 0.
          const aCsp = a.bestCandidate?.strategy === 'CSP' ? a.bestCandidate.cspScore : undefined;
          const bCsp = b.bestCandidate?.strategy === 'CSP' ? b.bestCandidate.cspScore : undefined;
          if (aCsp || bCsp) {
            const aScore = aCsp?.scoreStatus === 'AVAILABLE' ? aCsp.total : null;
            const bScore = bCsp?.scoreStatus === 'AVAILABLE' ? bCsp.total : null;
            if (aScore == null && bScore == null) return (b.ivr ?? 0) - (a.ivr ?? 0);
            if (aScore == null) return 1;
            if (bScore == null) return -1;
            return bScore - aScore;
          }
          return (b.ivr ?? 0) - (a.ivr ?? 0);
        });
      }

      // SCREENER-RESULTS-0001 corrective — rawScanCache and its IndexedDB
      // mirror used to be written here, BEFORE commitScanSession's stale
      // check, so a superseded scan's late scanCache could still land in
      // rawScanCache/IDB_RAW_SCAN_KEY and silently feed a later
      // applyRules() re-filter even though its session commit was rejected.
      // Moved inside the commit callback so a stale scan's cache write is
      // rejected by the exact same gate as everything else it produced.
      // SCREENER-RESULTS-0001 final corrective — the IndexedDB record is now
      // tagged with the owning session's sessionId. rawScanCache feeds
      // applyRules() directly (executable state, not just display), so on
      // restore it must be provably the SAME scan's data, not merely
      // "whatever the last write happened to be" — see the restore effect
      // below, which now requires an exact sessionId match.
      const committed = commitScanSession(session, () => {
        setRawScanCache(scanCache);
        idbSet(IDB_RAW_SCAN_KEY, { sessionId: session.sessionId, entries: scanCache }); // IndexedDB — full chain data can exceed localStorage's quota
        setResults(sortedResults);
        const cacheTs = Date.now();
        setResultsCachedAt(cacheTs);
        persistScanSession(session);
        try {
          localStorage.setItem(LS_RESULTS_CACHE_AT, String(cacheTs));
        } catch {}
        completeScreenerJob({
          resultCount: sortedResults.length,
          status: `${sortedResults.length} result${sortedResults.length === 1 ? '' : 's'} ready`,
          resultsHref: '/screener?mode=filter',
        });
      });
      if (!committed) {
        // Superseded by a newer scan while this one was in flight — its
        // results (and its rawScanCache) must never overwrite whatever the
        // newer session is showing. Nothing more to do; the newer scan owns
        // the UI now.
      }
    } catch (e: any) {
      // SCREENER-RESULTS-0001 corrective — a superseded scan's own catch
      // must not clobber the newer scan's loading/status/error/job state.
      if (isScanCurrent(session)) {
        setError(e.message);
        failScreenerJob(e.message);
      }
      const reasonCode: ScreenerReasonCode = /token/i.test(e?.message ?? '') ? 'ACCESS_TOKEN_UNAVAILABLE' : 'MARKET_DATA_REQUEST_FAILED';
      try {
        session = errorSession(session, reasonCode);
        commitScanSession(session);
      } catch { /* session already terminal (e.g. a supersession raced this catch) */ }
    } finally {
      // SCREENER-RESULTS-0001 corrective — same staleness guard: a
      // superseded scan's finally block must not reset loading/status back
      // to idle after a newer scan has already set them for itself.
      if (isScanCurrent(session)) {
        setStatus('');
        setLoading(false);
      }
    }
  };

  // Scan PMCC using the canonical Opportunity Universe — entirely separate
  // action from runScreen/Run Hunter. A PMCC scan replaces and isolates
  // prior strategy results. TE-0007: no longer reads a separate PMCC-only
  // ticker list; uses the same normalized array every other strategy
  // button reads.
  const runPMCCScan = async (submitted?: PmccScanCriteria) => {
    const pmcc = opportunityUniverse;
    if (!pmcc.length) {
      setError('No tickers in the Opportunity Universe to scan. Add a ticker above first.');
      return;
    }
    const dte = submitted?.dte ?? { shortMin: pmccShortDteMin, shortMax: pmccShortDteMax, longMin: pmccLongDteMin, longMax: pmccLongDteMax };
    if (!isValidPmccDteRanges(dte)) {
      setError('PMCC DTE ranges are invalid. Each minimum must be zero or greater and no larger than its maximum.');
      return;
    }
    setError('');
    if (submitted) {
      setPmccShortDteMin(submitted.dte.shortMin);
      setPmccShortDteMax(submitted.dte.shortMax);
      setPmccLongDteMin(submitted.dte.longMin);
      setPmccLongDteMax(submitted.dte.longMax);
      persistPmccDteRanges(submitted.dte);
    }
    // Switch to Filter mode immediately -- the same thing the main
    // "SCAN SELECTED" button already does via RunModeModal's onRun handler
    // before it calls runScreen(). Without this, PMCC/CSP/CC scans only set
    // the toast's resultsHref link, leaving the visible UI on whatever mode
    // (e.g. Rank) was last active until the person clicks "Open Results".
    setScreenMode('filter');
    try { localStorage.setItem(LS_SCREEN_MODE, 'filter'); } catch {}
    setLoading(true);
    startScreenerJob({
      kind: 'pmcc', label: 'PMCC scan', total: pmcc.length,
      status: 'Starting PMCC scan...', resultsHref: '/screener?mode=filter',
    });
    const pushStatus = (label: string) => { setStatus(label); updateScreenerJob({ status: label, phase: 'running' }); };

    // SCREENER-RESULTS-0001 — 'pmcc' session, filter mode only. Replaces,
    // never merges into, whatever session was previously active.
    const pmccAsOf = new Date();
    const pmccMarketSession = derivePmccMarketSession(pmccAsOf);
    // TE-0007D corrective — every field below now comes from the submitted
    // modal criteria when present, falling back to the prior hardcoded
    // DEFAULT_* constants only if this is ever invoked without going
    // through the modal (defensive, not the normal path -- FIND PMCCs
    // always opens the modal now).
    const pmccCriteria = {
      dte,
      longDelta: submitted?.longDelta ?? { ...DEFAULT_PMCC_LONG_DELTA_RANGE },
      shortDelta: submitted?.shortDelta ?? { ...DEFAULT_PMCC_SHORT_DELTA_RANGE },
      longOiMin: submitted?.longOiMin ?? DEFAULT_PMCC_LONG_OI_MIN,
      shortOiMin: submitted?.shortOiMin ?? DEFAULT_PMCC_SHORT_OI_MIN,
      requireDebitBelowWidth: submitted?.requireDebitBelowWidth ?? true,
      quotePolicy: { ...DEFAULT_PMCC_QUOTE_POLICY },
      limits: { ...DEFAULT_PMCC_PAIRING_LIMITS },
    };
    const pmccSnapshot: PmccScanSnapshot = {
      asOf: pmccAsOf.toISOString(), marketSession: pmccMarketSession, criteria: pmccCriteria,
    };
    let session = beginScanSession({
      mode: 'filter',
      requestedStrategy: 'pmcc',
      scope: { universeSymbols: pmcc, eligibleSymbols: pmcc },
      pmccSnapshot,
    });
    // TE-0007F — Ian/Paul: score/pop/creditPct are structurally always
    // null for PMCC (a debit structure, not a credit spread; PMCC's own
    // roc field literally carries a pending('Generic spread scoring is
    // not used for PMCC') placeholder, confirmed in pmccProduction.ts).
    // Leaving the sort on one of those fields silently reproduces the
    // "Contract order" bug this whole ticket exists to fix -- every
    // candidate ties on null, order falls back to arrival order. Only
    // resets when the CURRENT primary is one of those dead fields;
    // never overrides a PMCC-relevant field the person already chose.
    if (filteredSort.primary === 'score' || filteredSort.primary === 'pop' || filteredSort.primary === 'creditPct') {
      setFilteredSort({ primary: 'widthMinusDebitPct', secondary: 'none' });
    }
    const loopSymbols = session.plannedScanSymbols;

    try {
      pushStatus('Getting access token...');
      const token = await getAccessToken();

      pushStatus('Fetching market metrics...');
      const metricsArray = await getMarketMetrics(loopSymbols, token);
      const metricsMap = Object.fromEntries(metricsArray.map((m: any) => [m.symbol, m]));

      for (let pmccLoopIdx = 0; pmccLoopIdx < loopSymbols.length; pmccLoopIdx++) {
        const symbol = loopSymbols[pmccLoopIdx];
        pushStatus(`Scanning PMCC ${symbol}...`);
        updateScreenerJob({ progressCurrent: pmccLoopIdx + 1 });
        const metrics = metricsMap[symbol] || { symbol, ivRank: null, earningsExpectedDate: null };
        const outcome = await runPmccSymbolProduction({
          snapshot: pmccSnapshot,
          fallbackContext: {
            symbol, price: null, ivr: metrics.ivRank ?? null,
            earningsDate: metrics.earningsExpectedDate ?? null, underlyingType: 'stock',
          },
          acquire: async () => {
            const [pmccChain, price] = await Promise.all([
              getPMCCChain(symbol, token, {
                shortMin: pmccShortDteMin, shortMax: pmccShortDteMax,
                longMin: pmccLongDteMin, longMax: pmccLongDteMax,
              }),
              getQuote(symbol, token),
            ]);
            let trendResult: TrendResult | undefined;
            const isEtfOrIndex = pmccChain.classification === 'index' || pmccChain.classification === 'etf';
            try { trendResult = await getTrend(symbol, isEtfOrIndex); } catch {}
            return {
              chain: pmccChain,
              context: {
                symbol, price: price as number, ivr: metrics.ivRank ?? null,
                earningsDate: metrics.earningsExpectedDate ?? null,
                trendResult, underlyingType: pmccChain.classification,
              },
            };
          },
        });
        session = outcome.status === 'evaluated'
          ? recordSymbolEvaluated(session, symbol, outcome.results)
          : recordSymbolFailed(session, symbol, 'MARKET_DATA_REQUEST_FAILED', outcome.audit);
      }

      session = completeSession(session);
      const committed = commitScanSession(session, () => {
        setResults(session.results);
        const cacheTs = Date.now();
        setResultsCachedAt(cacheTs);
        persistScanSession(session);
        try {
          localStorage.setItem(LS_RESULTS_CACHE_AT, String(cacheTs));
        } catch {}
        completeScreenerJob({
          resultCount: session.results.length,
          status: `${session.results.length} PMCC result${session.results.length === 1 ? '' : 's'} ready`,
          resultsHref: '/screener?mode=filter',
        });
      });
      void committed;
    } catch (e: any) {
      // SCREENER-RESULTS-0001 corrective — same staleness guard as the
      // other scan functions: a superseded PMCC scan's catch must not
      // clobber a newer scan's loading/status/error/job state.
      if (isScanCurrent(session)) {
        setError(e.message);
        failScreenerJob(e.message);
      }
      const reasonCode: ScreenerReasonCode = /token/i.test(e?.message ?? '') ? 'ACCESS_TOKEN_UNAVAILABLE' : 'MARKET_DATA_REQUEST_FAILED';
      try {
        const completedSymbols = new Set(session.symbolOutcomes.map(outcome => outcome.symbol));
        for (const symbol of session.plannedScanSymbols) {
          if (completedSymbols.has(symbol)) continue;
          const audit = buildPmccFailureAuditResult({
            symbol, price: null, ivr: null, earningsDate: null, underlyingType: 'stock',
          }, pmccSnapshot.asOf, 'MARKET_DATA_FAILURE', e?.message ?? 'PMCC scan-wide acquisition failed');
          session = recordSymbolFailed(session, symbol, reasonCode, audit);
        }
        session = completeSession(session);
        commitScanSession(session, () => {
          setResults(session.results);
          const cacheTs = Date.now();
          setResultsCachedAt(cacheTs);
          persistScanSession(session);
        });
      } catch { /* session already terminal */ }
    } finally {
      if (isScanCurrent(session)) {
        setStatus('');
        setLoading(false);
      }
    }
  };

  // Scan CSP using the canonical Opportunity Universe — entirely separate
  // action from runScreen/Run Hunter, same pattern as runPMCCScan above.
  // CSP results are appended to the existing results list, so they render
  // through the exact same result-card UI as BPS/BCS/IC/PMCC (same look
  // and feel, per DR-0001 §10). TE-0007: no separate CSP-only ticker list.
  const runCspScan = async (request: CspScanRequest) => {
    const csp = opportunityUniverse;
    if (!csp.length) {
      setError('No tickers in the Opportunity Universe to scan. Add a ticker above first.');
      return;
    }
    setError('');
    setLastCspMode(request.mode);
    setCspRequestsByMode(prev => ({ ...prev, [request.mode]: request }));
    setScanLiveMessage(`Cash-Secured Put ${request.mode} scan started for ${csp.length} selected tickers.`);
    setScreenMode(request.mode);
    if (request.mode === 'rank') setFilteredSort({ primary: 'score', secondary: request.rankSecondary });
    try { localStorage.setItem(LS_SCREEN_MODE, request.mode); } catch {}
    setLoading(true);
    startScreenerJob({
      kind: 'csp', label: 'CSP scan', total: csp.length,
      status: 'Starting CSP scan...', resultsHref: `/screener?mode=${request.mode}`,
    });
    const pushStatus = (label: string) => { setStatus(label); updateScreenerJob({ status: label, phase: 'running' }); };

    // SCREENER-RESULTS-0001 — 'csp' session, filter mode only. A CSP launch
    // REPLACES whatever session was previously active (never merges into
    // it) — this is the strategy-isolation fix: CSP results can no longer
    // end up displayed alongside a prior spread/CC/PMCC scan's results, and
    // the launcher highlight (derived from activeSession.requestedStrategy
    // below, in the render) can no longer silently drift back to
    // "FIND SPREADS" after a CSP scan completes.
    let session = beginScanSession({
      mode: request.mode,
      requestedStrategy: 'csp',
      scope: { universeSymbols: csp, eligibleSymbols: csp },
      // CSP-WORKFLOW-0001 core-correction (BLOCKER-06) — every CSP session
      // now carries the immutable snapshot of the rules that actually ran.
      // Every CSP scan today applies exactly DEFAULT_CSP_RULES (there is no
      // per-session override path yet), so a snapshot built from it here is
      // faithful to what findAllCsp() below is about to apply.
      ruleSnapshot: buildCspRuleSnapshot(request.rules, {
        source: 'user', mode: request.mode, preset: request.preset,
        popMin: request.popMin, otmMin: request.otmMin, rocMin: request.rocMin,
        rankSecondary: request.rankSecondary,
      }),
    });
    const loopSymbols = session.plannedScanSymbols;

    try {
      pushStatus('Getting access token...');
      const token = await getAccessToken();

      pushStatus('Checking available capital...');
      // CSP-WORKFLOW-0001 core-correction (BLOCKER-02) — the manual cash
      // override is an explicit trader assertion (typed in, not guessed
      // from an unvalidated accounts[0]), so it is trusted as both sides of
      // min(optionBuyingPower, cashBalance) and marked account-selected
      // under a synthetic 'manual-override' identifier, preserving its
      // prior always-wins behavior. Absent an override, capital is resolved
      // from the real account via getCspCapitalContext(), which fails
      // closed (accountSelected: false, every figure null) whenever there
      // isn't exactly one verifiable Tastytrade account to attribute the
      // balance to -- never accounts[0] guessed blindly, never a fallback
      // constant.
      const manualCash = cspCashOverride.trim() === '' ? null : parseFloat(cspCashOverride);
      const capital: CspCapitalContext = Number.isFinite(manualCash as number)
        ? { accountSelected: true, accountId: 'manual-override', optionBuyingPower: manualCash as number, cashBalance: manualCash as number }
        : await getCspCapitalContext(token);

      pushStatus('Fetching market metrics...');
      const metricsArray = await getMarketMetrics(loopSymbols, token);
      const metricsMap = Object.fromEntries(metricsArray.map((m: any) => [m.symbol, m]));

      for (let cspLoopIdx = 0; cspLoopIdx < loopSymbols.length; cspLoopIdx++) {
        const symbol = loopSymbols[cspLoopIdx];
        pushStatus(`Scanning CSP ${symbol}...`);
        updateScreenerJob({ progressCurrent: cspLoopIdx + 1 });
        try {
          const classification = await classifyUnderlying(symbol, token);
          const isEtf = classification === 'index' || classification === 'etf';
          const metrics = metricsMap[symbol] || { symbol, ivRank: null, earningsExpectedDate: null };
          const [chainData, price] = await Promise.all([
            getChain(symbol, token, DEFAULT_RULES, { min: request.rules.DTE_MIN, max: request.rules.DTE_MAX }),
            getQuote(symbol, token),
          ]);
          let trendResult: TrendResult | undefined;
          try { trendResult = await getTrend(symbol, isEtf); } catch {}
          // CSP-WORKFLOW-0001 — one or more ScreenResults per symbol now
          // (one per discovered contract); recordSymbolEvaluated already
          // accepts an array and reconciles candidateCount against its
          // length — see lib/screener/scanSession.ts.
          const discovered = runCspChecklist(symbol, chainData, price, metrics, request.rules, capital, trendResult);
          const results = discovered.map(result => {
            const c = result.bestCandidate;
            if (!c) return result;
            const otm = price != null && price > 0 ? ((price - c.shortStrike) / price) * 100 : null;
            const targetedFailures = [
              request.popMin != null && (c.pop == null || c.pop < request.popMin) ? `POP ${c.pop?.toFixed(1) ?? 'unavailable'}% is below targeted minimum ${request.popMin}%` : null,
              request.otmMin != null && (otm == null || otm < request.otmMin) ? `OTM ${otm?.toFixed(1) ?? 'unavailable'}% is below targeted minimum ${request.otmMin}%` : null,
              request.rocMin != null && (c.roc == null || c.roc < request.rocMin) ? `Period ROC ${c.roc?.toFixed(1) ?? 'unavailable'}% is below targeted minimum ${request.rocMin}%` : null,
            ].filter((v): v is string => v != null);
            const modeQualification = request.mode !== 'targeted' ? 'NOT_APPLICABLE' as const
              : targetedFailures.length === 0 ? 'PASSED' as const : 'FAILED' as const;
            const nextCandidate = { ...c, cspModeQualification: modeQualification, cspModeQualificationReasons: targetedFailures };
            return {
              ...result,
              bestCandidate: nextCandidate,
              qualified: c.cspMarketQualification != null
                ? isOverallCspQualified(c.cspMarketQualification, modeQualification)
                : false,
              failReasons: [...result.failReasons, ...targetedFailures],
            };
          });
          session = recordSymbolEvaluated(session, symbol, results);
        } catch (e: any) {
          session = recordSymbolFailed(session, symbol, 'MARKET_DATA_REQUEST_FAILED');
        }
      }

      session = completeSession(session);
      const committed = commitScanSession(session, () => {
        setResults(session.results);
        const cacheTs = Date.now();
        setResultsCachedAt(cacheTs);
        persistScanSession(session);
        try {
          localStorage.setItem(LS_RESULTS_CACHE_AT, String(cacheTs));
        } catch {}
        completeScreenerJob({
          resultCount: session.results.length,
          status: `${session.results.length} CSP result${session.results.length === 1 ? '' : 's'} ready`,
          resultsHref: `/screener?mode=${request.mode}`,
        });
        const accounting = computeSessionAccounting(session);
        setScanLiveMessage(`Cash-Secured Put scan completed. ${accounting.evaluatedCount} symbols evaluated, ${accounting.qualifiedCandidateCount} candidates qualified, ${accounting.disqualifiedCandidateCount} candidates disqualified.`);
      });
      void committed; // superseded scans simply discard their own late results
    } catch (e: any) {
      // SCREENER-RESULTS-0001 corrective — same staleness guard as
      // runScreen()/runCcScan(): a superseded CSP scan's catch must not
      // clobber a newer scan's loading/status/error/job state.
      if (isScanCurrent(session)) {
        setError(e.message);
        setScanLiveMessage(`Cash-Secured Put scan failed. ${e.message}`);
        failScreenerJob(e.message);
      }
      const reasonCode: ScreenerReasonCode = /token/i.test(e?.message ?? '') ? 'ACCESS_TOKEN_UNAVAILABLE' : 'MARKET_DATA_REQUEST_FAILED';
      try {
        session = errorSession(session, reasonCode);
        commitScanSession(session);
      } catch { /* session already terminal */ }
    } finally {
      if (isScanCurrent(session)) {
        setStatus('');
        setLoading(false);
      }
    }
  };

  // Scan CC-eligible holdings only (TE-0007C). Unlike runCspScan, the
  // universe here is NOT a free-form ticker list -- it's fetched fresh from
  // /api/covered-call-capacity (the ticket's "clear refresh/reload state")
  // and filtered to symbols the trader hasn't hidden. Manual filtering can
  // only narrow this set (toggleCcSymbol above), never add an uncovered
  // symbol, because the scan loop only ever iterates over what the API
  // returned as eligible.
  // TE-0007: bypassUniverse is the explicit "Scan all eligible holdings"
  // override -- it bypasses ONLY the Opportunity Universe narrowing, never
  // the underlying capacity verification (availableCoveredContracts > 0)
  // or the hide-only ccHiddenSymbols filter, which still apply either way.
  // Extracted from runCcScan (Option 1, per Alan/Quinn/Ian/Paul agreement on
  // the CC-modal ticket): capacity/holdings loading is independent of the
  // submitted rule fields, so it no longer waits for modal submission.
  // Fired the moment the modal opens, matching the ticket's "eligible
  // universe summary" requirement and CSP's selectedTickerCount-on-open
  // precedent. runCcScan below still calls this itself before scanning --
  // fetching twice (once for display, once at execution) is the simplest
  // correct way to guarantee the scan never acts on holdings data that's
  // gone stale while the modal sat open, without introducing shared-state
  // staleness tracking for a single cheap API call.
  const loadCcCapacity = async (): Promise<{ ok: boolean; eligibleHoldings: typeof ccEligibleHoldings; bySymbol?: Record<string, CoveredCallCapacity>; reason?: string }> => {
    setCcHoldingsLoading(true);
    try {
      const token = await getAccessToken();
      const capacityReport = await getCoveredCallCapacityReport(token);
      setCcHoldingsLoading(false);
      if (capacityReport.status !== 'ok') {
        const reason = capacityReport.unavailableReason
          ?? 'Could not load covered-call capacity — holdings or working-order data unavailable.';
        setCcUnavailableReason(reason);
        setCcEligibleHoldings([]);
        setCcBlockedHoldings([]);
        return { ok: false, eligibleHoldings: [], reason };
      }
      setCcUnavailableReason(null);
      const eligibleEntries = Object.entries(capacityReport.bySymbol).filter(([, c]) => c.grossCoveredContracts > 0);
      const eligibleHoldings = eligibleEntries.map(([symbol, c]) => ({ symbol, ...c }));
      const blockedHoldings = eligibleEntries.filter(([, c]) => c.availableCoveredContracts === 0).map(([symbol]) => symbol);
      setCcEligibleHoldings(eligibleHoldings);
      setCcBlockedHoldings(blockedHoldings);
      return { ok: true, eligibleHoldings, bySymbol: capacityReport.bySymbol };
    } catch (e: any) {
      setCcHoldingsLoading(false);
      const reason = e?.message ?? 'Could not load covered-call capacity — holdings or working-order data unavailable.';
      setCcUnavailableReason(reason);
      setCcEligibleHoldings([]);
      setCcBlockedHoldings([]);
      return { ok: false, eligibleHoldings: [], reason };
    }
  };

  const runCcScan = async (bypassUniverse = false, rules: CcRulesType = ccRules) => {
    setError('');
    setScreenMode('filter');
    try { localStorage.setItem(LS_SCREEN_MODE, 'filter'); } catch {}
    setCcHoldingsLoading(true);
    setLoading(true);
    startScreenerJob({
      kind: 'cc', label: 'CC scan', total: 0,
      status: 'Loading eligible holdings...', resultsHref: '/screener?mode=filter',
    });
    const pushStatus = (label: string) => { setStatus(label); updateScreenerJob({ status: label, phase: 'running' }); };
    // Declared outside the try block (unlike the other four scan functions,
    // where the session is constructed before any awaits) because CC's
    // capacity/universe guard clauses below must run BEFORE a session
    // exists — none of them are attempts against a real, in-flight session,
    // so none of them should ever need to terminate one. Once the guards
    // pass and a session IS constructed, the outer catch below still needs
    // to reach it to close it out via errorSession() rather than leaving it
    // stuck 'running' forever, hence the wider scope here.
    let session: ScreenerScanSession | null = null;
    try {
      // Token first -- same order as every other scan function in this file.
      // The earlier version of this function fetched holdings via a Next.js
      // server API route before getting a token at all; that route used a
      // different (cookie-based, server-side) auth mechanism this app's
      // actual login flow never populates. Fixed to match CSP/PMCC/BPS.
      pushStatus('Getting access token...');
      const token = await getAccessToken();

      pushStatus('Loading eligible holdings...');
      const { ok, eligibleHoldings, bySymbol: capacityBySymbolMap, reason: capacityFailReason } = await loadCcCapacity();
      if (!ok || !capacityBySymbolMap) {
        const reason = capacityFailReason
          ?? 'Could not load covered-call capacity — holdings or working-order data unavailable.';
        setError(reason);
        failScreenerJob(reason);
        return;
      }

      // TE-0007: the Opportunity Universe may narrow this set (intersect
      // with verified eligible holdings) but can NEVER create eligibility
      // -- a ticker typed into the shared box that isn't a verified,
      // capacity-available holding is simply never in `eligibleHoldings`
      // to begin with, so there's nothing to add here even if we wanted to.
      const allScannable = eligibleHoldings.filter(h => h.availableCoveredContracts > 0 && !ccHiddenSymbols.includes(h.symbol));
      const eligibleSymbols = allScannable.map(h => h.symbol);

      // SCREENER-RESULTS-0001 — an empty ORDINARY Opportunity Universe must
      // never silently behave as "Scan all eligible holdings." Previously,
      // `universeNarrows` was false whenever the universe was empty
      // (`opportunityUniverse.length > 0 && !bypassUniverse`), which made
      // `scannable` fall through to `allScannable` — i.e. every eligible
      // holding — even though the trader never asked for that. The override
      // must be an explicit choice (bypassUniverse === true), never inferred
      // from an empty list.
      if (!bypassUniverse && opportunityUniverse.length === 0) {
        const msg = 'Your Opportunity Universe is empty. Add tickers to it, or use "Scan all eligible holdings" to scan every covered-call-eligible holding.';
        setError(msg);
        failScreenerJob(msg);
        return;
      }

      const universeSymbols = bypassUniverse ? eligibleSymbols : opportunityUniverse;
      const scannable = normalizeSymbols(universeSymbols).filter(s => new Set(eligibleSymbols).has(s));

      if (!scannable.length) {
        if (!bypassUniverse && eligibleSymbols.length > 0) {
          const msg = 'No covered-call-eligible holdings match the current Opportunity Universe.';
          setError(msg);
          failScreenerJob(msg);
          return;
        }
        const msg = 'No eligible covered-call holdings with available capacity to scan.';
        setError(msg);
        failScreenerJob(msg);
        return;
      }
      updateScreenerJob({ progressTotal: scannable.length });

      // SCREENER-RESULTS-0001 — precise per-symbol scope-exclusion reasons
      // for every selected-but-not-planned symbol (TE-0007C protections,
      // now expressed through the canonical model instead of an ad-hoc
      // "no eligible holdings" message that couldn't distinguish WHY a
      // given selected symbol didn't make it into the plan).
      const capacityBySymbol = capacityBySymbolMap;
      const scopeExclusionReasonCode = (symbol: string): ScreenerReasonCode => {
        if (ccHiddenSymbols.includes(symbol)) return 'CC_HIDDEN_BY_TRADER';
        const capacity = capacityBySymbol[symbol];
        if (!capacity || capacity.grossCoveredContracts <= 0) return 'CC_NO_SHARES_OWNED';
        if (capacity.availableCoveredContracts <= 0) return 'CC_FULLY_COVERED';
        return 'CC_NO_CAPACITY';
      };

      // `s` is a non-null local alias so TypeScript can track the session
      // through every reassignment without the outer, catch-visible
      // `session` variable's `| null` type getting in the way; `session` is
      // kept in sync after every transition purely so the outer catch below
      // can find and close out a session that was already constructed.
      let s = beginScanSession({
        mode: 'filter',
        requestedStrategy: 'cc',
        scope: { universeSymbols, eligibleSymbols, universeOverridden: bypassUniverse },
        scopeExclusionReasonCode,
      });
      session = s;
      const loopSymbols = s.plannedScanSymbols;

      pushStatus('Fetching market metrics...');
      const metricsArray = await getMarketMetrics(loopSymbols, token);
      const metricsMap = Object.fromEntries(metricsArray.map((m: any) => [m.symbol, m]));

      for (let ccLoopIdx = 0; ccLoopIdx < loopSymbols.length; ccLoopIdx++) {
        const symbol = loopSymbols[ccLoopIdx];
        pushStatus(`Scanning CC ${symbol}...`);
        updateScreenerJob({ progressCurrent: ccLoopIdx + 1 });
        try {
          const classification = await classifyUnderlying(symbol, token);
          const isEtf = classification === 'index' || classification === 'etf';
          const metrics = metricsMap[symbol] || { symbol, ivRank: null, earningsExpectedDate: null };
          const [chainData, price] = await Promise.all([
            getChain(symbol, token, DEFAULT_RULES, { min: rules.DTE_MIN, max: rules.DTE_MAX }),
            getQuote(symbol, token),
          ]);
          let trendResult: TrendResult | undefined;
          try { trendResult = await getTrend(symbol, isEtf); } catch {}
          // capacityReport.bySymbol[symbol] IS already a CoveredCallCapacity --
          // no need to reconstruct it field-by-field from the flattened
          // eligibleHoldings array (that reconstruction was dead weight left
          // over from the old server-route response shape).
          const capacity: CoveredCallCapacity = capacityBySymbolMap[symbol];
          const result = runCcChecklist(symbol, chainData, price, metrics, rules, capacity, trendResult);
          s = recordSymbolEvaluated(s, symbol, [result]);
        } catch (e: any) {
          s = recordSymbolFailed(s, symbol, 'MARKET_DATA_REQUEST_FAILED');
        }
        session = s;
      }

      s = completeSession(s);
      session = s;
      const finalSession = s;
      const committed = commitScanSession(finalSession, () => {
        setResults(finalSession.results);
        const cacheTs = Date.now();
        setResultsCachedAt(cacheTs);
        persistScanSession(finalSession);
        try {
          localStorage.setItem(LS_RESULTS_CACHE_AT, String(cacheTs));
        } catch {}
        completeScreenerJob({
          resultCount: finalSession.results.length,
          status: `${finalSession.results.length} CC result${finalSession.results.length === 1 ? '' : 's'} ready`,
          resultsHref: '/screener?mode=filter',
        });
      });
      void committed;
    } catch (e: any) {
      // Unattributable account-wide covered-call exposure is handled above
      // (capacityReport.status !== 'ok', before any session exists) via the
      // global fail-closed path, exactly as TE-0007C established — it is
      // never reached here as a per-symbol scope exclusion. This catch is
      // for real, unexpected failures — including one that happens after a
      // session was already constructed, which must still be closed out via
      // errorSession() rather than left stuck 'running' forever.
      // SCREENER-RESULTS-0001 corrective — same staleness guard as
      // runScreen(): a superseded CC scan's catch must not clobber a newer
      // scan's loading/status/error/job state.
      if (isScanCurrent(session)) {
        setError(e.message);
        failScreenerJob(e.message);
      }
      if (session && session.status === 'running') {
        try {
          const reasonCode: ScreenerReasonCode = /token/i.test(e?.message ?? '') ? 'ACCESS_TOKEN_UNAVAILABLE' : 'MARKET_DATA_REQUEST_FAILED';
          const errored = errorSession(session, reasonCode);
          commitScanSession(errored);
        } catch { /* session already terminal */ }
      }
    } finally {
      if (isScanCurrent(session)) {
        setStatus('');
        setLoading(false);
      }
    }
  };

  // Post-scan, client-side filters for Filter mode -- same pattern as
  // Rank/Targeted, layered on top of (not replacing) the qualify/disqualify
  // grading: these chips narrow which qualified/disqualified cards show,
  // they never change qualification status or trigger a rescan.
  const [filterPopMin, setFilterPopMin] = useState<number>(0);
  const [filterOtmMin, setFilterOtmMin] = useState<number>(0);
  const [filterCreditRatioMin, setFilterCreditRatioMin] = useState<number>(0);
  // SCREENER-OI-0001 — this chip list previously only listed BPS/BCS/IC,
  // predating CC/CSP/PMCC (TE-0007C/TE-0007) as Filtered-mode strategies.
  // Since those strategies were never included in the default array AND had
  // no toggle button to add them back, their results were silently excluded
  // from the QUALIFIED/DISQUALIFIED sections entirely -- a pre-existing gap,
  // not something this ticket set out to fix, but one that directly blocks
  // this ticket's own "consistent [OI/sort] behavior across scan modes"
  // requirement for those strategies in Filtered mode. Minimal, in-scope
  // correction: include every strategy Filtered mode can actually produce.
  const [filterStrategies, setFilterStrategies] = useState<string[]>(['BPS', 'BCS', 'IC', 'CSP', 'CC', 'PMCC']);
  const toggleFilterStrategy = (s: string) =>
    setFilterStrategies(prev => prev.includes(s) ? (prev.length === 1 ? prev : prev.filter(x => x !== s)) : [...prev, s]);
  const [filterHiddenSymbols, setFilterHiddenSymbols] = useState<string[]>([]);
  const toggleFilterSymbol = (sym: string) =>
    setFilterHiddenSymbols(prev => prev.includes(sym) ? prev.filter(s => s !== sym) : [...prev, sym]);

  const applyFilterModeChips = (list: ScreenResult[]) => list.filter(r => {
    if (filterHiddenSymbols.includes(r.symbol)) return false;
    if (activeSession?.requestedStrategy === 'pmcc') return true;
    if (!filterStrategies.includes(r.strategy)) return false;
    const c = r.bestCandidate;
    if (c) {
      if ((c.pop ?? 0) < filterPopMin) return false;
      if ((c.creditRatio ?? 0) * 100 < filterCreditRatioMin) return false;
      if (filterOtmMin > 0) {
        const price = r.price;
        if (price == null || price <= 0) return false;
        const otmPct = c.strategy === 'BPS' ? ((price - c.shortStrike) / price) * 100
          : c.strategy === 'BCS' ? ((c.shortStrike - price) / price) * 100
          : c.strategy === 'IC' && c.shortCallStrike != null
            ? Math.min(((price - c.shortStrike) / price) * 100, ((c.shortCallStrike - price) / price) * 100)
            : null;
        if (otmPct == null || otmPct < filterOtmMin) return false;
      }
    }
    return true;
  });

  const qualified = results.filter(r => r.qualified);
  const disqualified = results.filter(r => !r.qualified);
  // SCREENER-UX-0001 corrective pass: a scan that completed (or was
  // stopped/errored) with zero ScreenResults is a real, distinct outcome
  // from "no scan has run yet" -- it must still render the results panel
  // (scan identity, accounting, and the required Best-Opportunities empty
  // state) instead of falling through to the generic "ADD TICKERS" state.
  const hasCompletedScanForCurrentMode = !!(
    activeSession && activeSession.mode === screenMode && activeSession.status !== 'running'
  );
  const cspNonFilterSession = activeSession?.requestedStrategy === 'csp' && activeSession.mode !== 'filter';
  const activePmccSession = activeSession?.requestedStrategy === 'pmcc';
  // TE-0007H — a fourth real, pre-existing bug found in this same
  // investigation pattern: filteredQualifiedChips/filteredDisqualified
  // bypassed applyFilterModeChips entirely for PMCC, even though that
  // function already has its own correct, internal PMCC early-return
  // (skips the credit-spread-specific POP/creditRatio/OTM checks, but
  // still applies the symbol-hide filter first). The outer bypass meant
  // filterHiddenSymbols/toggleFilterSymbol -- real, working, already
  // used by every other strategy -- silently did nothing for PMCC.
  const filteredQualifiedChips = cspNonFilterSession ? qualified : applyFilterModeChips(qualified);
  const filteredDisqualified = cspNonFilterSession ? disqualified : applyFilterModeChips(disqualified);

  // SCREENER-OI-0001 — canonical minimum relevant-leg OI floor + two-level
  // sort, applied to the QUALIFIED section only. Eligibility filters
  // (qualify/disqualify, then the existing chips above) run first, and this
  // ordering runs after -- matching the ticket's "Filtered mode: apply all
  // eligibility filters first, followed by the selected ordering." The
  // disqualified section is left as-is: it's an audit trail of *why*
  // something didn't qualify, not a ranked results list.
  const calcFilteredOtmPct = (r: ScreenResult): number | null => {
    const c = r.bestCandidate;
    const price = r.price;
    if (!c || price == null || price <= 0) return null;
    if (c.strategy === 'BPS') return ((price - c.shortStrike) / price) * 100;
    if (c.strategy === 'BCS') return ((c.shortStrike - price) / price) * 100;
    if (c.strategy === 'IC' && c.shortCallStrike != null) {
      return Math.min(((price - c.shortStrike) / price) * 100, ((c.shortCallStrike - price) / price) * 100);
    }
    if (c.strategy === 'CSP' && c.breakeven != null && price > 0) return ((price - c.shortStrike) / price) * 100;
    return null;
  };
  const filteredOiByResult = new Map<ScreenResult, OiEligibilityResult>();
  // Targeted CSP is fully defined by its immutable launch snapshot. It must
  // not inherit the mutable Filter/Rank result controls that happen to live
  // in this page component.
  const cspTargetedSession = activeSession?.requestedStrategy === 'csp' && activeSession.mode === 'targeted';
  const effectiveFilteredMinOi = cspTargetedSession ? 0 : filteredMinOi;
  const effectiveFilteredSort = cspTargetedSession
    ? ({ primary: 'score', secondary: 'none' } as SortSpec)
    : filteredSort;
  // TE-0007F — a THIRD real, pre-existing bug found in this same
  // investigation, same class as the other two: the OI eligibility
  // filter itself (not just the controls rendering, not just the
  // sort) was also unconditionally bypassed for PMCC sessions. The
  // floor control rendered, the sort worked, but the floor never
  // actually excluded anything -- confirmed via a genuine test
  // failure (floor set to 300, both results still rendered) before
  // finding this.
  let filteredQualified = filteredQualifiedChips.filter(r => {
    const strat = toOiStrategy(r.strategy);
    if (!strat || !r.bestCandidate) return true; // strategies with no OI mapping are unaffected
    const oi = evaluateOiEligibility(extractOiLegsFromSpreadCandidate(strat, r.bestCandidate), effectiveFilteredMinOi);
    filteredOiByResult.set(r, oi);
    return oi.eligible;
  });
  // TE-0007F — a second real, pre-existing bug found while wiring PMCC
  // sort/filter: this whole sortItems call was unconditionally skipped
  // for PMCC sessions (activePmccSession ? filteredQualified : ...),
  // meaning PMCC results were never actually sorted by anything at all,
  // matching exactly the "Contract order" complaint that started this
  // thread. Removed the bypass so PMCC gets real sorting like every
  // other strategy.
  filteredQualified = sortItems(filteredQualified, effectiveFilteredSort, (r): SortableMetrics => {
    const c = r.bestCandidate;
    const strat = toOiStrategy(r.strategy);
    // TE-0007F — PMCC's three new sort fields read pmccPair.metrics
    // directly (not the flattened bestCandidate shape, which doesn't
    // carry width-minus-debit% or the raw leg data breakeven needs).
    // Same formulas as PmccResultCard, deliberately kept identical so
    // the sort order and the displayed numbers never silently diverge.
    const pmccMetrics = r.pmccPair?.metrics;
    const pmccBreakeven = pmccMetrics && r.pmccPair ? r.pmccPair.longLeg.strike + pmccMetrics.netDebitPerShare : null;
    return {
      score: c?.strategy === 'CSP'
        ? (c.cspScore?.scoreStatus === 'AVAILABLE' ? c.cspScore.total : null)
        : (strat ? scoreCandidate(r, rankConfig)?.score ?? null : null),
      pop: c?.pop ?? null,
      creditDollars: c?.credit ?? null,
      creditPct: c?.creditRatio != null ? c.creditRatio * 100 : null,
      rocPct: c?.roc ?? null,
      otmPct: calcFilteredOtmPct(r),
      relevantLegOI: strat && c ? computeRelevantLegOI(extractOiLegsFromSpreadCandidate(strat, c)) : null,
      dte: c?.dte ?? null,
      widthMinusDebitPct: pmccMetrics?.widthMinusDebitPctOfDebit ?? null,
      breakevenPct: pmccBreakeven != null && r.price ? ((r.price - pmccBreakeven) / r.price) * 100 : null,
      annualizedRoiPct: pmccMetrics && r.pmccPair && r.pmccPair.shortLeg.dte > 0
        ? pmccMetrics.shortCreditToNetDebitPct * (365 / r.pmccPair.shortLeg.dte)
        : null,
    };
  });

  // SCREENER-LAUNCHER-0001 corrective pass — identifies the ONE launcher
  // whose own scan invocation is currently in flight, replacing the
  // page-wide `loading` Boolean that previously made every launcher render
  // "SCANNING..." simultaneously. Read-only and derived entirely from the
  // canonical session: a session's status is 'running' only between
  // beginScanSession() (the real invocation start -- for Spreads, only
  // after RUN SCREENER is confirmed) and its completion/error/stop
  // transition, and beginScanSession() always supersedes any prior running
  // session first, so this can never resolve to more than one strategy at
  // once. No new mutable state, no effect on scanner routing, session
  // construction, qualification, or caching -- purely a render-time view of
  // state that already exists.
  const runningLauncher: LauncherStrategyId | null =
    activeSession?.status === 'running' ? activeSession.requestedStrategy : null;

  return (
    <div className={`min-h-screen ${th.bg} text-slate-100 transition-colors duration-200`} style={{ fontFamily: "'DM Sans', system-ui, sans-serif" }}>
      <span role="status" aria-live="polite" className="sr-only">{scanLiveMessage}</span>
      {/* Header */}
      <div className={`${th.header} border-b ${th.border} px-6 pb-0 pt-3 flex items-center justify-between sticky top-0 z-50 flex-col gap-0`}>
        <div className="flex items-center justify-between w-full pb-2">
          <div className="flex items-center gap-3">
            <svg width="46" height="46" viewBox="-26 -26 52 52" fill="none" xmlns="http://www.w3.org/2000/svg">
              <circle r="18" stroke="#00d4aa" strokeWidth="0.8" opacity="0.3"/>
              <circle r="12" stroke="#00d4aa" strokeWidth="0.8" opacity="0.6"/>
              <line x1="-23" y1="0" x2="-23" y2="0" stroke="#00d4aa" strokeWidth="1.1" strokeLinecap="round"/>
              <line x1="-23" y1="0" x2="-14" y2="0" stroke="#00d4aa" strokeWidth="1.1" strokeLinecap="round"/>
              <line x1="14" y1="0" x2="23" y2="0" stroke="#00d4aa" strokeWidth="1.1" strokeLinecap="round"/>
              <line x1="0" y1="-23" x2="0" y2="-14" stroke="#00d4aa" strokeWidth="1.1" strokeLinecap="round"/>
              <line x1="0" y1="14" x2="0" y2="23" stroke="#00d4aa" strokeWidth="1.1" strokeLinecap="round"/>
              <line x1="-6" y1="5" x2="-6" y2="-6" stroke="#ff5566" strokeWidth="1.8" strokeLinecap="round" opacity="0.85"/>
              <line x1="-1" y1="3" x2="-1" y2="-9" stroke="#00d4aa" strokeWidth="1.8" strokeLinecap="round"/>
              <line x1="4" y1="1" x2="4" y2="-12" stroke="#00d4aa" strokeWidth="1.8" strokeLinecap="round"/>
              <circle r="2" fill="#00d4aa"/>
            </svg>
            <div>
              <h1 className="text-lg font-bold tracking-widest text-white leading-tight" style={{ fontFamily: "'DM Mono', monospace" }}>TRADE<span style={{ color: '#00d4aa' }}>EDGE</span></h1>
              <p className="text-[9px] font-bold tracking-widest leading-tight" style={{ fontFamily: "'DM Mono', monospace", color: '#00d4aa', opacity: 0.75 }}>OPTIONS TRADING PLATFORM</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <a href="/help" target="_blank" className="text-white/50 hover:text-white/90 text-xs font-medium tracking-wider transition-colors" title="Help">?</a>
            <ThemeToggle theme={theme} setTheme={setTheme} accent={accent} setAccent={setAccent} />
          </div>
        </div>
        <div className={`flex items-center gap-0 w-full border-t border-white/10`}>
          <a href="/"            className="text-[10px] font-bold px-3 py-2 text-white/55 hover:text-white/80 transition-colors tracking-wider">HOME</a>
          <a href="/portfolio"   className="text-[10px] font-bold px-3 py-2 text-white/55 hover:text-white/80 transition-colors tracking-wider">PORTFOLIO</a>
          <span className="text-[10px] font-bold px-3 py-2 tracking-wider" style={{ color: '#00d4aa', borderBottom: '2px solid #00d4aa' }}>SCREENER</span>
          <a href="/engine"      className="text-[10px] font-bold px-3 py-2 text-white/55 hover:text-white/80 transition-colors tracking-wider">INCOME ENGINE</a>
          <a href="/rinse-repeat" className="text-[10px] font-bold px-3 py-2 text-white/55 hover:text-white/80 transition-colors tracking-wider">REPEAT STRATEGIES</a>
          <a href="/trade-log"   className="text-[10px] font-bold px-3 py-2 text-white/55 hover:text-white/80 transition-colors tracking-wider">TRADE LOG</a>
          <a href="/performance" className="text-[10px] font-bold px-3 py-2 text-white/55 hover:text-white/80 transition-colors tracking-wider">PERFORMANCE</a>
          <a href="/help"        className="text-[10px] font-bold px-3 py-2 text-white/55 hover:text-white/80 transition-colors tracking-wider">HELP</a>
        </div>
        
        </div>

      <div className="flex h-[calc(100vh-57px)]">
        {/* Sidebar */}
        <div className={`w-80 border-r ${th.border} ${th.sidebar} p-4 overflow-auto flex flex-col gap-3 shrink-0`}>
          {/* TE-0007: Opportunity Universe — the ONE canonical ticker list.
              Replaces the previously-separate general/PMCC/CSP ticker
              cards. Answers "which companies am I willing to evaluate";
              the buttons below answer "which strategy should evaluate
              them." Covered Calls is the one exception -- see its button's
              help text -- the universe can narrow its eligible holdings
              but can never create eligibility that verified share
              ownership doesn't already support. */}
          <div className={`${th.card} border ${th.border} rounded-xl p-3 space-y-3`}>
            <p className={`text-[9px] ${th.textMuted} tracking-widest font-medium`}>OPPORTUNITY UNIVERSE</p>
            <WatchlistBox
              tickers={tickers}
              onChange={handleTickersChange}
              disabled={loading || watchlistLoading}
              onLoadPrompt={showLoadPrompt}
              sessionsPanel={
                <SessionsPanel tickers={tickers} onLoadAll={handleTickersChange} onLoadPrompt={showLoadPrompt} th={th} />
              }
              th={th}
            />
            <p className={`text-[9px] ${th.textFaint}`}>
              {opportunityUniverse.length} ticker{opportunityUniverse.length === 1 ? '' : 's'} in your Opportunity Universe
            </p>
            <p className={`text-[9px] ${th.textFaint} leading-relaxed`}>
              Enter the companies you are willing to evaluate, then choose a strategy. Covered Calls use verified owned shares; the list can narrow them but cannot create coverage.
            </p>

            <div className="grid grid-cols-2 gap-1.5">
              {/* SCREENER-RESULTS-0001 / SCREENER-LAUNCHER-0001 — the
                  selected launcher is derived from
                  activeSession.requestedStrategy alone, never inferred
                  from screenMode, a candidate's shape, hover, focus, or the
                  last-clicked element. Previously FIND SPREADS was always
                  solid-filled regardless of selection while the other
                  three only ever got a translucent tint; LauncherButton
                  gives all four one shared unselected/selected visual
                  model (see its own header comment).

                  SCREENER-LAUNCHER-0001 corrective pass — production defect:
                  every launcher used to render its label from the page-wide
                  `loading` Boolean (`loading ? 'SCANNING...' : label`), so
                  ALL FOUR showed "SCANNING..." whenever any one scan ran.
                  `runningLauncher` fixes this by identifying the ONE
                  launcher whose own scan is actually in flight — derived
                  read-only from the canonical session (`activeSession`),
                  never a separate mutable flag: a session is 'running' only
                  between beginScanSession() (called at the moment a real
                  scan invocation starts — for Spreads, only after RUN
                  SCREENER is confirmed, never merely from opening the
                  config modal) and its completion/error/stop transition.
                  beginScanSession() also immediately supersedes any prior
                  still-running session, so this can never point at more
                  than one launcher, and a slow/failed older scan can never
                  clobber a newer one's running state — the same
                  stale-session guarantee every other canonical-session
                  consumer on this page already relies on. This performs NO
                  scanning, session, or qualification logic of its own. */}
              <LauncherButton
                strategy="spreads"
                label="FIND SPREADS"
                isSelected={activeSession?.requestedStrategy === 'spreads'}
                isRunning={runningLauncher === 'spreads'}
                onClick={() => setShowRunModal(true)}
                disabled={loading || !opportunityUniverse.length}
                title={!opportunityUniverse.length ? 'Add a ticker to the Opportunity Universe first.' : undefined}
              >
                {runningLauncher === 'spreads' ? 'SCANNING...' : 'FIND SPREADS'}
              </LauncherButton>
              <LauncherButton
                strategy="csp"
                label="FIND CSPs"
                isSelected={activeSession?.requestedStrategy === 'csp'}
                isRunning={runningLauncher === 'csp'}
                onClick={() => setShowCspRunModal(true)}
                disabled={loading || !opportunityUniverse.length}
                title={!opportunityUniverse.length ? 'Add a ticker to the Opportunity Universe first.' : undefined}
              >
                {runningLauncher === 'csp' ? 'SCANNING...' : 'FIND CSPs'}
              </LauncherButton>
              <LauncherButton
                strategy="cc"
                label="FIND CCs"
                isSelected={activeSession?.requestedStrategy === 'cc'}
                isRunning={runningLauncher === 'cc'}
                onClick={() => { setCcBypassUniverse(false); setShowCcScanModal(true); void loadCcCapacity(); }}
                disabled={loading}
                title="Uses verified owned shares. The Opportunity Universe can narrow eligible holdings but cannot add uncovered symbols."
              >
                {runningLauncher === 'cc' ? 'SCANNING...' : 'FIND CCs'}
              </LauncherButton>
              <LauncherButton
                strategy="pmcc"
                label="FIND PMCCs"
                isSelected={activeSession?.requestedStrategy === 'pmcc'}
                isRunning={runningLauncher === 'pmcc'}
                onClick={() => setShowPmccScanModal(true)}
                disabled={loading || !opportunityUniverse.length}
                title={!opportunityUniverse.length ? 'Add a ticker to the Opportunity Universe first.' : undefined}
              >
                {runningLauncher === 'pmcc' ? 'SCANNING...' : 'FIND PMCCs'}
              </LauncherButton>
              <button disabled
                title="Standalone LEAPS scanning requires its own conviction, duration, delta, valuation, and exit rules. PMCC scanning remains available separately."
                className={`col-span-2 text-xs font-bold tracking-widest py-2 rounded-lg border ${th.border} ${th.textFaint} opacity-50 cursor-not-allowed text-[10px]`}>
                FIND LEAPS — COMING SOON
              </button>
            </div>

            {/* PMCC DTE SETTINGS disclosure removed -- superseded by
                PmccScanModal, which now owns these same fields (same
                aria-labels preserved) inside the pre-scan modal FIND
                PMCCs opens, matching CSP/CC/Spreads' pattern. */}
            <details className="text-[9px]">
              <summary className={`cursor-pointer ${th.textMuted} tracking-widest font-medium`}>CSP SETTINGS</summary>
              <div className="mt-2">
                <p className={`text-[8px] ${th.textFaint} tracking-widest mb-1`}>AVAILABLE CASH (optional override)</p>
                <input
                  type="number"
                  min={0}
                  placeholder="Auto-detect from account"
                  value={cspCashOverride}
                  onChange={e => handleCspCashChange(e.target.value)}
                  className={`w-full ${th.input} border ${th.inputBorder} rounded px-2 py-1 text-[11px] ${th.text} focus:outline-none`}
                />
                <p className={`text-[8px] ${th.textFaint} mt-1`}>Leave blank to use your account&apos;s cash balance. Margin is never used by default.</p>
              </div>
            </details>
          </div>

          {/* CC status — compact, informational only (TE-0007C's verified-
              holdings display). Not a separate ticker-list card: the CC
              scan universe is never a free-form list, so there's nothing
              to "consolidate" here beyond showing what the button above
              will act on and offering the explicit "Scan all eligible
              holdings" override when the Opportunity Universe is narrowing
              it. */}
          <div className={`${th.card} border ${th.border} rounded-xl p-3 space-y-2`}>
            <p className={`text-[9px] ${th.textMuted} tracking-widest font-medium`}>COVERED CALL — ELIGIBLE HOLDINGS</p>
            {ccUnavailableReason ? (
              // TE-0007C final corrective pass: account-level data-integrity
              // failure -- open option exposure that couldn't be matched to a
              // holding. Deliberately NOT the "no eligible holdings loaded
              // yet" copy below, which would misrepresent this as an
              // ordinary empty result. Scanning stays blocked (the button
              // below still exists to retry, but runCcScan re-checks this
              // same condition and will not scan while it's set).
              <p className="text-[10px] text-red-400 bg-red-500/10 border border-red-500/30 rounded-lg p-2 leading-relaxed font-medium">
                {ccUnavailableReason}
              </p>
            ) : ccEligibleHoldings.length === 0 ? (
              <p className={`text-[10px] ${th.textFaint}`}>
                {ccHoldingsLoading ? 'Loading eligible holdings…' : 'No eligible holdings loaded yet — run a scan to check your account.'}
              </p>
            ) : opportunityUniverse.length === 0 ? (
              // SCREENER-RESULTS-0001 — an empty Opportunity Universe no
              // longer silently scans every eligible holding (that was the
              // exact bug this ticket fixes: "an empty ordinary Opportunity
              // Universe must not silently behave as the override"). This
              // is the explicit affordance for the override in that case —
              // previously there was no dedicated empty-universe branch at
              // all, so the override button never rendered here; the old
              // (buggy) auto-scan-all behavior was the only way to reach
              // every eligible holding from an empty universe.
              <div className="space-y-1.5">
                <p className={`text-[10px] ${th.textFaint}`}>
                  Your Opportunity Universe is empty. FIND CCs won&apos;t scan anything until you add tickers, or you can scan every eligible holding directly:
                </p>
                <button onClick={() => runCcScan(true)} disabled={loading}
                  className="w-full text-[10px] font-bold tracking-widest py-1.5 rounded-lg border border-cyan-500 text-cyan-400 hover:bg-cyan-500/10 transition-colors disabled:opacity-40">
                  SCAN ALL ELIGIBLE HOLDINGS
                </button>
              </div>
            ) : ccUniverseNarrowsCc && ccAllScannableHoldings.every(h => !opportunityUniverse.includes(h.symbol)) ? (
              // TE-0007: the Opportunity Universe currently overlaps none of
              // the verified eligible holdings -- a real distinct empty
              // state from "no eligible holdings at all," per the ticket.
              <div className="space-y-1.5">
                <p className="text-[10px] text-amber-300 bg-amber-500/10 border border-amber-500/30 rounded-lg p-2 leading-relaxed font-medium">
                  No covered-call-eligible holdings match the current Opportunity Universe.
                </p>
                <button onClick={() => runCcScan(true)} disabled={loading}
                  className="w-full text-[10px] font-bold tracking-widest py-1.5 rounded-lg border border-cyan-500 text-cyan-400 hover:bg-cyan-500/10 transition-colors disabled:opacity-40">
                  SCAN ALL ELIGIBLE HOLDINGS
                </button>
              </div>
            ) : (
              <div className="space-y-1.5">
                <p className={`text-[9px] ${th.textFaint}`}>
                  {ccEligibleHoldings.length} holding{ccEligibleHoldings.length === 1 ? '' : 's'} ·{' '}
                  {ccEligibleHoldings.reduce((sum, h) => sum + h.availableCoveredContracts, 0)} available contract
                  {ccEligibleHoldings.reduce((sum, h) => sum + h.availableCoveredContracts, 0) === 1 ? '' : 's'}
                </p>
                <div className="flex flex-wrap gap-1">
                  {ccEligibleHoldings.map(h => {
                    const hidden = ccHiddenSymbols.includes(h.symbol);
                    const blocked = h.availableCoveredContracts === 0;
                    return (
                      <button key={h.symbol} onClick={() => !blocked && toggleCcSymbol(h.symbol)} disabled={blocked}
                        title={blocked ? 'Fully covered — no available capacity' : h.hasUnclassifiedExposure ? 'Some option exposure could not be classified — capacity was reduced conservatively' : undefined}
                        className={`text-[9px] px-2 py-0.5 rounded border font-bold transition-colors ${
                          blocked
                            ? `${th.border} ${th.textFaint} line-through opacity-40 cursor-not-allowed`
                            : hidden
                            ? `${th.border} ${th.textFaint} line-through opacity-40`
                            : h.hasUnclassifiedExposure
                            ? 'border-amber-500 text-amber-300 bg-amber-500/10'
                            : 'border-cyan-600 text-cyan-300 bg-cyan-500/10'
                        }`}>
                        {h.symbol} <span className="opacity-60">({h.availableCoveredContracts})</span>{h.hasUnclassifiedExposure ? ' ⚠' : ''}
                      </button>
                    );
                  })}
                </div>
                {ccBlockedHoldings.length > 0 && (
                  <p className={`text-[9px] ${th.textFaint}`}>Fully covered / blocked: {ccBlockedHoldings.join(', ')}</p>
                )}
                {ccEligibleHoldings.some(h => h.hasUnclassifiedExposure) && (
                  // TE-0007C final corrective pass: per-symbol conservative-
                  // reservation disclosure -- the report stays 'ok'/usable,
                  // but the reduced capacity number must never be presented
                  // as fully verified. Never restores capacity by itself.
                  <p className="text-[9px] text-amber-400 bg-amber-500/10 border border-amber-500/30 rounded p-1.5 leading-relaxed">
                    ⚠ Some option exposure could not be classified. Available covered-call capacity was reduced conservatively.
                  </p>
                )}
                {ccUniverseNarrowsCc && (
                  // TE-0007: explicit override -- bypasses ONLY the
                  // Opportunity Universe narrowing, never capacity
                  // verification. Only shown when the universe is actually
                  // narrowing the eligible set.
                  <button onClick={() => runCcScan(true)} disabled={loading}
                    className="w-full text-[9px] font-medium tracking-wide py-1 rounded border border-cyan-600/50 text-cyan-300/80 hover:bg-cyan-500/10 transition-colors disabled:opacity-40">
                    Scan all eligible holdings (ignore Opportunity Universe)
                  </button>
                )}
              </div>
            )}
            {/* TE-0007 final corrective pass: this card used to also render
                its own "SCAN ELIGIBLE HOLDINGS FOR CC" button -- a second
                ordinary entry point for the exact same scan as the unified
                launcher's "FIND CCs" button above. Removed.
                FIND CCs is now the sole ordinary Covered Call
                scan action; this card is status/output only (verified
                capacity, blocked holdings, conservative-exposure warnings,
                fail-closed state, per-symbol hide controls) plus the
                explicit "Scan all eligible holdings" universe-bypass
                override rendered above when it's actually applicable. */}
          </div>

          {/* Transient alerts — not boxed, so they read as messages rather than a fixed section */}
          {error && <div className="text-[10px] text-red-400 bg-red-500/10 border border-red-500/30 rounded-lg p-2 leading-relaxed font-medium">{error}</div>}
          {loading && screenMode === 'targeted' && (
            <button onClick={() => { targetedCancelRef.current = true; }}
              className="w-full py-2 rounded-lg text-xs font-bold tracking-widest border border-red-600 text-red-400 hover:bg-red-600/20 transition-colors">
              ⏹ STOP SCAN
            </button>
          )}

          {/* Last Rules Used — hidden in rank mode */}
          {screenMode === 'filter' && activeSession?.requestedStrategy !== 'csp' && activeSession?.requestedStrategy !== 'pmcc' && (
            <div className={`${th.card} border ${th.border} rounded-xl p-3 text-[9px] space-y-1`}>
              <p className={`${th.textMuted} mb-2 tracking-widest font-medium`}>ACTIVE RULES</p>
              <div className="space-y-3">
                {[
                  { label: '📈 Stock', rules: runtimeStockRules, preset: stockPresetLabel },
                  { label: '🏦 ETF/Index', rules: runtimeEtfRules, preset: etfPresetLabel },
                ].map(({ label, rules, preset }) => (
                  <div key={label}>
                    <p className={`${th.textFaint} font-bold mb-1`}>{label} <span className="font-normal opacity-60">({preset})</span></p>
                    {[
                      ['IVR', `≥ ${rules.IVR_MIN}%`],
                      ['DTE', `${rules.DTE_MIN}–${rules.DTE_MAX}d`],
                      ['Credit ratio', `≥ ${(rules.CREDIT_RATIO_MIN * 100).toFixed(0)}%`],
                      ['OI per leg', `≥ ${rules.OI_MIN}`],
                      ['Bid-Ask', `≤ $${rules.BID_ASK_MAX}`],
                      ['Max width', `$${rules.MAX_SPREAD_WIDTH}`],
                      ['Min ROC spread', `${rules.ROC_MIN_SPREAD}%`],
                      ['Min ROC IC', `${rules.ROC_MIN_IC}%`],
                    ].map(([k, v]) => (
                      <div key={k} className="flex justify-between">
                        <span className={th.textFaint}>{k}</span>
                        <span className={`${th.textMuted} font-medium`}>{v}</span>
                      </div>
                    ))}
                  </div>
                ))}
              </div>
            </div>
          )}

        </div>

        {/* Main content */}
        <div className="flex-1 overflow-auto p-5">

          {/* Real-time Interactive Preset Filter Bar */}
          {screenMode === 'filter' && activeSession?.requestedStrategy !== 'csp' && activeSession?.requestedStrategy !== 'pmcc' && (
            <div className={`mb-4 p-3 ${th.card} border ${th.border} rounded-xl flex items-center justify-between gap-4 flex-wrap`}>
              <div className="flex items-center gap-2">
                <span className={`text-[10px] font-bold uppercase tracking-wider ${th.textFaint}`}>Quick Rule Presets:</span>
                <div className="flex gap-1.5 flex-wrap">
                  {[
                    { key: 'strict', label: 'Strict', rules: { IVR_MIN: 40, OI_MIN: 500, BID_ASK_MAX: 0.10, CREDIT_RATIO_MIN: 0.35, ROC_MIN_SPREAD: 25, ROC_MIN_IC: 35 } },
                    { key: 'course', label: 'Course', rules: { IVR_MIN: 30, OI_MIN: 500, BID_ASK_MAX: 0.10, CREDIT_RATIO_MIN: 0.33, ROC_MIN_SPREAD: 20, ROC_MIN_IC: 30 } },
                    { key: 'relaxed', label: 'Relaxed', rules: { IVR_MIN: 25, OI_MIN: 300, BID_ASK_MAX: 0.15, CREDIT_RATIO_MIN: 0.28, ROC_MIN_SPREAD: 15, ROC_MIN_IC: 25 } },
                    { key: 'lowvol', label: 'Low Vol', rules: { IVR_MIN: 20, OI_MIN: 200, BID_ASK_MAX: 0.20, CREDIT_RATIO_MIN: 0.22, ROC_MIN_SPREAD: 12, ROC_MIN_IC: 20 } },
                  ].map(p => {
                    const isActive = stockPresetLabel === p.label;
                    return (
                      <button
                        key={p.key}
                        onClick={() => {
                          const updatedRules = { ...runtimeStockRules, ...p.rules };
                          setRuntimeStockRules(updatedRules);
                          setStockPresetLabel(p.label);
                          try { 
                            localStorage.setItem('hunter-active-preset', p.key); 
                          } catch (e) {}
                        }}
                        className={`px-2.5 py-1 text-[10px] font-bold border rounded-lg transition-all ${
                          isActive 
                            ? 'bg-blue-500/10 border-blue-500 text-blue-400' 
                            : `${th.border} ${th.textFaint} hover:border-slate-500`
                        }`}
                      >
                        {p.label}
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className={`text-[10px] ${th.textFaint}`}>
                Active Stock DTE: <span className={`${th.text} font-medium`}>{runtimeStockRules.DTE_MIN}–{runtimeStockRules.DTE_MAX}d</span>
              </div>
            </div>
          )}

          {/* SCREENER-UX-0001 corrective pass: a completed scan that
              legitimately produced zero ScreenResults (every symbol
              failed/was skipped/produced no candidate) must still render
              the results panel -- including the required "no qualified
              opportunities" empty state -- rather than looking identical
              to "never ran a scan." hasCompletedScanForCurrentMode makes
              that distinction explicit. */}
          {results.length === 0 && targetedResults.length === 0 && !loading && !hasCompletedScanForCurrentMode && (
            <div className={`h-full flex flex-col items-center justify-center ${th.textFaint}`}>
              <div className="text-4xl mb-3 opacity-20">◈</div>
              <p className={`text-[10px] tracking-widest ${th.textMuted}`}>ADD TICKERS AND RUN HUNTER</p>
              <p className={`text-[9px] mt-2 ${th.textFaint}`}>Save sessions · Load scan lists · Upload Finviz screenshots</p>
            </div>
          )}
          {/* TE-0007D corrective — this used to show the full-screen
              spinner unconditionally whenever loading was true, which
              also hid the entire results panel below (its own gate
              required !loading) -- during a refresh of an already-
              displayed session, that synchronously hid prior valid
              results the instant the refresh started, the same
              user-facing defect this file's own comments already
              documented as "now fixed" for an older version of this UI,
              reintroduced here through a different mechanism. Now only
              shown for a genuine first scan (nothing to show yet); a
              refresh gets its own smaller indicator inside the still-
              visible panel below instead. */}
          {loading && results.length === 0 && targetedResults.length === 0 && <div className="h-full flex flex-col items-center justify-center gap-2"><div className={`text-[10px] tracking-widest ${th.textMuted} animate-pulse font-medium`}>{status || 'SCANNING...'}</div></div>}

          {(results.length > 0 || targetedResults.length > 0 || hasCompletedScanForCurrentMode) && (!loading || results.length > 0 || targetedResults.length > 0) && (
            <div className="space-y-4">
              {loading && (results.length > 0 || targetedResults.length > 0) && (
                <div className={`text-[10px] tracking-widest ${th.textMuted} animate-pulse font-medium px-1`}>
                  {status || 'Refreshing...'}
                </div>
              )}
              {/* TE-0007D corrective — opportunityError/opportunityState
                  were correctly SET by the recommendations effect's catch
                  block (confirmed via debug instrumentation: the real
                  error message reaches this state precisely), but nothing
                  in the render tree ever displayed them -- a genuinely
                  missing UI element, not a gating bug. role="alert" per
                  the real Ranked Scan orchestration test's explicit
                  requirement, distinguishable from the "Refreshing..."
                  banner above (role via the browser's implicit ARIA,
                  not role="status") -- a refresh failure must be
                  genuinely, accessibly distinct from a normal in-progress
                  refresh, not just styled differently. */}
              {!loading && opportunityState === 'error' && opportunityError && (
                <div role="alert" className="text-[10px] text-red-400 px-1">
                  {opportunityError}
                  {/* TE-0007D corrective — a second, real, missing piece:
                      when a refresh failure preserves prior valid
                      recommendations (per the earlier fix above), the
                      person looking at this needs to be told explicitly
                      that what they're seeing is the last GOOD data, not
                      something new or corrupted. Only shown when there's
                      genuinely something preserved to reassure about. */}
                  {opportunityRecommendations.length > 0 && (
                    <span className="block opacity-80">The last successfully published ranked opportunities remain visible.</span>
                  )}
                </div>
              )}
              {/* TE-0007D corrective — Finding 5's own store field
                  (lastResultsAffectingJobId) and capture logic already
                  exist and are already correct; page.tsx never read them.
                  Never hides the presentation -- results stay fully
                  visible/inspectable underneath, matching the real Ranked
                  Scan orchestration test's explicit requirement. */}
              {isPresentationStale && (
                <div role="status" className={`text-[10px] ${th.textMuted} px-1`}>
                  Superseded by a newer scan — this presentation may be out of date.
                </div>
              )}
              {/* TE-0007D corrective — Finding 3 added `skipped` as a real,
                  typed field (opportunityRecommendationsFromApiResponse's
                  return value), documented in that file's own header as
                  "the canonical evidence for a genuine partial-evaluation
                  disclosure," but page.tsx never actually read it -- the
                  plumbing was complete, only this rendering step was
                  missing. Never fabricated: skipped.length comes straight
                  from the route's own response, verbatim. */}
              {!loading && opportunitySkipped.length > 0 && (
                <div className={`text-[10px] ${th.textMuted} px-1`}>
                  Partial evaluation: {opportunitySkipped.length} of {opportunityEvaluatedCount} scan results could not be evaluated.
                </div>
              )}
              {/* SCREENER-UX-0001 — item 1 of the required hierarchy: scan
                  identity always leads. Falls back to the prior static
                  "⬢ FILTERED SCAN" label when no activeSession is available
                  for the currently displayed mode (matches the same guard
                  the accounting summary below has always used). */}
              {activeSession && activeSession.mode === screenMode ? (
                <ScanIdentityHeader
                  mode={activeSession.mode}
                  requestedStrategy={activeSession.requestedStrategy}
                  accentClassName={screenMode === 'filter' ? 'text-amber-400' : th.text}
                  textFaintClassName={th.textFaint}
                />
              ) : screenMode === 'filter' ? (
                <p className="text-sm font-bold tracking-wide text-amber-400">⬢ FILTERED SCAN</p>
              ) : null}
              <div className="flex items-center justify-between">
                <div className="flex gap-4 text-[10px] tracking-wider font-medium">
                  {screenMode === 'filter' || activeSession?.requestedStrategy === 'csp' ? (
                    <>
                      <span className="text-emerald-500">{filteredQualified.length} of {qualified.length} QUALIFIED</span>
                      <span className={th.textFaint}>{filteredDisqualified.length} of {disqualified.length} DISQUALIFIED</span>
                    </>
                  ) : screenMode === 'targeted' ? (
                    <>
                      <span className="text-teal-400">{targetedResults.length} SETUPS</span>
                      <span className={th.textFaint}>{Array.from(new Set(targetedResults.map(e => e.symbol))).length} SYMBOLS</span>
                    </>
                  ) : (
                    <RankedScoreTierSummary results={results} rankConfig={rankConfig} />
                  )}
                  {/* SCREENER-UX-0001 corrective pass: the non-targeted
                      "${results.length} SCANNED" label reintroduced the
                      exact scanned/attempted conflation this ticket exists
                      to remove -- `results` is actually the evaluated
                      candidate list, not a count of symbols scanned.
                      AccountingSummaryBar's own "evaluated" segment below
                      already states this precisely, so the label is
                      removed rather than relabeled. Targeted mode's
                      ENTRIES count is not a scanned/attempted conflation
                      (targetedResults is genuinely a count of setups) and
                      is kept. */}
                  {screenMode === 'targeted' && activeSession?.requestedStrategy !== 'csp' && (
                    <span className={th.textFaint}>{targetedResults.length} ENTRIES</span>
                  )}
                  {/* SCREENER-RESULTS-0001 — canonical accounting summary,
                      reconciling every selected symbol (never labeling
                      attemptedCount as "scanned," never showing a fraction
                      whose denominator merely repeats its own numerator).
                      Rendered whenever activeSession's mode matches what's
                      currently displayed, for every workflow (Filtered,
                      Ranked, Targeted, CSP, CC, PMCC alike) — see
                      lib/screener/scanSession.ts's formatSessionAccountingSummary. */}
                  {activeSession && activeSession.mode === screenMode && (
                    <AccountingSummaryBar session={activeSession} borderClassName={th.border} textFaintClassName={th.textFaint} />
                  )}
                  {mounted && screenMode === 'targeted' && targetedResults.length > 0 && targetedResultsCachedAt && (
                    <span className="text-purple-400 border border-purple-700 rounded px-1.5 py-0.5 text-[9px]" title="Results restored from last scan — click RUN HUNTER to rescan">
                      ↺ restored{' '}
                      <span className="text-purple-500/70">{(() => { const mins = Math.round((Date.now() - targetedResultsCachedAt) / 60000); return mins < 60 ? `${mins}m ago` : `${Math.round(mins/60)}h ago`; })()}</span>
                    </span>
                  )}
                  {mounted && screenMode !== 'targeted' && results.length > 0 && resultsCachedAt && (
                    <span className="text-purple-400 border border-purple-700 rounded px-1.5 py-0.5 text-[9px]" title="Results restored from last scan — click RUN HUNTER to rescan">
                      {rawScanCache.length > 0 ? '⚡ cached' : '↺ restored'}{' '}
                      <span className="text-purple-500/70">{(() => { const mins = Math.round((Date.now() - resultsCachedAt) / 60000); return mins < 60 ? `${mins}m ago` : `${Math.round(mins/60)}h ago`; })()}</span>
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  {results.some(r => !r.qualified && r.earningsDate && daysUntil(r.earningsDate) >= 0 && r.failReasons.some(f => f.includes('Earnings'))) && (
                    <button onClick={() => {
                      const toSchedule = results.filter(r => !r.qualified && r.earningsDate && daysUntil(r.earningsDate) >= 0 && r.failReasons.some(f => f.includes('Earnings')));
                      const stored = (() => { try { const s = localStorage.getItem(LS_CAL); return s ? JSON.parse(s) : {}; } catch { return {}; } })();
                      toSchedule.forEach((r, i) => {
                        const followUpIso = toIsoDate(getPostEarningsRescreenDate(r.earningsDate!));
                        const key = `${r.symbol}-${r.earningsDate}-${followUpIso}`;
                        if (!stored[key]) {
                          setTimeout(() => window.open(buildEarningsCalUrl(r.symbol, r.strategy, r.earningsDate!, r.ivr), '_blank'), i * 300);
                          stored[key] = true;
                        }
                      });
                      try { localStorage.setItem(LS_CAL, JSON.stringify(stored)); } catch {}
                    }}
                    className={`text-[10px] px-3 py-1.5 border ac-border-faint rounded-lg text-blue-400 ac-hover-border hover:ac-text transition-colors tracking-wider`}>
                      📅 Schedule All Earnings Follow-ups
                    </button>
                  )}
                  <button onClick={downloadCSV} className={`text-[10px] px-3 py-1.5 border ${th.border} rounded-lg ${th.textMuted} ac-hover-border ac-hover-text transition-colors tracking-wider`}>↓ CSV</button>
                  {activeSession?.requestedStrategy === 'pmcc' ? (
                    <button onClick={() => setShowPmccScanModal(true)} className={`text-[10px] px-3 py-1.5 border ${th.border} rounded-lg text-cyan-300 hover:border-cyan-500 transition-colors tracking-wider`}>
                      RESCAN PMCC ↺
                    </button>
                  ) : (
                    <button onClick={() => activeSession?.requestedStrategy === 'csp' ? setShowCspRunModal(true) : setShowRunModal(true)} className={`text-[10px] px-3 py-1.5 border ${th.border} rounded-lg ${th.textMuted} hover:border-purple-500 hover:text-purple-400 transition-colors tracking-wider`}>
                      {screenMode === 'filter' ? '⊘ Filter' : screenMode === 'rank' ? '⬡ Rank' : '⊕ Targeted'} ↺
                    </button>
                  )}
                </div>
              </div>

              {activeSession?.requestedStrategy === 'csp' && activeSession.ruleSnapshot && (
                <ActiveCspRules
                  snapshot={activeSession.ruleSnapshot}
                  onEdit={() => {
                    const s = activeSession.ruleSnapshot!;
                    const restored: CspScanRequest = {
                      mode: s.mode, preset: s.preset,
                      rules: { IVR_MIN: s.ivrMin, IVR_MAX: s.ivrMax, DELTA_MIN: s.deltaMin, DELTA_MAX: s.deltaMax, DTE_MIN: s.dteMin, DTE_MAX: s.dteMax, OI_MIN: s.oiMin, BID_ASK_MAX: s.bidAskMax },
                      popMin: s.popMin, otmMin: s.otmMin, rocMin: s.rocMin,
                      rankSecondary: s.rankSecondary,
                    };
                    setLastCspMode(s.mode);
                    setCspRequestsByMode(prev => ({ ...prev, [s.mode]: restored }));
                    setShowCspRunModal(true);
                  }}
                />
              )}

              {screenMode === 'filter' && activeSession?.requestedStrategy !== 'csp' && activeSession?.requestedStrategy !== 'pmcc' && (
                <SmartSuggestionsPanel results={results} rules={runtimeStockRules} th={th} onApplyAndRerun={(r) => {
                  setRuntimeStockRules(r);
                  if (rawScanCache.length > 0) {
                    applyRules(r, runtimeEtfRules, stockPresetLabel, etfPresetLabel);
                  } else {
                    runScreen(r, runtimeEtfRules, stockPresetLabel, etfPresetLabel);
                  }
                }} />
              )}

              {/* SCREENER-UX-0001 — Filtered mode: controls/filters (item 3)
                  now render BEFORE Best Opportunities (item 4), fixing the
                  hierarchy violation the ticket exists to correct. Ranked
                  and Targeted modes are unchanged (their own filter rows
                  already precede their result lists) — see the ticket's
                  documented Filtered-mode-first scope decision. */}
              {/* TE-0007F — a real, pre-existing bug found while scoping
                  PMCC sort/filter work (Ian/Paul, this session): the
                  pmcc-result-controls branch below was added inside this
                  ternary on 2026-08-15 (c6dda04, "PMCC/CC result-label and
                  OI tooltip accuracy"), correctly wired to real state
                  (filteredMinOi/filteredSort) with correct copy -- but the
                  outer !activePmccSession guard predates that commit and
                  was never updated, structurally preventing a PMCC
                  session from ever reaching its own branch. Confirmed via
                  git log -S and direct definition read
                  (activePmccSession = requestedStrategy === 'pmcc') that
                  this made the PMCC branch dead code since the day it was
                  added. This is exactly what produced the screenshot with
                  zero visible controls that started this whole thread. */}
              {(screenMode === 'filter' || (activeSession?.requestedStrategy === 'csp' && screenMode === 'rank')) && (
                activeSession?.requestedStrategy === 'csp' ? (
                  <section aria-label="CSP result controls" className={`mb-4 rounded-xl border ${th.border} p-3`} data-testid="csp-result-controls">
                    <p className={`mb-2 text-[9px] font-bold uppercase tracking-widest ${th.textMuted}`}>CSP result controls</p>
                    <OiAndSortControls th={th} minOi={filteredMinOi} setMinOi={setFilteredMinOi} sort={filteredSort} setSort={setFilteredSort} accent="amber" sortFields={['score','rocPct','creditDollars','otmPct','pop','relevantLegOI','dte']} />
                    <p className={`mt-2 text-[9px] ${th.textFaint}`}>Relevant-leg OI is the short put only. A positive OI floor fails closed when OI is missing.</p>
                  </section>
                ) : activeSession?.requestedStrategy === 'cc' ? (
                  <section aria-label="CC result controls" className={`mb-4 rounded-xl border ${th.border} p-3`} data-testid="cc-result-controls">
                    <p className={`mb-2 text-[9px] font-bold uppercase tracking-widest ${th.textMuted}`}>CC result controls</p>
                    <OiAndSortControls th={th} minOi={filteredMinOi} setMinOi={setFilteredMinOi} sort={filteredSort} setSort={setFilteredSort} accent="amber" />
                    <p className={`mt-2 text-[9px] ${th.textFaint}`}>Relevant-leg OI is the short call only. A positive OI floor fails closed when OI is missing.</p>
                  </section>
                ) : activeSession?.requestedStrategy === 'pmcc' ? (
                  <section aria-label="PMCC result controls" className={`mb-4 rounded-xl border ${th.border} p-3`} data-testid="pmcc-result-controls">
                    <p className={`mb-2 text-[9px] font-bold uppercase tracking-widest ${th.textMuted}`}>PMCC result controls</p>
                    <OiAndSortControls th={th} minOi={filteredMinOi} setMinOi={setFilteredMinOi} sort={filteredSort} setSort={setFilteredSort} accent="amber" sortFields={['widthMinusDebitPct', 'annualizedRoiPct', 'breakevenPct', 'relevantLegOI', 'dte']} />
                    <p className={`mt-2 text-[9px] ${th.textFaint}`}>Relevant-leg OI is the lower of the long LEAPS call's and short call's OI — both legs are required positions, not a protective/core distinction (matching IC's identical two-required-legs rule; confirmed via lib/screener/screenerResultOrdering.ts's own computeRelevantLegOI). A positive OI floor fails closed when either leg's OI is missing.</p>
                    {/* TE-0007H — reuses the exact filterHiddenSymbols/
                        toggleFilterSymbol state and interaction pattern
                        already real and working in FilteredResultControls's
                        own Tickers row -- not a new mechanism. That
                        component wasn't reused wholesale here since it
                        also renders credit-spread-specific sliders (POP/
                        OTM/credit ratio minimums) that don't apply to a
                        debit structure. Genuine, related bug found and
                        fixed alongside this: filteredQualifiedChips's own
                        activePmccSession bypass meant hiding a symbol via
                        this state never actually took effect for PMCC,
                        the same dead-guard class fixed three times
                        earlier this session -- see the fix below. */}
                    {(() => {
                      const pmccAllSymbols = Array.from(new Set(qualified.map(r => r.symbol))).sort();
                      return pmccAllSymbols.length > 1 && (
                        <div className="mt-2 flex items-center gap-1.5 flex-wrap">
                          <span className={`text-[9px] ${th.textFaint} shrink-0`}>Tickers</span>
                          {pmccAllSymbols.map(sym => {
                            const hidden = filterHiddenSymbols.includes(sym);
                            return (
                              <button key={sym} onClick={() => toggleFilterSymbol(sym)}
                                className={`text-[9px] px-2 py-0.5 rounded border transition-colors font-bold ${
                                  hidden ? `${th.border} ${th.textFaint} line-through opacity-40` : 'border-amber-600 text-amber-300 bg-amber-500/10'
                                }`}>
                                {sym} <span className="opacity-60">({qualified.filter(r => r.symbol === sym).length})</span>
                              </button>
                            );
                          })}
                        </div>
                      );
                    })()}
                  </section>
                ) : <FilteredResultControls
                  results={results}
                  qualifiedTotal={qualified.length}
                  filteredQualifiedCount={filteredQualified.length}
                  popMin={filterPopMin}
                  setPopMin={setFilterPopMin}
                  otmMin={filterOtmMin}
                  setOtmMin={setFilterOtmMin}
                  creditRatioMin={filterCreditRatioMin}
                  setCreditRatioMin={setFilterCreditRatioMin}
                  strategies={filterStrategies as FilterStrategy[]}
                  toggleStrategy={toggleFilterStrategy}
                  hiddenSymbols={filterHiddenSymbols}
                  toggleSymbol={toggleFilterSymbol}
                  setHiddenSymbols={setFilterHiddenSymbols}
                  th={th}
                  oiAndSortControls={
                    <OiAndSortControls th={th} minOi={filteredMinOi} setMinOi={setFilteredMinOi} sort={filteredSort} setSort={setFilteredSort} accent="amber" />
                  }
                />
              )}

              {/* OE-0002A: first production activation of OE-0001. Real,
                  ranked OpportunityRecommendation[] derived from this
                  page's own current scan results via the existing,
                  unmodified pipeline -- see the effect above.
                  SCREENER-RESULTS-0001: a disqualified/rejected candidate
                  can never appear here (the effect above only ever sends
                  qualified results) — when a completed session has results
                  but none qualified, this shows the required explicit empty
                  state instead of silently rendering nothing (which read as
                  "no opinion yet" rather than "nothing qualified").
                  SCREENER-UX-0001 corrective pass: Ranked mode now also
                  uses the collapsed top-3 BestOpportunitiesShortlist.
                  session.results (and therefore `results`) holds both
                  qualified and disqualified candidates -- see
                  computeSessionAccounting's own qualifiedCandidateCount/
                  disqualifiedCandidateCount split over the same array --
                  so this filters to qualified-only before building rows,
                  the same boundary Filtered mode's filteredQualified
                  already enforces; a disqualified candidate can never
                  reach a recommendation card in either mode. Targeted mode
                  has no OpportunityRecommendation source of its own
                  (opportunityRecommendations is derived from `results`,
                  which Targeted never populates) and would show a
                  meaningless/misleading empty state if wired to either
                  Best-Opportunities component -- it is deliberately
                  excluded, not merely deferred. */}
              {!activePmccSession && (results.length > 0 || hasCompletedScanForCurrentMode) && (screenMode === 'filter' || activeSession?.requestedStrategy === 'csp') && (
                <BestOpportunitiesShortlist
                  rows={buildBestOpportunityRows(filteredQualified, opportunityRecommendations)}
                  borderClassName={th.border}
                  textFaintClassName={th.textFaint}
                  textMutedClassName={th.textMuted}
                />
              )}
              {(results.length > 0 || hasCompletedScanForCurrentMode) && screenMode === 'rank' && (
                <BestOpportunitiesShortlist
                  rows={buildBestOpportunityRows(results.filter(r => r.qualified), opportunityRecommendations)}
                  borderClassName={th.border}
                  textFaintClassName={th.textFaint}
                  textMutedClassName={th.textMuted}
                />
              )}

              {screenMode === 'targeted' && activeSession?.requestedStrategy !== 'csp' ? (
                <>
                  <TargetedScanResultsPanel
                    entries={targetedResults}
                    sortBy={targetedSortBy}
                    setSortBy={setTargetedSortBy}
                    popMin={targetedPopMin}
                    th={th}
                    rankConfig={rankConfig}
                    rules={runtimeStockRules}
                    etfRules={runtimeEtfRules}
                    existingPositions={existingPositions}
                    onTrade={setTradeResult}
                  />
                  {/* SCREENER-UX-0001 corrective pass: item 7 of the
                      required hierarchy, wired into Targeted mode.
                      Targeted has no qualified/disqualified split (every
                      entry TargetedScanResultsPanel receives already
                      passed its own eligibility checks) and no
                      OpportunityRecommendation source, but symbol-level
                      failures/skips are still a real, session-level fact
                      and belong in their own disclosure here too. */}
                  {activeSession && activeSession.mode === 'targeted' && (
                    <SymbolOutcomesDisclosure
                      session={activeSession}
                      borderClassName={th.border}
                      textFaintClassName={th.textFaint}
                    />
                  )}
                </>
              ) : screenMode === 'filter' || activeSession?.requestedStrategy === 'csp' ? (() => {
                const topOpportunityRows = buildBestOpportunityRows(filteredQualified, opportunityRecommendations);
                const topOpportunityIds = pickTopOpportunityIds(topOpportunityRows);
                // CSP-WORKFLOW-0001 — match back to the ScreenResult being
                // rendered via each row's `resultKey` (the ScreenResult's
                // own candidateId for CSP; symbol+strategy for strategies
                // not yet migrated), never a re-derived symbol+strategy key
                // for CSP, which would collide across multiple contracts on
                // the same symbol. Closes BLOCKER-02.
                const topOpportunityResultKeys = new Set(
                  topOpportunityRows.filter(row => topOpportunityIds.has(row.candidateId)).map(row => row.resultKey),
                );
                const renderQualifiedCandidate = (r: ScreenResult) => {
                  const resultKey = r.candidateId ?? `${r.symbol}-${r.strategy}`;
                  const isTopOpportunity = topOpportunityResultKeys.has(resultKey);
                  return (
                    <div key={resultKey}>
                      {isTopOpportunity && <p className="mb-1 text-[9px] font-bold text-emerald-400" data-testid="top-opportunity-marker">★ Top opportunity — see Best Opportunities above</p>}
                      <ResultCard result={r} th={th} rules={r.isEtf ? runtimeEtfRules : runtimeStockRules} screenMode={screenMode} rankConfig={rankConfig} onTrade={setTradeResult} cachedEntry={rawScanCache.find(e => e.symbol === r.symbol && e.strategy === r.strategy)} existingPositions={existingPositions} />
                      {(filteredOiByResult.get(r)?.protectiveLegWarnings ?? []).map((w, wi) => <p key={wi} className="mt-1 text-[9px] text-amber-400" data-testid="oi-protective-leg-warning">⚠ {w}</p>)}
                    </div>
                  );
                };
                const cspExpirationGroups = activeSession?.requestedStrategy === 'csp'
                  ? Array.from(filteredQualified.reduce((groups, result) => {
                      const expiration = result.bestCandidate?.expiration ?? 'Unknown expiration';
                      const group = groups.get(expiration) ?? [];
                      group.push(result); groups.set(expiration, group); return groups;
                    }, new Map<string, ScreenResult[]>()).entries()).sort(([a], [b]) => a.localeCompare(b))
                  : [];
                // TE-0007H — Ian's real, priority addition: "I'd want a
                // collapsed view: ticker, best width-minus-debit%, best
                // annualized ROI, count of qualified structures... more
                // valuable to me day-to-day than the AI box, since it's
                // the thing that actually helps me triage 171 results
                // down to the 5 I'll seriously look at." Same real
                // grouping pattern as cspExpirationGroups above, grouped
                // by symbol instead of expiration. bestWidthMinusDebitPct
                // reads the real, already-computed metrics field
                // directly; bestAnnualizedRoiPct reuses pmccAnnualizedRoi
                // (the shared helper extracted above PmccResultCard's own
                // use of it), so the "best" figures shown here are
                // guaranteed to match what each individual card
                // underneath actually displays, never a separately
                // computed, potentially-drifting copy.
                const pmccTickerGroups = activePmccSession
                  ? Array.from(filteredQualified.reduce((groups, result) => {
                      const group = groups.get(result.symbol) ?? [];
                      group.push(result); groups.set(result.symbol, group); return groups;
                    }, new Map<string, ScreenResult[]>()).entries())
                    .map(([symbol, group]): [string, ScreenResult[], number | null, number | null] => {
                      const widthPcts = group.map(r => r.pmccPair?.metrics?.widthMinusDebitPctOfDebit).filter((v): v is number => v != null);
                      const roiPcts = group.map(r => pmccAnnualizedRoi(r)).filter((v): v is number => v != null);
                      return [
                        symbol, group,
                        widthPcts.length > 0 ? Math.max(...widthPcts) : null,
                        roiPcts.length > 0 ? Math.max(...roiPcts) : null,
                      ];
                    })
                    .sort(([, , aWidth], [, , bWidth]) => (bWidth ?? -Infinity) - (aWidth ?? -Infinity))
                  : [];
                return (
                <>
                  {filteredQualified.length > 0 && (
                    <div>
                      <p className="text-[9px] text-emerald-500 tracking-widest mb-2 font-medium">{activePmccSession ? 'QUALIFIED PMCC STRUCTURES' : 'QUALIFIED'}</p>
                      <div className="space-y-2">
                        {activeSession?.requestedStrategy === 'csp' ? cspExpirationGroups.map(([expiration, group]) => (
                          <ExpirationDisclosure key={expiration} expiration={expiration}
                            dte={group[0]?.bestCandidate?.dte ?? null} candidateCount={group.length}
                            kind="qualified" defaultOpen borderClassName={th.border}>
                            {group.map(renderQualifiedCandidate)}
                          </ExpirationDisclosure>
                        )) : activePmccSession ? pmccTickerGroups.map(([symbol, group, bestWidth, bestRoi]) => (
                          <PmccTickerDisclosure key={symbol} symbol={symbol}
                            price={group[0]?.price ?? null} candidateCount={group.length}
                            bestWidthMinusDebitPct={bestWidth} bestAnnualizedRoiPct={bestRoi}
                            defaultOpen={pmccTickerGroups.length === 1} borderClassName={th.border}>
                            {group.map(renderQualifiedCandidate)}
                          </PmccTickerDisclosure>
                        )) : filteredQualified.map(r => {
                          // CSP-WORKFLOW-0001 — candidateId (when present,
                          // i.e. CSP results) is the stable identity; other
                          // strategies fall back to symbol+strategy exactly
                          // as before, since they still produce at most one
                          // ScreenResult per symbol.
                          const resultKey = r.candidateId ?? `${r.symbol}-${r.strategy}`;
                          const isTopOpportunity = topOpportunityResultKeys.has(resultKey);
                          // TE-0007D — reuses the exact aligned/against
                          // comparison already live in Targeted mode's
                          // panel (line ~5978), against data that's
                          // already on every ScreenResult regardless of
                          // which scan mode produced it (runChecklist
                          // includes trendResult in its return; confirmed
                          // via direct read, not assumed). Only meaningful
                          // for BPS/BCS/IC -- trend's strategy field only
                          // ever resolves to one of those three, so CSP/
                          // CC/PMCC results never show a badge either way.
                          const trendAligned = r.trendResult?.strategy === r.strategy;
                          const trendAgainst = r.trendResult != null && r.trendResult.strategy !== 'NO_TRADE' && !trendAligned && r.strategy !== 'IC' && (r.strategy === 'BPS' || r.strategy === 'BCS');
                          return (
                          <div key={resultKey}>
                            {isTopOpportunity && (
                              <p className="text-[9px] font-bold text-emerald-400 mb-1" data-testid="top-opportunity-marker">★ Top opportunity — see Best Opportunities above</p>
                            )}
                            {trendAligned && (
                              <p className="text-[9px] text-emerald-400 mb-1" title="Trend aligned" data-testid="trend-aligned-marker">↑✓ Trend aligned</p>
                            )}
                            {trendAgainst && (
                              <p className="text-[9px] text-amber-400 mb-1" title="Against trend" data-testid="trend-against-marker">⚠ Against trend</p>
                            )}
                            <ResultCard
                              result={r}
                              th={th}
                              rules={r.isEtf ? runtimeEtfRules : runtimeStockRules}
                              screenMode={screenMode}
                              rankConfig={rankConfig}
                              onTrade={setTradeResult}
                              cachedEntry={rawScanCache.find(e => e.symbol === r.symbol && e.strategy === r.strategy)}
                              existingPositions={existingPositions}
                            />
                            {(filteredOiByResult.get(r)?.protectiveLegWarnings ?? []).map((w, wi) => (
                              <p key={wi} className="mt-1 text-[9px] text-amber-400" data-testid="oi-protective-leg-warning">
                                ⚠ {w}
                              </p>
                            ))}
                          </div>
                          );
                        })}
                      </div>
                    </div>
                  )}
                  {activePmccSession ? (
                    <>
                      {filteredDisqualified.filter(result => result.pmccPair != null).length > 0 && (
                        <div>
                          <p className="mb-2 text-[9px] font-medium tracking-widest text-amber-400">PMCC NEAR-MISS STRUCTURES</p>
                          <div className="space-y-2">
                            {filteredDisqualified.filter(result => result.pmccPair != null).map(result => (
                              <PmccResultCard key={result.candidateId} result={result} th={th} rules={runtimeStockRules} />
                            ))}
                          </div>
                        </div>
                      )}
                      {filteredDisqualified.filter(result => result.pmccPair == null).length > 0 && (
                        <div>
                          <p className="mb-2 text-[9px] font-medium tracking-widest text-amber-400">PMCC AUDIT RESULTS</p>
                          <div className="space-y-2">
                            {filteredDisqualified.filter(result => result.pmccPair == null).map(result => (
                              <PmccResultCard key={result.candidateId ?? `pmcc-audit-${result.symbol}`} result={result} th={th} rules={runtimeStockRules} />
                            ))}
                          </div>
                        </div>
                      )}
                    </>
                  ) : (
                    <DisqualifiedSection
                      results={filteredDisqualified}
                      hasQualifiedCandidates={filteredQualified.length > 0}
                      groupByExpiration={activeSession?.requestedStrategy === 'csp'}
                      borderClassName={th.border}
                      textFaintClassName={th.textFaint}
                      textMutedClassName={th.textMuted}
                    />
                  )}
                  {activeSession && (activeSession.requestedStrategy === 'csp' || activeSession.mode === 'filter') ? (
                    <SymbolOutcomesDisclosure
                      session={activeSession!}
                      borderClassName={th.border}
                      textFaintClassName={th.textFaint}
                    />
                  ) : null}
                </>
                );
              })() : (() => {
                // Post-scan, client-side filters over the already-fetched `results`
                // array — same approach Targeted mode uses, so loosening a filter
                // never requires a rescan. Order: DTE -> strategy -> POP -> OTM ->
                // credit ratio, then slice to the Show-top count.
                const calcRankedOtmPct = (r: ScreenResult): number | null => {
                  const c = r.bestCandidate;
                  const price = r.price;
                  if (!c || price == null || price <= 0) return null;
                  if (c.strategy === 'BPS') return ((price - c.shortStrike) / price) * 100;
                  if (c.strategy === 'BCS') return ((c.shortStrike - price) / price) * 100;
                  if (c.strategy === 'IC' && c.shortCallStrike != null) {
                    return Math.min(((price - c.shortStrike) / price) * 100, ((c.shortCallStrike - price) / price) * 100);
                  }
                  return null;
                };
                const getRankedOi = (r: ScreenResult): OiEligibilityResult | null => {
                  const strat = toOiStrategy(r.strategy);
                  if (!strat || !r.bestCandidate) return null;
                  return evaluateOiEligibility(extractOiLegsFromSpreadCandidate(strat, r.bestCandidate), rankMinOi);
                };
                const getRankedMetrics = (r: ScreenResult): SortableMetrics => {
                  const c = r.bestCandidate;
                  const strat = toOiStrategy(r.strategy);
                  return {
                    score: (strat ? scoreCandidate(r, rankConfig)?.score : null) ?? null,
                    pop: c?.pop ?? null,
                    creditDollars: c?.credit ?? null,
                    creditPct: c?.creditRatio != null ? c.creditRatio * 100 : null,
                    rocPct: c?.roc ?? null,
                    otmPct: calcRankedOtmPct(r),
                    relevantLegOI: strat && c ? computeRelevantLegOI(extractOiLegsFromSpreadCandidate(strat, c)) : null,
                    dte: c?.dte ?? null,
                    // TE-0007F — PMCC only ever runs in Filter mode
                    // (confirmed: SCREENER-RESULTS-0001's 'pmcc' session
                    // is filter-mode-only), so Rank mode structurally
                    // never receives a PMCC result here. null, not
                    // duplicated PMCC-specific logic this path can't
                    // reach.
                    widthMinusDebitPct: null,
                    breakevenPct: null,
                    annualizedRoiPct: null,
                  };
                };

                let filtered = results.filter(r => {
                  if (rankHiddenSymbols.includes(r.symbol)) return false;
                  const dte = r.bestCandidate?.dte ?? 0;
                  if (dte < rankDteMin || dte > rankDteMax) return false;
                  if (!rankStrategies.includes(r.strategy)) return false;
                  const c = r.bestCandidate;
                  if (c) {
                    if ((c.pop ?? 0) < rankPopMin) return false;
                    if ((c.creditRatio ?? 0) * 100 < rankCreditRatioMin) return false;
                    if (rankOtmMin > 0) {
                      const otmPct = calcRankedOtmPct(r);
                      if (otmPct == null || otmPct < rankOtmMin) return false;
                    }
                  }
                  return true;
                });
                // SCREENER-OI-0001 — canonical minimum relevant-leg OI floor,
                // applied (fail-closed) before the sort and before Show Top N.
                const rankOiByResult = new Map<ScreenResult, OiEligibilityResult>();
                filtered = filtered.filter(r => {
                  const oi = getRankedOi(r);
                  if (oi) rankOiByResult.set(r, oi);
                  return oi ? oi.eligible : true; // strategies with no OI mapping are unaffected
                });
                // Canonical two-level sort (see the module for the documented
                // score-band rule: Score has always been a flat descending
                // sort here, never grouped/tolerance-based -- unchanged).
                filtered = sortItems(filtered, rankSort, getRankedMetrics);
                const display = filtered.slice(0, rankTopN);

                return (
                <div>
                  <p className="text-sm font-bold tracking-wide text-purple-400 mb-2">⬡ RANKED SCAN</p>
                  <div className="flex items-center gap-3 mb-2 flex-wrap">
                    <p className="text-[9px] text-purple-400 tracking-widest font-medium shrink-0">
                      {display.length} of {filtered.length} SHOWN
                    </p>
                    <div className="flex items-center gap-1.5">
                      <span className={`text-[9px] ${th.textFaint}`}>Show top</span>
                      {[10, 20, 50, 999].map(n => (
                        <button key={n} onClick={() => setRankTopN(n)}
                          className={`text-[9px] px-2 py-0.5 rounded border transition-colors font-bold ${
                            rankTopN === n
                              ? 'border-purple-500 text-purple-300 bg-purple-500/15'
                              : `${th.border} ${th.textFaint} hover:border-purple-500/50`
                          }`}>
                          {n === 999 ? 'All' : n}
                        </button>
                      ))}
                    </div>
                    <div className="flex items-center gap-1.5">
                      <span className={`text-[9px] ${th.textFaint}`}>DTE</span>
                      {[
                        { label: 'All', min: 0, max: 999 },
                        { label: '< 21', min: 0, max: 20 },
                        { label: '21-45', min: 21, max: 45 },
                        { label: '30-45', min: 30, max: 45 },
                        { label: '> 45', min: 46, max: 999 },
                      ].map(d => (
                        <button key={d.label} onClick={() => { setRankDteMin(d.min); setRankDteMax(d.max); }}
                          className={`text-[9px] px-2 py-0.5 rounded border transition-colors font-bold ${
                            rankDteMin === d.min && rankDteMax === d.max
                              ? 'border-blue-500 text-blue-300 bg-blue-500/15'
                              : `${th.border} ${th.textFaint} hover:border-blue-500/50`
                          }`}>
                          {d.label}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* SCREENER-OI-0001 — canonical minimum relevant-leg OI + two-level sort */}
                  <div className="mb-3">
                    <OiAndSortControls th={th} minOi={rankMinOi} setMinOi={setRankMinOi} sort={rankSort} setSort={setRankSort} accent="purple" />
                  </div>

                  {/* Filter row 2 — POP / OTM / Credit Ratio / Strategy, same pattern as Targeted */}
                  <div className="flex items-center gap-3 mb-3 flex-wrap">
                    <div className="flex items-center gap-1.5">
                      <span className={`text-[9px] ${th.textFaint} shrink-0`}>POP ≥</span>
                      {[0, 50, 60, 70, 80].map(v => (
                        <button key={v} onClick={() => setRankPopMin(v)}
                          className={`text-[9px] px-2 py-0.5 rounded border transition-colors font-bold ${
                            rankPopMin === v
                              ? 'border-purple-500 text-purple-300 bg-purple-500/15'
                              : `${th.border} ${th.textFaint} hover:border-purple-500/50`
                          }`}>
                          {v === 0 ? 'Any' : `${v}%`}
                        </button>
                      ))}
                    </div>
                    <div className={`w-px h-4 ${th.border} border-l`} />
                    <div className="flex items-center gap-1.5">
                      <span className={`text-[9px] ${th.textFaint} shrink-0`}>OTM ≥</span>
                      {[0, 4, 8, 12, 16].map(v => (
                        <button key={v} onClick={() => setRankOtmMin(v)}
                          className={`text-[9px] px-2 py-0.5 rounded border transition-colors font-bold ${
                            rankOtmMin === v
                              ? 'border-purple-500 text-purple-300 bg-purple-500/15'
                              : `${th.border} ${th.textFaint} hover:border-purple-500/50`
                          }`}>
                          {v === 0 ? 'Any' : `${v}%`}
                        </button>
                      ))}
                    </div>
                    <div className={`w-px h-4 ${th.border} border-l`} />
                    <div className="flex items-center gap-1.5">
                      <span className={`text-[9px] ${th.textFaint} shrink-0`}>Cr Ratio ≥</span>
                      {[0, 15, 20, 25, 33].map(v => (
                        <button key={v} onClick={() => setRankCreditRatioMin(v)}
                          className={`text-[9px] px-2 py-0.5 rounded border transition-colors font-bold ${
                            rankCreditRatioMin === v
                              ? 'border-purple-500 text-purple-300 bg-purple-500/15'
                              : `${th.border} ${th.textFaint} hover:border-purple-500/50`
                          }`}>
                          {v === 0 ? 'Any' : `${v}%`}
                        </button>
                      ))}
                    </div>
                    <div className={`w-px h-4 ${th.border} border-l`} />
                    <div className="flex items-center gap-1.5">
                      <span className={`text-[9px] ${th.textFaint} shrink-0`}>Strategy</span>
                      {(['BPS', 'BCS', 'IC'] as const).map(s => {
                        const on = rankStrategies.includes(s);
                        const c  = s === 'BPS' ? 'border-emerald-600 text-emerald-400 bg-emerald-500/10'
                                 : s === 'BCS' ? 'border-red-600 text-red-400 bg-red-500/10'
                                 :               'border-blue-600 text-blue-400 bg-blue-500/10';
                        return (
                          <button key={s} onClick={() => toggleRankStrategy(s)}
                            className={`text-[9px] px-2 py-0.5 rounded border transition-colors font-bold ${
                              on ? c : `${th.border} ${th.textFaint} opacity-40`
                            }`}>
                            {s}
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  {/* Filter row 3 -- per-ticker breakdown/toggle, same pattern as Targeted mode */}
                  {(() => {
                    const allRankSymbols = Array.from(new Set(results.map(r => r.symbol))).sort();
                    if (allRankSymbols.length <= 1) return null;
                    return (
                      <div className="flex items-center gap-1.5 mb-3 flex-wrap">
                        <span className={`text-[9px] ${th.textFaint} shrink-0`}>Tickers</span>
                        {allRankSymbols.map(sym => {
                          const hidden = rankHiddenSymbols.includes(sym);
                          return (
                            <button key={sym} onClick={() => toggleRankSymbol(sym)}
                              className={`text-[9px] px-2 py-0.5 rounded border transition-colors font-bold ${
                                hidden
                                  ? `${th.border} ${th.textFaint} line-through opacity-40`
                                  : 'border-purple-600 text-purple-300 bg-purple-500/10'
                              }`}>
                              {sym} <span className="opacity-60">({results.filter(r => r.symbol === sym).length})</span>
                            </button>
                          );
                        })}
                        {rankHiddenSymbols.length > 0 && (
                          <button onClick={() => setRankHiddenSymbols([])}
                            className={`text-[9px] px-2 py-0.5 rounded border ${th.border} ${th.textFaint} hover:border-purple-500/50`}>
                            Show all
                          </button>
                        )}
                      </div>
                    );
                  })()}

                  <div className="space-y-2">
                    {display.map((r, i) => {
                      // TE-0007D — same aligned/against comparison as
                      // Filter mode above, against trendResult already
                      // present on every ScreenResult regardless of scan
                      // mode (exploreAllCandidatesForRank/errResult both
                      // include it; confirmed via direct read of
                      // lib/scans/rank-scoring.ts and
                      // lib/scans/ranked-scan-runner.ts, not assumed).
                      const trendAligned = r.trendResult?.strategy === r.strategy;
                      const trendAgainst = r.trendResult != null && r.trendResult.strategy !== 'NO_TRADE' && !trendAligned && r.strategy !== 'IC' && (r.strategy === 'BPS' || r.strategy === 'BCS');
                      return (
                        <div key={`${r.symbol}-${r.strategy}-${r.bestCandidate?.expiration}-${r.bestCandidate?.shortStrike}`} className="flex items-start gap-2">
                          <div className="flex flex-col items-center gap-1 shrink-0 mt-3">
                            <span className={`text-[9px] ${th.textFaint} w-5 text-right`}>{i + 1}</span>
                            <span className={`text-[9px] px-1.5 py-0.5 border rounded font-bold ${dteBadgeColor(r.bestCandidate?.dte ?? 0)}`}>
                              {r.bestCandidate?.dte ?? '—'}d
                            </span>
                            {trendAligned && <span className="text-[8px] text-emerald-400" title="Trend aligned">↑✓</span>}
                            {trendAgainst && <span className="text-[8px] text-amber-400" title="Against trend">⚠</span>}
                          </div>
                          <div className="flex-1">
                            <ResultCard result={r} th={th} rules={r.isEtf ? runtimeEtfRules : runtimeStockRules} screenMode={screenMode} rankConfig={rankConfig} onTrade={setTradeResult} cachedEntry={rawScanCache.find(e => e.symbol === r.symbol && e.strategy === r.strategy)} existingPositions={existingPositions} />
                            {(rankOiByResult.get(r)?.protectiveLegWarnings ?? []).map((w, wi) => (
                              <p key={wi} className="mt-1 text-[9px] text-amber-400" data-testid="oi-protective-leg-warning">
                                ⚠ {w}
                              </p>
                            ))}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                  {/* SCREENER-UX-0001 corrective pass: items 6-7 of the
                      required hierarchy, wired into Ranked mode.
                      `disqualified` (module-level, derived from `results`
                      the same way Filtered mode's is -- see its
                      declaration above) was never previously surfaced in
                      Ranked mode; the ranked/scored list above is left
                      completely untouched (no scanner/ranking-logic
                      change), this is purely additive. */}
                  <DisqualifiedSection
                    results={disqualified}
                    hasQualifiedCandidates={display.length > 0}
                    borderClassName={th.border}
                    textFaintClassName={th.textFaint}
                    textMutedClassName={th.textMuted}
                  />
                  {activeSession && activeSession.mode === 'rank' && (
                    <SymbolOutcomesDisclosure
                      session={activeSession}
                      borderClassName={th.border}
                      textFaintClassName={th.textFaint}
                    />
                  )}
                </div>
                );
              })()}
            </div>
          )}
        </div>
      </div>

      {tradeResult && tradeResult.bestCandidate && <TradeModal result={tradeResult} th={th} onClose={() => setTradeResult(null)} />}
      {tradeResult && !tradeResult.bestCandidate && tradeResult.pmccPair && <PmccTradeModal result={tradeResult} th={th} onClose={() => setTradeResult(null)} />}
      <LoadPromptModal state={loadPrompt} onClose={() => setLoadPrompt(p => ({ ...p, show: false }))} th={th} />
      {showRunModal && (
        <RunModeModal
          th={th}
          lastMode={screenMode}
          lastPreset={stockPresetLabel}
          activeRankRules={runtimeStockRules}
          lastTargetedDteMin={targetedDteMin}
          lastTargetedDteMax={targetedDteMax}
          lastTargetedPopMin={targetedPopMin}
          lastTargetedOtmMin={targetedOtmMin}
          lastTargetedPreset={targetedPreset}
          onClose={() => setShowRunModal(false)}
          onRun={(mode, preset, targetedOpts) => {
            setShowRunModal(false);
            setScreenMode(mode);
            try { localStorage.setItem(LS_SCREEN_MODE, mode); } catch {}
            if (mode === 'targeted' && targetedOpts) {
              setTargetedDteMin(targetedOpts.dteMin);
              setTargetedDteMax(targetedOpts.dteMax);
              setTargetedPopMin(targetedOpts.popMin);
              setTargetedOtmMin(targetedOpts.otmMin);
              setTargetedPreset(targetedOpts.preset);
              // Find rules for chosen preset
              const foundPreset = RULE_PRESETS.find(p => p.key === targetedOpts.preset);
              const tRules: RulesType = foundPreset ? { ...DEFAULT_RULES, ...foundPreset.rules } : runtimeStockRules;
              const tEtfRules: RulesType = foundPreset ? { ...DEFAULT_ETF_RULES, ...foundPreset.rules } : runtimeEtfRules;
              const activeSymbols = tickers.filter(t => t.active).map(t => t.symbol);
              runTargetedScan(activeSymbols, targetedOpts.dteMin, targetedOpts.dteMax, targetedOpts.popMin, targetedOpts.otmMin, tRules, tEtfRules, rankConfig, setLoading, setStatus, setError, setTargetedResults, setTargetedResultsCachedAt, targetedCancelRef, (scope) => beginScanSession({ mode: 'targeted', requestedStrategy: 'spreads', scope }), commitScanSession, isScanCurrent);
            } else if (mode === 'rank') {
              startRankedScan(runtimeStockRules, runtimeEtfRules, stockPresetLabel, etfPresetLabel);
            } else {
              const found = FILTER_PRESETS.find(p => p.key === preset);
              if (found) {
                setStockPresetLabel(found.label);
                setShowRulesModal(false);
              }
              runScreen(runtimeStockRules, runtimeEtfRules, found?.label ?? stockPresetLabel, etfPresetLabel, 'filter');
            }
          }}
        />
      )}
      {showCspRunModal && (
        <CspScanModal
          th={th}
          selectedTickerCount={opportunityUniverse.length}
          initial={cspRequestsByMode[lastCspMode]}
          requestsByMode={cspRequestsByMode}
          onClose={() => {
            setShowCspRunModal(false);
            requestAnimationFrame(() => document.querySelector<HTMLButtonElement>('button[aria-label="FIND CSPs"]')?.focus());
          }}
          onRun={(request) => {
            setShowCspRunModal(false);
            void runCspScan(request);
          }}
        />
      )}
      {showCcScanModal && (
        <CcScanModal
          th={th}
          selectedTickerCount={ccEligibleHoldings.length}
          initial={{ rules: ccRules }}
          onClose={() => {
            setShowCcScanModal(false);
            requestAnimationFrame(() => document.querySelector<HTMLButtonElement>('button[aria-label="FIND CCs"]')?.focus());
          }}
          onRun={(request) => {
            setShowCcScanModal(false);
            setCcRules(request.rules);
            void runCcScan(ccBypassUniverse, request.rules);
          }}
        />
      )}
      {showPmccScanModal && (
        <PmccScanModal
          th={th}
          selectedTickerCount={opportunityUniverse.length}
          initial={{
            dte: { shortMin: pmccShortDteMin, shortMax: pmccShortDteMax, longMin: pmccLongDteMin, longMax: pmccLongDteMax },
            longDelta: { ...DEFAULT_PMCC_LONG_DELTA_RANGE },
            shortDelta: { ...DEFAULT_PMCC_SHORT_DELTA_RANGE },
            longOiMin: DEFAULT_PMCC_LONG_OI_MIN,
            shortOiMin: DEFAULT_PMCC_SHORT_OI_MIN,
            requireDebitBelowWidth: true,
          }}
          onClose={() => {
            setShowPmccScanModal(false);
            requestAnimationFrame(() => document.querySelector<HTMLButtonElement>('button[aria-label="FIND PMCCs"]')?.focus());
          }}
          onRun={(criteria) => {
            setShowPmccScanModal(false);
            void runPMCCScan(criteria);
          }}
        />
      )}
      {showRulesModal && <RulesModal stockRules={runtimeStockRules} etfRules={runtimeEtfRules} rankConfig={rankConfig} onClose={() => setShowRulesModal(false)} onRun={(sRules, eRules, sLabel, eLabel, rCfg) => { setShowRulesModal(false); setRuntimeStockRules(sRules); setRuntimeEtfRules(eRules); setStockPresetLabel(sLabel); setEtfPresetLabel(eLabel); setRankConfig(rCfg); if (rawScanCache.length > 0) { applyRules(sRules, eRules, sLabel, eLabel); } else if (screenMode === 'rank') { startRankedScan(sRules, eRules, sLabel, eLabel); } else { runScreen(sRules, eRules, sLabel, eLabel); } }} th={th} />}
    </div>
  );
}

SCRIPT_EOF

git add app/screener/page.tsx

cat > commit-message-2.txt << 'MSG_EOF'
PMCC-CARD-0001: decision strip, 3-state readiness, chart link, collapsed audit detail

- Reorganize PmccResultCard into a 5-field decision strip (width-minus-debit,
  annualized ROI, breakeven, roll runway, net delta), always visible.
  Net debit, strike width, total premium, and profit-at-current-price move
  into the quote/pricing disclosure -- supporting math, not decision-tier.
  All values reused from existing metrics/breakeven/rollRunway/annualizedRoi
  computations, no new calculations.
- Replace binary ready/not-ready header text with a three-state readiness
  indicator (green ready / amber not ready / red disqualified). Disqualified
  derives from pair.qualified and pair.failureReasons (existing fields),
  not-ready from the existing readyInput fields. No new qualification logic.
- Collapse quote/pricing detail (OCC symbols, bid/ask/mid, natural price
  math) and qualification/audit detail (near-miss reasons, pairing counts,
  leg rejection list) behind two disclosures, off by default. Same data,
  restructured only.
- Add ChartLinkButton: reuses GenericResultCard's existing /api/chart
  sparkline + "Open in TradingView" pattern verbatim, wired next to the
  PMCC ticker symbol in both the qualified-pair card and the audit-fallback
  card. No new data source.
- Audit-fallback (!pair) card relabeled Disqualified (red) instead of
  Not Ready (amber), since a scan that found no executable pair is a
  disqualification, not a temporary data-readiness gate.

Ian/Paul/Diane/Quinn-reviewed mockup, signed off before implementation.
No new data sourcing, no changes to qualification/scoring logic.
MSG_EOF

git commit -F commit-message-2.txt
rm commit-message-2.txt

git push origin fix/pmcc-card-0001-decision-strip-readiness

echo ""
echo "Pushed to fix/pmcc-card-0001-decision-strip-readiness."
echo "Next: verify on Vercel preview, then merge to main:"
echo "  git checkout main && git pull origin main"
echo "  git merge --no-ff fix/pmcc-card-0001-decision-strip-readiness"
echo "  git push origin main"
echo "  git branch -d fix/pmcc-card-0001-decision-strip-readiness"
echo "  git push origin --delete fix/pmcc-card-0001-decision-strip-readiness"
