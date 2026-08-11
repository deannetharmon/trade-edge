// lib/portfolio-intelligence/objectives/positionObjective.ts
//
// PI-0002: TE-0006B (Portfolio Recommendation Rules) consolidated into the
// canonical lib/portfolio-intelligence model. This is the single source of
// truth for per-position recommendation logic going forward -- the old
// features/portfolio/recommendations/* files are now thin re-export shims
// over this module.
//
// Design decision (documented per PI-0002's "use judgment" instruction):
// this function returns BOTH a canonical `objective: PortfolioObjective |
// null` AND a `legacyRecommendation: PortfolioRecommendation` from a single
// shared evaluation pass, rather than deriving one from the other:
//   - `legacyRecommendation` preserves the EXACT trigger conditions,
//     thresholds, and wording TE-0006B already had in production, so
//     PositionRecommendationBadge, DailyPriorityList, and the priorities
//     engine keep receiving byte-for-byte the same shape and values they
//     did before this refactor -- zero user-visible behavior change.
//   - `objective` is the new canonical PortfolioObjective, using the ten
//     stable rule IDs from ruleIds.ts. It is null for the "hold" case,
//     matching evaluatePortfolioObjectives' existing philosophy that a
//     healthy position with nothing to act on simply doesn't get an
//     objective, rather than always emitting a "nothing to do" entry.
//
// Several legacy recommendation "kinds" (assignment-risk, close-loser,
// earnings-risk) all map to the single REVIEW_THREATENED_POSITION /
// OBJ-REVIEW-THREATENED-POSITION canonical type -- there is no dedicated
// stable ID per fine-grained trigger, by design (see ruleIds.ts). Likewise
// place-gtc, let-expire, and watch all map to MANAGE_POSITION /
// OBJ-MANAGE-21-DTE even though not all of them are DTE-driven -- the ten
// stable IDs given are exhaustive and this function does not invent an
// eleventh. The specific triggering condition is preserved in `title`,
// `rationale`, and `metadata.rulesTriggered` on the objective, and in
// `kind` on the legacy recommendation (unchanged).
//
// This module does NOT go through evaluatePortfolioObjectives()'s own
// REVIEW_THREATENED_POSITION / CLOSE_FOR_PROFIT / MANAGE_POSITION rules --
// those operate on the portfolio-level PortfolioPositionInput shape with
// their own (differently-tuned) default thresholds, used by the batch
// evaluator. This function has its own thresholds, matching TE-0006B
// exactly, because that is what "no user-visible behavior changes" requires
// for the Portfolio page's existing per-position cards. Reconciling the two
// threshold sets into one is explicitly deferred -- see
// planning/SPRINT3_PI0002_PLAN.md "Later items".

import type {
  ObjectiveImpact,
  PortfolioObjective,
  PortfolioObjectiveActionability,
  PortfolioObjectiveConcern,
  PortfolioObjectiveEvidence,
  PortfolioObjectiveReviewTrigger,
  PortfolioObjectiveRuleId,
  PositionStrategy,
  AssignmentPreference,
} from '../types';
import type { PositionHealthScore } from '../health/types';
import { DEFAULT_POSITION_MANAGEMENT_POLICY } from '../policies';
import { defaultActionabilityForPriority } from '../actionability';
// PI-0014 follow-up (Product Owner review): the Decision Engine is the
// correct owner of "did execution reality invalidate this recommendation,"
// not lib/positionValuation (which stays purely observational -- see that
// module's types.ts doc). This is the one new dependency this file takes on:
// LiquidityTier is a plain, dependency-free type, imported here as one more
// piece of input evidence, the same way marketablePnlPct already is.
import type { LiquidityTier } from '@/lib/positionValuation';
import type { QuoteQuality } from '@/lib/portfolio/stopLossPolicy';
import {
  selectManagementIntent,
  type ManagementIntentContext,
  type ManagementIntentEvidence,
  type ManagementIntentResult,
  type TechnicalAlignment,
} from '../managementIntent';

export type PortfolioRecommendationKind =
  | 'hold'
  | 'watch'
  | 'close-winner'
  | 'close-loser'
  | 'roll-soon'
  | 'place-gtc'
  | 'let-expire'
  | 'earnings-risk'
  | 'assignment-risk'
  | 'verify-pricing';

export type PortfolioPricingBasis = 'MID' | 'MARKETABLE' | 'NONE';
export type PortfolioPricingFreshness = 'FRESH' | 'STALE' | 'UNKNOWN';
export type PortfolioPricingDecisionStatus =
  | 'MID_ONLY'
  | 'PRICING_AGREEMENT'
  | 'MARKETABLE_OBSERVATIONAL'
  | 'MARKETABLE_CONFIRMED'
  | 'VERIFY_PRICING';

export interface PortfolioPricingDecisionEvidence {
  midPnlPct: number | null;
  marketablePnlPct: number | null;
  marketableQuoteQuality: QuoteQuality;
  marketableQuoteFreshness: PortfolioPricingFreshness;
  marketableQuoteCapturedAt: string | null;
  marketableDecisionEligible: boolean;
  // Independent of the currently winning recommendation. True while an
  // identified pricing conflict still lacks fresh, reliable marketable
  // evidence, including while a higher-priority midpoint/assignment/
  // earnings/DTE action is primary.
  verificationUnresolved: boolean;
  controllingBasis: PortfolioPricingBasis;
  status: PortfolioPricingDecisionStatus;
}

export type PortfolioRecommendationUrgency = 'low' | 'medium' | 'high' | 'critical';

export interface PortfolioRecommendation {
  positionId: string;
  symbol: string;
  kind: PortfolioRecommendationKind;
  label: string;
  urgency: PortfolioRecommendationUrgency;
  confidence: number;
  primaryReason: string;
  supportingReasons: string[];
  suggestedAction: string;
  computedAt: string;
  // PI-0006B: the canonical intent-selection result behind `label` -- the
  // winning ManagementIntent, its supporting reasons, and the alternatives
  // considered (including Roll Position when relevant but not chosen). See
  // ../managementIntent.ts. Optional only for type-level back-compat with
  // any external construction of a PortfolioRecommendation fixture that
  // predates PI-0006B; every value returned by evaluatePositionObjective()
  // always populates it.
  managementIntent?: ManagementIntentResult;
}

