// lib/ai-policy/__tests__/scope.test.ts
import { describe, expect, it } from 'vitest';
import { ScopeError, accountScopeId } from '../scope';

const ENV = { AI_POLICY_SCOPE_SECRET: 'a-secret-of-sufficient-length' };

describe('accountScopeId', () => {
  it('is deterministic, opaque, and does not contain the account number', () => {
    const id = accountScopeId('user-1', '5WX12345', ENV);
    expect(id).toBe(accountScopeId('user-1', '5WX12345', ENV));
    expect(id).toMatch(/^[0-9a-f]{32}$/);
    expect(id).not.toContain('5WX12345');
  });

  it('differs by user, by account, and by secret', () => {
    const base = accountScopeId('user-1', 'ACCT-A', ENV);
    expect(accountScopeId('user-2', 'ACCT-A', ENV)).not.toBe(base);
    expect(accountScopeId('user-1', 'ACCT-B', ENV)).not.toBe(base);
    expect(accountScopeId('user-1', 'ACCT-A', { AI_POLICY_SCOPE_SECRET: 'another-secret-of-length' })).not.toBe(base);
  });

  it('does not confuse (a, bc) with (ab, c)', () => {
    expect(accountScopeId('a', 'bc', ENV)).not.toBe(accountScopeId('ab', 'c', ENV));
  });

  it('fails closed without a secret', () => {
    expect(() => accountScopeId('u', 'a', {})).toThrow(ScopeError);
    expect(() => accountScopeId('u', 'a', { AI_POLICY_SCOPE_SECRET: 'short' })).toThrow(ScopeError);
  });
});
