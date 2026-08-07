// features/screener/components/ScanIdentityHeader.tsx
//
// SCREENER-UX-0001 — "Scan identity" is the first item in the required
// information hierarchy: what strategy and scan mode produced these
// results. Renders the exact title derived from the canonical session's own
// mode/requestedStrategy (see features/screener/lib/scanIdentity.ts) plus an
// explicit "Mode: … · Strategy: …" line, so neither has to be inferred from
// the cards below.

import type { ScreenerRequestedStrategy, ScreenerScanMode } from '@/lib/screener/scanSession';
import { getScanIdentity } from '../lib/scanIdentity';

export interface ScanIdentityHeaderProps {
  mode: ScreenerScanMode;
  requestedStrategy: ScreenerRequestedStrategy;
  /** Tailwind color utility class applied to the title, matching each mode's existing accent color. */
  accentClassName?: string;
  textFaintClassName?: string;
}

export function ScanIdentityHeader({
  mode,
  requestedStrategy,
  accentClassName = 'text-amber-400',
  textFaintClassName = 'text-slate-500',
}: ScanIdentityHeaderProps) {
  const identity = getScanIdentity(mode, requestedStrategy);
  return (
    <div data-testid="scan-identity-header">
      <h2 className={`text-sm font-bold tracking-wide ${accentClassName}`}>{identity.title}</h2>
      <p className={`text-[9px] tracking-wide ${textFaintClassName}`}>
        Mode: <span className="font-medium">{identity.modeLabel}</span>
        {' · '}
        Strategy: <span className="font-medium">{identity.requestedStrategyLabel}</span>
      </p>
    </div>
  );
}
