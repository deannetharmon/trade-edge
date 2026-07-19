// lib/portfolio-mode/types.ts
//
// PT-0002A: Global Portfolio Mode Foundation -- the canonical PortfolioMode
// domain type. This is the single source of truth for what a "portfolio
// mode" is anywhere in the application; nothing else may redefine or
// re-derive it. See docs/design/PT-0002A-Global-Portfolio-Mode-Foundation.md.

/**
 * LIVE  -- the existing, unmodified TastyTrade acquisition/execution
 *          pipeline (lib/portfolio-data, lib/tastytrade, app/portfolio's
 *          broker-boundary calls). Real money, real broker orders.
 * PAPER -- the existing PT-0001 manual paper-trading ledger
 *          (lib/paper-trading), reachable only via the paper-trading API
 *          routes. Fully simulated; cannot reach a broker.
 */
export type PortfolioMode = 'LIVE' | 'PAPER';

export const PORTFOLIO_MODES: readonly PortfolioMode[] = ['LIVE', 'PAPER'] as const;

/**
 * Strict runtime validator. Used at every trust boundary (persistence
 * read-back, any future API/query-param input in PT-0002B) that hands this
 * type a value that didn't originate from a `PortfolioMode`-typed variable
 * -- e.g. `JSON.parse()`, `localStorage.getItem()`, a URL/query value, or a
 * network response. Deliberately rejects anything other than the two exact
 * uppercase strings: no case-insensitive matching, no numeric/boolean
 * coercion, no trimming. A near-miss (`"live"`, `"Live"`, `"paper "`, `1`,
 * `null`) is invalid, not a fuzzy match -- ambiguity must fail visibly per
 * the design doc's persistence requirements, never be silently coerced.
 */
export function isPortfolioMode(value: unknown): value is PortfolioMode {
  return value === 'LIVE' || value === 'PAPER';
}