export interface PositionObjectiveInput {
  positionId?: string;
  key?: string;
  symbol: string;
  strategy?: string | null;
  dte?: number | null;
  pnlPct?: number | null;
  pnl?: number | null;
  creditReceived?: number | null;
  // PI-0014: marketable/executable pnl% -- same normalization convention as
  // pnlPct (a fraction or already-a-percent, run through
  // normalizePositionObjectivePct), but derived from the position's
  // marketable "if I closed now" value instead of mid. Null when marketable
  // pricing is unavailable (e.g. a one-sided market on some leg) -- never
  // fabricated from mid. Widens materialLoss/weakHealthLoss/
  // profitTargetReached below; every other branch (assignment-risk,
  // earnings-risk, roll-soon, watch, health scoring) is unchanged and still
  // reads mid pricing only. See lib/positionValuation and
  // docs/design/PI-0014-Marketable-Pricing-Risk-Gating.md.
  marketablePnlPct?: number | null;
  // PI-0014C: marketable pricing may influence a hard recommendation only
  // when the caller proves both quote quality and freshness. Absence is
  // UNKNOWN/fail-closed; callers must never substitute page-load time.
  marketableQuoteQuality?: QuoteQuality | null;
  marketableQuoteFreshness?: PortfolioPricingFreshness | null;
  marketableQuoteCapturedAt?: string | null;
  // PI-0014C: in-session transition provenance supplied by the canonical
  // acquisition pipeline. This preserves an unresolved pricing-verification
  // disposition across an incomplete refresh without copying stale decision
  // objects. Independent current rules still win below.
  priorPricingVerificationUnresolved?: boolean;
  // PI-0014 follow-up: this position's liquidity classification (see
  // lib/positionValuation's PositionValuation.liquidityTier), supplied so
  // this function -- not the valuation module -- can decide whether
  // marketable evidence promoting/vetoing a recommendation also counts as a
  // "liquidity trap" (see PositionObjectiveResult.liquidityTrapTriggered
  // below). Null when valuation is unavailable.
  liquidityTier?: LiquidityTier | null;
  hitTarget?: boolean | null;
  needsClose?: boolean | null;
  hasGtc?: boolean | null;
  buffer?: number | null;
  earningsDate?: string | null;
  expDate?: string | null;
  healthScore?: PositionHealthScore | null;
  // PI-0004B: optional, independent fields -- see PositionStrategy /
  // AssignmentPreference doc comments in types.ts. Read by PI-0006B's intent
  // selection for Wheel/assignment-preference awareness (ticket #7) --
  // still not read by any of this file's own trigger-detection branches,
  // which are unchanged from PI-0002/TE-0006B.
  positionStrategy?: PositionStrategy | null;
  assignmentPreference?: AssignmentPreference | null;
  // PI-0006B: optional evidence for intent selection (see
  // ../managementIntent.ts's doc comment for why each is optional and what
  // "absent" means for each). None of these are read by the trigger-
  // detection branches below -- only by the intent-selection pass that runs
  // after a branch has already fired.
  //
  // managementFlags mirrors evaluatePortfolioObjectives.ts's
  // PortfolioPositionInput field of the same name -- 'roll_review' is the
  // one form of roll-specific evidence this codebase has.
  managementFlags?: string[] | null;
  // % decline off peak net edge (negative = below peak) and whether net
  // edge is currently negative -- both already computed on the Portfolio
  // page (see netEdgePeak/netEdgeLive in app/portfolio/page.tsx) and passed
  // through here where available; this module performs no net-edge math of
  // its own.
  netEdgeDeclinePct?: number | null;
  netEdgeNegative?: boolean | null;
  // Existing "trend vs. strategy" alignment (see TrendResult/trendAgainst/
  // trendAligns in app/portfolio/page.tsx). Not yet wired through from the
  // Portfolio page in this V1 (see PI-0006B implementation report) -- accepted
  // here so a future slice, or a direct caller/test, can supply it without
  // another type change.
  technicalAlignment?: TechnicalAlignment | null;
  // PI-0008B: Remaining Opportunity (PI-0008A), 0-100, already computed
  // wherever the caller also computes Position Intelligence's own Remaining
  // Opportunity display (see app/portfolio/page.tsx's
  // scorePortfolioRemainingOpportunity). Threaded through to intent
  // selection here for the first time -- see managementIntent.ts's doc
  // comment for how it's used.
  remainingOpportunityPct?: number | null;
}

// PI-0006B: `kind` (above) remains the stable internal trigger identifier --
// unchanged, so ruleId/type/actionability/management-choices mappings keyed
// off it are untouched. `label` is now sourced from the canonical
// ManagementIntent selector (../managementIntent.ts) instead of PI-0006A's
// static per-kind lookup table: the same trigger (e.g. 'roll-soon',
// 'watch', 'assignment-risk') can resolve to different decisive labels
// depending on evidence -- a material loss resolves to Cut Losses, a tight
// buffer without a loss resolves to Reduce Risk, a Wheel CSP with assignment
// preferred resolves to Accept Assignment, and so on. See
// classifyIntentContext() below and the evidence-assembly block inside
// evaluatePositionObjective().
function classifyIntentContext(
  strategyUpper: string,
  positionStrategy: PositionStrategy | null | undefined,
): ManagementIntentContext {
  if (positionStrategy === 'WHEEL') {
    // A Wheel cycles between a CSP leg and a covered-call leg -- both get
    // assignment-aware handling, just against slightly different relevant
    // intent sets (see managementIntent.ts's RELEVANT_INTENTS).
    return strategyUpper.includes('CALL') || strategyUpper.includes('COVERED') ? 'covered-call' : 'wheel-csp';
  }
  if (strategyUpper.includes('CSP') || strategyUpper === 'PUT') return 'wheel-csp';
  if (strategyUpper.includes('COVERED') || (strategyUpper === 'CALL' && positionStrategy !== 'ACQUIRE')) return 'covered-call';
  if (['BPS', 'BCS', 'IC'].includes(strategyUpper) || strategyUpper.includes('SPREAD')) return 'credit-spread';
  return 'other-position';
}

// -- helpers, moved verbatim from recommendation-rules.ts (behavior-critical, unchanged) --

