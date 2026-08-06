// lib/help/optionsStrategyReference.ts
//
// Canonical, content-driven data model for the Help section's "Options
// Strategy Reference" (approved design; corrections from the final team
// review are incorporated below — see docs/reviews/
// HELP-0001-Options-Strategy-Reference-Implementation-Report.md).
//
// ── Isolation boundary — read before importing this anywhere ───────────────
// This module is EDUCATIONAL REFERENCE CONTENT ONLY. It must never be
// imported by, or feed into, any recommendation, scoring, suitability,
// screening, order-construction, or execution code path — specifically:
// lib/decision-engine, lib/opportunity-engine, lib/recommendations,
// lib/scans/*, lib/wheel/*, or any app/api/* trading route. This file has
// zero dependencies on the rest of the app (no imports from this repo at
// all) so that boundary is structurally enforced, not just a comment.
//
// All dollar examples below are fixed, verified, illustrative numbers for
// teaching mechanics — never live market data, never a suggestion to enter
// any specific trade, and never personalized to any account.

export type StrategyId =
  | 'covered_call'
  | 'cash_secured_put'
  | 'poor_mans_covered_call'
  | 'bull_put_spread'
  | 'bear_call_spread'
  | 'bull_call_spread'
  | 'iron_condor'
  | 'long_leaps_call';

export type GoalId =
  | 'income_from_shares'
  | 'income_while_waiting'
  | 'bullish_limited_risk'
  | 'bearish_limited_risk'
  | 'neutral_range'
  | 'long_term_leverage';

export interface PositionLeg {
  action: 'Own' | 'Buy' | 'Sell';
  quantity: number;
  instrument: 'Stock' | 'Call' | 'Put';
  strikeLabel: string;
  note?: string;
}

export interface ExampleOutput {
  label: string;
  value: string;
}

// Mechanical, plain-text risk labels — never conveyed through color alone
// (see the UI's accessibility requirements). "Defined risk" strategies still
// carry the DEFINED_RISK_CAVEAT reminder that defined does not mean small.
export interface MechanicalLabels {
  riskLabel: string;
  capitalType: string;
  positionShape: string;
}

export interface ScenarioResponses {
  fallsSharply: string;
  staysNearPrice: string;
  risesSharply: string;
}

export interface StrategyReferenceEntry {
  strategyId: StrategyId;
  displayName: string;
  // Derived from GOALS below at module init — never hand-duplicated. See
  // buildStrategyReference().
  applicableGoals: GoalId[];
  typicalOutlook: string;
  plainSummary: string;
  scenarioResponses: ScenarioResponses;
  mechanicalLabels: MechanicalLabels;
  positionLegs: PositionLeg[];
  exampleInputs: string[];
  exampleOutputs: ExampleOutput[];
  maxProfitExplanation: string;
  maxLossExplanation: string;
  expirationBreakeven: string;
  timeDecay: string;
  volatility: string;
  assignmentExercise: string;
  useWhen: string[];
  avoidWhen: string[];
  beginnerMisunderstanding: string;
  caveats: string[];
  contentVersion: string;
  lastReviewed: string; // ISO date (YYYY-MM-DD)
}

// ── Shared caveat text — single-sourced so wording never drifts between
//    strategies that share the same underlying mechanical risk. ───────────
const EARLY_ASSIGNMENT_CAVEAT =
  'American-style equity options can be assigned early, at any time before expiration — not only when in the money at expiration. This is more likely for deep in-the-money short options and around ex-dividend dates.';
const DIVIDEND_RISK_CAVEAT =
  'If the underlying pays a dividend, in-the-money short calls face a heightened risk of early assignment shortly before the ex-dividend date, since the option holder may exercise to capture the dividend.';
const EXPIRATION_RISK_CAVEAT =
  'Expiration outcomes are not guaranteed to land exactly at a strike or resolve exactly as a round-number example suggests — small moves in either direction change whether a leg is assigned, exercised, or expires worthless.';
const AFTER_HOURS_CAVEAT =
  'The stock can move after the options market closes but before final settlement is determined, which can result in assignment (or non-assignment) that looks inconsistent with the official closing price — this is sometimes called "pin risk" when the stock settles very close to a strike.';
const PROTECTIVE_LEG_CAVEAT =
  'The long option leg in this position exists to define and limit your risk, but only if it is exercised, sold, or allowed to expire correctly. Mishandling it — for example, letting it lapse while still valuable, or failing to act if the short leg is assigned — can leave you with larger, unexpected exposure than the defined-risk example suggests.';
const PMCC_LONG_LEG_CAVEAT =
  'The long LEAPS call must be exercised, sold, or allowed to expire correctly to realize its value — mishandling it (letting it lapse while still valuable, or failing to use it to cover an assigned short call) can produce a result very different from the simplified net-debit example.';
const BUYING_POWER_CAVEAT =
  'Your broker\'s margin/buying-power treatment of this strategy may differ from the simplified capital figures shown here — always confirm the actual capital requirement and buying-power effect in your own account before trading.';
const DEFINED_RISK_CAVEAT =
  'Defined risk does not necessarily mean small risk. A "defined" maximum loss can still be a significant amount of money relative to your account.';

export const CONTENT_VERSION = '1.0.0';
export const LAST_REVIEWED = '2026-08-06';

