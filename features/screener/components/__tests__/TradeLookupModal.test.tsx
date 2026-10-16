import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { TradeLookupModal } from '../TradeLookupModal';
import type { ScanModalTheme } from '../ScanModalShell';
import type { LookupDeps } from '@/lib/tradeLookup/loadLookup';

const th: ScanModalTheme = {
  bg: 'bg-[#0a0a0a]', card: 'bg-[#171717]', border: 'border-[#2c2c2c]',
  text: 'text-white', textMuted: 'text-[#e0e0e0]', textFaint: 'text-[#808080]',
  input: 'bg-[#141414]', inputBorder: 'border-[#353535]',
};

const raw = (strike: number, exp: string, over: Record<string, unknown> = {}) => ({
  strikePrice: strike, expirationDate: exp, optionType: 'P', bid: 5.4, ask: 5.6, delta: -0.2, openInterest: 800, iv: 63,
  occSymbol: 'SOXL  261106P00' + strike + '000', quoteUpdatedAt: '2026-10-15T20:00:00Z', ...over,
});

function makeDeps(over: Partial<LookupDeps> = {}): LookupDeps {
  return {
    getToken: async () => 'tok',
    getListedExpirations: async () => ['2026-10-23', '2026-11-06', '2026-11-13'],
    fetchChain: async (_s, _t, exp) => ({
      chains: { [exp]: [115, 117.5, 120, 122.5, 125].map((k) => raw(k, exp, k === 117.5 ? { bid: 0, ask: 0 } : {})) },
      classification: 'etf',
    }),
    getUnderlyingPrice: async () => 135,
    getCoverageReports: async () => ({ capacity: null, foundations: null }),
    today: () => ({ year: 2026, month: 10, day: 15 }),
    ...over,
  };
}

async function lookup(post: string, deps: LookupDeps = makeDeps(), onOrderCsp = vi.fn()) {
  render(<TradeLookupModal th={th} deps={deps} onClose={vi.fn()} onOrderCsp={onOrderCsp} />);
  await userEvent.click(screen.getByLabelText('Group post'));
  await userEvent.paste(post);
  await userEvent.click(screen.getByRole('button', { name: /LOOK UP/ }));
  return onOrderCsp;
}

