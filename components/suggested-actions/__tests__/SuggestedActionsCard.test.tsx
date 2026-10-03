// components/suggested-actions/__tests__/SuggestedActionsCard.test.tsx

import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { THEMES } from '@/lib/theme';
import type { ExistingIncomeOpportunity } from '@/features/portfolio/positions-workspace/model/types';
import { PMCC_SHORT_CALL_BADGE, pmccShortCallWindowText, type PmccShortCallCard, type PmccSuggestionResult } from '@/lib/suggested-actions/pmccShortCallSuggestion';
import { PMCC_REVIEW_HANDOFF_STORAGE_KEY } from '@/lib/scans/pmccReviewHandoff';
import { SuggestedActionsCard, formatExpiration } from '../SuggestedActionsCard';

function card(key: string, over: Partial<PmccShortCallCard> = {}): PmccShortCallCard {
  const opportunity = {
    id: `pmcc:${key}`, kind: 'pmcc-short-call', status: 'review-income-call', symbol: 'NVDA', positionKey: key,
    exactContract: 'NVDA  280121C00100000', accountNumber: '5WT1',
  } as unknown as ExistingIncomeOpportunity;
  return {
    positionKey: key, symbol: 'NVDA', accountNumber: '5WT1', exactContract: 'NVDA  280121C00100000', strike: 100,
    expiration: '2028-01-21', dte: 475, quantity: 1, spot: 190.4, entryPerShare: 10, markPerShare: 24.2, gain: 1.42,
    gainDollars: 1420, badge: PMCC_SHORT_CALL_BADGE, windowText: pmccShortCallWindowText(), opportunity, ...over,
  };
}

function result(cards: PmccShortCallCard[], over: Partial<PmccSuggestionResult> = {}): PmccSuggestionResult {
  return { cards, overflow: 0, armedKeys: {}, stale: false, asOf: new Date('2026-10-02T15:38:00'), ...over };
}

const th = THEMES.dark;

describe('SuggestedActionsCard', () => {
  it('renders nothing when there are no cards', () => {
    const { container } = render(<SuggestedActionsCard result={result([])} th={th} onRefresh={vi.fn()} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('shows symbol, contract with full expiry, spot, gain in % and $ (mid), badge and the policy window', () => {
    render(<SuggestedActionsCard result={result([card('a')])} th={th} onRefresh={vi.fn()} />);
    const row = screen.getByTestId('suggested-action-a');
    expect(row).toHaveTextContent('NVDA');
    expect(row).toHaveTextContent('$100 call · Jan 21 2028 · ×1');
    expect(row).toHaveTextContent('Stock $190.40');
    expect(row).toHaveTextContent('+142%');
    expect(row).toHaveTextContent('+$1,420 (mid)');
    expect(row).toHaveTextContent(PMCC_SHORT_CALL_BADGE);
    expect(row).toHaveTextContent(pmccShortCallWindowText());
    expect(screen.queryByRole('button', { name: 'Refresh' })).not.toBeInTheDocument();
  });

  it('tapping a card opens the PMCC short-call review for that exact LEAPS', () => {
    const setItem = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {});
    const assign = vi.fn();
    const original = window.location;
    Object.defineProperty(window, 'location', { configurable: true, value: { ...original, assign } });
    render(<SuggestedActionsCard result={result([card('a')])} th={th} onRefresh={vi.fn()} />);
    fireEvent.click(screen.getByTestId('suggested-action-a'));
    expect(setItem).toHaveBeenCalledWith(PMCC_REVIEW_HANDOFF_STORAGE_KEY, JSON.stringify({
      accountNumber: '5WT1', positionKey: 'a', underlyingSymbol: 'NVDA', occSymbol: 'NVDA  280121C00100000',
    }));
    expect(assign).toHaveBeenCalledWith('/screener?launch=pmcc-held');
    Object.defineProperty(window, 'location', { configurable: true, value: original });
    setItem.mockRestore();
  });

  it('stale: cards are disabled and do not open, the header says "As of", and Refresh calls onRefresh', async () => {
    const onOpen = vi.fn();
    const onRefresh = vi.fn(async () => {});
    render(<SuggestedActionsCard result={result([card('a')], { stale: true })} th={th} onRefresh={onRefresh} onOpen={onOpen} />);
    expect(screen.getByTestId('suggested-action-a')).toBeDisabled();
    fireEvent.click(screen.getByTestId('suggested-action-a'));
    expect(onOpen).not.toHaveBeenCalled();
    expect(screen.getByText(/As of 3:38 PM/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
    expect(onRefresh).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Refresh' })).toBeEnabled());
  });

  it('shows "+N more" when more than three qualify', () => {
    render(<SuggestedActionsCard result={result([card('a')], { overflow: 2 })} th={th} onRefresh={vi.fn()} />);
    expect(screen.getByText('+2 more LEAPS qualify')).toBeInTheDocument();
  });

  it('uses the theme tokens it is given (light theme)', () => {
    const { container } = render(<SuggestedActionsCard result={result([card('a')])} th={THEMES.light} onRefresh={vi.fn()} />);
    expect(container.querySelector('section')?.className).toContain(THEMES.light.card);
    expect(container.querySelector('section')?.className).not.toContain(THEMES.dark.card);
  });
});

describe('formatExpiration', () => {
  it('formats a date without a timezone shift and tolerates an odd string', () => {
    expect(formatExpiration('2028-01-21')).toBe('Jan 21 2028');
    expect(formatExpiration('2027-12-01')).toBe('Dec 1 2027');
    expect(formatExpiration('soon')).toBe('soon');
  });
});
