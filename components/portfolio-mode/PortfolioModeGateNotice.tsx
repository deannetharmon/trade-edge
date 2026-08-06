// components/portfolio-mode/PortfolioModeGateNotice.tsx
//
// PT-0002B: shared placeholder rendered by /dashboard and /portfolio
// whenever the global PortfolioMode is not resolved-and-LIVE.

'use client';

import Link from 'next/link';
import { THEMES, type Theme } from '@/lib/theme';
import type { PortfolioModeContextValue } from './PortfolioModeProvider';

export function PortfolioModeGateNotice({
  portfolioMode,
  th,
  screenName,
}: {
  portfolioMode: PortfolioModeContextValue;
  th: typeof THEMES[Theme];
  screenName: string;
}) {
  const { status, mode } = portfolioMode;

  let heading: string;
  let body: string;

  if (status === 'resolving') {
    heading = 'Resolving portfolio mode…';
    body = 'Determining your current portfolio mode…';
  } else if (status === 'invalid') {
    heading = 'Portfolio mode needs to be resolved';
    body =
      'Use the indicator at the top of the page to choose LIVE or PAPER before continuing.';
  } else if (mode === 'PAPER') {
    heading = `${screenName}: Currently supports LIVE mode only`;
    body =
      'Paper mode isn’t wired into this screen yet. Visit Paper Trading to view your simulated portfolio, or switch back to LIVE using the indicator at the top of the page.';
  } else {
    heading = 'Portfolio mode unresolved';
    body =
      'Use the indicator at the top of the page to choose LIVE or PAPER before continuing.';
  }

  const accessibilityProps =
    status === 'resolving'
      ? ({
          role: 'status',
          'aria-live': 'polite',
        } as const)
      : status === 'invalid'
        ? ({
            role: 'alert',
          } as const)
        : {};

  return (
    <div
      className={`min-h-screen ${th.bg} flex items-center justify-center px-6 transition-colors duration-200`}
    >
      <div
        {...accessibilityProps}
        className={`max-w-md rounded-lg border ${th.border} ${th.card} p-6 text-center shadow-lg`}
      >
        <p className={`text-sm font-semibold ${th.text}`}>{heading}</p>
        <p className={`mt-2 text-xs ${th.textMuted}`}>{body}</p>

        {mode === 'PAPER' && status === 'ready' && (
          <Link
            href="/paper-trading"
            className="mt-4 inline-block rounded border border-emerald-400 px-4 py-2 text-sm font-semibold text-emerald-300 hover:bg-emerald-500/10"
          >
            Go to Paper Trading
          </Link>
        )}
      </div>
    </div>
  );
}
