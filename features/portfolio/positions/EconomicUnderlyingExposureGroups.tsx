'use client';

import { THEMES, Theme } from '@/lib/theme';
import type { LeveragedPositionExposureGroup } from '@/lib/portfolio/leveragedPositionExposure';

function money(value: number | null): string {
  if (value == null || !Number.isFinite(value)) return 'Unavailable';
  const sign = value < 0 ? '-' : '';
  return `${sign}$${Math.abs(value).toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
}

export interface EconomicUnderlyingExposureGroupsProps {
  groups: LeveragedPositionExposureGroup[];
  th: typeof THEMES[Theme];
}

export function EconomicUnderlyingExposureGroups({ groups, th }: EconomicUnderlyingExposureGroupsProps) {
  if (groups.length === 0) return null;

  return (
    <section className="mb-6" aria-label="Economic Underlying Exposure">
      <div className="mb-2">
        <h2 className={`text-[12px] font-bold uppercase tracking-widest ${th.text}`}>Economic Underlying Exposure</h2>
        <p className={`mt-1 text-[10px] ${th.textFaint}`}>Related direct and issuer-validated leveraged positions are rolled up to the same economic underlying. Gross and net are shown separately; max capital loss is shown separately from exposure.</p>
      </div>
      <div className="space-y-2">
        {groups.map(group => (
          <div key={group.economicUnderlying} className={`rounded-xl border ${th.border} ${th.card} p-3 space-y-2`}>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className={`text-sm font-semibold ${th.text}`}>{group.economicUnderlying} Exposure Group</span>
              <span className={`text-[9px] font-bold ${group.normalizationAuthoritative ? th.textMuted : 'text-amber-400'}`}>
                {group.normalizationAuthoritative ? 'Normalization Complete' : 'Normalization Incomplete'}
              </span>
            </div>

            {group.normalizationAuthoritative ? (
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
                <div><p className={`text-[9px] ${th.textFaint}`}>Gross bullish</p><p className={`text-[11px] font-semibold ${th.text}`}>{money(group.grossBullishExposure)}</p></div>
                <div><p className={`text-[9px] ${th.textFaint}`}>Gross bearish</p><p className={`text-[11px] font-semibold ${th.text}`}>{money(group.grossBearishExposure)}</p></div>
                <div><p className={`text-[9px] ${th.textFaint}`}>Gross exposure</p><p className={`text-[11px] font-semibold ${th.text}`}>{money(group.grossExposure)}</p></div>
                <div><p className={`text-[9px] ${th.textFaint}`}>Net directional</p><p className={`text-[11px] font-semibold ${th.text}`}>{money(group.netDirectionalExposure)}</p></div>
                <div><p className={`text-[9px] ${th.textFaint}`}>Max capital loss</p><p className={`text-[11px] font-semibold ${th.text}`}>{money(group.maxCapitalLoss)}</p></div>
              </div>
            ) : (
              <p className="text-[10px] text-amber-400">Authoritative group totals are unavailable because at least one related position lacks required exposure or capital evidence.</p>
            )}

            <ul className="space-y-1">
              {group.members.map(member => (
                <li key={member.positionKey} className={`flex flex-wrap items-center justify-between gap-2 border-t ${th.borderLight} pt-1 text-[10px]`}>
                  <span className={th.textMuted}>
                    {member.symbol} · {member.strategy} · {member.leverageMultiplier === 1 ? 'Direct' : `${member.leverageMultiplier}×`}
                  </span>
                  <span className={th.textFaint}>
                    Effective {money(member.signedEffectiveExposure)} · Max loss {money(member.maxCapitalLoss)}
                    {!member.normalizationAuthoritative ? ' · Incomplete' : ''}
                  </span>
                </li>
              ))}
            </ul>

            <p className={`text-[9px] italic ${th.textFaint}`}>Effective exposure is first-order delta-based sensitivity. Leveraged-product mapping uses validated issuer leverage; it is not maximum loss and does not model multi-day reset/path effects.</p>
          </div>
        ))}
      </div>
    </section>
  );
}
