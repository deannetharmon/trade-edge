// lib/wheel/planSchema.ts
//
// WHEEL-SYSTEM-0001 (W1) -- the saved wheel plan: its shape, validation and safe parsing.
//
// The plan stores only the trader's OVERRIDES of the defaults plus the wheel list. Reading never throws:
// malformed or partly bad stored data falls back to defaults field by field, so one bad value can never
// break the tab (Quinn). Writing validates every field and rejects unknown keys.

import {
  PLAN_PARAM_KEYS,
  isPlanProfile,
  resolveParams,
  validateParams,
  type PlanOverrides,
  type PlanParams,
} from './capitalPlan';

export interface WheelListEntry {
  symbol: string;
  /** Sector for the sector limit. Blank means the symbol is its own sector. */
  sector?: string;
  /** Per-symbol assumed drop in basis points; overrides the plan-wide drop for this name. */
  dropBps?: number;
  /** The trader's own contract count for this name; the plan places it as asked and warns instead of limiting it. */
  contracts?: number;
}

export interface WheelPlan {
  overrides: PlanOverrides;
  wheelList: WheelListEntry[];
  updatedAt: string;
}

export const MAX_WHEEL_LIST = 40;
export const SYMBOL_PATTERN = /^[A-Z][A-Z0-9.\-]{0,9}$/;
const MAX_SECTOR_LENGTH = 32;
export const MAX_OVERRIDE_CONTRACTS = 100;

export function emptyPlan(): WheelPlan {
  return { overrides: {}, wheelList: [], updatedAt: new Date(0).toISOString() };
}

type ParamCheck = (v: unknown) => boolean;

const isInt = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v);
const bps: ParamCheck = (v) => isInt(v) && v >= 0 && v <= 10_000;

const FIELD_CHECKS: Record<keyof PlanParams, ParamCheck> = {
  accountCents: (v) => isInt(v) && v > 0 && v <= 100_000_000_000,
  reserveBps: bps,
  spreadCapBps: bps,
  singleSpreadCapBps: bps,
  profile: isPlanProfile,
  customLossBps: bps,
  dropBps: (v) => bps(v) && (v as number) > 0,
  stressBps: bps,
  sectorLimitBps: bps,
  targetDeltaBps: (v) => isInt(v) && v > 0 && v < 10_000,
  dteMin: (v) => isInt(v) && v >= 0 && v <= 1000,
  dteMax: (v) => isInt(v) && v >= 0 && v <= 1000,
  monthlyGrowthBps: (v) => typeof v === 'number' && Number.isFinite(v) && v >= -10_000 && v <= 10_000,
};

/** Keeps only known, valid override keys from arbitrary input (used when READING stored data). */
export function sanitizeOverrides(input: unknown): PlanOverrides {
  const out: Record<string, unknown> = {};
  if (input && typeof input === 'object' && !Array.isArray(input)) {
    for (const key of PLAN_PARAM_KEYS) {
      const v = (input as Record<string, unknown>)[key];
      if (v !== undefined && FIELD_CHECKS[key](v)) out[key] = v;
    }
  }
  return out as PlanOverrides;
}

export function sanitizeWheelEntry(input: unknown): WheelListEntry | null {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null;
  const raw = input as Record<string, unknown>;
  const symbol = typeof raw.symbol === 'string' ? raw.symbol.trim().toUpperCase() : '';
  if (!SYMBOL_PATTERN.test(symbol)) return null;
  const entry: WheelListEntry = { symbol };
  if (typeof raw.sector === 'string' && raw.sector.trim()) entry.sector = raw.sector.trim().slice(0, MAX_SECTOR_LENGTH);
  if (isInt(raw.dropBps) && raw.dropBps > 0 && raw.dropBps <= 10_000) entry.dropBps = raw.dropBps;
  if (isInt(raw.contracts) && raw.contracts >= 1 && raw.contracts <= MAX_OVERRIDE_CONTRACTS) entry.contracts = raw.contracts;
  return entry;
}

