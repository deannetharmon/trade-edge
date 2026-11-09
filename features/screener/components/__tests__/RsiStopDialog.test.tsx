import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { useRsiGuard } from '../RsiStopDialog';

function Harness({ rsi, run }: { rsi: number | null; run: () => void }) {
  const g = useRsiGuard({ symbol: 'TQQQ', rsi, cutoff: 50 });
  return <div><button onClick={() => g.request(run)}>sell</button>{g.dialog}</div>;
}

describe('useRsiGuard', () => {
  it('runs straight away when RSI is at or above cutoff', () => {
    const run = vi.fn(); render(<Harness rsi={55} run={run} />);
    fireEvent.click(screen.getByText('sell'));
    expect(run).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId('rsi-stop')).toBeNull();
  });
  it('stops below cutoff, shows RSI and cutoff, Go back does not run', () => {
    const run = vi.fn(); render(<Harness rsi={42} run={run} />);
    fireEvent.click(screen.getByText('sell'));
    expect(run).not.toHaveBeenCalled();
    expect(screen.getByTestId('rsi-stop-rsi').textContent).toBe('42');
    expect(screen.getByTestId('rsi-stop-cutoff').textContent).toBe('50');
    fireEvent.click(screen.getByTestId('rsi-stop-back'));
    expect(run).not.toHaveBeenCalled();
    expect(screen.queryByTestId('rsi-stop')).toBeNull();
  });
  it('Sell anyway runs the original action once', () => {
    const run = vi.fn(); render(<Harness rsi={42} run={run} />);
    fireEvent.click(screen.getByText('sell'));
    fireEvent.click(screen.getByTestId('rsi-stop-anyway'));
    expect(run).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId('rsi-stop')).toBeNull();
  });
  it('stops when RSI is unreadable with the check-the-chart wording', () => {
    const run = vi.fn(); render(<Harness rsi={null} run={run} />);
    fireEvent.click(screen.getByText('sell'));
    expect(screen.getByTestId('rsi-stop-body').textContent).toContain('Check the chart yourself');
    expect(run).not.toHaveBeenCalled();
  });
  it('Escape goes back', () => {
    const run = vi.fn(); render(<Harness rsi={42} run={run} />);
    fireEvent.click(screen.getByText('sell'));
    fireEvent.keyDown(screen.getByTestId('rsi-stop-overlay'), { key: 'Escape' });
    expect(screen.queryByTestId('rsi-stop')).toBeNull();
    expect(run).not.toHaveBeenCalled();
  });
});