// PI-0008A: exported alongside daysUntil()/isUpcomingBeforeExpiration() above
// -- remainingOpportunity.ts's caller (app/portfolio/page.tsx) needs the same
// fraction-vs-percent normalization this module already applies to pnlPct/
// buffer before evaluating its own trigger branches, so evidence handed to
// calculateRemainingOpportunity() is normalized exactly the same way.
export function normalizePositionObjectivePct(value: number | null | undefined): number | null {
  if (value == null || !Number.isFinite(value)) return null;
  return Math.abs(value) <= 1 ? value * 100 : value;
}

function hasHealthFactor(input: PositionObjectiveInput, key: string): boolean {
  return Boolean(input.healthScore?.factors?.some((f) => f.key === key));
}

// PI-0008A: exported (previously module-private) so remainingOpportunity.ts
// can reuse the exact same earnings-date math instead of duplicating it.
// Pure date arithmetic, not part of the recommendation/scoring logic --
// exporting it changes nothing about how this module's own branches behave.
export function daysUntil(dateString: string | null | undefined, now: Date = new Date()): number | null {
  if (!dateString) return null;
  const target = new Date(`${dateString}T00:00:00`);
  if (Number.isNaN(target.getTime())) return null;
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);
  target.setHours(0, 0, 0, 0);
  return Math.round((target.getTime() - today.getTime()) / 86_400_000);
}

// PI-0008A: exported alongside daysUntil() above, for the same reason.
export function isUpcomingBeforeExpiration(
  dateString: string | null | undefined,
  expDate: string | null | undefined,
  now: Date = new Date(),
): boolean {
  const days = daysUntil(dateString, now);
  if (days == null || days < 0) return false;
  if (!expDate) return true;
  const date = new Date(`${dateString}T00:00:00`);
  const expiry = new Date(`${expDate}T23:59:59`);
  if (Number.isNaN(date.getTime()) || Number.isNaN(expiry.getTime())) return false;
  return date <= expiry;
}

function isShortPremiumStrategy(strategy: string | null | undefined): boolean {
  const normalized = String(strategy ?? '').toUpperCase();
  return (
    ['BPS', 'BCS', 'IC', 'PUT', 'CALL'].includes(normalized) ||
    normalized.includes('CSP') ||
    normalized.includes('SPREAD') ||
    normalized.includes('SHORT')
  );
}

function makeLegacyRecommendation(
  input: PositionObjectiveInput,
  kind: PortfolioRecommendationKind,
  urgency: PortfolioRecommendationUrgency,
  confidence: number,
  primaryReason: string,
  suggestedAction: string,
  supportingReasons: string[] = [],
  now: Date = new Date(),
  intentResult?: ManagementIntentResult,
): PortfolioRecommendation {
  // PI-0006B: intentResult's own reasons (the specific evidence that won it
  // the recommendation) lead; PI-0006A's dte/pnlPct/buffer/healthScore
  // bullets follow as supporting context. Capped at 4 total, same as
  // buildSupportingReasons already did on its own.
  const mergedReasons = intentResult
    ? [...intentResult.reasons, ...supportingReasons].slice(0, 4)
    : supportingReasons;

  return {
    positionId: input.positionId ?? input.key ?? `${input.symbol}-${input.expDate ?? 'unknown'}`,
    symbol: input.symbol,
    kind,
    // PI-0006B: decisive, user-facing label sourced from the canonical
    // intent selector -- see classifyIntentContext() above and
    // selectManagementIntent() in ../managementIntent.ts.
    label: intentResult?.label ?? kind,
    urgency,
    confidence: Math.max(0, Math.min(100, Math.round(confidence))),
    primaryReason,
    supportingReasons: mergedReasons,
    suggestedAction,
    computedAt: now.toISOString(),
    managementIntent: intentResult,
  };
}

// Maps a legacy urgency directly onto a PortfolioObjective priority. `watch`
// and `hold` never reach here at 'critical' or 'high' -- those tiers are
// reserved for the genuinely time-sensitive legacy kinds, preserved as-is.
const URGENCY_TO_PRIORITY: Record<PortfolioRecommendationUrgency, PortfolioObjective['priority']> = {
  critical: 'critical',
  high: 'high',
  medium: 'medium',
  low: 'low',
};

const URGENCY_TO_OBJECTIVE_URGENCY: Record<PortfolioRecommendationUrgency, PortfolioObjective['urgency']> = {
  critical: 'now',
  high: 'today',
  medium: 'this_week',
  low: 'monitor',
};

const KIND_TO_TYPE: Record<Exclude<PortfolioRecommendationKind, 'hold'>, PortfolioObjective['type']> = {
  'assignment-risk': 'REVIEW_THREATENED_POSITION',
  'close-loser': 'REVIEW_THREATENED_POSITION',
  'earnings-risk': 'REVIEW_THREATENED_POSITION',
  'close-winner': 'CLOSE_FOR_PROFIT',
  'roll-soon': 'MANAGE_POSITION',
  'place-gtc': 'MANAGE_POSITION',
  'let-expire': 'MANAGE_POSITION',
  watch: 'MANAGE_POSITION',
  'verify-pricing': 'MANAGE_POSITION',
};

// PI-0003: each legacy kind now gets its own fine-grained rule ID, instead
// of collapsing to one ID per type (PI-0002's interim approach, which this
// resolves -- see PI-0002 plan doc "OBJ-MANAGE-21-DTE now covers some
// non-DTE-driven cases" for the naming tension this fixes).
const KIND_TO_RULE_ID: Record<Exclude<PortfolioRecommendationKind, 'hold'>, PortfolioObjectiveRuleId> = {
  'assignment-risk': 'OBJ-ASSIGNMENT-RISK',
  'close-loser': 'OBJ-CLOSE-LOSER',
  'earnings-risk': 'OBJ-EARNINGS-RISK',
  'close-winner': 'OBJ-CLOSE-FOR-PROFIT',
  'roll-soon': 'OBJ-MANAGE-21-DTE',
  'place-gtc': 'OBJ-PLACE-GTC',
  'let-expire': 'OBJ-LET-EXPIRE',
  watch: 'OBJ-WATCH-POSITION',
  'verify-pricing': 'OBJ-VERIFY-PRICING',
};

