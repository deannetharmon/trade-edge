// lib/discovery/__tests__/strategy.test.ts

import { describe, expect, it } from 'vitest';
import {
  QV_V1_0_IDENTITY,
  compareStrategyVersions,
  createStrategyIdentity,
  createStrategyRegistry,
  parseStrategyVersion,
  sameStrategyIdentity,
  strategyKey,
} from '..';
import { FIXTURE_IDENTITY, FIXTURE_IDENTITY_V11, createFixtureStrategy } from './fixtures';

describe('strategy identity and versioning', () => {
  it('QV-v1.0 is the initial Quality Value identity', () => {
    expect(QV_V1_0_IDENTITY).toEqual({ strategyId: 'QV', strategyVersion: 'QV-v1.0' });
    expect(strategyKey(QV_V1_0_IDENTITY)).toBe('QV@QV-v1.0');
    expect(Object.isFrozen(QV_V1_0_IDENTITY)).toBe(true);
  });

  it('parses versions and rejects malformed ones', () => {
    expect(parseStrategyVersion('QV-v1.0')).toEqual({ strategyId: 'QV', major: 1, minor: 0 });
    expect(parseStrategyVersion('QV-v12.34')).toEqual({ strategyId: 'QV', major: 12, minor: 34 });
    ['QV-1.0', 'qv-v1.0', 'QV-v1', 'QV-v1.0.1', 'v1.0', ''].forEach((bad) => {
      expect(parseStrategyVersion(bad)).toBeNull();
    });
  });

  it('refuses an identity whose version belongs to another strategy or is malformed', () => {
    expect(() => createStrategyIdentity('QV', 'MOM-v1.0')).toThrow(/does not belong/);
    expect(() => createStrategyIdentity('QV', 'QV-1.0')).toThrow(/Invalid strategy version/);
    expect(() => createStrategyIdentity('qv', 'QV-v1.0')).toThrow(/Invalid strategy id/);
  });

  it('compares versions numerically, not lexically', () => {
    expect(compareStrategyVersions('QV-v1.0', 'QV-v1.1')).toBeLessThan(0);
    expect(compareStrategyVersions('QV-v1.10', 'QV-v1.9')).toBeGreaterThan(0);
    expect(compareStrategyVersions('QV-v2.0', 'QV-v1.99')).toBeGreaterThan(0);
    expect(compareStrategyVersions('QV-v1.0', 'QV-v1.0')).toBe(0);
    expect(() => compareStrategyVersions('QV-v1.0', 'MOM-v1.0')).toThrow(/different strategies/);
  });

  it('compares identities by id and version', () => {
    expect(sameStrategyIdentity(FIXTURE_IDENTITY, createStrategyIdentity('FIX', 'FIX-v1.0'))).toBe(true);
    expect(sameStrategyIdentity(FIXTURE_IDENTITY, FIXTURE_IDENTITY_V11)).toBe(false);
  });
});

describe('strategy registry', () => {
  it('keeps every published version retrievable and reports the latest', () => {
    const registry = createStrategyRegistry<ReturnType<typeof createFixtureStrategy>>();
    const v10 = createFixtureStrategy(FIXTURE_IDENTITY);
    const v11 = createFixtureStrategy(FIXTURE_IDENTITY_V11);
    registry.register(v11);
    registry.register(v10);

    expect(registry.versions('FIX')).toEqual(['FIX-v1.0', 'FIX-v1.1']);
    expect(registry.latest('FIX')).toBe(v11);
    // Reproducibility: the old version is still exactly the old strategy.
    expect(registry.require(FIXTURE_IDENTITY)).toBe(v10);
  });

  it('never replaces a published version', () => {
    const registry = createStrategyRegistry<ReturnType<typeof createFixtureStrategy>>();
    registry.register(createFixtureStrategy());
    expect(() => registry.register(createFixtureStrategy())).toThrow(/already registered/);
  });

  it('does not fall back to a nearby version', () => {
    const registry = createStrategyRegistry<ReturnType<typeof createFixtureStrategy>>();
    registry.register(createFixtureStrategy(FIXTURE_IDENTITY));
    expect(registry.get(FIXTURE_IDENTITY_V11)).toBeUndefined();
    expect(() => registry.require(FIXTURE_IDENTITY_V11)).toThrow(/not registered/);
    expect(registry.latest('NOPE')).toBeUndefined();
    expect(registry.versions('NOPE')).toEqual([]);
  });
});
