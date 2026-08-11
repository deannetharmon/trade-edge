// lib/portfolio-intelligence/types.ts
//
// PI-0001: canonical domain model for the Portfolio Intelligence layer.
// This layer answers "given the entire portfolio, what deserves the
// trader's attention today?" -- it does NOT re-answer "is this candidate a
// good trade?" (that's lib/decision-engine's job). Where an objective
// concerns a specific position/candidate that already has a DecisionAnalysis,
// this layer links to it via `linkedDecisionAnalysis` rather than
// re-deriving that reasoning.
//
// Dependency direction is intentional and one-way:
//   lib/portfolio-intelligence -> lib/decision-engine (types only, for linking)
//   lib/autopilot              -> lib/portfolio-intelligence (future consumer)
// portfolio-intelligence must never import from lib/autopilot.

import type { DecisionAnalysis, EvidenceTone } from '@/lib/decision-engine';
import type { ManagementIntentResult } from './managementIntent';

// ---------------------------------------------------------------------------
// PortfolioObjective contract
// ---------------------------------------------------------------------------

export type PortfolioObjectiveType =
  | 'MANAGE_POSITION'
  | 'CLOSE_FOR_PROFIT'
  | 'REVIEW_THREATENED_POSITION'
  | 'ROLL_POSITION'
  | 'DEPLOY_IDLE_CASH'
  | 'INCREASE_INCOME'
  | 'REDUCE_CONCENTRATION'
  | 'PRESERVE_BUYING_POWER'
  | 'REVIEW_PENDING_ORDER'
  | 'WAIT';

export type PortfolioObjectivePriority = 'critical' | 'high' | 'medium' | 'low' | 'informational';

export type PortfolioObjectiveUrgency = 'now' | 'today' | 'this_week' | 'monitor' | 'none';

// PI-0004B: Actionability answers a different question than priority/urgency
// do. Priority/urgency describe how severe or time-sensitive a *true* fact
// is; Actionability answers whether that fact deserves the trader's
// attention *today*. A position can have a real, correctly-detected
// condition (e.g. earnings before expiration) that simply isn't actionable
// yet -- MONITOR -- until some condition (a review window opening, a
// threshold being crossed) promotes it. MONITOR objectives are still
// produced and still carry their full priority/urgency/rationale -- they are
// just excluded from the surfaced Today's Priorities list by the combining
// adapter (see adapters/portfolioIntelligenceAdapter.ts). This keeps
// "is this true" (priority/urgency, unchanged) separate from "does this
// belong in front of the trader right now" (actionability, new).
export type PortfolioObjectiveActionability = 'MONITOR' | 'REVIEW_SOON' | 'ACTION_NEEDED' | 'CRITICAL';

// PI-0004B: Position Strategy -- the trader's declared management plan for a
// position. Deliberately small (three values): WHEEL (CSP/CC intentionally
// cycling toward and through assignment), INCOME (pure premium harvesting,
// assignment is a failure mode to avoid), ACQUIRE (a one-shot acquisition
// CSP -- assignment is welcome, but there's no intent to keep writing calls
// against the shares the way WHEEL does). Optional and independent of
// AssignmentPreference below -- a position with no PositionStrategy set is
// legacy/unclassified, not silently assumed to be any particular strategy.
export type PositionStrategy = 'WHEEL' | 'INCOME' | 'ACQUIRE';

// PI-0004B: Assignment Preference -- independent of PositionStrategy by
// design (the brief is explicit: a WHEEL position and its assignment
// preference are two separate questions). AVOID: assignment is an unwanted
// outcome to manage away from. ACCEPT: assignment is a neutral, tolerable
// outcome. PREFER: assignment is the desired outcome -- the position was
// opened wanting it to happen.
export type AssignmentPreference = 'AVOID' | 'ACCEPT' | 'PREFER';

// This first slice is a pure, stateless evaluator with no persistence layer
// -- every call re-derives objectives from scratch, so only 'active' and
// 'informational' are ever produced here. 'resolved' / 'dismissed' are
// reserved for a future decision-history/persistence layer (see
// planning/SPRINT3_PORTFOLIO_INTELLIGENCE_PLAN.md "later Sprint 3 items")
// that would track objectives across runs; this evaluator does not implement
// that tracking and never emits those two values.
export type PortfolioObjectiveStatus = 'active' | 'informational' | 'resolved' | 'dismissed';

// Which slice of the input context this objective was derived from.
export type PortfolioObjectiveSource = 'position' | 'pending_order' | 'portfolio_state' | 'market_context';

export type PortfolioObjectiveSubjectType = 'position' | 'pending_order' | 'portfolio' | 'symbol' | 'sector';

export interface PortfolioObjectiveSubject {
  type: PortfolioObjectiveSubjectType;
  id?: string;
  symbol?: string;
  label: string;
}

export interface PortfolioObjectiveEvidence {
  id: string;
  label: string;
  value?: string | number;
  tone: EvidenceTone;
  explanation?: string;
}

