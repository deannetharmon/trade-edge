import React from 'react';
import { OptionsTelemetryProps } from '@/types/options';
import { getMetricVerdict, VERDICT_COLOR_CLASS } from '@/lib/dashboard/metricDirectionRules';
// TELEMETRY-METRIC-DIRECTION-0001: lucide-react was never an actual
// dependency of this project (not in package.json), which broke the
// build. Replaced with the plain unicode warning glyph already used
// consistently elsewhere in this app (app/portfolio/page.tsx) rather
// than add a new dependency for two icons.

export const OptionsTelemetryCard: React.FC<OptionsTelemetryProps> = (data) => {
  const {
    strategy,
    symbol,
    plStart,
    plNow,
    deltaStart,
    deltaNow,
    thetaStart,
    thetaNow,
    gammaStart,
    gammaNow,
    vegaStart,
    vegaNow,
    ivStart,
    ivNow,
    ivrStart,
    ivrNow,
    shortLeg,
  } = data;

  const formatCurrency = (val: number) => {
    const formatted = Math.abs(val).toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
    return val < 0 ? `-${formatted}` : `$${val}`;
  };

  const formatGreek = (val: number, decimals: number = 2) => val.toFixed(decimals);
  const formatGamma = (val: number) => val.toFixed(3);

  const isGammaHigh = gammaNow > 0.05;
  const isThetaExtreme = Math.abs(thetaNow) > 0.50;

  // TELEMETRY-METRIC-DIRECTION-0001: real verdicts, from the one shared
  // rules function -- only for the three metrics with a genuine
  // universal rule. Delta (main row), Vega, and IV/IVR are deliberately
  // NOT run through this -- they stay neutral, confirmed final with
  // Dean, not a placeholder.
  const plVerdict = getMetricVerdict('plNow', plStart, plNow);
  const thetaVerdict = getMetricVerdict('thetaNow', thetaStart, thetaNow);
  const gammaVerdict = getMetricVerdict('gammaNow', gammaStart, gammaNow);

  // Bigger, bolder arrow glyph (Dean's original legibility complaint) --
  // color driven by the verdict, not a separate hand-picked color per
  // cell. Magnitude-based amber warnings (isThetaExtreme, isGammaHigh)
  // are a different, pre-existing concern and stay untouched -- they
  // flag "this number is unusually large," not "this got better or
  // worse," and both signals can be true independently.
  const VerdictArrow = ({ verdict }: { verdict: ReturnType<typeof getMetricVerdict> }) => (
    <span className={`${VERDICT_COLOR_CLASS[verdict]} text-sm leading-none`} aria-hidden="true">
      {verdict === 'improving' ? '▲' : verdict === 'worsening' ? '▼' : '—'}
    </span>
  );

  return (
    <div className="w-full max-w-sm rounded-xl bg-slate-950 border border-slate-800 p-4 font-mono text-slate-100 shadow-lg">
      {/* Header */}
      <div className="flex items-center justify-between pb-3 border-b border-slate-800 mb-3">
        <span className="font-bold text-xs tracking-wider uppercase bg-slate-800 text-slate-200 px-2 py-0.5 rounded">
          {strategy.replace('_', ' ')} • {symbol}
        </span>
        <div className="text-[10px] text-slate-400 flex items-center gap-1">
          <span>first</span>
          <span>→</span>
          <span className="text-sky-400 font-semibold">now</span>
        </div>
      </div>

      {/* Telemetry Grid */}
      <div className="space-y-1 text-xs">
        {/* P/L Row */}
        <div className="grid grid-cols-3 py-0.5 items-center">
          <span className="text-slate-400">P/L</span>
          <span className="text-slate-200 text-right">{formatCurrency(plStart)}</span>
          <span className={`text-right font-bold flex items-center justify-end gap-1 ${VERDICT_COLOR_CLASS[plVerdict]}`}>
            <VerdictArrow verdict={plVerdict} />
            {formatCurrency(plNow)}
          </span>
        </div>

        {/* Delta Row */}
        <div className="grid grid-cols-3 py-0.5 items-center">
          <span className="text-slate-400">Delta (Δ)</span>
          <span className="text-slate-200 text-right">{formatGreek(deltaStart)}</span>
          <span className="text-sky-400 font-semibold text-right">{formatGreek(deltaNow)}</span>
        </div>

        {/* Theta Row */}
        <div className="grid grid-cols-3 py-0.5 items-center">
          <span className="text-slate-400">Theta (θ)</span>
          <span className="text-slate-200 text-right">{formatGreek(thetaStart)}</span>
          <span className={`text-right font-semibold flex items-center justify-end gap-1 ${isThetaExtreme ? 'text-amber-400' : VERDICT_COLOR_CLASS[thetaVerdict]}`}>
            <VerdictArrow verdict={thetaVerdict} />
            {formatGreek(thetaNow)}
          </span>
        </div>

        {/* Gamma Row */}
        <div className="grid grid-cols-3 py-0.5 items-center">
          <span className="text-slate-400">Gamma (Γ)</span>
          <span className="text-slate-200 text-right">{formatGamma(gammaStart)}</span>
          <span className={`text-right font-semibold flex items-center justify-end gap-1 ${isGammaHigh ? 'text-rose-400 animate-pulse' : VERDICT_COLOR_CLASS[gammaVerdict]}`}>
            <VerdictArrow verdict={gammaVerdict} />
            {formatGamma(gammaNow)}
          </span>
        </div>

        {/* Vega Row */}
        <div className="grid grid-cols-3 py-0.5 items-center">
          <span className="text-slate-400">Vega (V)</span>
          <span className="text-slate-200 text-right">{formatGreek(vegaStart)}</span>
          <span className="text-sky-400 font-semibold text-right">{formatGreek(vegaNow)}</span>
        </div>

        <div className="border-t border-slate-800/80 my-2 pt-1.5" />

        {/* IV Row */}
        <div className="grid grid-cols-3 py-0.5 items-center">
          <span className="text-slate-400">IV</span>
          <span className="text-slate-200 text-right">{ivStart}%</span>
          <span className="text-sky-400 font-semibold text-right">{ivNow}%</span>
        </div>

        {/* IVR Row + Visual Meter */}
        <div className="grid grid-cols-3 py-0.5 items-center">
          <span className="text-slate-400">IVR</span>
          <div className="flex items-center justify-end">
            <div className="w-10 h-1.5 bg-slate-800 rounded-full overflow-hidden mr-1.5">
              <div className="h-full bg-slate-400" style={{ width: `${Math.min(100, Math.max(0, ivrStart))}%` }} />
            </div>
            <span className="text-slate-200">{ivrStart}</span>
          </div>
          <div className="flex items-center justify-end">
            <div className="w-10 h-1.5 bg-slate-800 rounded-full overflow-hidden mr-1.5">
              <div className="h-full bg-sky-400" style={{ width: `${Math.min(100, Math.max(0, ivrNow))}%` }} />
            </div>
            <span className="text-sky-400 font-semibold">{ivrNow}</span>
          </div>
        </div>
      </div>

      {/* Short Leg Risk Callout */}
      {shortLeg && (
        <div className="mt-3 pt-2 border-t border-slate-800 space-y-1.5">
          <div className="flex items-center justify-between text-xs">
            <span className="text-slate-300 font-medium">
              Short {shortLeg.strike}{shortLeg.optionType} ({shortLeg.dte}d)
            </span>
            <span className={`font-semibold ${shortLeg.deltaNow >= 0.50 ? 'text-rose-400' : shortLeg.deltaNow >= 0.40 ? 'text-amber-400' : 'text-sky-400'}`}>
              Δ {formatGreek(shortLeg.deltaStart)} → {formatGreek(shortLeg.deltaNow)}
            </span>
          </div>

          {shortLeg.deltaNow >= 0.50 ? (
            <div className="flex items-center gap-1.5 text-[11px] bg-rose-950/60 border border-rose-800/80 text-rose-300 p-2 rounded-md">
              <span className="text-rose-400 shrink-0" aria-hidden="true">⛔</span>
              <span>CRITICAL: Short leg ITM / Delta breached 0.50 cap.</span>
            </div>
          ) : shortLeg.deltaNow >= 0.40 ? (
            <div className="flex items-center gap-1.5 text-[11px] bg-amber-950/60 border border-amber-800/80 text-amber-300 p-2 rounded-md">
              <span className="text-amber-400 shrink-0" aria-hidden="true">⚠</span>
              <span>WARNING: Short delta entering roll boundary (0.40+).</span>
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
};
