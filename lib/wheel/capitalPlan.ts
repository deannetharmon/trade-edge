// lib/wheel/capitalPlan.ts
//
// WHEEL-SYSTEM-0001 (slice W1) -- the wheel capital plan and unlock ladder arithmetic.
//
// Pure functions only. Every money value is an integer number of CENTS and every rate is an integer
// number of BASIS POINTS (1 bp = 0.01%), so boundary cases ("a put that costs exactly the per-name
// limit") are exact and never depend on float rounding (Alan, review of draft 1).
//
// Rounding: contracts and per-name cash use floor; the account size at which a name fits uses ceil;
// percentages are shown half-up to one decimal, but every comparison uses the unrounded integers.
//
// Defaults are Ian's recommendations, not rules. The saved plan stores only the trader's OVERRIDES;
// the effective value is { ...DEFAULTS, ...overrides }, so changing a default here never overwrites
// something the trader chose.

export type PlanProfile = 'careful' | 'balanced' | 'concentrated' | 'custom';

export interface PlanParams {
  /** Total account, in cents. */
  accountCents: number;
  /** Cash reserve the plan never uses, basis points of the account. */
  reserveBps: number;
  /** Most that may be lost across all open spreads together (max loss), basis points of the account. */
  spreadCapBps: number;
  /** Most that any single spread may risk, basis points of the account. */
  singleSpreadCapBps: number;
  profile: PlanProfile;
  /** Loss budget per name when profile is 'custom', basis points of the account. */
  customLossBps: number;
  /** Assumed fall of one holding used to size a position, basis points. */
  dropBps: number;
  /** Fall applied to every holding together in the stress test, basis points. */
  stressBps: number;
  /** Most that may sit in one sector, basis points of the account. */
  sectorLimitBps: number;
  /** Lowest absolute delta considered for the put, in basis points (2500 = 0.25). */
  deltaMinBps: number;
  /** Highest absolute delta considered, in basis points (3000 = 0.30). The plan prices the best-paying put in [min, max]. */
  deltaMaxBps: number;
  dteMin: number;
  dteMax: number;
  /** Assumed simple monthly growth of the account, basis points (75 = 0.75% a month). */
  monthlyGrowthBps: number;
  // ── W2: the checks on the "Next candidate" table (WHEEL-SYSTEM-0002) ──
  /** Annual ROC at the bid a put must reach, basis points (1000 = 10%). */
  hurdleBps: number;
  /** IVR floors in points (0 to 100): a lower IVR says "wait". */
  ivrEtf: number;
  ivrStock: number;
  /** RSI(14) above this, in points, says "wait for a pullback". */
  rsiMax: number;
  /** Widest bid-ask gap as basis points of the midpoint (1000 = 10%). */
  maxBidAskBps: number;
  /** Fewest open contracts for a put to count as liquid. */
  minOpenInterest: number;
  /** Opening fee per contract in cents, taken off the credit in the return. Dean, 2026-09-26: none (0). */
  openFeeCents: number;
  /** 'flag' keeps a stock with earnings inside the expiry ranked and flagged; 'wait' says wait until after earnings. */
  earningsRule: EarningsRule;
  /** The shortest expiry, in days, the "Find a shorter expiry" search will look at. */
  minShortDte: number;
}

export type EarningsRule = 'flag' | 'wait';

export const PROFILE_LOSS_BPS: Record<Exclude<PlanProfile, 'custom'>, number> = {
  careful: 600,
  balanced: 900,
  concentrated: 1200,
};

export const PROFILE_LABELS: Record<PlanProfile, string> = {
  careful: 'Careful',
  balanced: 'Balanced',
  concentrated: 'Concentrated',
  custom: 'Custom',
};

