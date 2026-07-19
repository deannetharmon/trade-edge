// components/command-center/CommandCenterHeader.tsx
//
// TC-0001: morning header -- time-appropriate greeting, portfolio context
// where available, last-refreshed timestamp, and explicit loading/stale/
// empty/error states (design doc section 3.2). Never fabricates live
// market status, prices, news, or account freshness.

import type { THEMES, Theme } from '@/lib/theme';
import type { CommandCenterHeaderViewModel } from '@/lib/command-center';

export interface CommandCenterHeaderProps {
  header: CommandCenterHeaderViewModel;
  th: (typeof THEMES)[Theme];
}

export function CommandCenterHeader({ header, th }: CommandCenterHeaderProps) {
  return (
    <header className={`mb-6 rounded-xl border ${th.border} ${th.card} p-5`} aria-label="Command Center Header">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h1 className={`text-lg font-bold ${th.text}`}>{header.greeting}</h1>
        <p className={`text-[11px] ${th.textFaint}`}>
          {header.lastRefreshedAt
            ? `Last refreshed ${new Date(header.lastRefreshedAt).toLocaleTimeString()}`
            : 'Not yet refreshed'}
        </p>
      </div>
      {header.message && (
        <p className={`mt-2 text-[12px] ${header.state === 'error' ? 'text-red-400' : th.textFaint}`}>{header.message}</p>
      )}
    </header>
  );
}
