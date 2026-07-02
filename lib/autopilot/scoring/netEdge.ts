// lib/autopilot/scoring/netEdge.ts

export interface NetEdgeInput {
  theta: number;
  gamma: number;
  expectedDailyMove: number;
}

export interface NetEdgeResult {
  netEdge: number;
  gammaPenalty: number;
  formula: string;
}

export function calculateNetEdge(input: NetEdgeInput): NetEdgeResult {
  const theta = Number.isFinite(input.theta) ? input.theta : 0;
  const gamma = Number.isFinite(input.gamma) ? input.gamma : 0;
  const expectedDailyMove = Number.isFinite(input.expectedDailyMove) ? input.expectedDailyMove : 0;
  const gammaPenalty = 0.5 * Math.abs(gamma) * Math.pow(expectedDailyMove, 2);

  return {
    netEdge: theta - gammaPenalty,
    gammaPenalty,
    formula: 'net_edge = theta - (0.5 * |gamma| * expected_daily_move^2)',
  };
}

export function calculateNetEdgeFadePct(peakNetEdge: number, currentNetEdge: number): number {
  if (!Number.isFinite(peakNetEdge) || peakNetEdge <= 0) return 0;
  if (!Number.isFinite(currentNetEdge)) return 100;
  return Math.max(0, ((peakNetEdge - currentNetEdge) / peakNetEdge) * 100);
}