export const DEFAULT_PLAN_PARAMS: PlanParams = {
  accountCents: 5_000_000, // $50,000
  reserveBps: 1000, // 10%
  spreadCapBps: 1000, // 10%
  singleSpreadCapBps: 200, // 2%
  profile: 'balanced',
  customLossBps: 900,
  dropBps: 3000, // 30%
  stressBps: 2500, // 25%
  sectorLimitBps: 3500, // 35%
  deltaMinBps: 2500, // 0.25 (Dean, 2026-09-26: the best-paying put between delta 0.25 and 0.30)
  deltaMaxBps: 3000, // 0.30
  dteMin: 30,
  dteMax: 45,
  monthlyGrowthBps: 75, // 0.75% a month
  hurdleBps: 1000, // 10% a year (Dean)
  ivrEtf: 20,
  ivrStock: 30,
  rsiMax: 70,
  maxBidAskBps: 1000, // 10% of the midpoint
  minOpenInterest: 100,
  openFeeCents: 0, // no opening fee in the return (Dean, 2026-09-26)
  earningsRule: 'flag',
  minShortDte: 7,
};

export const PLAN_PARAM_KEYS = Object.keys(DEFAULT_PLAN_PARAMS) as (keyof PlanParams)[];

export type PlanOverrides = Partial<PlanParams>;

const PROFILES: PlanProfile[] = ['careful', 'balanced', 'concentrated', 'custom'];
export const isPlanProfile = (v: unknown): v is PlanProfile => typeof v === 'string' && (PROFILES as string[]).includes(v);

/** The effective parameters: defaults with the trader's overrides on top. */
export function resolveParams(overrides?: PlanOverrides | null): PlanParams {
  const out = { ...DEFAULT_PLAN_PARAMS } as Record<string, unknown>;
  for (const key of PLAN_PARAM_KEYS) {
    const v = overrides?.[key];
    if (v !== undefined && v !== null) out[key] = v;
  }
  return out as unknown as PlanParams;
}

export function isOverridden(overrides: PlanOverrides | null | undefined, key: keyof PlanParams): boolean {
  const v = overrides?.[key];
  return v !== undefined && v !== null && v !== DEFAULT_PLAN_PARAMS[key];
}

/** Loss budget per name (bps of the account) for the chosen profile. */
export function lossBudgetBps(p: PlanParams): number {
  return p.profile === 'custom' ? p.customLossBps : PROFILE_LOSS_BPS[p.profile];
}

// ── Validation: hard errors (refuse to save) vs soft warnings (save anyway) ───────────────────────

export interface PlanValidation {
  errors: string[];
  warnings: string[];
}

const isInt = (n: unknown): n is number => typeof n === 'number' && Number.isInteger(n);

