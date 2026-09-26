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
  /** Target absolute delta for the put to sell, in basis points (2000 = 0.20). */
  targetDeltaBps: number;
  dteMin: number;
  dteMax: number;
  /** Assumed simple monthly growth of the account, basis points (75 = 0.75% a month). */
  monthlyGrowthBps: number;
}

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
  targetDeltaBps: 2000, // 0.20
  dteMin: 30,
  dteMax: 45,
  monthlyGrowthBps: 75, // 0.75% a month
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
  if (!isInt(p.targetDeltaBps) || p.targetDeltaBps <= 0 || p.targetDeltaBps >= 10_000) errors.push('Target delta must be between 0 and 1.');
  if (!isInt(p.dteMin) || !isInt(p.dteMax) || p.dteMin < 0 || p.dteMin > p.dteMax) errors.push('Days to expiry: the minimum cannot be above the maximum.');
  if (typeof p.monthlyGrowthBps !== 'number' || !Number.isFinite(p.monthlyGrowthBps)) errors.push('Monthly growth must be a number.');

  if (errors.length) return { errors, warnings };

  const loss = lossBudgetBps(p);
  if (loss > 1200) warnings.push('A loss budget above 12% of the account per name means one bad name can hurt a lot; the worst-case line shows the effect.');
  if (p.dropBps < 2000) warnings.push('An assumed drop under 20% understates how far a stock can fall; positions will be sized larger than the recommended plan would allow.');
  if (p.reserveBps < 500) warnings.push('A reserve under 5% leaves little cash to act on a bad month.');
  if (p.spreadCapBps > 1000) warnings.push('A total spread cap above 10% of the account raises the worst case, because spreads can lose their full risk.');
  if (p.singleSpreadCapBps > p.spreadCapBps) warnings.push('The single-spread cap is above the total spread cap, so it can never bind.');
  if (p.targetDeltaBps > 3500) warnings.push('A target delta above 0.35 puts the strike close to the money and raises the chance of assignment.');
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