export function sanitizeWheelList(input: unknown): WheelListEntry[] {
  if (!Array.isArray(input)) return [];
  const seen = new Set<string>();
  const out: WheelListEntry[] = [];
  for (const item of input) {
    const entry = sanitizeWheelEntry(item);
    if (!entry || seen.has(entry.symbol)) continue;
    seen.add(entry.symbol);
    out.push(entry);
    if (out.length >= MAX_WHEEL_LIST) break;
  }
  return out;
}

/** Parses what is stored. Never throws; anything unusable becomes the default. */
export function parseStoredPlan(raw: string | null | undefined): WheelPlan {
  if (!raw) return emptyPlan();
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown> | null;
    if (!parsed || typeof parsed !== 'object') return emptyPlan();
    return {
      overrides: sanitizeOverrides(parsed.overrides),
      wheelList: sanitizeWheelList(parsed.wheelList),
      updatedAt: typeof parsed.updatedAt === 'string' ? parsed.updatedAt : new Date(0).toISOString(),
    };
  } catch {
    return emptyPlan();
  }
}

export interface PlanPatchResult {
  ok: boolean;
  errors: string[];
  overrides?: PlanOverrides;
  wheelList?: WheelListEntry[];
}

/**
 * Validates a save request: { overrides?, wheelList? }. Each present part REPLACES the stored one.
 * Unknown keys, wrong types and hard-invalid combined values are rejected; soft warnings never block a save.
 */
export function validatePlanPatch(body: unknown): PlanPatchResult {
  const errors: string[] = [];
  if (!body || typeof body !== 'object' || Array.isArray(body)) return { ok: false, errors: ['Body must be an object.'] };
  const raw = body as Record<string, unknown>;
  for (const key of Object.keys(raw)) {
    if (key !== 'overrides' && key !== 'wheelList') errors.push(`Unknown field: ${key}`);
  }

  let overrides: PlanOverrides | undefined;
  if (raw.overrides !== undefined) {
    if (!raw.overrides || typeof raw.overrides !== 'object' || Array.isArray(raw.overrides)) {
      errors.push('overrides must be an object.');
    } else {
      const candidate = raw.overrides as Record<string, unknown>;
      const good: Record<string, unknown> = {};
      for (const key of Object.keys(candidate)) {
        if (!(PLAN_PARAM_KEYS as string[]).includes(key)) { errors.push(`Unknown parameter: ${key}`); continue; }
        if (!FIELD_CHECKS[key as keyof PlanParams](candidate[key])) { errors.push(`Invalid value for ${key}.`); continue; }
        good[key] = candidate[key];
      }
      if (!errors.length) {
        const check = validateParams(resolveParams(good as PlanOverrides));
        errors.push(...check.errors);
      }
      overrides = good as PlanOverrides;
    }
  }

  let wheelList: WheelListEntry[] | undefined;
  if (raw.wheelList !== undefined) {
    if (!Array.isArray(raw.wheelList)) {
      errors.push('wheelList must be a list.');
    } else if (raw.wheelList.length > MAX_WHEEL_LIST) {
      errors.push(`The wheel list can hold at most ${MAX_WHEEL_LIST} symbols.`);
    } else {
      const seen = new Set<string>();
      const list: WheelListEntry[] = [];
      raw.wheelList.forEach((item, i) => {
        const entry = sanitizeWheelEntry(item);
        if (!entry) { errors.push(`Wheel list item ${i + 1} is not valid.`); return; }
        if (seen.has(entry.symbol)) { errors.push(`Duplicate symbol: ${entry.symbol}`); return; }
        seen.add(entry.symbol);
        list.push(entry);
      });
      wheelList = list;
    }
  }

  if (errors.length) return { ok: false, errors };
  return { ok: true, errors: [], overrides, wheelList };
}
