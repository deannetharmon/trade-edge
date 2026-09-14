import React from 'react';
import { OptionsTelemetryProps } from '@/types/options';

// Vector Arrow Helper
const getTrendArrow = (start: number, now: number): string => {
  if (now > start) return '↗';
  if (now < start) return '↘';
  return '→';
};

// Integer Volatility Formatter
const toWhole = (val: number): number => Math.round(val);

// IVR Visual Bar Renderer (10-block scale)
const renderIvrBar = (ivr: number): string => {
  const filled = Math.min(10, Math.max(0, Math.round(ivr / 10)));
  return `[${'█'.repeat(filled)}${'░'.repeat(10 - filled)}]`;
};

export const OptionsTelemetryCard: React.FC<OptionsTelemetryProps> = ({
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
}) => {
  // P/L Color Logic
  const plColor = plNow >= 0 ? 'text-emerald-400 font-bold' : 'text-rose-500 font-bold';

  // Short-leg Delta Risk Logic (PMCC Roll Zone)
  const getShortDeltaStyle = (delta: number) => {
    if (delta >= 0.50) return 'text-rose-500 font-bold animate-pulse';
    if (delta >= 0.40) return 'text-amber-400 font-bold';
    return 'text-emerald-400 font-semibold';
  };

  return (
    <div className="w-72 bg-slate-950 border border-slate-800 rounded-lg p-3 font-mono text-xs text-slate-200 shadow-xl select-none">
      {/* Card Header */}
      <div className="flex items-center justify-between border-b border-slate-800 pb-1.5 mb-2">
        <span className="font-sans font-bold text-slate-300 tracking-wide uppercase text-[11px]">
          {strategy.replace('_', ' ')} • {symbol}
        </span>
        <span className="text-[10px] text-slate-500 font-mono">first → now</span>
      </div>

      {/* Primary Metrics Grid */}
      <div className="space-y-1">
        {/* P/L Row */}
        <div className="flex justify-between items-center py-0.5">
          <span className="text-slate-400 font-semibold">P/L</span>
          <span className="font-mono">
            ${plStart} <span className="text-slate-600">{getTrendArrow(plStart, plNow)}</span>{' '}
            <span className={plColor}>${plNow}</span>
          </span>
        </div>

        {/* Delta Row */}
        <div className="flex justify-between items-center py-0.5">
          <span className="text-slate-400 font-semibold">Delta (Δ)</span>
          <span className="font-mono text-slate-300">
            {deltaStart.toFixed(2)} <span className="text-slate-600">{getTrendArrow(deltaStart, deltaNow)}</span>{' '}
            <span className="text-sky-400 font-semibold">{deltaNow.toFixed(2)}</span>
          </span>
        </div>

        {/* Theta Row */}
        <div className="flex justify-between items-center py-0.5">
          <span className="text-slate-400 font-semibold">Theta (Θ)</span>
          <span className="font-mono text-slate-300">
            {thetaStart.toFixed(2)} <span className="text-slate-600">{getTrendArrow(thetaStart, thetaNow)}</span>{' '}
            <span className="text-sky-400 font-semibold">{thetaNow.toFixed(2)}</span>
          </span>
        </div>

        {/* Gamma Row */}
        <div className="flex justify-between items-center py-0.5">
          <span className="text-slate-400 font-semibold">Gamma (Γ)</span>
          <span className="font-mono text-slate-300">
            {gammaStart.toFixed(3)} <span className="text-slate-600">{getTrendArrow(gammaStart, gammaNow)}</span>{' '}
            <span className="text-slate-200">{gammaNow.toFixed(3)}</span>
          </span>
        </div>

        {/* Vega Row */}
        <div className="flex justify-between items-center py-0.5">
          <span className="text-slate-400 font-semibold">Vega (V)</span>
          <span className="font-mono text-slate-300">
            {vegaStart.toFixed(2)} <span className="text-slate-600">{getTrendArrow(vegaStart, vegaNow)}</span>{' '}
            <span className="text-slate-200">{vegaNow.toFixed(2)}</span>
          </span>
        </div>
      </div>

      {/* Volatility Footer */}
      <div className="mt-2.5 pt-2 border-t border-slate-800 space-y-1 text-slate-400 text-[11px]">
        <div className="flex justify-between items-center">
          <span>IV</span>
          <span className="font-mono text-slate-200">
            {toWhole(ivStart)}% <span className="text-slate-600">{getTrendArrow(ivStart, ivNow)}</span>{' '}
            <span className="font-semibold text-sky-400">{toWhole(ivNow)}%</span>
          </span>
        </div>
        <div className="flex justify-between items-center">
          <span className="flex items-center gap-1">
            IVR <span className="text-[9px] text-slate-600 font-mono">{renderIvrBar(ivrNow)}</span>
          </span>
          <span className="font-mono text-slate-200">
            {toWhole(ivrStart)} <span className="text-slate-600">{getTrendArrow(ivrStart, ivrNow)}</span>{' '}
            <span className="font-semibold text-sky-400">{toWhole(ivrNow)}</span>
          </span>
        </div>
      </div>

      {/* PMCC Short-Leg Risk Bar */}
      {strategy === 'PMCC' && shortLeg && (
        <div className="mt-2.5 p-2 bg-slate-900 border border-slate-800 rounded text-[11px] space-y-1">
          <div className="flex justify-between items-center text-slate-300">
            <span className="font-semibold">
              Short {shortLeg.strike}{shortLeg.optionType} ({shortLeg.dte}d)
            </span>
            <span className={getShortDeltaStyle(shortLeg.deltaNow)}>
              Δ {shortLeg.deltaStart.toFixed(2)} {getTrendArrow(shortLeg.deltaStart, shortLeg.deltaNow)} {shortLeg.deltaNow.toFixed(2)}
            </span>
          </div>

          {/* Dynamic Action Trigger Warnings */}
          {shortLeg.deltaNow >= 0.50 ? (
            <div className="text-rose-400 font-sans text-[10px] font-semibold flex items-center gap-1">
              <span>🚨</span> CRITICAL: Short leg ITM / Delta breached 0.50 cap.
            </div>
          ) : shortLeg.deltaNow >= 0.40 ? (
            <div className="text-amber-400 font-sans text-[10px] font-semibold flex items-center gap-1">
              <span>⚠️</span> WARNING: Short delta entering roll boundary (0.40+).
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
};
