// features/portfolio/intelligence/__tests__/managementChoices.test.tsx
//
// PI-0005: pure-logic coverage for Available Management Choices.

import { describe, expect, it } from 'vitest';
import { deriveManagementChoices } from '../managementChoices';
import type { PortfolioRecommendationKind } from '@/lib/portfolio-intelligence';

describe('PI-0005: deriveManagementChoices', () => {
  it('returns a preferred choice and alternatives for every recommendation kind', () => {
    const kinds: PortfolioRecommendationKind[] = [
      'hold', 'watch', 'close-winner', 'close-loser', 'roll-soon',
      'place-gtc', 'let-expire', 'earnings-risk', 'assignment-risk',
    ];
    for (const kind of kinds) {
      const choices = deriveManagementChoices(kind);
      expect(typeof choices.preferred).toBe('string');
      expect(choices.preferred.length).toBeGreaterThan(0);
      expect(Array.isArray(choices.alternatives)).toBe(true);
      expect(choices.alternatives.length).toBeGreaterThan(0);
      expect(choices.alternatives).not.toContain(choices.preferred);
    }
  });

  it('prefers Accept Assignment for assignment-risk', () => {
    expect(deriveManagementChoices('assignment-risk').preferred).toBe('Accept Assignment');
  });

  it('prefers Harvest for close-winner', () => {
    expect(deriveManagementChoices('close-winner').preferred).toBe('Harvest');
  });

  it('prefers Roll for roll-soon', () => {
    expect(deriveManagementChoices('roll-soon').preferred).toBe('Roll');
  });

  it('prefers Close for close-loser', () => {
    expect(deriveManagementChoices('close-loser').preferred).toBe('Close');
  });

  it('prefers Hold for the plain hold case', () => {
    expect(deriveManagementChoices('hold').preferred).toBe('Hold');
  });
});