export const MAX_COMPARISON_STRATEGIES = 3;
export const COMPARISON_LIMIT_MESSAGE =
  'You can compare up to three strategies at a time. Remove one to add another.';

export const EDUCATIONAL_DISCLAIMER =
  'This reference is educational only. It does not provide personalized investment advice, a recommendation to buy or sell any security, or a suitability assessment for your account or goals. Options trading involves substantial risk, including the potential loss of your entire investment. Verify all figures independently before trading — your broker\'s margin, buying-power, and assignment handling may differ from the simplified examples shown here.';

// ── Goal mapping — the single source of truth for which strategies satisfy
//    which stated goal, and any per-goal outlook-label override (e.g. Bull
//    Put Spread reads "Neutral to bullish" specifically under the neutral/
//    range goal, even though its own typicalOutlook is "Bullish"). ─────────
export interface GoalStrategyLink {
  strategyId: StrategyId;
  outlookOverride?: string;
}

export interface Goal {
  id: GoalId;
  label: string;
  strategies: GoalStrategyLink[];
}

export const GOALS: Goal[] = [
  {
    id: 'income_from_shares',
    label: 'Generate income from shares I own',
    strategies: [{ strategyId: 'covered_call' }, { strategyId: 'poor_mans_covered_call' }],
  },
  {
    id: 'income_while_waiting',
    label: 'Get paid while waiting to buy shares',
    strategies: [{ strategyId: 'cash_secured_put' }],
  },
  {
    id: 'bullish_limited_risk',
    label: 'Make a bullish trade with limited risk',
    strategies: [
      { strategyId: 'bull_put_spread' },
      { strategyId: 'bull_call_spread' },
      { strategyId: 'poor_mans_covered_call' },
    ],
  },
  {
    id: 'bearish_limited_risk',
    label: 'Make a bearish trade with limited risk',
    strategies: [{ strategyId: 'bear_call_spread' }],
  },
  {
    id: 'neutral_range',
    label: 'Trade a range or neutral outlook',
    strategies: [
      { strategyId: 'iron_condor' },
      { strategyId: 'covered_call' },
      { strategyId: 'cash_secured_put' },
      { strategyId: 'bull_put_spread', outlookOverride: 'Neutral to bullish' },
      { strategyId: 'bear_call_spread', outlookOverride: 'Neutral to bearish' },
    ],
  },
  {
    id: 'long_term_leverage',
    label: 'Invest for long-term upside with less capital than 100 shares',
    strategies: [{ strategyId: 'long_leaps_call' }, { strategyId: 'poor_mans_covered_call' }],
  },
];