export function validateParams(p: PlanParams): PlanValidation {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (!isInt(p.accountCents) || p.accountCents <= 0) errors.push('Account value must be greater than zero.');
  const bpsFields: [keyof PlanParams, string][] = [
    ['reserveBps', 'Reserve'],
    ['spreadCapBps', 'Spread cap'],
    ['singleSpreadCapBps', 'Single-spread cap'],
    ['customLossBps', 'Custom loss budget'],
    ['dropBps', 'Assumed drop'],
    ['stressBps', 'Stress fall'],
    ['sectorLimitBps', 'Sector limit'],
  ];
  for (const [key, label] of bpsFields) {
    const v = p[key] as number;
    if (!isInt(v) || v < 0 || v > 10_000) errors.push(`${label} must be between 0% and 100%.`);
  }
  if (isInt(p.dropBps) && p.dropBps === 0) errors.push('Assumed drop must be above 0%.');
  if (p.profile === 'custom' && (!isInt(p.customLossBps) || p.customLossBps <= 0)) errors.push('Custom loss budget must be above 0%.');
  if (!isPlanProfile(p.profile)) errors.push('Profile must be Careful, Balanced, Concentrated or Custom.');
  if (isInt(p.reserveBps) && isInt(p.spreadCapBps) && p.reserveBps + p.spreadCapBps > 10_000) {
    errors.push('Reserve plus the spread cap cannot be more than 100% of the account.');
  }
  for (const [value, label] of [[p.deltaMinBps, 'Low'], [p.deltaMaxBps, 'High']] as [number, string][]) {
    if (!isInt(value) || value <= 0 || value >= 10_000) errors.push(`${label} end of the delta range must be between 0 and 1.`);
  }
  if (isInt(p.deltaMinBps) && isInt(p.deltaMaxBps) && p.deltaMinBps > p.deltaMaxBps) errors.push('Delta range: the low end cannot be above the high end.');
  if (!isInt(p.dteMin) || !isInt(p.dteMax) || p.dteMin < 0 || p.dteMin > p.dteMax) errors.push('Days to expiry: the minimum cannot be above the maximum.');
  if (typeof p.monthlyGrowthBps !== 'number' || !Number.isFinite(p.monthlyGrowthBps)) errors.push('Monthly growth must be a number.');
  if (!isInt(p.hurdleBps) || p.hurdleBps < 0 || p.hurdleBps > 100_000) errors.push('The return hurdle must be between 0% and 1,000% a year.');
  for (const [value, label] of [[p.ivrEtf, 'ETF IVR floor'], [p.ivrStock, 'Stock IVR floor'], [p.rsiMax, 'RSI limit']] as [number, string][]) {
    if (!isInt(value) || value < 0 || value > 100) errors.push(`${label} must be between 0 and 100.`);
  }
  if (!isInt(p.maxBidAskBps) || p.maxBidAskBps < 0 || p.maxBidAskBps > 10_000) errors.push('The bid-ask limit must be between 0% and 100% of the midpoint.');
  if (!isInt(p.minOpenInterest) || p.minOpenInterest < 0 || p.minOpenInterest > 10_000_000) errors.push('Minimum open interest must be a whole number of contracts.');
  if (!isInt(p.openFeeCents) || p.openFeeCents < 0 || p.openFeeCents > 100_000) errors.push('The opening fee must be between $0 and $1,000 per contract.');
  if (p.earningsRule !== 'flag' && p.earningsRule !== 'wait') errors.push('The earnings rule must be flag or wait.');
  if (!isInt(p.minShortDte) || p.minShortDte < 1 || p.minShortDte > 365) errors.push('The shortest expiry for the shorter-expiry search must be between 1 and 365 days.');

  if (errors.length) return { errors, warnings };

  const loss = lossBudgetBps(p);
  if (loss > 1200) warnings.push('A loss budget above 12% of the account per name means one bad name can hurt a lot; the worst-case line shows the effect.');
  if (p.dropBps < 2000) warnings.push('An assumed drop under 20% understates how far a stock can fall; positions will be sized larger than the recommended plan would allow.');
  if (p.reserveBps < 500) warnings.push('A reserve under 5% leaves little cash to act on a bad month.');
  if (p.spreadCapBps > 1000) warnings.push('A total spread cap above 10% of the account raises the worst case, because spreads can lose their full risk.');
  if (p.singleSpreadCapBps > p.spreadCapBps) warnings.push('The single-spread cap is above the total spread cap, so it can never bind.');
  if (p.deltaMaxBps > 3500) warnings.push('A delta above 0.35 puts the strike close to the money and raises the chance of assignment.');
  if (p.hurdleBps < 500) warnings.push('A return hurdle under 5% a year is about what idle cash can earn, so it will not screen out thin premium.');
  if (p.rsiMax > 80) warnings.push('An RSI limit above 80 will not stop you selling puts on a stretched chart.');
  if (p.maxBidAskBps > 2000) warnings.push('A bid-ask limit above 20% lets thinly quoted puts through, and you give up that gap when you trade.');
  if (p.minOpenInterest < 10) warnings.push('Very low open interest can mean a put you cannot trade near the quoted price.');
  if (p.stressBps < 1500) warnings.push('A stress fall under 15% is milder than recent broad selloffs.');
  return { errors, warnings };
}

// ── Limits ────────────────────────────────────────────────────────────────────────────────────────

export interface PlanLimits {
  reserveCents: number;
  spreadCapCents: number;
  singleSpreadCents: number;
  /** Cash left for the wheel: account minus reserve minus the spread cap. */
  wheelCashCents: number;
  sectorLimitCents: number;
  /** Most cash one name may tie up under the chosen profile and drop. */
  maxCashPerNameCents: number;
  /** Highest put strike (whole dollars) that fits one contract under maxCashPerNameCents. */
  highestStrikeDollars: number;
  lossBudgetBps: number;
}

const bpsOf = (cents: number, bps: number) => Math.floor((cents * bps) / 10_000);

export function maxCashPerNameCents(p: PlanParams, dropBps: number = p.dropBps): number {
  return Math.floor((lossBudgetBps(p) * p.accountCents) / dropBps);
}

