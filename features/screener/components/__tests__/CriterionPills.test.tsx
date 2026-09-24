import React, { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { CriterionPills } from '../scanConfig/CriterionPills';
import { LifecycleTag } from '../scanConfig/LifecycleTag';
import type { ScanModalTheme } from '../ScanModalShell';

const th: ScanModalTheme = {
  bg: 'bg-[#0a0a0a]', card: 'bg-[#171717]', border: 'border-[#2c2c2c]', text: 'text-white',
  textMuted: 'text-[#e0e0e0]', textFaint: 'text-[#808080]', input: 'bg-[#141414]', inputBorder: 'border-[#353535]',
};

describe('CriterionPills', () => {
  it('renders a labelled group of buttons whose pressed state is exposed with aria-pressed', () => {
    render(<CriterionPills th={th} groupLabel="OI quick select" pills={[
      { key: '100', label: '100', pressed: false, onSelect: vi.fn() },
      { key: '500', label: '500', pressed: true, onSelect: vi.fn() },
    ]} />);
    const group = screen.getByRole('group', { name: 'OI quick select' });
    expect(within(group).getByRole('button', { name: '100' })).toHaveAttribute('aria-pressed', 'false');
    expect(within(group).getByRole('button', { name: '500' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('pills are buttons, never radios', () => {
    render(<CriterionPills th={th} groupLabel="g" pills={[{ key: 'a', label: 'A', pressed: true, onSelect: vi.fn() }]} />);
    expect(screen.queryAllByRole('radio')).toHaveLength(0);
  });

  it('calls only the clicked pill', async () => {
    const a = vi.fn(); const b = vi.fn();
    render(<CriterionPills th={th} groupLabel="g" pills={[
      { key: 'a', label: 'A', pressed: false, onSelect: a }, { key: 'b', label: 'B', pressed: false, onSelect: b },
    ]} />);
    await userEvent.click(screen.getByRole('button', { name: 'B' }));
    expect(b).toHaveBeenCalledTimes(1);
    expect(a).not.toHaveBeenCalled();
  });

  it('is reachable and operable from the keyboard', async () => {
    const onSelect = vi.fn();
    render(<CriterionPills th={th} groupLabel="g" pills={[{ key: 'a', label: 'A', pressed: false, onSelect }]} />);
    await userEvent.tab();
    expect(screen.getByRole('button', { name: 'A' })).toHaveFocus();
    await userEvent.keyboard('{Enter}');
    expect(onSelect).toHaveBeenCalledTimes(1);
  });

  it('draws the explicit off state dashed, so it never reads as disabled', () => {
    render(<CriterionPills th={th} groupLabel="g" pills={[{ key: 'any', label: 'Any', pressed: true, off: true, onSelect: vi.fn() }]} />);
    const pill = screen.getByRole('button', { name: 'Any' });
    expect(pill).toBeEnabled();
    expect(pill.className).toContain('border-dashed');
  });

  it('renders nothing when a criterion has no quick selects', () => {
    const { container } = render(<CriterionPills th={th} groupLabel="g" pills={[]} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('a click in one group never changes the selection of another', async () => {
    function TwoGroups() {
      const [pop, setPop] = useState<number | null>(null);
      const [otm, setOtm] = useState<number | null>(8);
      return (
        <>
          <CriterionPills th={th} groupLabel="POP quick select" pills={[
            { key: 'any', label: 'POP Any', pressed: pop == null, off: true, onSelect: () => setPop(null) },
            { key: '70', label: 'POP 70%', pressed: pop === 70, onSelect: () => setPop(70) },
          ]} />
          <CriterionPills th={th} groupLabel="OTM quick select" pills={[
            { key: 'any', label: 'OTM Any', pressed: otm == null, off: true, onSelect: () => setOtm(null) },
            { key: '8', label: 'OTM 8%', pressed: otm === 8, onSelect: () => setOtm(8) },
          ]} />
        </>
      );
    }
    render(<TwoGroups />);
    await userEvent.click(screen.getByRole('button', { name: 'POP 70%' }));
    expect(screen.getByRole('button', { name: 'POP 70%' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'POP Any' })).toHaveAttribute('aria-pressed', 'false');
    // The OTM group is untouched.
    expect(screen.getByRole('button', { name: 'OTM 8%' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'OTM Any' })).toHaveAttribute('aria-pressed', 'false');
  });
});

describe('LifecycleTag', () => {
  it('says what the engine does in words, not color alone', () => {
    const { rerender } = render(<LifecycleTag lifecycle="fetch" rescan />);
    expect(screen.getByText('SEARCH RANGE · RESCAN')).toBeInTheDocument();
    rerender(<LifecycleTag lifecycle="rank" />);
    expect(screen.getByText('PREFERENCE')).toBeInTheDocument();
    rerender(<LifecycleTag lifecycle="gate" fixed />);
    expect(screen.getByText('GATE · FIXED')).toBeInTheDocument();
    rerender(<LifecycleTag lifecycle="advisory" />);
    expect(screen.getByText('ADVISORY')).toBeInTheDocument();
    rerender(<LifecycleTag lifecycle="result-filter" fixed />);
    expect(screen.getByText('RESULT FILTER')).toBeInTheDocument();
  });
});