// ── Strategy entries — applicableGoals left empty here; filled by
//    buildStrategyReference() below from GOALS so goal membership is never
//    hand-duplicated between the two data structures. ─────────────────────
const STRATEGY_ENTRIES_BASE: Omit<StrategyReferenceEntry, 'applicableGoals'>[] = [
  {
    strategyId: 'covered_call',
    displayName: 'Covered Call',
    typicalOutlook: 'Neutral to bullish',
    plainSummary:
      'Sell someone the right to buy your shares at a set price in exchange for upfront cash — you keep the cash no matter what, but you may have to sell your shares at that price.',
    scenarioResponses: {
      fallsSharply:
        'You keep the premium, but the stock loss is not capped — you still hold the shares and their value falls just as it would without the call, offset only by the $2.00/share premium collected.',
      staysNearPrice:
        'The call likely expires worthless (or is closed for a small amount) and you keep both the premium and the shares — this is close to the ideal outcome for income-focused covered calls.',
      risesSharply:
        'Profit is capped at the strike. If the stock rises well above $55, your shares are typically called away at $55 and you do not participate in gains above that level.',
    },
    mechanicalLabels: {
      riskLabel: 'Large risk — capped only if the stock falls all the way to $0, not "small" just because shares are owned',
      capitalType: 'Requires owning 100 shares per contract',
      positionShape: 'Single short call against owned stock',
    },
    positionLegs: [
      { action: 'Own', quantity: 100, instrument: 'Stock', strikeLabel: '$50.00 cost basis', note: '100 shares owned' },
      { action: 'Sell', quantity: 1, instrument: 'Call', strikeLabel: '$55 strike', note: 'Collect $2.00 premium ($200 total)' },
    ],
    exampleInputs: ['100 shares owned at $50.00 per share', 'Sell 1 call, $55 strike, for $2.00 premium ($200 total)'],
    exampleOutputs: [
      { label: 'Maximum profit', value: '$700' },
      { label: 'Breakeven', value: '$48.00 per share' },
      { label: 'Maximum theoretical loss', value: '$4,800 (if the stock fell to $0)' },
    ],
    maxProfitExplanation:
      'Maximum profit occurs if the stock closes at or above the $55 strike at expiration: ($55 − $50) × 100 shares + $200 premium = $500 + $200 = $700.',
    maxLossExplanation:
      'The $200 premium collected reduces your effective cost basis to $48/share, but if the stock fell all the way to $0 you would still lose $4,800 ($48 × 100) — the call premium provides only limited downside protection, not a floor.',
    expirationBreakeven: 'Breakeven at expiration is $48.00 per share ($50.00 cost basis minus $2.00 premium collected).',
    timeDecay: 'Time decay (theta) generally works in your favor as the seller of the call — the call you sold loses extrinsic value as expiration approaches, all else equal.',
    volatility:
      'Rising implied volatility increases the value of the call you sold, which can increase paper losses on the short call before expiration even if the stock hasn\'t moved; falling IV generally works in your favor.',
    assignmentExercise:
      'If the stock closes above $55 at expiration, your shares will likely be called away (sold at $55) — but this is not guaranteed to happen exactly at expiration or exactly at that price. Early assignment is possible at any time the call is in the money, especially around an ex-dividend date.',
    useWhen: [
      'You already own the shares and are willing to sell them at the strike price if called away.',
      'You have a neutral to modestly bullish outlook and want to generate income on stock you plan to hold.',
    ],
    avoidWhen: [
      'You expect a large rally and want to keep all the upside.',
      'You are not willing to have your shares sold at the strike price.',
    ],
    beginnerMisunderstanding:
      'A covered call is not risk-free just because you already own the stock — you still bear the full downside risk of stock ownership, offset only by the premium collected.',
    caveats: [EARLY_ASSIGNMENT_CAVEAT, DIVIDEND_RISK_CAVEAT, EXPIRATION_RISK_CAVEAT, AFTER_HOURS_CAVEAT, BUYING_POWER_CAVEAT],
    contentVersion: CONTENT_VERSION,
    lastReviewed: LAST_REVIEWED,
  },
  {
    strategyId: 'cash_secured_put',
    displayName: 'Cash-Secured Put',
    typicalOutlook: 'Neutral to bullish',
    plainSummary: 'Get paid upfront for agreeing to buy 100 shares at a price you choose, with the cash to buy them already set aside.',
    scenarioResponses: {
      fallsSharply:
        'You are likely assigned and must buy 100 shares at $50 even though the market price is much lower — your effective cost is $48/share after the premium, but the position can show a large paper loss immediately.',
      staysNearPrice: 'The put likely expires worthless (or is closed for a small amount) and you keep the full premium without ever buying the shares.',
      risesSharply: 'The put expires worthless and you keep the premium, but you do not get to buy the shares at $50 — you also did not participate in the rally.',
    },
    mechanicalLabels: {
      riskLabel: 'Large risk — capped only if the stock falls all the way to $0 after assignment',
      capitalType: 'Cash-secured (cash reserved to buy shares if assigned)',
      positionShape: 'Single short put',
    },
    positionLegs: [
      { action: 'Sell', quantity: 1, instrument: 'Put', strikeLabel: '$50 strike', note: 'Collect $2.00 premium ($200); cash reserved: $5,000' },
    ],
    exampleInputs: ['Cash reserved to buy 100 shares at $50 if assigned ($5,000)', 'Sell 1 put, $50 strike, for $2.00 premium ($200 total)'],
    exampleOutputs: [
      { label: 'Maximum profit', value: '$200' },
      { label: 'Breakeven', value: '$48.00 per share' },
      { label: 'Maximum theoretical loss', value: '$4,800 (if the stock fell to $0 after assignment)' },
    ],
    maxProfitExplanation: 'Maximum profit is the $200 premium collected, realized in full if the stock closes at or above $50 at expiration and the put expires worthless.',
    maxLossExplanation:
      'If assigned at $50 and the stock then fell all the way to $0, the loss would be $4,800 (($50 − $2.00) × 100) — the premium only slightly offsets the purchase price.',
    expirationBreakeven: 'Breakeven at expiration is $48.00 per share ($50 strike minus $2.00 premium collected).',
    timeDecay: 'As the seller, time decay generally works in your favor — the put loses extrinsic value as expiration approaches, all else equal.',
    volatility: 'Rising implied volatility increases the value of the put you sold (working against you before expiration); falling IV generally works in your favor.',
    assignmentExercise:
      'If the stock closes below $50 at expiration you will likely be assigned 100 shares per contract at $50 — but this is not guaranteed to happen exactly at expiration. Early assignment is possible at any time, particularly for deep in-the-money puts.',
    useWhen: [
      'You are willing and able to buy 100 shares at the strike price if assigned.',
      'You want to get paid while waiting for a pullback to a price you\'d be willing to buy at.',
    ],
    avoidWhen: [
      'You are not prepared to buy the shares if the stock falls well below the strike.',
      'You do not want to tie up the full cash required to secure the put.',
    ],
    beginnerMisunderstanding:
      'A cash-secured put is not "free money" for waiting — assignment means buying shares at the strike even if the stock has fallen well below it, and the cash is fully committed for the life of the trade.',
    caveats: [EARLY_ASSIGNMENT_CAVEAT, EXPIRATION_RISK_CAVEAT, AFTER_HOURS_CAVEAT, BUYING_POWER_CAVEAT],
    contentVersion: CONTENT_VERSION,
    lastReviewed: LAST_REVIEWED,
  },
  {
    strategyId: 'poor_mans_covered_call',
    displayName: 'Poor Man\'s Covered Call',
    typicalOutlook: 'Bullish',
    plainSummary:
      'Use a long-term call option instead of owning 100 shares, then sell short-term calls against it for income — a lower-capital stand-in for a covered call.',
    scenarioResponses: {
      fallsSharply:
        'The long LEAPS call loses value (though typically less than 100 shares would, due to leverage) and the short call likely expires worthless — you can usually sell another short call next cycle, but a large enough drop can put the long call underwater.',
      staysNearPrice:
        'This is close to the ideal outcome — the short call likely expires worthless (or is closed cheaply), the long call retains most of its value, and you can sell another short call for the next cycle.',
      risesSharply:
        'The short call is likely assigned or must be bought back at a loss; while the long LEAPS call gains value, a sharp enough rally can outpace what the short call gives back, capping your net gain versus owning shares outright.',
    },
    mechanicalLabels: {
      riskLabel: 'Defined risk — limited to the net debit paid for the long call, though its value fluctuates over time',
      capitalType: 'Long premium paid (LEAPS call) — no shares required',
      positionShape: 'Diagonal — two call legs, different expirations',
    },
    positionLegs: [
      { action: 'Buy', quantity: 1, instrument: 'Call', strikeLabel: '$40 strike, 12-month expiration', note: 'Pay $12.00 premium ($1,200) — the long "stock substitute" leg' },
      { action: 'Sell', quantity: 1, instrument: 'Call', strikeLabel: '$55 strike, 30-day expiration', note: 'Collect $2.00 premium ($200) — sold repeatedly over time' },
    ],
    exampleInputs: [
      'Buy 1 call, $40 strike, 12-month expiration, for $12.00 premium ($1,200 total)',
      'Sell 1 call, $55 strike, 30-day expiration, for $2.00 premium ($200 total)',
    ],
    exampleOutputs: [
      { label: 'Initial net debit', value: '$1,000 (($12.00 long call premium − $2.00 short call premium) × 100)' },
      {
        label: 'Maximum profit',
        value: 'No single fixed maximum — depends on the long call\'s value over time and the cumulative result of each short call sold against it. See Max Profit Explanation.',
      },
      {
        label: 'Breakeven',
        value: 'No single simple breakeven — shifts every time a short call is sold or closed. See Expiration/Breakeven note.',
      },
    ],
    maxProfitExplanation:
      'Unlike a vertical spread, PMCC does not have one fixed maximum profit. The long LEAPS call\'s value changes continuously with the stock price, time, and implied volatility, and a new short call can be sold against it repeatedly (often monthly) before the long call expires. Total realized profit depends on the sum of all these transactions over the life of the position, not a single formula — do not treat this as a static, capped-profit spread.',
    maxLossExplanation:
      'The initial net debit ($1,000 in this example) is the amount at risk if the long call expired worthless today with no further short calls sold — but that is not automatically the actual outcome. Assignment on the short call, a large adverse move in the underlying, or mishandling the long call\'s exercise or expiration can produce a materially different realized result than the initial debit alone would suggest.',
    expirationBreakeven:
      'There is no single simple portfolio breakeven for PMCC, because a new short call can be sold each cycle and each one changes your effective cost basis. Track your own running cost basis (long call cost minus cumulative short-call premium collected) rather than relying on a fixed breakeven number.',
    timeDecay:
      'Time decay works in different directions for the two legs: the short-dated short call loses value quickly as its expiration approaches (in your favor), while the long-dated long call decays much more slowly (a smaller drag against you) — the net effect shifts each time a new short call is sold.',
    volatility:
      'A drop in implied volatility on the long-dated call can meaningfully reduce its value even if the stock hasn\'t moved (a real risk for LEAPS); the short-dated call\'s volatility exposure is smaller due to its shorter life. The two legs do not offset volatility risk evenly.',
    assignmentExercise:
      'If the short $55 call is in the money at expiration, you may be assigned and required to deliver 100 shares — since you don\'t own shares, this typically means exercising the long call to cover the assignment (subject to your broker\'s policies and possible timing/liquidity constraints), which can produce a different realized result than simply closing both legs for cash. Early assignment on the short call is possible at any time it is in the money, especially close to an ex-dividend date.',
    useWhen: ['You want long-term bullish exposure and ongoing income similar to a covered call, without the capital required to own 100 shares.'],
    avoidWhen: [
      'You are not prepared to actively manage two option legs with different expirations, including handling assignment on the short leg.',
      'The underlying has frequent, unpredictable dividends that increase early-assignment risk on the short call.',
    ],
    beginnerMisunderstanding:
      'PMCC is not "the same as" a covered call with less capital — because the long leg is itself an option (not stock), it has its own expiration, time decay, and exercise mechanics that a real covered call does not, and mishandling the long leg can produce a very different result than the simplified net-debit example suggests.',
    caveats: [EARLY_ASSIGNMENT_CAVEAT, DIVIDEND_RISK_CAVEAT, EXPIRATION_RISK_CAVEAT, PMCC_LONG_LEG_CAVEAT, BUYING_POWER_CAVEAT, DEFINED_RISK_CAVEAT],
    contentVersion: CONTENT_VERSION,
    lastReviewed: LAST_REVIEWED,
  },
  {
    strategyId: 'bull_put_spread',
    displayName: 'Bull Put Spread',
    typicalOutlook: 'Bullish',
    plainSummary: 'Collect a credit by selling a put and buying a cheaper, lower-strike put as protection — you profit if the stock stays above your short strike.',
    scenarioResponses: {
      fallsSharply: 'Both puts move in the money; you likely face the maximum loss on the spread ($400 in this example) as the stock falls below your long put strike.',
      staysNearPrice: 'If the stock stays above the $50 short strike, both puts likely expire worthless and you keep the full $100 credit.',
      risesSharply: 'Both puts expire worthless and you keep the full $100 credit — a large rally does not increase your profit beyond the credit collected.',
    },
    mechanicalLabels: {
      riskLabel: 'Defined risk — limited to the spread width minus the credit received',
      capitalType: 'Margin/spread capital reserved by your broker',
      positionShape: 'Two-leg vertical put spread',
    },
    positionLegs: [
      { action: 'Sell', quantity: 1, instrument: 'Put', strikeLabel: '$50 strike', note: 'Collect premium' },
      { action: 'Buy', quantity: 1, instrument: 'Put', strikeLabel: '$45 strike', note: 'Pay premium — defines and limits risk' },
    ],
    exampleInputs: ['Sell 1 put, $50 strike', 'Buy 1 put, $45 strike', 'Net credit: $1.00 ($100 total)'],
    exampleOutputs: [
      { label: 'Maximum profit', value: '$100' },
      { label: 'Maximum loss', value: '$400' },
      { label: 'Breakeven', value: '$49.00' },
    ],
    maxProfitExplanation:
      'Maximum profit is the $1.00 credit received, or $100 per spread (1 contract = 100 shares), realized in full if the stock closes at or above the $50 short strike at expiration and both puts expire worthless.',
    maxLossExplanation:
      'Maximum loss is the $5.00 strike width minus the $1.00 credit received, or $400 per spread, realized if the stock closes at or below the $45 long put strike at expiration.',
    expirationBreakeven:
      'Breakeven at expiration is $49.00 (short strike $50 minus $1.00 credit received). Outcomes very close to either strike are not guaranteed to resolve exactly as the round numbers suggest — small moves can change whether a leg is assigned or exercised.',
    timeDecay:
      'As a net credit spread, time decay generally works in your favor while the stock stays above the short strike — but theta behavior can change as the underlying moves through the strikes, and decay is not linear or guaranteed day to day.',
    volatility: 'Rising implied volatility generally increases the value of both puts; the net effect on the spread depends on how IV changes relative to the stock price and the remaining time to expiration.',
    assignmentExercise:
      'If the short $50 put is in the money at expiration, you may be assigned and required to buy 100 shares at $50 — early assignment is also possible at any time the put is in the money, particularly close to expiration. The long $45 put helps offset this risk, but only if it is exercised or its value realized correctly.',
    useWhen: [
      'You have a neutral to bullish outlook and want to collect a credit with defined risk.',
      'You want less capital at risk than selling a cash-secured put outright.',
    ],
    avoidWhen: [
      'You expect a sharp decline through both strikes.',
      'You are not comfortable with the possibility of assignment on the short leg before expiration.',
    ],
    beginnerMisunderstanding:
      'A credit received up front is not "free money" — it represents compensation for taking on defined risk, and the maximum loss can still be several times the credit collected.',
    caveats: [EARLY_ASSIGNMENT_CAVEAT, EXPIRATION_RISK_CAVEAT, PROTECTIVE_LEG_CAVEAT, BUYING_POWER_CAVEAT, DEFINED_RISK_CAVEAT],
    contentVersion: CONTENT_VERSION,
    lastReviewed: LAST_REVIEWED,
  },
  {
    strategyId: 'bear_call_spread',
    displayName: 'Bear Call Spread',
    typicalOutlook: 'Bearish',
    plainSummary: 'Collect a credit by selling a call and buying a more expensive, higher-strike call as protection — you profit if the stock stays below your short strike.',
    scenarioResponses: {
      fallsSharply: 'Both calls likely expire worthless and you keep the full $100 credit — a large decline does not increase your profit beyond the credit collected.',
      staysNearPrice: 'If the stock stays below the $50 short strike, both calls likely expire worthless and you keep the full $100 credit.',
      risesSharply: 'Both calls move in the money; you likely face the maximum loss on the spread ($400 in this example) as the stock rises above your long call strike.',
    },
    mechanicalLabels: {
      riskLabel: 'Defined risk — limited to the spread width minus the credit received',
      capitalType: 'Margin/spread capital reserved by your broker',
      positionShape: 'Two-leg vertical call spread',
    },
    positionLegs: [
      { action: 'Sell', quantity: 1, instrument: 'Call', strikeLabel: '$50 strike', note: 'Collect premium' },
      { action: 'Buy', quantity: 1, instrument: 'Call', strikeLabel: '$55 strike', note: 'Pay premium — defines and limits risk' },
    ],
    exampleInputs: ['Sell 1 call, $50 strike', 'Buy 1 call, $55 strike', 'Net credit: $1.00 ($100 total)'],
    exampleOutputs: [
      { label: 'Maximum profit', value: '$100' },
      { label: 'Maximum loss', value: '$400' },
      { label: 'Breakeven', value: '$51.00' },
    ],
    maxProfitExplanation:
      'Maximum profit is the $1.00 credit received, or $100 per spread, realized in full if the stock closes at or below the $50 short strike at expiration and both calls expire worthless.',
    maxLossExplanation:
      'Maximum loss is the $5.00 strike width minus the $1.00 credit received, or $400 per spread, realized if the stock closes at or above the $55 long call strike at expiration.',
    expirationBreakeven:
      'Breakeven at expiration is $51.00 (short strike $50 plus $1.00 credit received). Outcomes very close to either strike are not guaranteed to resolve exactly as the round numbers suggest.',
    timeDecay:
      'As a net credit spread, time decay generally works in your favor while the stock stays below the short strike — but theta behavior can change as the underlying moves through the strikes, and decay is not linear or guaranteed day to day.',
    volatility: 'Rising implied volatility generally increases the value of both calls; the net effect on the spread depends on how IV changes relative to the stock price and the remaining time to expiration.',
    assignmentExercise:
      'If the short $50 call is in the money at expiration, you may be assigned and required to sell 100 shares at $50 (or deliver shares you do not own) — early assignment is also possible at any time the call is in the money, especially just before an ex-dividend date. The long $55 call helps offset this risk, but only if it is exercised or its value realized correctly.',
    useWhen: ['You have a neutral to bearish outlook and want to collect a credit with defined risk.'],
    avoidWhen: [
      'You expect a sharp rally through both strikes.',
      'The underlying has an upcoming ex-dividend date and you are not prepared for early-assignment risk on the short call.',
    ],
    beginnerMisunderstanding:
      'Selling a call without owning the shares is not the same as an uncovered ("naked") call — the long $55 call defines and limits your risk, but you are still exposed to early-assignment mechanics on the short leg.',
    caveats: [EARLY_ASSIGNMENT_CAVEAT, DIVIDEND_RISK_CAVEAT, EXPIRATION_RISK_CAVEAT, PROTECTIVE_LEG_CAVEAT, BUYING_POWER_CAVEAT, DEFINED_RISK_CAVEAT],
    contentVersion: CONTENT_VERSION,
    lastReviewed: LAST_REVIEWED,
  },
  {
    strategyId: 'bull_call_spread',
    displayName: 'Bull Call Spread',
    typicalOutlook: 'Bullish',
    plainSummary: 'Pay a debit to buy a call and partially offset the cost by selling a higher-strike call — you profit if the stock rises to or above your short strike.',
    scenarioResponses: {
      fallsSharply: 'Both calls likely expire worthless and you lose the $200 debit paid — this is the maximum loss for the position.',
      staysNearPrice:
        'Near the strikes, the outcome is sensitive to exactly where the stock settles — the result can land anywhere between a full loss and the full profit depending on the final price relative to $50 and $55.',
      risesSharply: 'If the stock closes at or above $55, you likely realize the maximum profit of $300 — gains above $55 do not add further profit.',
    },
    mechanicalLabels: {
      riskLabel: 'Defined risk — limited to the net debit paid',
      capitalType: 'Long premium paid (net debit)',
      positionShape: 'Two-leg vertical call spread',
    },
    positionLegs: [
      { action: 'Buy', quantity: 1, instrument: 'Call', strikeLabel: '$50 strike', note: 'Pay premium' },
      { action: 'Sell', quantity: 1, instrument: 'Call', strikeLabel: '$55 strike', note: 'Collect premium — reduces cost, caps upside' },
    ],
    exampleInputs: ['Buy 1 call, $50 strike', 'Sell 1 call, $55 strike', 'Net debit: $2.00 ($200 total)'],
    exampleOutputs: [
      { label: 'Maximum profit', value: '$300' },
      { label: 'Maximum loss', value: '$200' },
      { label: 'Breakeven', value: '$52.00' },
    ],
    maxProfitExplanation:
      'Maximum profit is the $5.00 strike width minus the $2.00 debit paid, or $300 per spread, realized if the stock closes at or above the $55 short call strike at expiration.',
    maxLossExplanation: 'Maximum loss is the $2.00 debit paid, or $200 per spread, realized if the stock closes at or below the $50 long call strike at expiration.',
    expirationBreakeven: 'Breakeven at expiration is $52.00 (long strike $50 plus $2.00 debit paid).',
    timeDecay:
      'Time decay for this spread depends on the stock price relative to the strikes and the time remaining — it is not simply "for" or "against" the position the way a single option is. Decay tends to work against the position while the stock is near or below the long strike, and can work in the position\'s favor as the stock moves toward or above the short strike.',
    volatility: 'The net effect of implied volatility changes depends on where the stock sits relative to the two strikes and how much time remains — this spread is not simply long or short volatility the way a single option is.',
    assignmentExercise:
      'If the short $55 call is in the money at expiration, you may be assigned and required to sell 100 shares at $55 — you would typically exercise your long $50 call to deliver those shares. Early assignment on the short leg is possible at any time it is in the money, especially close to an ex-dividend date.',
    useWhen: ['You have a bullish outlook and want to pay less than buying a call outright, in exchange for a capped upside.'],
    avoidWhen: [
      'You expect a large move well above the short strike and want unlimited upside.',
      'The underlying has an upcoming ex-dividend date and you are not prepared to manage early assignment on the short call.',
    ],
    beginnerMisunderstanding:
      'A debit spread is not automatically "riskier" than a credit spread just because you pay money up front — in this example the bull call spread\'s maximum loss ($200) is smaller than the bull put spread\'s maximum loss ($400), even though the bull put spread collects a credit instead of paying a debit.',
    caveats: [EARLY_ASSIGNMENT_CAVEAT, DIVIDEND_RISK_CAVEAT, EXPIRATION_RISK_CAVEAT, PROTECTIVE_LEG_CAVEAT, BUYING_POWER_CAVEAT, DEFINED_RISK_CAVEAT],
    contentVersion: CONTENT_VERSION,
    lastReviewed: LAST_REVIEWED,
  },
  {
    strategyId: 'iron_condor',
    displayName: 'Iron Condor',
    typicalOutlook: 'Neutral',
    plainSummary:
      'Combine a bull put spread and a bear call spread on the same stock and expiration to collect two credits — you profit if the stock stays in a range between both short strikes.',
    scenarioResponses: {
      fallsSharply: 'The put side moves toward its maximum loss ($350 in this example) as the stock falls below your long put strike; the call side expires worthless.',
      staysNearPrice:
        'If the stock stays between the short strikes ($45–$55 in this example), all four legs likely expire worthless and you keep the full $150 credit — this is the ideal outcome.',
      risesSharply: 'The call side moves toward its maximum loss ($350 in this example) as the stock rises above your long call strike; the put side expires worthless.',
    },
    mechanicalLabels: {
      riskLabel: 'Defined risk — limited to the wider spread width minus the total credit received',
      capitalType: 'Margin/spread capital (broker reserves the greater of the two spread widths, not both added together)',
      positionShape: 'Four-leg combination (two vertical spreads)',
    },
    positionLegs: [
      { action: 'Buy', quantity: 1, instrument: 'Put', strikeLabel: '$40 strike', note: 'Defines and limits risk on the put side' },
      { action: 'Sell', quantity: 1, instrument: 'Put', strikeLabel: '$45 strike', note: 'Collect premium' },
      { action: 'Sell', quantity: 1, instrument: 'Call', strikeLabel: '$55 strike', note: 'Collect premium' },
      { action: 'Buy', quantity: 1, instrument: 'Call', strikeLabel: '$60 strike', note: 'Defines and limits risk on the call side' },
    ],
    exampleInputs: ['Buy 1 put, $40 strike', 'Sell 1 put, $45 strike', 'Sell 1 call, $55 strike', 'Buy 1 call, $60 strike', 'Net credit: $1.50 ($150 total)'],
    exampleOutputs: [
      { label: 'Maximum profit', value: '$150' },
      { label: 'Maximum loss', value: '$350' },
      { label: 'Breakevens', value: '$43.50 and $56.50' },
      { label: 'Preferred expiration range', value: '$45–$55' },
    ],
    maxProfitExplanation:
      'Maximum profit is the total $1.50 credit received, or $150 per condor, realized in full if the stock closes between the short strikes ($45–$55) at expiration and all four legs expire worthless.',
    maxLossExplanation:
      'Maximum loss is the $5.00 width of whichever side is tested minus the $1.50 total credit received, or $350, realized if the stock closes at or beyond either long strike ($40 or $60) at expiration.',
    expirationBreakeven:
      'Breakevens at expiration are $43.50 (short put strike $45 minus $1.50 credit) and $56.50 (short call strike $55 plus $1.50 credit). The preferred zone for the stock to stay within through expiration is $45–$55, between the short strikes.',
    timeDecay:
      'Time decay generally works in your favor while the stock stays between the short strikes — but theta behavior can change as the underlying moves through either short strike, and decay is not linear or guaranteed day to day on either side.',
    volatility:
      'Rising implied volatility generally works against an iron condor (it increases the value of the short legs); the net effect still depends on how IV changes relative to the stock price and time remaining, and can differ between the put side and the call side.',
    assignmentExercise:
      'If either short leg is in the money at expiration, you may be assigned on that side — early assignment is possible at any time a short leg is in the money, especially close to an ex-dividend date for the short call. The corresponding long leg helps offset the risk, but only if it is exercised or its value realized correctly.',
    useWhen: ['You expect the stock to stay within a defined range through expiration and want to collect premium from both sides.'],
    avoidWhen: ['You expect a large move in either direction, or an upcoming binary event (earnings, an FDA decision, etc.) that could push the stock outside the range.'],
    beginnerMisunderstanding:
      'An iron condor is not two independent trades whose losses cancel out — only one side is typically tested at a time, and both sides share the same defined-risk ceiling rather than offsetting each other.',
    caveats: [EARLY_ASSIGNMENT_CAVEAT, DIVIDEND_RISK_CAVEAT, EXPIRATION_RISK_CAVEAT, AFTER_HOURS_CAVEAT, PROTECTIVE_LEG_CAVEAT, BUYING_POWER_CAVEAT, DEFINED_RISK_CAVEAT],
    contentVersion: CONTENT_VERSION,
    lastReviewed: LAST_REVIEWED,
  },
  {
    strategyId: 'long_leaps_call',
    displayName: 'Long LEAPS Call',
    typicalOutlook: 'Bullish',
    plainSummary: 'Buy a call option with about a year until expiration for long-term bullish exposure with less capital than buying the stock outright.',
    scenarioResponses: {
      fallsSharply: 'The call loses value; if the stock stays below $50 through expiration you can lose up to the full $1,000 premium paid, but never more than that.',
      staysNearPrice:
        'If the stock stays near or below $60 (breakeven) at expiration, the position may show a loss or only a small gain — time decay works against a long option that hasn\'t moved enough by expiration.',
      risesSharply:
        'Profit is theoretically unlimited above the $60 breakeven — for example, a move to $70 nets roughly $1,000 of profit in this example, and further gains keep adding to that as the stock rises.',
    },
    mechanicalLabels: {
      riskLabel: 'Defined risk — limited to the premium paid; upside is theoretically unlimited',
      capitalType: 'Long premium paid',
      positionShape: 'Single long call, long-dated',
    },
    positionLegs: [
      { action: 'Buy', quantity: 1, instrument: 'Call', strikeLabel: '$50 strike, 12-month expiration', note: 'Pay $10.00 premium ($1,000 total)' },
    ],
    exampleInputs: ['Buy 1 call, $50 strike, 12-month expiration, for $10.00 premium ($1,000 total)'],
    exampleOutputs: [
      { label: 'Maximum loss', value: '$1,000' },
      { label: 'Breakeven', value: '$60.00' },
      { label: 'Profit if stock is $70 at expiration', value: '$1,000' },
      { label: 'Maximum profit', value: 'Theoretically unlimited' },
    ],
    maxProfitExplanation:
      'Profit is theoretically unlimited — for every $1 the stock rises above the $60 breakeven at expiration, the position gains approximately $100 (1 contract = 100 shares), with no cap on the upside.',
    maxLossExplanation: 'Maximum loss is the $10.00 premium paid, or $1,000 per contract, realized if the stock closes at or below the $50 strike at expiration and the call expires worthless.',
    expirationBreakeven:
      'Breakeven at expiration is $60.00 (strike $50 plus $10.00 premium paid). For example, a close at $70 nets roughly $1,000 of profit: ($70 − $60) × 100.',
    timeDecay:
      'Time decay works against a long option — the call loses extrinsic value as expiration approaches, all else equal — though a 12-month LEAPS call decays much more slowly early in its life than a short-dated option does.',
    volatility: 'Rising implied volatility generally increases the value of a long call (helps you); falling IV generally decreases its value (hurts you), independent of stock price movement.',
    assignmentExercise:
      'You control exercise as the option holder — there is no assignment risk on a long call. You are responsible for exercising it correctly (or selling it) before expiration; an in-the-money long option you don\'t act on before it expires can be auto-exercised by your broker or expire worthless depending on their policy, which may not match your intent.',
    useWhen: ['You want long-term bullish exposure with less capital than buying 100 shares outright, and are comfortable losing the full premium if the stock does not perform.'],
    avoidWhen: ['You want to own the stock outright (dividends, voting rights, no expiration).', 'You are not prepared to actively manage the option before expiration.'],
    beginnerMisunderstanding:
      'A LEAPS call is not "safer" than owning stock just because the dollar amount at risk is smaller — losing 100% of the premium paid is a real possibility, whereas a stock rarely falls all the way to zero.',
    caveats: [EXPIRATION_RISK_CAVEAT, AFTER_HOURS_CAVEAT, BUYING_POWER_CAVEAT, DEFINED_RISK_CAVEAT],
    contentVersion: CONTENT_VERSION,
    lastReviewed: LAST_REVIEWED,
  },
];