// PI-0004B: earnings-risk is the one branch with dedicated actionability
// logic -- "earnings before expiration" is a true fact the moment it's
// detected, but it isn't worth the trader's attention until it's inside the
// centralized review window (DEFAULT_POSITION_MANAGEMENT_POLICY.
// earningsReviewWindowDays). Everything else defaults to a priority-derived
// actionability (see actionability.ts's doc comment for why that's a
// sufficient proxy for every other branch).
function computeActionability(
  kind: Exclude<PortfolioRecommendationKind, 'hold'>,
  priority: PortfolioObjective['priority'],
  input: PositionObjectiveInput,
  now: Date,
): PortfolioObjectiveActionability {
  if (kind === 'earnings-risk') {
    const daysUntilEarnings = daysUntil(input.earningsDate, now);
    if (daysUntilEarnings != null && daysUntilEarnings <= DEFAULT_POSITION_MANAGEMENT_POLICY.earningsReviewWindowDays) {
      return 'REVIEW_SOON';
    }
    return 'MONITOR';
  }
  return defaultActionabilityForPriority(priority);
}

// PI-0004B: "Remove generic review triggers... replace with meaningful
// triggers when available" -- every branch below derives its trigger from
// the actual condition that fired it (the same fields/policy values already
// used to evaluate that branch), instead of the old one-size-fits-all
// "re-check on next portfolio refresh" text.
function buildReviewTriggers(
  kind: Exclude<PortfolioRecommendationKind, 'hold'>,
  input: PositionObjectiveInput,
): PortfolioObjectiveReviewTrigger[] {
  switch (kind) {
    case 'assignment-risk':
      return [{
        id: 'assignment-or-buffer-recovery', label: 'Assignment or buffer recovery', triggerType: 'risk',
        explanation: 'Re-evaluate upon assignment, or if the strike buffer recovers above the critical threshold before expiration.',
      }];
    case 'close-loser':
      return [{
        id: 'position-managed', label: 'Position closed or rolled', triggerType: 'risk',
        explanation: 'Re-evaluate once the position is closed, rolled, or the loss no longer meets the loss-stop threshold.',
      }];
    case 'earnings-risk':
      return [{
        id: 'review-before-earnings', label: 'Review before earnings', triggerType: 'earnings',
        threshold: input.earningsDate ?? undefined,
        explanation: 'Decide whether to close, reduce risk, or intentionally hold through earnings before the earnings date arrives.',
      }];
    case 'close-winner':
      return [{
        id: 'close-or-gtc-fill', label: 'Close confirmed or GTC fills', triggerType: 'profit_target',
        threshold: `${DEFAULT_POSITION_MANAGEMENT_POLICY.profitTargetPct}%`,
        explanation: 'Re-evaluate once the position is closed or the profit-target GTC order fills.',
      }];
    case 'roll-soon':
      return [{
        id: 'dte-review-window', label: 'Next DTE management threshold reached', triggerType: 'dte',
        threshold: DEFAULT_POSITION_MANAGEMENT_POLICY.dteReviewThreshold,
        explanation: 'Finalize the close, roll, or hold decision as DTE continues to decrease toward the near-term management window.',
      }];
    case 'place-gtc':
      return [{
        id: 'gtc-confirmed', label: 'GTC order confirmed working', triggerType: 'manual',
        explanation: 'Re-evaluate once a profit-target GTC order is placed and confirmed working.',
      }];
    case 'let-expire':
      return [{
        id: 'strike-buffer-below-policy', label: 'Strike buffer falls below policy', triggerType: 'price',
        threshold: '2%',
        explanation: 'Re-evaluate if the strike buffer erodes toward the critical threshold before expiration.',
      }];
    case 'watch':
      return [{
        id: 'health-score-threshold', label: 'Health score crosses policy threshold', triggerType: 'risk',
        threshold: DEFAULT_POSITION_MANAGEMENT_POLICY.watchHealthScoreThreshold,
        explanation: 'Re-evaluate if the health score moves back above the watch threshold, or deteriorates further.',
      }];
    case 'verify-pricing':
      return [{
        id: 'fresh-executable-quote', label: 'Fresh broker leg quotes received', triggerType: 'price',
        explanation: 'Re-evaluate only after every leg has a fresh, reliable, two-sided quote and the derived marketable estimate resolves the pricing conflict. This is not a firm complex-order quote or guaranteed fill price.',
      }];
  }
}

