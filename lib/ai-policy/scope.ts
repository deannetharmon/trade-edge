// lib/ai-policy/scope.ts
//
// Opaque account scope: truncated HMAC-SHA256 of (userId, accountNumber) keyed by AI_POLICY_SCOPE_SECRET.
// Account numbers never leave this function; the scope id is what is stored and sent anywhere.

import { createHmac } from 'crypto';
import type { Env } from './types';

export class ScopeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ScopeError';
  }
}

export function accountScopeId(userId: string, accountNumber: string, env: Env = process.env): string {
  const secret = env.AI_POLICY_SCOPE_SECRET;
  if (!secret || secret.length < 16) throw new ScopeError('AI_POLICY_SCOPE_SECRET is not configured');
  if (!userId || !accountNumber) throw new ScopeError('userId and accountNumber are required');
  return createHmac('sha256', secret).update(`${userId}\u0000${accountNumber}`, 'utf8').digest('hex').slice(0, 32);
}