export function computeLimits(p: PlanParams): PlanLimits {
  const reserveCents = bpsOf(p.accountCents, p.reserveBps);
  const spreadCapCents = bpsOf(p.accountCents, p.spreadCapBps);
  const maxCash = maxCashPerNameCents(p);
  return {
    reserveCents,
    spreadCapCents,
    singleSpreadCents: bpsOf(p.accountCents, p.singleSpreadCapBps),
    wheelCashCents: Math.max(0, p.accountCents - reserveCents - spreadCapCents),
    sectorLimitCents: bpsOf(p.accountCents, p.sectorLimitBps),
    maxCashPerNameCents: maxCash,
    highestStrikeDollars: Math.floor(maxCash / 10_000),
    lossBudgetBps: lossBudgetBps(p),
  };
}

// ── One put ───────────────────────────────────────────────────────────────────────────────────────

/** A strike in dollars (37.5) to whole cents (3750). */
export const strikeToCents = (strikeDollars: number): number => Math.round(strikeDollars * 100);

/** Cash secured by one contract, in cents: strike x 100 shares. */
export const cashForOnePutCents = (strikeDollars: number): number => strikeToCents(strikeDollars) * 100;

/**
 * The credit for one contract at the BID, in cents: bid to whole cents (floored, so it is never overstated) times
 * 100 shares. A missing or non-positive bid returns null.
 */
export function creditPerContractCents(bidDollars: number | null | undefined): number | null {
  if (bidDollars == null || !Number.isFinite(bidDollars) || bidDollars <= 0) return null;
  const bidCents = Math.floor(bidDollars * 100 + 1e-6);
  return bidCents > 0 ? bidCents * 100 : null;
}

/**
 * How far below the price the strike sits, as tenths of a percent (51 = 5.1%), half-up, in integer cents.
 * Negative when the strike is above the price (in the money). Null when there is no usable price or strike.
 */
export function percentBelowPriceTenths(priceDollars: number | null | undefined, strikeDollars: number): number | null {
  if (priceDollars == null || !Number.isFinite(priceDollars) || priceDollars <= 0) return null;
  const priceCents = Math.round(priceDollars * 100);
  const strikeCents = strikeToCents(strikeDollars);
  if (priceCents <= 0) return null;
  return Math.round(((priceCents - strikeCents) * 1000) / priceCents);
}

/**
 * Annualized return on capital at the BID, in basis points, before fees unless a fee is given: the credit for one
 * contract (bid floored to whole cents, times 100 shares) less the opening fee, over the cash the put ties up, scaled
 * to a year by simple (not compounded) calendar days. Null when there is no usable bid, the credit does not cover
 * the fee, or fewer than 1 day is left. Floored, so a name just under a hurdle can never read as passing.
 */
export function annualizedRocBps(bidDollars: number | null | undefined, strikeDollars: number, dte: number, openFeeCents = 0): number | null {
  const credit = creditPerContractCents(bidDollars);
  if (credit == null) return null;
  const net = credit - openFeeCents;
  if (net <= 0) return null;
  const cash = cashForOnePutCents(strikeDollars);
  if (!(cash > 0) || !Number.isInteger(dte) || dte < 1) return null;
  return Math.floor((net * 365 * 10_000) / (cash * dte));
}

/** Basis points as a percent floored to one decimal (997 -> "9.9%"), so a shortfall never displays as reaching the mark. */
export const formatRocBps = (bps: number): string => `${(Math.floor(bps / 10) / 10).toFixed(1)}%`;

/** How many contracts fit under the per-name cash limit. */
export function contractsThatFit(maxCashCents: number, cashCents: number): number {
  if (!(cashCents > 0) || !(maxCashCents > 0)) return 0;
  return Math.floor(maxCashCents / cashCents);
}

/**
 * The account size (cents) at which one contract of this cash need first fits the profile:
 * cash x drop / loss budget, rounded UP. Independent of the reserve and the spread cap.
 */
export function fitsAtAccountCents(cashCents: number, p: PlanParams, dropBps: number = p.dropBps): number {
  return Math.ceil((cashCents * dropBps) / lossBudgetBps(p));
}

export const MAX_UNLOCK_MONTHS = 600;

