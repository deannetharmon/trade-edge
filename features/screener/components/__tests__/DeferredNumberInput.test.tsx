// features/screener/components/__tests__/DeferredNumberInput.test.tsx
// Typing a decimal into a scan-rule box must not lose characters, with or without a leading zero.

import React, { useState } from 'react';
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DeferredNumberInput } from '../DeferredNumberInput';

function Harness({ start, seen }: { start: number; seen: number[] }) {
  const [value, setValue] = useState(start);
  return <DeferredNumberInput aria-label="delta" value={value} onValueChange={v => { seen.push(v); setValue(v); }} />;
}

async function typeInto(start: number, keys: string) {
  const seen: number[] = [];
  render(<Harness start={start} seen={seen} />);
  const input = screen.getByLabelText('delta') as HTMLInputElement;
  await userEvent.clear(input);
  await userEvent.type(input, keys);
  return { input, seen };
}

describe('DeferredNumberInput typing', () => {
  it('accepts a leading-dot decimal: .05', async () => {
    const { input, seen } = await typeInto(0.1, '.05');
    expect(input.value).toBe('.05');
    expect(seen[seen.length - 1]).toBe(0.05);
  });
  it('accepts a leading-zero decimal: 0.05', async () => {
    const { input, seen } = await typeInto(0.1, '0.05');
    expect(input.value).toBe('0.05');
    expect(seen[seen.length - 1]).toBe(0.05);
  });
  it('keeps a trailing zero while typing: 0.60', async () => {
    const { input, seen } = await typeInto(0.5, '0.60');
    expect(input.value).toBe('0.60');
    expect(seen[seen.length - 1]).toBe(0.6);
  });
  it('accepts whole numbers and a lone 0', async () => {
    const a = await typeInto(7, '14');
    expect(a.input.value).toBe('14');
    expect(a.seen[a.seen.length - 1]).toBe(14);
  });
  it('shows an externally changed value (a quick-select pill)', () => {
    const { rerender } = render(<DeferredNumberInput aria-label="d" value={0.1} onValueChange={() => {}} />);
    rerender(<DeferredNumberInput aria-label="d" value={0.35} onValueChange={() => {}} />);
    expect((screen.getByLabelText('d') as HTMLInputElement).value).toBe('0.35');
  });
});