// PI-0004B: portfolioImpact/incomeImpact were previously identical
// boilerplate across every branch ("Consolidated from the per-position
// recommendation engine..." / "No direct income impact modeled..."). Each
// kind now gets an impact statement grounded in what that specific
// recommendation actually means -- riskImpact/capitalImpact were already
// reasonably kind-aware and are left as-is.
function buildPortfolioAndIncomeImpact(
  kind: Exclude<PortfolioRecommendationKind, 'hold'>,
  intent?: ManagementIntentResult['intent'],
): { portfolioImpact: ObjectiveImpact; incomeImpact: ObjectiveImpact } {
  // PI-0006B: assignment-risk previously always described assignment as an
  // unplanned risk to avoid -- no longer accurate once the intent selector
  // has resolved this to Accept Assignment (a Wheel position where
  // assignment is the stated goal, ticket #7). Every other kind's impact
  // text is unchanged from PI-0006A/PI-0002 (see "Follow-ups" in the
  // PI-0006B implementation report -- a full per-intent impact rewrite is
  // deferred as broader than this ticket's scope).
  if (kind === 'assignment-risk' && intent === 'ACCEPT_ASSIGNMENT') {
    return {
      portfolioImpact: { direction: 'neutral', magnitude: 'low', explanation: 'Assignment is the stated goal for this position -- proceeding is the intended outcome, not a risk to manage away from.' },
      incomeImpact: { direction: 'positive', magnitude: 'low', explanation: 'Assignment converts the position as planned; a Wheel position typically continues with a covered call against the resulting shares.' },
    };
  }
  switch (kind) {
    case 'assignment-risk':
      return {
        portfolioImpact: { direction: 'negative', magnitude: 'high', explanation: 'Leaving this unreviewed risks an unplanned assignment or a breach beyond the strike buffer before expiration.' },
        incomeImpact: { direction: 'neutral', magnitude: 'low', explanation: 'Income effect depends on how assignment, close, or roll is resolved -- not yet determined.' },
      };
    case 'close-loser':
      return {
        portfolioImpact: { direction: 'negative', magnitude: 'high', explanation: 'The loss is already incurred whether or not it is closed -- reviewing now limits further downside from an unmanaged position.' },
        incomeImpact: { direction: 'negative', magnitude: 'medium', explanation: 'Closing or rolling at a loss reduces net income for the period.' },
      };
    case 'earnings-risk':
      return {
        portfolioImpact: { direction: 'negative', magnitude: 'medium', explanation: 'An earnings gap before expiration adds event risk beyond normal theta decay.' },
        incomeImpact: { direction: 'neutral', magnitude: 'low', explanation: 'No income change from monitoring alone; effect depends on whether the position is closed, reduced, or intentionally held through earnings.' },
      };
    case 'close-winner':
      return {
        portfolioImpact: { direction: 'positive', magnitude: 'medium', explanation: 'Closing locks in the captured gain and frees the allocated capital and risk budget for redeployment.' },
        incomeImpact: { direction: 'positive', magnitude: 'medium', explanation: 'Realizes the premium already earned on this position.' },
      };
    case 'roll-soon':
      return {
        portfolioImpact: { direction: 'neutral', magnitude: 'medium', explanation: 'Time-based review of an existing position; outcome depends on whether it is closed, rolled, or held to expiration.' },
        incomeImpact: { direction: 'neutral', magnitude: 'low', explanation: 'Rolling can extend income collection and closing realizes it now -- no income change from the review itself.' },
      };
    case 'place-gtc':
      return {
        portfolioImpact: { direction: 'neutral', magnitude: 'low', explanation: 'Placing a GTC order does not change the position itself, only how the existing profit target gets captured.' },
        incomeImpact: { direction: 'positive', magnitude: 'low', explanation: 'Protects the profit already accrued from being given back if the position reverses before it is otherwise managed.' },
      };
    case 'let-expire':
      return {
        portfolioImpact: { direction: 'neutral', magnitude: 'low', explanation: 'Letting a healthy, near-expiration position decay to zero is the intended outcome here, not a risk needing intervention.' },
        incomeImpact: { direction: 'positive', magnitude: 'low', explanation: 'Full remaining premium is retained if the position expires as expected.' },
      };
    case 'watch':
      return {
        portfolioImpact: { direction: 'neutral', magnitude: 'medium', explanation: 'No immediate action is required, but the flagged factors are worth monitoring before they compound.' },
        incomeImpact: { direction: 'neutral', magnitude: 'low', explanation: 'No income change from monitoring alone.' },
      };
    case 'verify-pricing':
      return {
        portfolioImpact: { direction: 'neutral', magnitude: 'medium', explanation: 'The position remains under review because the current marketable estimate is not trustworthy enough to support a directional action.' },
        incomeImpact: { direction: 'neutral', magnitude: 'low', explanation: 'No income decision is supported until fresh broker leg quotes produce a reliable marketable estimate.' },
      };
  }
}

function buildObjective(
  input: PositionObjectiveInput,
  legacy: PortfolioRecommendation,
  now: Date,
): PortfolioObjective {
  const kind = legacy.kind as Exclude<PortfolioRecommendationKind, 'hold'>;
  const type = KIND_TO_TYPE[kind];
  const ruleId = KIND_TO_RULE_ID[kind];
  const priority = URGENCY_TO_PRIORITY[legacy.urgency];
  const concerns: PortfolioObjectiveConcern[] = [
    {
      id: legacy.kind,
      label: legacy.label,
      severity:
        legacy.urgency === 'critical' ? 'critical' : legacy.urgency === 'high' ? 'high' : legacy.urgency === 'medium' ? 'medium' : 'low',
      explanation: legacy.primaryReason,
    },
  ];
  const supportingEvidence: PortfolioObjectiveEvidence[] = legacy.supportingReasons.map((reason, index) => ({
    id: `legacy-reason-${index}`,
    label: reason.split(':')[0] ?? 'Factor',
    tone: 'neutral',
    explanation: reason,
  }));
  const { portfolioImpact, incomeImpact } = buildPortfolioAndIncomeImpact(kind, legacy.managementIntent?.intent);

  return {
    id: `objective_${now.getTime().toString(36)}_${Math.random().toString(36).slice(2, 9)}`,
    createdAt: now.toISOString(),
    version: 'portfolio-objective-v1',
    type,
    ruleId,
    title: `${legacy.label}: ${input.symbol}`,
    summary: legacy.primaryReason,
    priority,
    urgency: URGENCY_TO_OBJECTIVE_URGENCY[legacy.urgency],
    actionability: computeActionability(kind, priority, input, now),
    confidence: legacy.confidence,
    status: 'active',
    source: 'position',
    subject: { type: 'position', id: legacy.positionId, symbol: input.symbol, label: `${input.symbol} position` },
    rationale: `${legacy.primaryReason} ${legacy.suggestedAction}`,
    supportingEvidence,
    concerns,
    portfolioImpact,
    incomeImpact,
    riskImpact: {
      direction: legacy.kind === 'close-winner' ? 'positive' : legacy.urgency === 'critical' || legacy.urgency === 'high' ? 'negative' : 'neutral',
      magnitude: legacy.urgency === 'critical' ? 'high' : legacy.urgency === 'high' ? 'medium' : 'low',
      explanation: legacy.primaryReason,
    },
    capitalImpact: { direction: 'neutral', magnitude: 'low', explanation: 'No capital change from generating this objective alone.' },
    reviewTriggers: buildReviewTriggers(kind, input),
    managementIntent: legacy.managementIntent,
    metadata: {
      executionAllowed: false,
      paperExecutionAllowed: false,
      rulesEvaluated: ['position_objective_legacy_consolidated'],
      rulesTriggered: [legacy.kind],
    },
  };
}

