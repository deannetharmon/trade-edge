// components/__tests__/EntryWalk.test.tsx

import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { WalkCheckbox, WalkProgress } from '../EntryWalk';
import type { WalkLogEntry, WalkOutcome } from '@/lib/entry-walk/walk';

const log: WalkLogEntry[] = [
  { price: 1.37, state: 'no_fill' },
  { price: 1.36, state: 'no_fill' },
  { price: 1.34, state: 'waiting' },
];

describe('WalkCheckbox', () => {
  it('is off by default when the parent says so, and reports changes', () => {
    const onChange = vi.fn();
    render(<WalkCheckbox checked={false} onChange={onChange} />);
    const box = screen.getByRole('checkbox', { name: /walk the price/i }) as HTMLInputElement;
    expect(box.checked).toBe(false);
    fireEvent.click(box);
    expect(onChange).toHaveBeenCalledWith(true);
  });
});

describe('WalkProgress', () => {
  it('lists the prices in order inside a polite live region, with a Cancel button while working', () => {
    const onCancel = vi.fn();
    const { container } = render(<WalkProgress log={log} running outcome={null} onCancel={onCancel} />);
    const region = container.querySelector('[role="status"]') as HTMLElement;
    expect(region.getAttribute('aria-live')).toBe('polite');
    expect(region.textContent).toMatch(/Tried \$1\.37no fill.*Tried \$1\.36no fill.*Trying \$1\.34waiting/);
    const cancel = screen.getByRole('button', { name: 'Cancel' });
    expect(cancel.className).toContain('min-h-[44px]');
    fireEvent.click(cancel);
    expect(onCancel).toHaveBeenCalled();
  });

  it('shows the filled row and one closing line, and no Cancel once it has ended', () => {
    const done: WalkLogEntry[] = [...log.slice(0, 2), { price: 1.34, state: 'filled' }];
    const outcome: WalkOutcome = { kind: 'filled', price: 1.34, orderId: 'o3' };
    render(<WalkProgress log={done} running={false} outcome={outcome} onCancel={() => {}} />);
    expect(screen.getByText('Filled')).toBeTruthy();
    expect(screen.getByText('Filled at $1.34.')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Cancel' })).toBeNull();
  });

  it('says plainly when a stop leaves the order working', () => {
    const outcome: WalkOutcome = { kind: 'stopped', reason: 'stale_quote', orderLive: true, price: 1.37, orderId: 'o1', message: 'The quote went stale. Nothing was resubmitted.' };
    render(<WalkProgress log={[{ price: 1.37, state: 'stopped' }]} running={false} outcome={outcome} onCancel={() => {}} />);
    expect(screen.getByText(/Nothing was resubmitted\. The order stays working at \$1\.37\./)).toBeTruthy();
  });

  it('renders nothing before a walk starts', () => {
    const { container } = render(<WalkProgress log={[]} running={false} outcome={null} onCancel={() => {}} />);
    expect(container.firstChild).toBeNull();
  });
});
