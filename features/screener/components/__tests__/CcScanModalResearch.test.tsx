// features/screener/components/__tests__/CcScanModalResearch.test.tsx
// CC-RESEARCH-0001 -- the scan scope switch: owned positions (default) or any ticker (research).

import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { CcScanModal, parseResearchTickers } from '../CcScanModal';
import type { ScanModalTheme } from '../ScanModalShell';
import { DEFAULT_CC_RULES } from '@/lib/scans/constants';
import { ccOrderInputFromScanResult } from '@/lib/scans/ccScanOrderInput';
import type { ScreenResult } from '@/lib/scans/types';

const th: ScanModalTheme = {
  bg: 'bg-[#0a0a0a]', card: 'bg-[#171717]', border: 'border-[#2c2c2c]', text: 'text-white',
  textMuted: 'text-[#e0e0e0]', textFaint: 'text-[#808080]', input: 'bg-[#141414]', inputBorder: 'border-[#353535]',
};

const open = (onRun = vi.fn(), holdings = [{ symbol: 'AAA', availableCoveredContracts: 2 }]) => {
  render(
    <CcScanModal th={th} selectedTickerCount={1} holdings={holdings} hiddenSymbols={[]} onToggleSymbol={vi.fn()}
      holdingsLoading={false} initial={{ rules: { ...DEFAULT_CC_RULES } }} onClose={vi.fn()} onRun={onRun} />,
  );
  return onRun;
};

describe('parseResearchTickers', () => {
  it('upper-cases, de-duplicates, splits on commas and spaces, and reports junk', () => {
    expect(parseResearchTickers('tqqq, soxl tqqq')).toEqual({ tickers: ['TQQQ', 'SOXL'], invalid: [] });
    expect(parseResearchTickers('TQQQ, $$$, 12345')).toEqual({ tickers: ['TQQQ'], invalid: ['$$$', '12345'] });
    expect(parseResearchTickers('  ')).toEqual({ tickers: [], invalid: [] });
  });
});

describe('scan scope switch', () => {
  it('defaults to owned positions and runs exactly as before', async () => {
    const onRun = open();
    await userEvent.click(screen.getByRole('button', { name: /RUN CC SCAN/ }));
    expect(onRun).toHaveBeenCalledTimes(1);
    expect(onRun.mock.calls[0][0].research).toBeUndefined();
  });

  it('research mode needs a ticker, then runs with the tickers and the typed entry price', async () => {
    const onRun = open();
    await userEvent.click(screen.getByLabelText('Any ticker (research)'));
    const run = screen.getByRole('button', { name: /RUN RESEARCH SCAN/ });
    expect(run).toBeDisabled();
    await userEvent.type(screen.getByLabelText('Research tickers'), 'tqqq');
    await userEvent.type(screen.getByLabelText('Research entry price'), '82');
    expect(run).toBeEnabled();
    await userEvent.click(run);
    expect(onRun.mock.calls[0][0].research).toEqual({ tickers: ['TQQQ'], entryPrice: 82 });
  });

  it('works with no owned positions at all', async () => {
    const onRun = open(vi.fn(), []);
    await userEvent.click(screen.getByLabelText('Any ticker (research)'));
    await userEvent.type(screen.getByLabelText('Research tickers'), 'SOXL');
    await userEvent.click(screen.getByRole('button', { name: /RUN RESEARCH SCAN/ }));
    expect(onRun.mock.calls[0][0].research).toEqual({ tickers: ['SOXL'], entryPrice: null });
  });

  it('blocks a bad ticker, a bad entry price, and an entry price with several tickers', async () => {
    open();
    await userEvent.click(screen.getByLabelText('Any ticker (research)'));
    const run = screen.getByRole('button', { name: /RUN RESEARCH SCAN/ });
    await userEvent.type(screen.getByLabelText('Research tickers'), 'TQQQ, $$$');
    expect(run).toBeDisabled();
    await userEvent.clear(screen.getByLabelText('Research tickers'));
    await userEvent.type(screen.getByLabelText('Research tickers'), 'TQQQ, SOXL');
    expect(run).toBeEnabled();
    await userEvent.type(screen.getByLabelText('Research entry price'), '82');
    expect(run).toBeDisabled();
    await userEvent.clear(screen.getByLabelText('Research entry price'));
    await userEvent.type(screen.getByLabelText('Research entry price'), '-5');
    expect(run).toBeDisabled();
  });
});

describe('research results can never be ordered', () => {
  const result = (research: boolean): ScreenResult => ({
    symbol: 'TQQQ', strategy: 'CC', price: 62.28, qualified: true, failReasons: [], underlyingType: 'etf',
    bestCandidate: {
      strategy: 'CC', expiration: '2026-12-18', dte: 44, shortStrike: 85, shortDelta: 0.07, credit: 38, ccPremiumPerShare: 0.38,
      shortOccSymbol: 'TQQQ  261218C00085000', ccResearch: research,
    },
  } as unknown as ScreenResult);
  it('a normal covered-call result gives an order input; a research one does not', () => {
    expect(ccOrderInputFromScanResult(result(false))).not.toBeNull();
    expect(ccOrderInputFromScanResult(result(true))).toBeNull();
  });
});
