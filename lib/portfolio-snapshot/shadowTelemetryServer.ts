import { createHmac } from 'crypto';
import type { CapacityShadowDifference, CapacityShadowResult } from './shadowParity';

const DIGEST_PREFIX_LENGTH = 24;

function hmac(secret: string, purpose: string, value: string): string {
  return createHmac('sha256', secret).update(`${purpose}\0${value}`).digest('hex');
}

function diagnosticCode(secret: string, kind: 'warning' | 'reason', value: string | null): string | null {
  if (value === null) return null;
  return `${kind}:sha256:${hmac(secret, kind, value).slice(0, DIGEST_PREFIX_LENGTH)}`;
}

function sanitizeDifference(secret: string, difference: CapacityShadowDifference): CapacityShadowDifference {
  if (difference.kind === 'warnings') {
    return {
      kind: 'warnings',
      legacy: difference.legacy.map(value => diagnosticCode(secret, 'warning', value) as string),
      snapshot: difference.snapshot.map(value => diagnosticCode(secret, 'warning', value) as string),
    };
  }
  if (difference.kind === 'unavailableReason') {
    return {
      kind: 'unavailableReason',
      legacy: diagnosticCode(secret, 'reason', difference.legacy),
      snapshot: diagnosticCode(secret, 'reason', difference.snapshot),
    };
  }
  return difference;
}

export function sanitizeCapacityShadowForStorage(
  result: CapacityShadowResult,
  secret: string,
): CapacityShadowResult {
  return {
    ...result,
    differences: result.differences.map(difference => sanitizeDifference(secret, difference)),
  } as CapacityShadowResult;
}

export function hashCapacityShadowIdentity(identity: string, secret: string): string {
  return hmac(secret, 'identity', identity).slice(0, DIGEST_PREFIX_LENGTH);
}

export function fingerprintCapacityShadowEvent(
  result: CapacityShadowResult,
  identityHash: string,
  secret: string,
): string {
  return hmac(secret, 'event', `${identityHash}\0${JSON.stringify(result)}`);
}
