// lib/ai/__tests__/completionParams.test.ts

import { describe, expect, it } from 'vitest';
import { completionParams } from '../models';

describe('AI-POLICY D3 completion params', () => {
  it('reasoning models: max_completion_tokens with a 4,000 floor, no temperature', () => {
    expect(completionParams('gpt-5.6-terra', 1200, 0.2)).toEqual({ max_completion_tokens: 4000 });
    expect(completionParams('gpt-5.6-luna', 8000, 0)).toEqual({ max_completion_tokens: 8000 });
    expect(completionParams('o3', 900)).toEqual({ max_completion_tokens: 4000 });
  });
  it('older models keep max_tokens and temperature', () => {
    expect(completionParams('gpt-4o', 900, 0)).toEqual({ max_tokens: 900, temperature: 0 });
    expect(completionParams('gpt-4o-mini', 500)).toEqual({ max_tokens: 500 });
  });
});