function buildStrategyReference(): StrategyReferenceEntry[] {
  const goalsByStrategy = new Map<StrategyId, GoalId[]>();
  for (const goal of GOALS) {
    for (const link of goal.strategies) {
      const list = goalsByStrategy.get(link.strategyId) ?? [];
      list.push(goal.id);
      goalsByStrategy.set(link.strategyId, list);
    }
  }
  return STRATEGY_ENTRIES_BASE.map(entry => ({
    ...entry,
    applicableGoals: goalsByStrategy.get(entry.strategyId) ?? [],
  }));
}

export const STRATEGIES: StrategyReferenceEntry[] = buildStrategyReference();

export function getStrategy(id: StrategyId): StrategyReferenceEntry | undefined {
  return STRATEGIES.find(s => s.strategyId === id);
}

export function getGoal(id: GoalId): Goal | undefined {
  return GOALS.find(g => g.id === id);
}

export function getStrategiesForGoal(goalId: GoalId): StrategyReferenceEntry[] {
  const goal = getGoal(goalId);
  if (!goal) return [];
  return goal.strategies
    .map(link => getStrategy(link.strategyId))
    .filter((s): s is StrategyReferenceEntry => s != null);
}

// Returns the outlook label to show for a strategy in the context of a
// specific goal (honoring per-goal overrides, e.g. "Neutral to bullish" for
// Bull Put Spread under the neutral/range goal), or the strategy's own
// typicalOutlook when no goal context is active or no override exists.
export function getOutlookLabel(goalId: GoalId | null, strategyId: StrategyId): string {
  if (goalId) {
    const goal = getGoal(goalId);
    const link = goal?.strategies.find(l => l.strategyId === strategyId);
    if (link?.outlookOverride) return link.outlookOverride;
  }
  return getStrategy(strategyId)?.typicalOutlook ?? '';
}