export interface PortfolioObjectiveConcern {
  id: string;
  label: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
  explanation: string;
}

export interface PortfolioObjectiveReviewTrigger {
  id: string;
  label: string;
  triggerType:
    | 'profit_target'
    | 'dte'
    | 'price'
    | 'earnings'
    | 'risk'
    | 'volatility'
    | 'concentration'
    | 'buying_power'
    | 'order_age'
    | 'manual';
  threshold?: string | number;
  explanation: string;
}

// Shared shape for the four required impact dimensions (portfolioImpact,
// incomeImpact, riskImpact, capitalImpact). Deliberately one shared shape
// rather than four bespoke ones -- they're the same kind of statement
// ("this objective moves dimension X in direction Y, roughly this much")
// just applied to different dimensions.
export interface ObjectiveImpact {
  direction: 'positive' | 'negative' | 'neutral';
  magnitude: 'low' | 'medium' | 'high';
  explanation: string;
  estimatedDollarValue?: number;
}

// PI-0003: stable, fine-grained rule IDs. Multiple rule IDs can map to the
// same objective `type` -- rule IDs describe WHY an objective fired,
// `type` describes WHAT kind of objective it is. See ruleIds.ts for the
// rule-id -> type reverse mapping and validation helper.
export type PortfolioObjectiveRuleId =
  | 'OBJ-CLOSE-FOR-PROFIT'
  | 'OBJ-MANAGE-21-DTE'
  | 'OBJ-PLACE-GTC'
  | 'OBJ-LET-EXPIRE'
  | 'OBJ-WATCH-POSITION'
  | 'OBJ-VERIFY-PRICING'
  | 'OBJ-ROLL-POSITION'
  | 'OBJ-ASSIGNMENT-RISK'
  | 'OBJ-EARNINGS-RISK'
  | 'OBJ-CLOSE-LOSER'
  | 'OBJ-DEPLOY-IDLE-CASH'
  | 'OBJ-INCREASE-INCOME'
  | 'OBJ-REDUCE-CONCENTRATION'
  | 'OBJ-PRESERVE-BUYING-POWER'
  | 'OBJ-REVIEW-PENDING-ORDER'
  | 'OBJ-WAIT';

export interface PortfolioObjective {
  id: string;
  createdAt: string;
  version: 'portfolio-objective-v1';
  type: PortfolioObjectiveType;
  // Stable, deterministic rule identifier -- see PortfolioObjectiveRuleId.
  // Always OBJECTIVE_RULE_ID[type]; present on every objective from every
  // producer (portfolio-level and per-position).
  ruleId: PortfolioObjectiveRuleId;
  title: string;
  summary: string;
  priority: PortfolioObjectivePriority;
  urgency: PortfolioObjectiveUrgency;
  // PI-0004B: whether this objective belongs in front of the trader today.
  // Always present, on every objective from every producer (position-level,
  // portfolio-level, WAIT) -- see PortfolioObjectiveActionability's doc
  // comment for why this is distinct from priority/urgency.
  actionability: PortfolioObjectiveActionability;
  confidence: number; // 0-100
  status: PortfolioObjectiveStatus;
  source: PortfolioObjectiveSource;
  subject: PortfolioObjectiveSubject;
  rationale: string;
  supportingEvidence: PortfolioObjectiveEvidence[];
  concerns: PortfolioObjectiveConcern[];
  portfolioImpact: ObjectiveImpact;
  incomeImpact: ObjectiveImpact;
  riskImpact: ObjectiveImpact;
  capitalImpact: ObjectiveImpact;
  reviewTriggers: PortfolioObjectiveReviewTrigger[];
  // Linked when this objective concerns a specific position/candidate that
  // already has a DecisionAnalysis. Not every objective has one -- e.g.
  // REDUCE_CONCENTRATION and PRESERVE_BUYING_POWER are portfolio-level and
  // have no single candidate to link to in this slice. DEPLOY_IDLE_CASH
  // linking to the highest-ranked candidate analysis is explicitly future
  // work (see plan doc), not implemented here.
  linkedDecisionAnalysis?: DecisionAnalysis;
  // PI-0006B: the canonical intent-selection result behind `title` -- see
  // lib/portfolio-intelligence/managementIntent.ts. Optional so existing
  // fixtures/producers that don't yet set it (REDUCE_CONCENTRATION,
  // PRESERVE_BUYING_POWER, INCREASE_INCOME, WAIT -- none of which are part
  // of the ticket's canonical management-intent vocabulary) remain valid.
  managementIntent?: ManagementIntentResult;
  metadata: {
    executionAllowed: false;
    paperExecutionAllowed: false;
    rulesEvaluated: string[];
    rulesTriggered: string[];
  };
}

// ---------------------------------------------------------------------------
// Evaluation input: PortfolioIntelligenceContext
// ---------------------------------------------------------------------------

