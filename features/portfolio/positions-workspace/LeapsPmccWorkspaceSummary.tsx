'use client';

import type { THEMES, Theme } from '@/lib/theme';
import type { PositionsWorkspaceModel } from './model/types';

const money = (value: number | null | undefined) => value == null || !Number.isFinite(value)
  ? 'Unavailable'
  : new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(value);

const pct = (value: number | null | undefined) => value == null || !Number.isFinite(value)
  ? 'Unavailable'
  : `${value >= 0 ? '+' : ''}${value.toFixed(1)}%`;

function statusLabel(status: string, activeShorts: number): string {
  if (status === 'RECONCILIATION_REQUIRED') return 'Reconciliation required';
  if (status === 'RELATIONSHIP_UNRESOLVED') return 'Relationship unresolved';
  if (status === 'PMCC_ROLL_IN_PROGRESS') return 'PMCC roll in progress';
  if (status === 'CAMPAIGN_CLOSED') return 'Campaign closed';
  if (activeShorts > 0 || status === 'ACTIVE_PMCC') return `${activeShorts} short call${activeShorts === 1 ? '' : 's'} active`;
  return 'Available for PMCC';
}

export function LeapsPmccWorkspaceSummary({ model, th, campaignLoadUnavailableReason }: {
  model: PositionsWorkspaceModel;
  th: typeof THEMES[Theme];
  campaignLoadUnavailableReason?: string | null;
}) {
  const leaps = model.symbolGroups.flatMap(group => group.optionInstruments
    .filter(instrument => instrument.leapsEconomics != null)
    .map(instrument => ({ group, instrument })));

  if (leaps.length === 0 && !campaignLoadUnavailableReason) return null;

  return <section aria-label="LEAPS and PMCC intelligence" className={`mb-4 rounded-xl border ${th.border} p-4`}>
    <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
      <div>
        <h2 className="text-sm font-bold text-white">LEAPS Position Intelligence</h2>
        <p className={`mt-1 text-[10px] ${th.textFaint}`}>Standalone LEAPS economics first; PMCC income strategy shown separately.</p>
      </div>
      <span className={`text-[10px] ${th.textFaint}`}>{leaps.length} LEAPS position{leaps.length === 1 ? '' : 's'}</span>
    </div>

    {campaignLoadUnavailableReason && <div role="alert" className="mb-3 rounded border border-amber-500/40 bg-amber-500/10 p-3 text-xs text-amber-200">
      PMCC campaign state unavailable — {campaignLoadUnavailableReason}. PMCC-dependent actions must fail closed until relationship state can be verified.
    </div>}

    <div className="grid gap-3 xl:grid-cols-2">
      {leaps.map(({ group, instrument }) => {
        const e = instrument.leapsEconomics!;
        const c = instrument.pmccCampaign;
        const activeShortQty = c?.activeShortCalls.reduce((sum, call) => sum + (call.liveQuantity ?? call.allocatedQuantity), 0) ?? 0;
        const position = instrument.position;
        return <article key={instrument.key} className={`rounded-lg border ${th.border} p-4 text-xs`}>
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div>
              <b className="font-mono text-sm text-white">{group.symbol} · {position.legs[0]?.strikePrice}{position.legs[0]?.optionType} · {position.expDate}</b>
              <p className={`mt-1 ${th.textFaint}`}>{position.quantity} contract{position.quantity === 1 ? '' : 's'} · {position.dte} DTE · Δ {position.netDelta == null ? '—' : position.netDelta.toFixed(2)} · IV {position.iv == null ? '—' : `${position.iv.toFixed(1)}%`}</p>
            </div>
            <span className={`rounded px-2 py-1 text-[10px] font-semibold ${c?.relationshipVerified === false ? 'bg-amber-500/15 text-amber-300' : activeShortQty > 0 ? 'bg-blue-500/15 text-blue-300' : 'bg-emerald-500/15 text-emerald-300'}`}>
              {c ? statusLabel(c.status, activeShortQty) : 'Available for PMCC'}
            </span>
          </div>

          <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3">
            <div><p className={th.textFaint}>Original Cost</p><p className="font-mono text-white">{money(e.originalCost)}</p></div>
            <div><p className={th.textFaint}>Estimated Sell-Now Value</p><p className="font-mono font-semibold text-white">{money(e.estimatedSellNowValue)}</p></div>
            <div><p className={th.textFaint}>Profit If Closed Now</p><p className={`font-mono font-semibold ${e.profitIfClosedNow == null ? th.textFaint : e.profitIfClosedNow >= 0 ? 'text-emerald-300' : 'text-red-300'}`}>{money(e.profitIfClosedNow)}</p></div>
            <div><p className={th.textFaint}>Return If Closed Now</p><p className={`font-mono ${e.returnIfClosedNowPct == null ? th.textFaint : e.returnIfClosedNowPct >= 0 ? 'text-emerald-300' : 'text-red-300'}`}>{pct(e.returnIfClosedNowPct)}</p></div>
            <div><p className={th.textFaint}>Estimated Value Now — Mid</p><p className="font-mono text-white">{money(e.estimatedValueNowMid)}</p></div>
            <div><p className={th.textFaint}>Slippage vs Mid</p><p className="font-mono text-white">{money(e.slippageVsMid)}</p></div>
            <div><p className={th.textFaint}>Intrinsic Value</p><p className="font-mono text-white">{money(e.intrinsicValueMid)}</p></div>
            <div><p className={th.textFaint}>Extrinsic Value</p><p className="font-mono text-white">{money(e.extrinsicValueMid)}</p></div>
            <div><p className={th.textFaint}>Moneyness</p><p className="font-mono text-white">{pct(e.moneynessPct)}</p></div>
          </div>

          {c && <div className={`mt-4 border-t ${th.border} pt-3`}>
            <div className="flex items-center justify-between gap-2"><b className="text-white">PMCC Income Strategy</b><span className={`text-[10px] ${c.relationshipVerified ? 'text-emerald-300' : 'text-amber-300'}`}>{c.relationshipVerified ? 'Verified relationship' : 'Verification required'}</span></div>
            {c.blockingReason && <p className="mt-1 text-amber-300">{c.blockingReason}</p>}
            <div className="mt-2 grid grid-cols-2 gap-3 sm:grid-cols-4">
              <div><p className={th.textFaint}>Current Short-Call P/L</p><p className="font-mono text-white">{money(c.currentPmccExposurePnl)}</p></div>
              <div><p className={th.textFaint}>Net Profit If Fully Exited Now</p><p className="font-mono font-semibold text-white">{money(c.netProfitIfFullyExitedNow)}</p></div>
              <div><p className={th.textFaint}>PMCC Income Earned</p><p className="font-mono text-white">{money(c.realizedPmccIncome)}</p></div>
              <div><p className={th.textFaint}>Lifetime Strategy P/L</p><p className="font-mono text-white">{money(c.lifetimeStrategyPnl)}</p></div>
            </div>
            <p className={`mt-2 text-[10px] ${th.textFaint}`}>{c.allocatedShortQuantity} allocated short contract{c.allocatedShortQuantity === 1 ? '' : 's'} · {c.unencumberedLongQuantity ?? '—'} unencumbered LEAPS contract{c.unencumberedLongQuantity === 1 ? '' : 's'}</p>
          </div>}

          {!e.complete && e.reasons.length > 0 && <p className="mt-3 text-[10px] text-amber-300">Unavailable evidence: {e.reasons.join(' · ')}</p>}
        </article>;
      })}
    </div>
  </section>;
}
