// components/CspRiskCell.tsx
//
// Table cell for the Cash-Secured Put "Max Loss" column: shows the 2-sigma
// "Realistic Loss" as the primary value, with the old theoretical
// "Capital at Risk" (stock -> $0) as a smaller, muted secondary value, plus
// a hover tooltip explaining the difference.

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
  const { realisticLoss, capitalAtRisk, expectedLowPrice } = calculateCspRisk({
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
        <span className="text-sm font-bold text-red-400">{formatMoney(realisticLoss)}</span>

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
            <span className="font-semibold text-red-400">Realistic Loss</span> estimates the loss if the stock
            falls to a 2-sigma expected low of {formatMoney(expectedLowPrice)}, based on implied volatility.{' '}
            <span className="font-semibold text-gray-400">Capital at Risk</span> is the theoretical worst case if
            the stock fell all the way to $0 -- useful for buying-power purposes, but rarely realistic.
          </span>
        </span>
      </div>

      <span className="text-[11px] text-gray-500">Capital at Risk: {formatMoney(capitalAtRisk)}</span>
    </div>
  );
}