// Deliberately NOT imported from lib/autopilot/types -- portfolio-intelligence
// must not depend on autopilot (see dependency-direction note above), even
// though the concept overlaps with AutopilotStrategy/PortfolioRiskPosture.
export type PortfolioIntelligenceStrategy = 'BPS' | 'BCS' | 'IC' | 'CSP' | 'CC' | 'STOCK' | 'OTHER';
export type PortfolioIntelligenceRiskPosture = 'conserve' | 'steady' | 'maximize';
export type PortfolioPositionLifecycle = 'open' | 'review_required' | 'closing' | 'assigned' | 'rolled';
export type PendingOrderStatus = 'working' | 'partially_filled' | 'stale' | 'review_required';
export type MarketRegime = 'bullish' | 'bearish' | 'neutral' | 'uncertain';

export interface PortfolioStateInput {
  netLiquidity: number;
  cash: number;
  availableBuyingPower: number;
  buyingPowerUtilizationPct: number;
  currentDrawdownPct: number;
  riskPosture: PortfolioIntelligenceRiskPosture;
  // symbol/sector -> % of net liquidity currently allocated. Portfolio-state
  // level aggregates, not derived from the `positions` array in this slice.
  symbolConcentrationPct: Record<string, number>;
  sectorConcentrationPct: Record<string, number>;
  maxSymbolConcentrationPct: number;
  maxSectorConcentrationPct: number;
  idleCashPct: number;
  recurringIncomeTarget: number;
  currentIncomeProduced: number;
  // PI-0004B: per-symbol fraction (0-1) of that symbol's concentration
  // attributable to positions with PositionStrategy WHEEL and
  // AssignmentPreference PREFER, as derived by
  // adapters/balancesNormalization.ts's deriveWheelDominance(). Optional --
  // absent (or a symbol simply missing from the map) means "no Wheel data
  // available for this symbol", which evaluateConcentration() treats
  // identically to "not Wheel-managed" (existing behavior, unchanged).
  symbolWheelDominance?: Record<string, number>;
}

export interface PortfolioPositionInput {
  id: string;
  symbol: string;
  strategy: PortfolioIntelligenceStrategy;
  status: PortfolioPositionLifecycle;
  dte?: number;
  // P/L as a percentage of credit received / cost basis. Can be negative.
  // -200 means a loss equal to 2x the credit received (this repo's
  // established "2x credit loss stop" convention).
  openPlPct?: number;
  pctOfMaxProfitCaptured?: number; // 0-100
  theoreticalMaxLoss: number;
  currentRisk: number;
  assignmentIntent: 'willing' | 'unwilling' | 'neutral';
  earningsWithinExpiration: boolean;
  managementFlags: string[]; // e.g. 'technical_breach', 'stop_triggered', 'roll_review'
  // PI-0004B: optional, independent fields -- see PositionStrategy /
  // AssignmentPreference doc comments above. Absent on legacy/unclassified
  // positions; never defaulted to 'WHEEL' automatically (see PI-0004B brief:
  // "do not silently convert all ACQUIRE positions into WHEEL").
  positionStrategy?: PositionStrategy;
  assignmentPreference?: AssignmentPreference;
  linkedDecisionAnalysis?: DecisionAnalysis;
}

export interface PendingOrderInput {
  id: string;
  symbol: string;
  strategyAction: string; // free-text description, e.g. 'OPEN_BPS', 'CLOSE', 'ROLL'
  ageMinutes: number;
  fillDistancePct?: number; // how far current price is from the limit price, %
  status: PendingOrderStatus;
  staleOrReviewRequired: boolean;
}

export interface MarketContextInput {
  regime: MarketRegime;
  macroEventProximityHours?: number;
  volatilityStable: boolean;
  marketOpen: boolean;
  dataFreshnessSeconds?: number;
}

export interface PortfolioIntelligenceThresholds {
  // Matches this repo's established "50% profit target" convention.
  profitTargetPct: number;
  // Matches this repo's established "21-DTE time stop" convention.
  dteReviewThreshold: number;
  // Matches this repo's established "2x credit loss stop" convention,
  // expressed as an openPlPct threshold (-200 = -2x credit received).
  materialLossPct: number;
  stalePendingOrderMinutes: number;
  materialFillDistancePct: number;
  idleCashThresholdPct: number;
  // Matches AutopilotThresholds.bpUtilizationMaxPct default (65) so both
  // layers agree on what "high buying-power utilization" means.
  maxBuyingPowerUtilizationPct: number;
  // Matches AutopilotThresholds.monthlyDrawdownDefensivePct default (8).
  defensiveDrawdownPct: number;
}

export interface PortfolioIntelligenceContext {
  generatedAt: string;
  portfolio: PortfolioStateInput;
  positions: PortfolioPositionInput[];
  pendingOrders: PendingOrderInput[];
  market: MarketContextInput;
  thresholds: PortfolioIntelligenceThresholds;
}