export type UnlockMonths =
  | { kind: 'fits' }
  | { kind: 'months'; months: number }
  | { kind: 'not-reached' }
  | { kind: 'over-50-years' };

/** Months of compounding at simple monthly rate g until the account reaches fitsAt. */
export function monthsToUnlock(fitsAtCents: number, accountCents: number, monthlyGrowthBps: number): UnlockMonths {
  if (fitsAtCents <= accountCents) return { kind: 'fits' };
  if (!(monthlyGrowthBps > 0)) return { kind: 'not-reached' };
  const growth = 1 + monthlyGrowthBps / 10_000;
  let months = Math.ceil(Math.log(fitsAtCents / accountCents) / Math.log(growth) - 1e-9);
  // Guard the exact-edge case against float error: the answer is the smallest n with account x growth^n >= fitsAt.
  while (months > 1 && accountCents * Math.pow(growth, months - 1) >= fitsAtCents) months -= 1;
  if (months > MAX_UNLOCK_MONTHS) return { kind: 'over-50-years' };
  return { kind: 'months', months };
}

// ── Allocation and stress ─────────────────────────────────────────────────────────────────────────

export interface AllocationInput {
  symbol: string;
  sector: string;
  cashCents: number;
  maxCashCents: number;
  /** The trader's own contract count for this name. Bypasses the per-name and sector limits (the tab warns). */
  forcedContracts?: number;
}

export interface AllocationRow {
  symbol: string;
  sector: string;
  fitContracts: number;
  contracts: number;
  deployedCents: number;
  /** True when the trader set the contract count, so the limits were not applied to it. */
  forced: boolean;
}

/**
 * Names the trader set a contract count for are placed first, exactly as asked and outside the per-name, sector and wheel-cash
 * limits (the tab warns about each). The rest get cash in list order (until the ranking exists in W2), each taking
 * min(per-name cap, wheel cash still available, sector room still available).
 */
export function allocate(inputs: AllocationInput[], wheelCashCents: number, sectorLimitCents: number): {
  rows: AllocationRow[];
  deployedCents: number;
  bySector: Record<string, number>;
} {
  const bySector: Record<string, number> = {};
  const result = new Map<string, AllocationRow>();
  const isForced = (i: AllocationInput) => typeof i.forcedContracts === 'number' && i.forcedContracts > 0;

  let remaining = Math.max(0, wheelCashCents);
  for (const input of inputs.filter(isForced)) {
    const contracts = input.forcedContracts as number;
    const deployedCents = contracts * input.cashCents;
    remaining = Math.max(0, remaining - deployedCents);
    bySector[input.sector] = (bySector[input.sector] ?? 0) + deployedCents;
    result.set(input.symbol, { symbol: input.symbol, sector: input.sector, fitContracts: contractsThatFit(input.maxCashCents, input.cashCents), contracts, deployedCents, forced: true });
  }
  for (const input of inputs.filter((i) => !isForced(i))) {
    const fit = contractsThatFit(input.maxCashCents, input.cashCents);
    const sectorUsed = bySector[input.sector] ?? 0;
    const sectorRoom = Math.max(0, sectorLimitCents - sectorUsed);
    const byWheelCash = input.cashCents > 0 ? Math.floor(remaining / input.cashCents) : 0;
    const bySectorRoom = input.cashCents > 0 ? Math.floor(sectorRoom / input.cashCents) : 0;
    const contracts = Math.max(0, Math.min(fit, byWheelCash, bySectorRoom));
    const deployedCents = contracts * input.cashCents;
    remaining -= deployedCents;
    bySector[input.sector] = sectorUsed + deployedCents;
    result.set(input.symbol, { symbol: input.symbol, sector: input.sector, fitContracts: fit, contracts, deployedCents, forced: false });
  }
  const rows = inputs.map((i) => result.get(i.symbol) as AllocationRow);
  return { rows, deployedCents: rows.reduce((sum, r) => sum + r.deployedCents, 0), bySector };
}

/** Dollars lost if every holding falls by stressBps, in cents (half-up). */
export const stressLossCents = (deployedCents: number, stressBps: number): number => Math.round((deployedCents * stressBps) / 10_000);

