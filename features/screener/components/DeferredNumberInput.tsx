'use client';

import { useEffect, useState } from 'react';

/** Keeps an in-progress decimal such as `.20` intact while a scan rule is edited. */
export function DeferredNumberInput({ value, onValueChange, className, step, min, max, 'aria-label': ariaLabel }: {
  value: number;
  onValueChange: (value: number) => void;
  className?: string;
  step?: string;
  min?: number;
  max?: number;
  'aria-label': string;
}) {
  const [text, setText] = useState(String(value));
  useEffect(() => setText(String(value)), [value]);
  const commit = (raw: string) => {
    if (raw === '' || raw === '.') { setText(String(value)); return; }
    const parsed = Number(raw);
    if (Number.isFinite(parsed)) onValueChange(parsed);
    else setText(String(value));
  };
  return <input aria-label={ariaLabel} type="text" inputMode="decimal" step={step} min={min} max={max}
    value={text}
    onChange={event => {
      const raw = event.target.value;
      if (!/^\d*\.?\d*$/.test(raw)) return;
      setText(raw);
      if (raw !== '' && raw !== '.') commit(raw);
    }}
    onBlur={event => commit(event.target.value)}
    onKeyDown={event => { if (event.key === 'Enter') event.currentTarget.blur(); }}
    className={className}
  />;
}
