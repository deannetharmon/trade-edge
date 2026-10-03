// lib/discovery/strategy.ts

// LEAPS-QV-0001 Gate 1 (items 1-2, Sections 6-7) -- strategy identity, versioning and a version-pinned
// registry. Historical decisions must stay reproducible, so a (strategyId, strategyVersion) pair can be
// registered exactly once and is never replaced; an older version stays retrievable after a newer one ships.

export interface StrategyIdentity {
  readonly strategyId: string;
  readonly strategyVersion: string;
}

const STRATEGY_ID = /^[A-Z][A-Z0-9]*$/;
const STRATEGY_VERSION = /^([A-Z][A-Z0-9]*)-v(\d+)\.(\d+)$/;

export interface ParsedStrategyVersion {
  readonly strategyId: string;
  readonly major: number;
  readonly minor: number;
}

/** "QV-v1.0" -> { strategyId: 'QV', major: 1, minor: 0 }; null when the text is not a valid version. */
export function parseStrategyVersion(version: string): ParsedStrategyVersion | null {
  const match = STRATEGY_VERSION.exec(version);
  if (!match) return null;
  return { strategyId: match[1], major: Number(match[2]), minor: Number(match[3]) };
}

/** Builds a validated identity. The version's prefix must equal the strategy id ("QV" + "QV-v1.0"). */
export function createStrategyIdentity(strategyId: string, strategyVersion: string): StrategyIdentity {
  if (!STRATEGY_ID.test(strategyId)) {
    throw new Error(`Invalid strategy id "${strategyId}": expected upper-case letters/digits starting with a letter.`);
  }
  const parsed = parseStrategyVersion(strategyVersion);
  if (!parsed) {
    throw new Error(`Invalid strategy version "${strategyVersion}": expected <ID>-v<major>.<minor>, e.g. QV-v1.0.`);
  }
  if (parsed.strategyId !== strategyId) {
    throw new Error(`Strategy version "${strategyVersion}" does not belong to strategy "${strategyId}".`);
  }
  return Object.freeze({ strategyId, strategyVersion });
}

export function sameStrategyIdentity(a: StrategyIdentity, b: StrategyIdentity): boolean {
  return a.strategyId === b.strategyId && a.strategyVersion === b.strategyVersion;
}

/** Stable key such as "QV@QV-v1.0". */
export function strategyKey(identity: StrategyIdentity): string {
  return `${identity.strategyId}@${identity.strategyVersion}`;
}

/** Negative when a is older than b. Both versions must belong to the same strategy. */
export function compareStrategyVersions(a: string, b: string): number {
  const left = parseStrategyVersion(a);
  const right = parseStrategyVersion(b);
  if (!left || !right) throw new Error(`Cannot compare invalid strategy versions "${a}" and "${b}".`);
  if (left.strategyId !== right.strategyId) {
    throw new Error(`Cannot compare versions of different strategies ("${a}" vs "${b}").`);
  }
  return left.major !== right.major ? left.major - right.major : left.minor - right.minor;
}

export interface Identified {
  readonly identity: StrategyIdentity;
}

export interface StrategyRegistry<S extends Identified> {
  /** Registers a strategy. Throws if that exact id+version already exists (versions are immutable). */
  register(strategy: S): void;
  /** Exact-version lookup; there is deliberately no fallback to a "nearest" version. */
  get(identity: StrategyIdentity): S | undefined;
  require(identity: StrategyIdentity): S;
  /** Highest registered version of a strategy id. */
  latest(strategyId: string): S | undefined;
  /** Registered versions of a strategy id, oldest first. */
  versions(strategyId: string): string[];
}

export function createStrategyRegistry<S extends Identified>(): StrategyRegistry<S> {
  const byKey: Record<string, S> = {};
  const versionsById: Record<string, string[]> = {};

  return {
    register(strategy) {
      // Re-validate so an identity forged by hand cannot enter the registry.
      const identity = createStrategyIdentity(strategy.identity.strategyId, strategy.identity.strategyVersion);
      const key = strategyKey(identity);
      if (Object.prototype.hasOwnProperty.call(byKey, key)) {
        throw new Error(`Strategy ${key} is already registered; a published version is immutable.`);
      }
      byKey[key] = strategy;
      const list = versionsById[identity.strategyId] || (versionsById[identity.strategyId] = []);
      list.push(identity.strategyVersion);
      list.sort(compareStrategyVersions);
    },
    get(identity) {
      const key = strategyKey(identity);
      return Object.prototype.hasOwnProperty.call(byKey, key) ? byKey[key] : undefined;
    },
    require(identity) {
      const found = this.get(identity);
      if (!found) throw new Error(`Strategy ${strategyKey(identity)} is not registered.`);
      return found;
    },
    latest(strategyId) {
      const list = versionsById[strategyId];
      if (!list || list.length === 0) return undefined;
      return byKey[strategyKey({ strategyId, strategyVersion: list[list.length - 1] })];
    },
    versions(strategyId) {
      return (versionsById[strategyId] || []).slice();
    },
  };
}
