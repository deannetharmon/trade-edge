// lib/ai-policy/budget.ts
//
// Atomic budget reservation (spec AC 12). Three allowances are enforced together, before any provider call:
//   - per-user, per-route hourly request count (fixed hourly window);
//   - per-user monthly USD;
//   - global daily USD.
// Amounts are integer micro-dollars. `reserve()` checks and reserves in one step; `reconcile()` later releases the
// unused part of the reservation (or records an overrun). RedisBudgetStore does the check+reserve in ONE Lua script;
// InMemoryBudgetStore is the test double with the same contract.

import { randomUUID } from 'crypto';
import type { AiRouteId, RedisLike } from './types';

export interface BudgetLimits {
  routeHourlyLimit: number;
  userMonthlyMicros: number;
  globalDailyMicros: number;
}

export interface BudgetReservation {
  id: string;
  reservedMicros: number;
  monthKey: string;
  dayKey: string;
}

export type ReserveResult = { ok: true; reservation: BudgetReservation } | { ok: false; reason: 'RATE_LIMIT' | 'BUDGET' };

export interface ReserveInput {
  userId: string;
  route: AiRouteId;
  estimateMicros: number;
  limits: BudgetLimits;
  nowMs: number;
}

export interface BudgetStore {
  reserve(input: ReserveInput): Promise<ReserveResult>;
  /** Replace the reservation with the actual spend (release the difference, or record an overrun). */
  reconcile(reservation: BudgetReservation, actualMicros: number): Promise<void>;
}

const HOUR_MS = 3_600_000;
const pad = (n: number): string => String(n).padStart(2, '0');

export function budgetKeys(userId: string, route: AiRouteId, nowMs: number): { hourKey: string; monthKey: string; dayKey: string } {
  const d = new Date(nowMs);
  const month = `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}`;
  const day = `${month}-${pad(d.getUTCDate())}`;
  return {
    hourKey: `ai-policy:budget:hour:${userId}:${route}:${Math.floor(nowMs / HOUR_MS)}`,
    monthKey: `ai-policy:budget:month:${userId}:${month}`,
    dayKey: `ai-policy:budget:day:global:${day}`,
  };
}

/** Atomic check + reserve. KEYS: hour, month, day. ARGV: hourlyLimit, monthlyLimit, dailyLimit, estimate, ttls. */
export const RESERVE_SCRIPT = `
local h = tonumber(redis.call('GET', KEYS[1]) or '0')
local m = tonumber(redis.call('GET', KEYS[2]) or '0')
local d = tonumber(redis.call('GET', KEYS[3]) or '0')
local est = tonumber(ARGV[4])
if h >= tonumber(ARGV[1]) then return 'RATE_LIMIT' end
if m + est > tonumber(ARGV[2]) then return 'BUDGET' end
if d + est > tonumber(ARGV[3]) then return 'BUDGET' end
redis.call('INCR', KEYS[1])
redis.call('EXPIRE', KEYS[1], ARGV[5])
redis.call('INCRBY', KEYS[2], est)
redis.call('EXPIRE', KEYS[2], ARGV[6])
redis.call('INCRBY', KEYS[3], est)
redis.call('EXPIRE', KEYS[3], ARGV[7])
return 'OK'
`;

const HOUR_TTL = 2 * 3600;
const DAY_TTL = 3 * 86_400;
const MONTH_TTL = 40 * 86_400;

export class RedisBudgetStore implements BudgetStore {
  constructor(private readonly redis: RedisLike) {}

  async reserve(input: ReserveInput): Promise<ReserveResult> {
    const { hourKey, monthKey, dayKey } = budgetKeys(input.userId, input.route, input.nowMs);
    const { limits, estimateMicros } = input;
    const outcome = await this.redis.eval(
      RESERVE_SCRIPT, 3, hourKey, monthKey, dayKey,
      limits.routeHourlyLimit, limits.userMonthlyMicros, limits.globalDailyMicros, estimateMicros, HOUR_TTL, MONTH_TTL, DAY_TTL,
    );
    if (outcome === 'OK') return { ok: true, reservation: { id: randomUUID(), reservedMicros: estimateMicros, monthKey, dayKey } };
    return { ok: false, reason: outcome === 'RATE_LIMIT' ? 'RATE_LIMIT' : 'BUDGET' };
  }

  async reconcile(reservation: BudgetReservation, actualMicros: number): Promise<void> {
    const delta = Math.round(actualMicros) - reservation.reservedMicros;
    if (delta === 0) return;
    await this.redis.incrby(reservation.monthKey, delta);
    await this.redis.incrby(reservation.dayKey, delta);
  }
}

/** Test double with the same contract. Single-threaded JS makes each reserve() atomic. */
export class InMemoryBudgetStore implements BudgetStore {
  private readonly counters = new Map<string, number>();

  get(key: string): number {
    return this.counters.get(key) ?? 0;
  }

  async reserve(input: ReserveInput): Promise<ReserveResult> {
    const { hourKey, monthKey, dayKey } = budgetKeys(input.userId, input.route, input.nowMs);
    const { limits, estimateMicros } = input;
    if (this.get(hourKey) >= limits.routeHourlyLimit) return { ok: false, reason: 'RATE_LIMIT' };
    if (this.get(monthKey) + estimateMicros > limits.userMonthlyMicros) return { ok: false, reason: 'BUDGET' };
    if (this.get(dayKey) + estimateMicros > limits.globalDailyMicros) return { ok: false, reason: 'BUDGET' };
    this.counters.set(hourKey, this.get(hourKey) + 1);
    this.counters.set(monthKey, this.get(monthKey) + estimateMicros);
    this.counters.set(dayKey, this.get(dayKey) + estimateMicros);
    return { ok: true, reservation: { id: randomUUID(), reservedMicros: estimateMicros, monthKey, dayKey } };
  }

  async reconcile(reservation: BudgetReservation, actualMicros: number): Promise<void> {
    const delta = Math.round(actualMicros) - reservation.reservedMicros;
    this.counters.set(reservation.monthKey, this.get(reservation.monthKey) + delta);
    this.counters.set(reservation.dayKey, this.get(reservation.dayKey) + delta);
  }
}