export interface PositionObjectiveResult {
  objective: PortfolioObjective | null;
  legacyRecommendation: PortfolioRecommendation;
  // PI-0014: true when marketable evidence alone changed materialLoss,
  // weakHealthLoss, or profitTargetReached relative to what mid pricing
  // alone would have produced.
  executionRealityPromoted: boolean;
  // PI-0014 follow-up (Product Owner review): true only when
  // a marketable-only promotion OR a pricing-verification conflict coincides
  // with caller-supplied liquidityTier 'LIQUIDITY_TRAP'. This is a
  // valuation property -- a position can be LIQUIDITY_TRAP tier
  // (lib/positionValuation's own, purely observational classification) and
  // still have this false if the recommendation would have been the same
  // either way. False (never fabricated true) when liquidityTier is absent.
  liquidityTrapTriggered: boolean;
  // PI-0014C: reconstructable, typed record of which valuation was allowed
  // to control the recommendation. This is also the canonical AI/UI
  // grounding contract; consumers must not infer a basis from prose.
  pricingDecisionEvidence: PortfolioPricingDecisionEvidence;
}

// PI-0006A: builds 2-4 concise evidence bullets from data this function
// already has in scope -- health-score factors first (most specific),
// padded out with the already-normalized dte/pnlPct/buffer/healthScore
// values when health factors are sparse or absent. No new fields, no new
// calculations -- these are the exact values every branch below already
// reads to decide which recommendation fires.
function buildSupportingReasons(
  input: PositionObjectiveInput,
  dte: number | null,
  pnlPct: number | null,
  buffer: number | null,
  healthScore: number | null,
): string[] {
  const reasons = input.healthScore?.factors?.slice(0, 3).map((f) => `${f.label}: ${f.message}`) ?? [];
  if (reasons.length < 2 && dte != null) reasons.push(`Days to expiration: ${dte}.`);
  if (reasons.length < 2 && pnlPct != null) reasons.push(`Open P/L: ${pnlPct.toFixed(0)}% of credit.`);
  if (reasons.length < 2 && buffer != null) reasons.push(`Strike buffer: ${buffer.toFixed(1)}%.`);
  if (reasons.length < 2 && healthScore != null) reasons.push(`Health score: ${healthScore}.`);
  return reasons.slice(0, 4);
}