describe('TradeLookupModal', () => {
  it('does nothing until the button is pressed, and the button is off when empty', () => {
    const deps = makeDeps({ getToken: vi.fn(async () => 'tok') });
    render(<TradeLookupModal th={th} deps={deps} onClose={vi.fn()} onOrderCsp={vi.fn()} />);
    expect(screen.getByRole('dialog', { name: 'TRADE LOOKUP' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /LOOK UP/ })).toBeDisabled();
    expect(deps.getToken).not.toHaveBeenCalled();
  });

  it('shows what it read, highlights the posted contract, and compares to the posted price', async () => {
    await lookup('NEW CSP SOXL 11/6 $120P @ $5.47');
    expect(await screen.findByTestId('trade-lookup-pick-row')).toHaveTextContent('120P');
    expect(screen.getByTestId('trade-lookup-pick-row')).toHaveTextContent('POSTED');
    expect(screen.getByTestId('trade-lookup-parsed')).toHaveTextContent('Cash-secured put · SOXL 120P');
    expect(screen.getByTestId('trade-lookup-posted')).toHaveTextContent('Posted $5.47');
    expect(screen.getByTestId('trade-lookup-posted')).toHaveTextContent('mid now $5.50');
    expect(screen.getAllByTestId('trade-lookup-row').length).toBeGreaterThanOrEqual(4);
  });

  it('a no-quote row says so and cannot be selected', async () => {
    await lookup('NEW CSP SOXL 11/6 $120P @ $5.47');
    await screen.findByTestId('trade-lookup-pick-row');
    const btn = screen.getByRole('button', { name: 'Select 117.5P 2026-11-06' });
    expect(btn).toBeDisabled();
    expect(screen.getByText('NO QUOTE')).toBeInTheDocument();
  });

  it('max risk is hidden in the table by default and shown in the Selected bar', async () => {
    await lookup('NEW CSP SOXL 11/6 $120P @ $5.47');
    await screen.findByTestId('trade-lookup-pick-row');
    expect(within(screen.getByTestId('trade-lookup-table')).queryByText('Max risk')).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Select 120P 2026-11-06' }));
    expect(screen.getByTestId('trade-lookup-selected')).toHaveTextContent(/max risk \$11,450/);
  });

  it('the Columns control can show max risk', async () => {
    await lookup('NEW CSP SOXL 11/6 $120P @ $5.47');
    await screen.findByTestId('trade-lookup-pick-row');
    await userEvent.click(screen.getByRole('button', { name: 'Columns' }));
    await userEvent.click(screen.getByRole('checkbox', { name: /Max risk/ }));
    expect(within(screen.getByTestId('trade-lookup-table')).getByText('Max risk')).toBeInTheDocument();
  });

  it('sends the chosen put to the order dialog', async () => {
    const onOrder = await lookup('NEW CSP SOXL 11/6 $120P @ $5.47');
    await screen.findByTestId('trade-lookup-pick-row');
    await userEvent.click(screen.getByRole('button', { name: 'Select 120P 2026-11-06' }));
    await userEvent.click(screen.getByRole('button', { name: /SEND TO ORDER/ }));
    expect(onOrder).toHaveBeenCalledTimes(1);
    const arg = onOrder.mock.calls[0][0];
    expect(arg.symbol).toBe('SOXL');
    expect(arg.bestCandidate.shortStrike).toBe(120);
    expect(arg.bestCandidate.cspMid).toBeCloseTo(5.5, 10);
  });

  it('covered calls are inspection-only with the coverage message', async () => {
    const deps = makeDeps({
      fetchChain: async (_s, _t, exp) => ({ chains: { [exp]: [15, 16, 17].map((k) => raw(k, exp, { optionType: 'C', delta: 0.25, bid: 0.38, ask: 0.4 })) }, classification: 'etf' }),
      getCoverageReports: async () => ({ capacity: { status: 'ok', warnings: [], bySymbol: { BITX: { availableCoveredContracts: 2, costBasis: null, costBasisComplete: false } } } as never, foundations: null }),
    });
    const onOrder = await lookup('BITX 11/6 16C @ 0.39 COVERED CALLS', deps);
    expect(await screen.findByTestId('trade-lookup-coverage')).toHaveTextContent('Covered by shares');
    await userEvent.click(screen.getByRole('button', { name: 'Select 16C 2026-11-06' }));
    expect(screen.queryByRole('button', { name: /SEND TO ORDER/ })).not.toBeInTheDocument();
    expect(screen.getByTestId('trade-lookup-selected')).toHaveTextContent(/not enabled/i);
    expect(onOrder).not.toHaveBeenCalled();
  });

  it('shows delta, spread and open interest as values and highlights only the ones out of range', async () => {
    const deps = makeDeps({
      fetchChain: async (_s, _t, exp) => ({
        chains: { [exp]: [
          raw(115, exp, { delta: -0.09, openInterest: 0, bid: 1, ask: 2 }),
          raw(120, exp, { delta: -0.2, openInterest: 800, bid: 5.45, ask: 5.5 }),
        ] },
        classification: 'etf',
      }),
    });
    await lookup('NEW CSP SOXL 11/6 $120P @ $5.47', deps);
    const pick = await screen.findByTestId('trade-lookup-pick-row');
    // The in-range posted contract has no highlight anywhere and there are no flag chips.
    expect(pick.innerHTML).not.toContain('text-amber-300');
    expect(screen.queryByText('DELTA')).not.toBeInTheDocument();
    expect(screen.queryByText('SPREAD')).not.toBeInTheDocument();
    // The out-of-range neighbor shows its numbers, highlighted, with the reason on hover.
    const other = screen.getAllByTestId('trade-lookup-row').filter((r) => r.textContent!.startsWith('115P'))[0];
    expect(other.querySelectorAll('td.text-amber-300').length).toBe(3);
    expect(other.textContent).toContain('0.09');
    expect(other.textContent).toContain('spread $1.00');
    expect(other.querySelector('td[title*="Delta 0.09"]')).not.toBeNull();
    expect(other.querySelector('td[title*="Open interest 0"]')).not.toBeNull();
  });

  describe('covered-call hand-off', () => {
    const ccDeps = (shares: number | null) => makeDeps({
      fetchChain: async (_s, _t, exp) => ({ chains: { [exp]: [15, 16, 17].map((k) => raw(k, exp, { optionType: 'C', delta: 0.25, bid: 0.38, ask: 0.4 })) }, classification: 'etf' }),
      getCoverageReports: async () => ({ capacity: shares === null ? null : { status: 'ok', warnings: [], bySymbol: { BITX: { availableCoveredContracts: shares, costBasis: null, costBasisComplete: false } } } as never, foundations: null }),
    });
    const open = async (deps: LookupDeps, onOrderCc?: (o: unknown) => void) => {
      render(<TradeLookupModal th={th} deps={deps} onClose={vi.fn()} onOrderCsp={vi.fn()} onOrderCc={onOrderCc as never} />);
      await userEvent.click(screen.getByLabelText('Group post'));
      await userEvent.paste('BITX 11/6 16C @ 0.39 COVERED CALLS');
      await userEvent.click(screen.getByRole('button', { name: /LOOK UP/ }));
      await screen.findByTestId('trade-lookup-coverage');
      await userEvent.click(screen.getByRole('button', { name: 'Select 16C 2026-11-06' }));
    };

    it('offers SEND TO ORDER for a covered call and hands over the call', async () => {
      const onOrderCc = vi.fn();
      await open(ccDeps(2), onOrderCc);
      await userEvent.click(screen.getByRole('button', { name: /SEND TO ORDER/ }));
      expect(onOrderCc).toHaveBeenCalledTimes(1);
      expect(onOrderCc.mock.calls[0][0]).toMatchObject({ symbol: 'BITX', strike: 16, expiration: '2026-11-06', midPerShare: 0.39, isIndex: false });
    });

    it('offers no order when coverage is not proven', async () => {
      const onOrderCc = vi.fn();
      await open(ccDeps(0), onOrderCc);
      expect(screen.queryByRole('button', { name: /SEND TO ORDER/ })).not.toBeInTheDocument();
      expect(screen.getByTestId('trade-lookup-selected')).toHaveTextContent(/Coverage is not proven/);
    });

    it('offers no order when coverage is unknown', async () => {
      await open(ccDeps(null), vi.fn());
      expect(screen.queryByRole('button', { name: /SEND TO ORDER/ })).not.toBeInTheDocument();
    });
  });

  it('an unreadable post explains why and fetches nothing', async () => {
    const deps = makeDeps({ getToken: vi.fn(async () => 'tok') });
    await lookup('hello there', deps);
    expect(await screen.findByRole('alert')).toHaveTextContent(/No option contract found/);
    expect(deps.getToken).not.toHaveBeenCalled();
  });

  it('an exit post is explained, not looked up', async () => {
    const deps = makeDeps({ getToken: vi.fn(async () => 'tok') });
    await lookup('DFEN + GGLL EXIT', deps);
    expect(await screen.findByRole('alert')).toHaveTextContent(/exit post/i);
    expect(deps.getToken).not.toHaveBeenCalled();
  });

  it('an expired date is blocked with a message and fetches no chain', async () => {
    const deps = makeDeps({ fetchChain: vi.fn(async () => ({ chains: {}, classification: 'etf' as const })) });
    await lookup('Market.Moves.Matt  10/1/26, 9:01 AM\nNEW CSP SOXL 10/9 $120P @ $5.47', deps);
    expect(await screen.findByRole('alert')).toHaveTextContent(/2026-10-09 has already passed/);
    expect(deps.fetchChain).not.toHaveBeenCalled();
  });

  it('a far date waits for confirmation, then loads', async () => {
    const deps = makeDeps({ getListedExpirations: async () => ['2027-06-18'] });
    await lookup('NEW CSP SOXL 6/18/2027 $120P @ $5.47', deps);
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(/days out/);
    await userEvent.click(screen.getByRole('button', { name: /USE 2027-06-18/ }));
    expect(await screen.findByTestId('trade-lookup-pick-row')).toBeInTheDocument();
  });

  it('an unlisted strike offers the closest listed strikes without rounding', async () => {
    await lookup('NEW CSP SOXL 11/6 $121P @ $5.47');
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('121 is not a listed strike');
    expect(within(alert).getByRole('button', { name: '120' })).toBeInTheDocument();
    expect(within(alert).getByRole('button', { name: '122.5' })).toBeInTheDocument();
    await userEvent.click(within(alert).getByRole('button', { name: '120' }));
    expect(await screen.findByTestId('trade-lookup-pick-row')).toHaveTextContent('120P');
  });

  it('a broker failure is shown as an error', async () => {
    await lookup('NEW CSP SOXL 11/6 $120P @ $5.47', makeDeps({ getToken: async () => null }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/Sign in to TastyTrade/);
  });

  it('renders nothing while suspended but keeps its state', async () => {
    const deps = makeDeps();
    const { rerender } = render(<TradeLookupModal th={th} deps={deps} onClose={vi.fn()} onOrderCsp={vi.fn()} />);
    await userEvent.click(screen.getByLabelText('Group post'));
    await userEvent.paste('NEW CSP SOXL 11/6 $120P @ $5.47');
    await userEvent.click(screen.getByRole('button', { name: /LOOK UP/ }));
    await screen.findByTestId('trade-lookup-pick-row');
    rerender(<TradeLookupModal th={th} deps={deps} onClose={vi.fn()} onOrderCsp={vi.fn()} suspended />);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    rerender(<TradeLookupModal th={th} deps={deps} onClose={vi.fn()} onOrderCsp={vi.fn()} />);
    expect(await screen.findByTestId('trade-lookup-pick-row')).toBeInTheDocument();
  });
});
