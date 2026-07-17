// components/CspRiskCell.tsx
//
// Table cell for the Cash-Secured Put "Max Loss" column: shows the "2σ
// Scenario Loss" as the primary value -- the loss under one modeled
// downside scenario (a 2-standard-deviation implied-volatility move), not a
// prediction or maximum expected loss -- with the existing theoretical
// "Capital at Risk" (stock -> $0) as a smaller, muted secondary value, plus
// a hover tooltip explaining the difference. Renamed from "Realistic Loss"
// for terminology accuracy; no calculation changes.

'use client';

import { calculateCspRisk } from '@/lib/calculateCspRisk';

export interface CspRiskCellProps {
  impliedVolatility: number;
  daysToExpiration: number;
  currentStockPrice: number;
  strikePrice: number;
  premiumCollected: number;
  contracts: number;
}

function formatMoney(value: number): string {
  return value.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
}

export function CspRiskCell({
  impliedVolatility,
  daysToExpiration,
  currentStockPrice,
  strikePrice,
  premiumCollected,
  contracts,
}: CspRiskCellProps) {
  const { scenarioLoss, capitalAtRisk } = calculateCspRisk({
    impliedVolatility,
    daysToExpiration,
    currentStockPrice,
    strikePrice,
    premiumCollected,
    contracts,
  });

  return (
    <div className="flex flex-col gap-0.5">
      <div className="flex items-center gap-1">
        <span className="text-[10px] font-medium uppercase tracking-wide text-gray-500">2σ Scenario Loss</span>
        <span className="text-sm font-bold text-red-400">{formatMoney(scenarioLoss)}</span>

        {/* Info icon + CSS-only hover tooltip -- no extra dependency */}
        <span className="group relative inline-flex items-center">
          <svg
            aria-hidden="true"
            viewBox="0 0 20 20"
            className="h-3.5 w-3.5 shrink-0 cursor-help text-gray-500 hover:text-gray-300"
            fill="currentColor"
          >
            <path
              fillRule="evenodd"
              d="M18 10A8 8 0 112 10a8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z"
              clipRule="evenodd"
            />
          </svg>
          <span
            role="tooltip"
            className="pointer-events-none absolute bottom-full left-1/2 z-10 mb-2 w-64 -translate-x-1/2 rounded-md border border-gray-700 bg-gray-900 p-2 text-xs text-gray-200 opacity-0 shadow-lg transition-opacity group-hover:opacity-100"
          >
            <span className="font-semibold text-red-400">2σ Scenario Loss</span> estimates the loss if the
            underlying declines by two implied-volatility standard deviations by expiration. It is a modeled
            scenario, not a prediction or maximum expected loss.
            <br />
            <br />
            <span className="font-semibold text-gray-400">Capital at Risk</span> assumes the underlying falls to $0
            and represents the theoretical worst-case loss used for buying-power purposes.
          </span>
        </span>
      </div>

      <span className="text-[11px] text-gray-500">Capital at Risk: {formatMoney(capitalAtRisk)}</span>
    </div>
  );
}