// The single canonical evaluator for per-position recommendations. Trigger
// order and thresholds below are preserved EXACTLY from the original
// calculatePortfolioRecommendation() (TE-0006B) for parity -- do not
// reorder or retune without an explicit product decision, since Portfolio
// page cards depend on this producing identical output to before PI-0002.
export function evaluatePositionObjective(
  input: PositionObjectiveInput,
  now: Date = new Date(),
): PositionObjectiveResult {
  const dte = Number.isFinite(input.dte ?? NaN) ? Number(input.dte) : null;
  const pnlPct = normalizePositionObjectivePct(input.pnlPct);
  // PI-0014: see PositionObjectiveInput.marketablePnlPct doc comment above.
  const marketablePnlPct = normalizePositionObjectivePct(input.marketablePnlPct);
  const marketableQuoteQuality = input.marketableQuoteQuality ?? 'UNKNOWN';
  const marketableQuoteFreshness = input.marketableQuoteFreshness ?? 'UNKNOWN';
  const marketableDecisionEligible =
    marketablePnlPct != null &&
    marketableQuoteQuality === 'RELIABLE' &&
    marketableQuoteFreshness === 'FRESH';
  const buffer = normalizePositionObjectivePct(input.buffer);
  const healthScore = input.healthScore?.score ?? null;
  const strategy = String(input.strategy ?? '').toUpperCase();
  const shortPremium = isShortPremiumStrategy(strategy);

  // PI-0006A: "support every recommendation" with 2-4 concise evidence
  // bullets, using existing engine data only -- no new calculations. Health
  // factors are the richest source when present; when there are fewer than
  // two (including the common case of no healthScore at all), fall back to
  // the same dte/pnlPct/buffer/healthScore values this function already
  // derived above, which is exactly what drove the primaryReason text for
  // whichever branch fires below.
  const supportingReasons = buildSupportingReasons(input, dte, pnlPct, buffer, healthScore);

  const criticalExpiration = dte != null && dte <= 7;
  const itmOrCriticalBuffer =
    hasHealthFactor(input, 'itm') || hasHealthFactor(input, 'buffer-critical') || (buffer != null && buffer < 2);

  // PI-0006B: independent evidence computation for intent selection --
  // these mirror the exact conditions the branches below use to fire, but
  // are computed once, up front, regardless of which single branch ends up
  // winning the if/else-if chain. This is what lets e.g. a position that
  // triggers 'assignment-risk' (tight buffer near expiration) still resolve
  // to Cut Losses when it *also* has a material loss, or to Accept
  // Assignment when it's a Wheel CSP with assignment preferred -- the
  // trigger-detection chain below is unchanged, only the label is now
  // evidence-driven rather than a static 1:1 lookup.
  // PI-0014: Execution Reality gate. materialLoss/weakHealthLoss fire on
  // EITHER mid or marketable evidence breaching its threshold -- marketable
  // pricing can only make these fire *more* often, never less, so an
  // already-conservative mid-based verdict is never weakened. profitTargetReached
  // still fires on mid evidence (unchanged), but is vetoed when marketable
  // data is available and contradicts it; a vetoed profit target simply
  // falls through to whichever branch the cascade below reaches next
  // (roll-soon / watch / hold) -- no separate demotion logic needed, the
  // existing if/else-if priority order already produces the correct
  // "Take Profit -> Hold/Manage/Cut Losses" behavior once this input is
  // corrected. See docs/design/PI-0014-Marketable-Pricing-Risk-Gating.md.
  const midMaterialLoss = pnlPct != null && pnlPct <= DEFAULT_POSITION_MANAGEMENT_POLICY.materialLossPct;
  const rawMarketableMaterialLoss =
    marketablePnlPct != null && marketablePnlPct <= DEFAULT_POSITION_MANAGEMENT_POLICY.materialLossPct;
  const marketableMaterialLoss = marketableDecisionEligible && rawMarketableMaterialLoss;
  const materialLoss = midMaterialLoss || marketableMaterialLoss;

  const midWeakHealthLoss =
    pnlPct != null && pnlPct <= DEFAULT_POSITION_MANAGEMENT_POLICY.weakHealthLossPct &&
    healthScore != null && healthScore < DEFAULT_POSITION_MANAGEMENT_POLICY.weakHealthScoreThreshold;
  const rawMarketableWeakHealthLoss =
    marketablePnlPct != null && marketablePnlPct <= DEFAULT_POSITION_MANAGEMENT_POLICY.weakHealthLossPct &&
    healthScore != null && healthScore < DEFAULT_POSITION_MANAGEMENT_POLICY.weakHealthScoreThreshold;
  const marketableWeakHealthLoss = marketableDecisionEligible && rawMarketableWeakHealthLoss;
  const weakHealthLoss = midWeakHealthLoss || marketableWeakHealthLoss;

  const midProfitTargetReached =
    Boolean(input.hitTarget) || hasHealthFactor(input, 'profit-target') ||
    (pnlPct != null && pnlPct >= DEFAULT_POSITION_MANAGEMENT_POLICY.profitTargetPct);
  const rawMarketableContradictsProfitTarget =
    marketablePnlPct != null && marketablePnlPct < DEFAULT_POSITION_MANAGEMENT_POLICY.profitTargetPct;
  const marketableContradictsProfitTarget =
    marketableDecisionEligible && rawMarketableContradictsProfitTarget;
  const profitTargetReached = midProfitTargetReached && !marketableContradictsProfitTarget;

  // Did marketable evidence alone change any of the three outcomes above?
  // Feeds both the explainability bullet appended after the cascade below
  // and the executionRealityPromoted flag this function returns (which
  // callers combine with lib/positionValuation's liquidityTier to set
  // PositionValuation.liquidityTrapTriggered).
  const executionRealityPromoted =
    (!midMaterialLoss && marketableMaterialLoss) ||
    (!midWeakHealthLoss && marketableWeakHealthLoss) ||
    (midProfitTargetReached && !profitTargetReached);
  const pricingConflictRequiresVerification =
    marketablePnlPct != null &&
    !marketableDecisionEligible &&
    ((!midMaterialLoss && rawMarketableMaterialLoss) ||
      (!midWeakHealthLoss && rawMarketableWeakHealthLoss) ||
      (midProfitTargetReached && rawMarketableContradictsProfitTarget));
  const pricingVerificationUnresolved =
    !marketableDecisionEligible &&
    (pricingConflictRequiresVerification || input.priorPricingVerificationUnresolved === true);
  const meaningfulUnprotectedProfit =
    shortPremium && input.hasGtc === false && pnlPct != null && pnlPct >= 20 && dte != null && dte > 14;
  const earningsUpcoming = isUpcomingBeforeExpiration(input.earningsDate, input.expDate, now);
  const daysUntilEarnings = daysUntil(input.earningsDate, now);
  const earningsActionable = earningsUpcoming
    ? daysUntilEarnings != null && daysUntilEarnings <= DEFAULT_POSITION_MANAGEMENT_POLICY.earningsReviewWindowDays
    : null;
  // PI-0008B: how close, within the review window, earnings actually falls --
  // 0 at the window's outer edge, 1 the day of. Computed here (where the
  // policy threshold already lives) rather than in managementIntent.ts,
  // which does not read policy thresholds itself. Only meaningful when
  // earningsActionable is true.
  const earningsProximityFraction = earningsActionable && daysUntilEarnings != null
    ? Math.max(0, Math.min(1, (DEFAULT_POSITION_MANAGEMENT_POLICY.earningsReviewWindowDays - daysUntilEarnings) / DEFAULT_POSITION_MANAGEMENT_POLICY.earningsReviewWindowDays))
    : null;
  const rollFlagged = Boolean(input.managementFlags?.includes('roll_review'));
  const intentContext = classifyIntentContext(strategy, input.positionStrategy);

  const intentEvidence: ManagementIntentEvidence = {
    context: intentContext,
    dte,
    pnlPct,
    materialLoss,
    weakHealthLoss,
    itmOrCriticalBuffer,
    profitTargetReached,
    meaningfulUnprotectedProfit,
    earningsActionable,
    earningsProximityFraction,
    rollFlagged,
    assignmentPreference: input.assignmentPreference,
    positionStrategy: input.positionStrategy,
    netEdgeDeclinePct: input.netEdgeDeclinePct,
    netEdgeNegative: input.netEdgeNegative,
    technicalAlignment: input.technicalAlignment,
    remainingOpportunityPct: input.remainingOpportunityPct,
  };
  const intentResult = selectManagementIntent(intentEvidence);

  let legacy: PortfolioRecommendation;

  if (shortPremium && criticalExpiration && itmOrCriticalBuffer) {
    legacy = makeLegacyRecommendation(
      input, 'assignment-risk', 'critical', 94,
      dte != null ? `${dte} DTE with tight or ITM strike buffer.` : 'Tight or ITM strike buffer near expiration.',
      'Review assignment, close, or roll plan before adding new risk.',
      supportingReasons, now, intentResult,
    );
  } else if (materialLoss) {
    const controllingLossPct = midMaterialLoss ? pnlPct : marketablePnlPct;
    const controllingBasis = midMaterialLoss ? 'midpoint' : 'fresh, reliable marketable';
    legacy = makeLegacyRecommendation(
      input, 'close-loser', 'critical', 91,
      `The ${controllingBasis} valuation is near or beyond the 1x-credit loss threshold (${controllingLossPct!.toFixed(0)}% of credit; midpoint ${pnlPct?.toFixed(0) ?? 'unknown'}%, marketable ${marketablePnlPct?.toFixed(0) ?? 'unknown'}%).`,
      'Review closing or rolling defensively.',
      supportingReasons, now, intentResult,
    );
  } else if (weakHealthLoss) {
    legacy = makeLegacyRecommendation(
      input, 'close-loser', 'high', 84,
      `Material loss with weak health score (${healthScore}).`,
      'Review whether the thesis still holds; close or roll if risk is no longer acceptable.',
      supportingReasons, now, intentResult,
    );
  } else if (earningsUpcoming) {
    legacy = makeLegacyRecommendation(
      input, 'earnings-risk', 'high', 86,
      `Upcoming earnings before expiration (${input.earningsDate}).`,
      'Decide whether to close, reduce risk, or intentionally hold through earnings.',
      supportingReasons, now, intentResult,
    );
  } else if (profitTargetReached) {
    legacy = makeLegacyRecommendation(
      input, 'close-winner', 'high', 90,
      pnlPct != null ? `Profit target reached at approximately ${pnlPct.toFixed(0)}% of credit.` : 'Profit target reached.',
      'Take profit or confirm the GTC target order is working.',
      supportingReasons, now, intentResult,
    );
  } else if (dte != null && dte <= DEFAULT_POSITION_MANAGEMENT_POLICY.dteReviewThreshold && dte > 7 && shortPremium) {
    legacy = makeLegacyRecommendation(
      input, 'roll-soon', 'medium', 80,
      `${dte} DTE is inside the standard management window.`,
      'Review close, roll, or let-decay plan.',
      supportingReasons, now, intentResult,
    );
  } else if (meaningfulUnprotectedProfit) {
    legacy = makeLegacyRecommendation(
      input, 'place-gtc', 'medium', 78,
      `Position has profit (${pnlPct!.toFixed(0)}%) but no working GTC detected.`,
      'Place or verify a profit-target GTC order.',
      supportingReasons, now, intentResult,
    );
  } else if (dte != null && dte <= 3 && healthScore != null && healthScore >= DEFAULT_POSITION_MANAGEMENT_POLICY.watchHealthScoreThreshold && !itmOrCriticalBuffer) {
    legacy = makeLegacyRecommendation(
      input, 'let-expire', 'low', 72,
      `${dte} DTE with healthy score and no critical buffer flag.`,
      'Monitor through expiration only if assignment risk is acceptable.',
      supportingReasons, now, intentResult,
    );
  } else if ((healthScore != null && healthScore < DEFAULT_POSITION_MANAGEMENT_POLICY.watchHealthScoreThreshold) || (buffer != null && buffer < 5)) {
    legacy = makeLegacyRecommendation(
      input, 'watch', 'medium', 70,
      healthScore != null ? `Health score is ${healthScore}.` : 'One or more risk factors deserve attention.',
      'Monitor closely and avoid adding correlated risk.',
      supportingReasons, now, intentResult,
    );
  } else {
    legacy = makeLegacyRecommendation(
      input, 'hold', 'low', 76,
      healthScore != null ? `Health score is ${healthScore}; no primary action rule triggered.` : 'No primary action rule triggered.',
      'Leave position alone unless market conditions or thesis change.',
      supportingReasons, now, intentResult,
    );
  }

  // PI-0014: explainability -- a recommendation must be reconstructable from
  // its stated evidence alone. When marketable pricing actually changed the
  // outcome, say so explicitly and put it first, rather than letting the
  // divergence stay invisible inside a single reused pnlPct-style number.
  if (executionRealityPromoted && marketablePnlPct != null && pnlPct != null) {
    legacy = {
      ...legacy,
      supportingReasons: [
        `The marketable estimate is materially worse than mid: ${marketablePnlPct.toFixed(0)}% vs ${pnlPct.toFixed(0)}% of credit -- wide bid/ask changed this recommendation.`,
        ...legacy.supportingReasons,
      ].slice(0, 4),
    };
  }

  // PI-0014C final correction: an unresolved verification is sticky only
  // across non-authoritative fallback/profit states. Current independent
  // threat-management rules must remain authoritative; never let missing
  // marketable evidence mask midpoint loss, assignment, earnings, or DTE
  // management. Rebuild Verify Pricing from current evidence rather than
  // transplanting an earlier recommendation/objective with stale figures.
  const independentCurrentKinds = new Set<PortfolioRecommendationKind>([
    'assignment-risk',
    'close-loser',
    'earnings-risk',
    'roll-soon',
    'let-expire',
  ]);
  const pricingVerificationIsPrimary =
    pricingVerificationUnresolved &&
    legacy.kind !== 'verify-pricing' &&
    !independentCurrentKinds.has(legacy.kind);

  if (pricingVerificationIsPrimary) {
    const currentEvidence = marketablePnlPct == null
      ? 'current broker leg quotes are incomplete, so no marketable estimate is available'
      : `the current marketable estimate is not decision-eligible (${marketableQuoteQuality.toLowerCase()} quality, ${marketableQuoteFreshness.toLowerCase()} freshness)`;
    legacy = makeLegacyRecommendation(
      input, 'verify-pricing', 'high', 70,
      `A prior pricing conflict remains unresolved because ${currentEvidence}.`,
      'Refresh broker leg quotes and verify the derived marketable estimate before making a pricing-dependent decision; it is not a guaranteed fill price.',
      supportingReasons, now,
    );
    legacy = { ...legacy, label: 'Verify Pricing' };
  }

  const objective = legacy.kind === 'hold' ? null : buildObjective(input, legacy, now);

  // PI-0014 follow-up (Product Owner review): liquidityTrapTriggered is a
  // decision-engine property, owned here, not by lib/positionValuation's
  // PositionValuation (which stays purely observational -- see that
  // module's types.ts doc). Never fabricated true when liquidityTier is
  // absent.
  const liquidityTrapTriggered =
    (executionRealityPromoted || pricingVerificationUnresolved) &&
    input.liquidityTier === 'LIQUIDITY_TRAP';

  const pricingDecisionEvidence: PortfolioPricingDecisionEvidence = {
    midPnlPct: pnlPct,
    marketablePnlPct,
    marketableQuoteQuality,
    marketableQuoteFreshness,
    marketableQuoteCapturedAt: input.marketableQuoteCapturedAt ?? null,
    marketableDecisionEligible,
    verificationUnresolved: pricingVerificationUnresolved,
    controllingBasis: executionRealityPromoted
      ? 'MARKETABLE'
      : pnlPct != null
        ? 'MID'
        : 'NONE',
    status: pricingVerificationIsPrimary
      ? 'VERIFY_PRICING'
      : executionRealityPromoted
        ? 'MARKETABLE_CONFIRMED'
        : marketablePnlPct == null
          ? 'MID_ONLY'
          : !marketableDecisionEligible
            ? 'MARKETABLE_OBSERVATIONAL'
            : 'PRICING_AGREEMENT',
  };

  return { objective, legacyRecommendation: legacy, executionRealityPromoted, liquidityTrapTriggered, pricingDecisionEvidence };
}
