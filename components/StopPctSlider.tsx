// components/StopPctSlider.tsx

'use client';

import React from 'react';

// STOP-SLIDER-0001: shared slider for choosing a stop percentage. The caller
// owns the meaning of the number (percent of credit vs. maximum loss percent)
// and passes a plain-language `description` that is always visible, so the
// trader can see exactly what the current position of the slider means.
interface StopPctSliderProps {
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (value: number) => void;
  description: string;
  ariaLabel: string;
  accent: 'teal' | 'orange';
  minLabel?: string;
  maxLabel?: string;
  /** Set when the value is outside [min, max]: greys the thumb and says so instead of pretending. */
  customLabel?: string;
}

export function StopPctSlider({ value, min, max, step, onChange, description, ariaLabel, accent, minLabel, maxLabel, customLabel }: StopPctSliderProps) {
  const thumbValue = Math.min(Math.max(Number.isFinite(value) ? value : min, min), max);
  const accentText = accent === 'teal' ? 'text-teal-300' : 'text-orange-300';
  const accentColor = accent === 'teal' ? '#2dd4bf' : '#fb923c';
  return (
    <div className="w-full">
      <input
        type="range"
        aria-label={ariaLabel}
        min={min}
        max={max}
        step={step}
        value={thumbValue}
        onChange={e => onChange(Number(e.target.value))}
        className={`w-full cursor-pointer ${customLabel ? 'opacity-40' : ''}`}
        style={{ accentColor }}
      />
      <div className="flex justify-between text-[9px] text-slate-500">
        <span>{minLabel ?? `${min}%`}</span>
        <span>{maxLabel ?? `${max}%`}</span>
      </div>
      {customLabel && <p className="mt-0.5 text-[10px] font-semibold text-amber-300">{customLabel}</p>}
      <p className={`mt-0.5 text-[10px] font-bold ${accentText}`}>{description}</p>
    </div>
  );
}
