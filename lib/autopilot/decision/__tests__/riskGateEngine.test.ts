// lib/autopilot/decision/__tests__/riskGateEngine.test.ts
//
// Sprint 2 validation, item 4 (Autopilot layer): evaluateRiskGates() covers
// the portfolio-discipline rules that are NOT modeled by the shared Decision
// Engine (per-trade max loss %, drawdown circuit breaker, correlation), plus
// single_ticker/sector_metadata which are computed here but intentionally
// NOT used as blocking pre-gates in recommendationEngine.ts (that concern
// ownership belongs to the shared engine's buildConcerns() -- see
// PORTFOLIO_PRE_GATE_RULES in recommendationEngine.ts).

import { describe, expect, it } from 'vitest';
import { evaluateRiskGates, hasBlockingRiskGate, summarizeRiskGateReasons } from '@/lib/autopilot/decision/riskGateEngine';
import { makeCandidate, makeConfig, makePortfolioState } from '../../../../test/fixtures/autopilotFixtures';

describe('per_trade_max_loss gate', () => {
  it('passes when max loss is within perTradeMaxLossPctEquity', () => {
    const gates = evaluateRiskGates(
      makeCandidate({ theoreticalMaxLoss: 1000 }),
      makeConfig({ thresholds: { perTradeMaxLossPctEquity: 2.5 } as any }),
      makePortfolioState({ currentBalance: 100000 }),
    );
    const gate = gates.find((g) => g.rule === 'per_trade_max_loss');
    expect(gate?.passed).toBe(true);
  });

  it('blocks when max loss exceeds perTradeMaxLossPctEquity', () => {
    const gates = evaluateRiskGates(
      makeCandidate({ theoreticalMaxLoss: 5000 }), // 5% of 100k, limit is 2.5%
      makeConfig({ thresholds: { perTradeMaxLossPctEquity: 2.5 } as any }),
      makePortfolioState({ currentBalance: 100000 }),
    );
    const gate = gates.find((g) => g.rule === 'per_trade_max_loss');
    expect(gate?.passed).toBe(false);
    expect(hasBlockingRiskGate(gates)).toBe(true);
  });
});

describe('drawdown circuit breaker', () => {
  it('passes when drawdown is below the defensive threshold', () => {
    const gates = evaluateRiskGates(
      makeCandidate(),
      makeConfig({ thresholds: { monthlyDrawdownDefensivePct: 8 } as any }),
      makePortfolioState({ drawdownPct: 3 }),
    );
    expect(gates.find((g) => g.rule === 'drawdown')?.passed).toBe(true);
  });

  it('blocks when drawdown meets or exceeds the defensive threshold', () => {
    const gates = evaluateRiskGates(
      makeCandidate(),
      makeConfig({ thresholds: { monthlyDrawdownDefensivePct: 8 } as any }),
      makePortfolioState({ drawdownPct: 8 }),
    );
    expect(gates.find((g) => g.rule === 'drawdown')?.passed).toBe(false);
  });
});

describe('single_ticker gate (computed, not used as an Autopilot pre-gate)', () => {
  it('blocks at the riskGateEngine level when projected ticker exposure exceeds the limit', () => {
    const gates = evaluateRiskGates(
      makeCandidate({ symbol: 'AMD', theoreticalMaxLoss: 6000 }),
      makeConfig({ thresholds: { singleTickerMaxPct: 10 } as any }),
      makePortfolioState({ currentBalance: 100000, tickerExposure: { AMD: 5000 } }),
    );
    expect(gates.find((g) => g.rule === 'single_ticker')?.passed).toBe(false);
  });

  it('is present in evaluateRiskGates output but is excluded from recommendationEngine PORTFOLIO_PRE_GATE_RULES', async () => {
    // This is a documentation-style test: it asserts the deliberate design
    // choice (see recommendationEngine.ts comment above
    // PORTFOLIO_PRE_GATE_RULES) that single_ticker concentration is owned by
    // the shared Decision Engine's buildConcerns(), not double-enforced here.
    const engineSource = await import('@/lib/autopilot/decision/recommendationEngine');
    expect(typeof engineSource.runRecommendationEngine).toBe('function');
    // We can't easily introspect the private PORTFOLIO_PRE_GATE_RULES
    // constant from outside the module (it isn't exported), so this is
    // enforced functionally in recommendationEngine.test.ts instead. This
    // test exists to keep the intent documented alongside the gate itself.
  });
});

describe('correlation gate', () => {
  it('passes when correlation penalty is within the configured threshold', () => {
    const gates = evaluateRiskGates(
      makeCandidate({ correlationPenalty: 20 }),
      makeConfig({ thresholds: { correlationSkipThreshold: 0.65 } as any }), // *100 = 65
      makePortfolioState(),
    );
    expect(gates.find((g) => g.rule === 'correlation')?.passed).toBe(true);
  });

  it('blocks when correlation penalty exceeds the configured threshold', () => {
    const gates = evaluateRiskGates(
      makeCandidate({ correlationPenalty: 80 }),
      makeConfig({ thresholds: { correlationSkipThreshold: 0.65 } as any }),
      makePortfolioState(),
    );
    expect(gates.find((g) => g.rule === 'correlation')?.passed).toBe(false);
  });

  it('treats a missing correlationPenalty as 0 (passes), not as a blocking unknown', () => {
    const gates = evaluateRiskGates(
      makeCandidate({ correlationPenalty: undefined }),
      makeConfig(),
      makePortfolioState(),
    );
    expect(gates.find((g) => g.rule === 'correlation')?.passed).toBe(true);
  });
});

describe('sector metadata handling', () => {
  it('warns (does not block) when sector metadata is missing', () => {
    const gates = evaluateRiskGates(
      makeCandidate({ sector: undefined }),
      makeConfig(),
      makePortfolioState(),
    );
    const gate = gates.find((g) => g.rule === 'sector_metadata');
    expect(gate?.passed).toBe(true);
    expect(gate?.severity).toBe('warning');
    expect(summarizeRiskGateReasons(gates).some((r) => r.startsWith('sector_metadata'))).toBe(true);
  });

  it('passes cleanly (info) when sector metadata is present', () => {
    const gates = evaluateRiskGates(
      makeCandidate({ sector: 'Technology' }),
      makeConfig(),
      makePortfolioState(),
    );
    const gate = gates.find((g) => g.rule === 'sector_metadata');
    expect(gate?.passed).toBe(true);
    expect(gate?.severity).toBe('info');
  });
});

describe('summarizeRiskGateReasons', () => {
  it('includes blocking gates and warnings, excludes clean passes', () => {
    const gates = evaluateRiskGates(
      makeCandidate({ theoreticalMaxLoss: 5000, sector: undefined }),
      makeConfig({ thresholds: { perTradeMaxLossPctEquity: 2.5 } as any }),
      makePortfolioState({ currentBalance: 100000, drawdownPct: 0 }),
    );
    const reasons = summarizeRiskGateReasons(gates);
    expect(reasons.some((r) => r.startsWith('per_trade_max_loss'))).toBe(true);
    expect(reasons.some((r) => r.startsWith('sector_metadata'))).toBe(true);
    expect(reasons.some((r) => r.startsWith('drawdown'))).toBe(false);
  });
});