/** A cents amount as tenths of a percent of the account (221 = 22.1%), half-up. */
export const pctTenthsOfAccount = (cents: number, accountCents: number): number =>
  accountCents > 0 ? Math.round((cents * 1000) / accountCents) : 0;

export interface StressSummary {
  deployedCents: number;
  wheelLossCents: number;
  wheelLossPctTenths: number;
  fullWheelCents: number;
  fullWheelLossCents: number;
  fullWheelLossPctTenths: number;
  spreadCapCents: number;
  worstCaseCents: number;
  worstCasePctTenths: number;
}

/** Wheel stress today and fully deployed, plus spreads at full loss (the honest worst case). */
export function summarizeStress(p: PlanParams, limits: PlanLimits, deployedCents: number): StressSummary {
  const wheelLossCents = stressLossCents(deployedCents, p.stressBps);
  const fullWheelLossCents = stressLossCents(limits.wheelCashCents, p.stressBps);
  const worstCaseCents = fullWheelLossCents + limits.spreadCapCents;
  return {
    deployedCents,
    wheelLossCents,
    wheelLossPctTenths: pctTenthsOfAccount(wheelLossCents, p.accountCents),
    fullWheelCents: limits.wheelCashCents,
    fullWheelLossCents,
    fullWheelLossPctTenths: pctTenthsOfAccount(fullWheelLossCents, p.accountCents),
    spreadCapCents: limits.spreadCapCents,
    worstCaseCents,
    worstCasePctTenths: pctTenthsOfAccount(worstCaseCents, p.accountCents),
  };
}

export type InstrumentKind = 'etf' | 'stock';

// ── Leveraged and inverse ETFs (Ian, O7): never a wheel candidate ─────────────────────────────────

const LEVERAGED_OR_INVERSE = new Set([
  'TQQQ', 'SQQQ', 'SOXL', 'SOXS', 'UPRO', 'SPXU', 'SPXL', 'SPXS', 'SDS', 'SSO', 'QLD', 'QID', 'TNA', 'TZA', 'UDOW', 'SDOW',
  'TECL', 'TECS', 'FAS', 'FAZ', 'LABU', 'LABD', 'NUGT', 'DUST', 'JNUG', 'JDST', 'UVXY', 'SVXY', 'VXX', 'TSLL', 'TSLQ',
  'NVDL', 'NVDD', 'NVDX', 'FNGU', 'FNGD', 'BULZ', 'BERZ', 'YINN', 'YANG', 'ERX', 'ERY', 'UCO', 'SCO', 'BOIL', 'KOLD',
  'TMF', 'TMV', 'DPST', 'CURE', 'WEBL', 'WEBS', 'HIBL', 'HIBS', 'MSFU', 'AAPU', 'AMZU', 'GGLL', 'METU', 'PLTU',
]);

export const isLeveragedEtf = (symbol: string): boolean => LEVERAGED_OR_INVERSE.has(symbol.trim().toUpperCase());

// ── Display helpers ───────────────────────────────────────────────────────────────────────────────

/** Cents to "$5,100" (whole dollars) or "$19,333.34" (with cents when there are any). */
export function formatCents(cents: number): string {
  const negative = cents < 0;
  const abs = Math.abs(Math.round(cents));
  const dollars = Math.floor(abs / 100);
  const rest = abs % 100;
  const body = dollars.toLocaleString('en-US') + (rest ? `.${String(rest).padStart(2, '0')}` : '');
  return `${negative ? '-' : ''}$${body}`;
}

/** 221 -> "22.1%". */
export const formatPctTenths = (tenths: number): string => `${(tenths / 10).toFixed(1)}%`;

/** Basis points to a percent string without trailing zeros: 900 -> "9%", 75 -> "0.75%". */
export function formatBps(bps: number): string {
  const pct = bps / 100;
  return `${Number.isInteger(pct) ? pct : pct.toFixed(2).replace(/0+$/, '').replace(/\.$/, '')}%`;
}

export function formatUnlock(u: UnlockMonths): string {
  switch (u.kind) {
    case 'fits': return '';
    case 'months': return u.months === 1 ? '1 month' : `${u.months} months`;
    case 'not-reached': return 'not reached';
    case 'over-50-years': return 'over 50 years';
  }
}
