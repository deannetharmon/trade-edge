// lib/paper-trading/validation.ts
//
// PT-0001: strategy/leg shape validation. Pure, deterministic, no I/O.
// Rejects anything that isn't one of the four supported strategies with a
// structurally coherent leg set. See docs/design/PT-0001-Manual-Paper-Trading-Sandbox.md
// section "Supported strategies" for the exact shape each strategy requires.

import { PaperTradingError } from './types';
import type { PaperLeg, PaperOptionType, PaperStrategy } from './types';

export const SUPPORTED_STRATEGIES: readonly PaperStrategy[] = ['CSP', 'BPS', 'BCS', 'IC'];

export interface TicketInput {
  symbol: string;
  strategy: string;
  expiration: string;
  quantity: number;
  legs: PaperLeg[];
}

function isFiniteNumber(n: unknown): n is number {
  return typeof n === 'number' && Number.isFinite(n);
}

function fail(message: string, details?: Record<string, unknown>): never {
  throw new PaperTradingError('VALIDATION_ERROR', message, details);
}

function requireLegShape(leg: PaperLeg, index: number): void {
  if (!leg || typeof leg !== 'object') fail(`Leg ${index} is missing or malformed.`);
  if (leg.optionType !== 'put' && leg.optionType !== 'call') {
    fail(`Leg ${index} has an invalid optionType.`, { index });
  }
  if (!isFiniteNumber(leg.strike) || leg.strike <= 0) {
    fail(`Leg ${index} has an invalid strike.`, { index, strike: leg.strike });
  }
  if (leg.openAction !== 'buy_to_open' && leg.openAction !== 'sell_to_open') {
    fail(`Leg ${index} has an invalid openAction.`, { index });
  }
  if (!leg.expiration || Number.isNaN(new Date(leg.expiration).getTime())) {
    fail(`Leg ${index} has an unparsable expiration.`, { index, expiration: leg.expiration });
  }
}

function requireSameExpiration(legs: PaperLeg[], expiration: string): void {
  for (const leg of legs) {
    if (leg.expiration !== expiration) {
      fail('All legs must share the same expiration as the position.', {
        positionExpiration: expiration,
        legExpiration: leg.expiration,
      });
    }
  }
}

function legsOfType(legs: PaperLeg[], optionType: PaperOptionType) {
  return legs.filter((l) => l.optionType === optionType);
}

function validateCsp(legs: PaperLeg[]): void {
  if (legs.length !== 1) fail('CSP requires exactly one leg.', { legCount: legs.length });
  const [leg] = legs;
  if (leg.optionType !== 'put') fail('CSP requires a put leg.');
  if (leg.openAction !== 'sell_to_open') fail('CSP requires a short (sell_to_open) put.');
}

function validateVerticalSpread(legs: PaperLeg[], optionType: PaperOptionType, label: string): void {
  const relevant = legsOfType(legs, optionType);
  if (legs.length !== 2 || relevant.length !== 2) {
    fail(`${label} requires exactly two ${optionType} legs.`, { legCount: legs.length });
  }
  const short = legs.find((l) => l.openAction === 'sell_to_open');
  const long = legs.find((l) => l.openAction === 'buy_to_open');
  if (!short || !long) fail(`${label} requires one short leg and one long leg.`);
  if (short.strike === long.strike) fail(`${label} legs must have different strikes (zero-width spread).`);

  if (optionType === 'put') {
    // Bull put spread: short strike above long strike.
    if (short.strike <= long.strike) {
      fail('BPS short strike must be above the long strike.', { short: short.strike, long: long.strike });
    }
  } else {
    // Bear call spread: short strike below long strike.
    if (short.strike >= long.strike) {
      fail('BCS short strike must be below the long strike.', { short: short.strike, long: long.strike });
    }
  }
}

function validateIronCondor(legs: PaperLeg[]): void {
  if (legs.length !== 4) fail('IC requires exactly four legs.', { legCount: legs.length });
  const puts = legsOfType(legs, 'put');
  const calls = legsOfType(legs, 'call');
  if (puts.length !== 2 || calls.length !== 2) {
    fail('IC requires exactly two put legs and two call legs.', { puts: puts.length, calls: calls.length });
  }
  validateVerticalSpread(puts, 'put', 'IC put spread');
  validateVerticalSpread(calls, 'call', 'IC call spread');

  const putShort = puts.find((l) => l.openAction === 'sell_to_open')!;
  const callShort = calls.find((l) => l.openAction === 'sell_to_open')!;
  if (putShort.strike >= callShort.strike) {
    fail('IC put spread must be entirely below the call spread (no overlap).', {
      putShort: putShort.strike,
      callShort: callShort.strike,
    });
  }
}

export function validateTicket(input: TicketInput): void {
  if (!input.symbol || typeof input.symbol !== 'string') fail('Symbol is required.');
  if (!SUPPORTED_STRATEGIES.includes(input.strategy as PaperStrategy)) {
    fail(`Unsupported strategy: ${input.strategy}. Supported: ${SUPPORTED_STRATEGIES.join(', ')}.`, {
      strategy: input.strategy,
    });
  }
  if (!isFiniteNumber(input.quantity) || input.quantity <= 0 || !Number.isInteger(input.quantity)) {
    fail('Quantity must be a positive whole number.', { quantity: input.quantity });
  }
  if (!input.expiration || Number.isNaN(new Date(input.expiration).getTime())) {
    fail('Position expiration is unparsable.', { expiration: input.expiration });
  }
  if (!Array.isArray(input.legs) || input.legs.length === 0) {
    fail('At least one leg is required.');
  }

  input.legs.forEach((leg, index) => requireLegShape(leg, index));
  requireSameExpiration(input.legs, input.expiration);

  const strategy = input.strategy as PaperStrategy;
  if (strategy === 'CSP') validateCsp(input.legs);
  else if (strategy === 'BPS') validateVerticalSpread(input.legs, 'put', 'BPS');
  else if (strategy === 'BCS') validateVerticalSpread(input.legs, 'call', 'BCS');
  else if (strategy === 'IC') validateIronCondor(input.legs);
}

export function validateContractMultiplier(contractMultiplier: number): void {
  if (!isFiniteNumber(contractMultiplier) || contractMultiplier !== 100) {
    fail('Contract multiplier must be 100 for supported strategies.', { contractMultiplier });
  }
}
