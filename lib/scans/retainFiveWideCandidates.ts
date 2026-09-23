import type { ScreenResult } from './types';

// A broad scan's winner for a short strike can be wider than $5. Keep the
// separately evaluated five-wide trade so the results filter can reveal it.
export function retainFiveWideCandidates(broad: ScreenResult[], fiveWide: ScreenResult[]): ScreenResult[] {
  const identity = (r: ScreenResult) => {
    const c = r.bestCandidate;
    return `${r.symbol}:${r.strategy}:${c?.expiration}:${c?.shortStrike}:${c?.longStrike}:${c?.shortCallStrike ?? ''}:${c?.longCallStrike ?? ''}`;
  };
  const seen = new Set(broad.map(identity));
  const result = [...broad];
  for (const candidate of fiveWide) {
    const key = identity(candidate);
    if (!seen.has(key)) { seen.add(key); result.push(candidate); }
  }
  return result;
}
