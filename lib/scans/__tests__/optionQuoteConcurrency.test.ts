import { afterEach, describe, expect, it, vi } from 'vitest';
import { getOptionQuoteBatchConcurrency } from '../tastytrade-client';

describe('option quote batch concurrency', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('uses the conservative default when not configured', () => {
    vi.stubEnv('NEXT_PUBLIC_OPTION_QUOTE_BATCH_CONCURRENCY', '');
    expect(getOptionQuoteBatchConcurrency()).toBe(3);
  });

  it('accepts a configured provider-safe limit', () => {
    vi.stubEnv('NEXT_PUBLIC_OPTION_QUOTE_BATCH_CONCURRENCY', '4');
    expect(getOptionQuoteBatchConcurrency()).toBe(4);
  });

  it('clamps unsafe values to the supported range', () => {
    vi.stubEnv('NEXT_PUBLIC_OPTION_QUOTE_BATCH_CONCURRENCY', '0');
    expect(getOptionQuoteBatchConcurrency()).toBe(1);

    vi.stubEnv('NEXT_PUBLIC_OPTION_QUOTE_BATCH_CONCURRENCY', '99');
    expect(getOptionQuoteBatchConcurrency()).toBe(6);
  });
});
