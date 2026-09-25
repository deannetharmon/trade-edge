// features/screener/components/__tests__/OrderOverrideAcknowledgment.test.tsx

import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { OrderOverrideAcknowledgment, qualificationGateBlocking, reasonText } from '../OrderOverrideAcknowledgment';
import { deriveQualificationState, RANKED_SPREAD_GATE_KEYS } from '@/lib/scans/qualificationState';
import type { CheckResult } from '@/lib/scans/types';

const ck = (status: CheckResult['status'], value = 'v', reason = 'r'): CheckResult => ({ status, value, reason });
const pass = { ivr: ck('pass'), earnings: ck('pass'), oi: ck('pass'), roc: ck('pass') };

describe('order-window acknowledgment', () => {
  it('renders nothing for a Qualified trade', () => {
    const d = deriveQualificationState(pass, RANKED_SPREAD_GATE_KEYS);
    const { container } = render(<OrderOverrideAcknowledgment derivation={d} checks={pass} acknowledged={false} onChange={() => {}} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('a Disqualified trade lists every failure and warning with its numbers, and starts unchecked', () => {
    const checks = { ...pass, earnings: ck('fail', '34d', 'Earnings 6d after expiry, inside the 10-day buffer'), ivr: ck('fail', '3.7%', 'Below 30% minimum'), oi: ck('warn', '208/371', 'below the 500 target') };
    const d = deriveQualificationState(checks, RANKED_SPREAD_GATE_KEYS);
    render(<OrderOverrideAcknowledgment derivation={d} checks={checks} acknowledged={false} onChange={() => {}} />);
    const box = screen.getByTestId('order-override-ack');
    expect(box).toHaveAttribute('data-state', 'disqualified');
    expect(box).toHaveTextContent('THIS TRADE OVERRIDES THE SCAN RULES');
    expect(box).toHaveTextContent('IVR 3.7% below the floor: Below 30% minimum');
    expect(box).toHaveTextContent('earnings inside the 10-day buffer: Earnings 6d after expiry, inside the 10-day buffer');
    expect(box).toHaveTextContent('low OI 208/371: below the 500 target');
    expect(screen.getByRole('checkbox')).not.toBeChecked();
  });

  it('a Caution trade lists only its warnings and uses the softer heading', () => {
    const checks = { ...pass, oi: ck('warn', '208/371', 'below the 500 target') };
    const d = deriveQualificationState(checks, RANKED_SPREAD_GATE_KEYS);
    render(<OrderOverrideAcknowledgment derivation={d} checks={checks} acknowledged={false} onChange={() => {}} />);
    const box = screen.getByTestId('order-override-ack');
    expect(box).toHaveAttribute('data-state', 'caution');
    expect(box).toHaveTextContent('THIS TRADE HAS WARNINGS');
    expect(box).not.toHaveTextContent('✕');
  });

  it('reports the checkbox change so the order buttons can unlock', () => {
    const checks = { ...pass, ivr: ck('fail', '3.7%', 'x') };
    const d = deriveQualificationState(checks, RANKED_SPREAD_GATE_KEYS);
    const onChange = vi.fn();
    render(<OrderOverrideAcknowledgment derivation={d} checks={checks} acknowledged={false} onChange={onChange} />);
    fireEvent.click(screen.getByLabelText(/I understand and want to place this order anyway/));
    expect(onChange).toHaveBeenCalledWith(true);
  });

  it('reasonText combines the gate description with the check\'s own explanation', () => {
    expect(reasonText('oi', { oi: ck('warn', '208/371', 'below the 500 target') })).toBe('low OI 208/371: below the 500 target');
    expect(reasonText('roc', {})).toBe('roc unavailable');
  });

  it('the order stays locked until a non-Qualified trade is acknowledged; Qualified and no-verdict orders are never locked', () => {
    const q = deriveQualificationState(pass, RANKED_SPREAD_GATE_KEYS);
    const c = deriveQualificationState({ ...pass, oi: ck('warn') }, RANKED_SPREAD_GATE_KEYS);
    const d = deriveQualificationState({ ...pass, ivr: ck('fail') }, RANKED_SPREAD_GATE_KEYS);
    expect(qualificationGateBlocking(q, false)).toBe(false);
    expect(qualificationGateBlocking(c, false)).toBe(true);
    expect(qualificationGateBlocking(d, false)).toBe(true);
    expect(qualificationGateBlocking(c, true)).toBe(false);
    expect(qualificationGateBlocking(d, true)).toBe(false);
    expect(qualificationGateBlocking(null, false)).toBe(false);
    expect(qualificationGateBlocking(undefined, false)).toBe(false);
  });
});
