import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const account = vi.hoisted(() => ({ resolve: vi.fn(), switchAccount: vi.fn() }));
vi.mock('@/lib/tastytrade/accountSelection', () => ({
  ACTIVE_BROKER_ACCOUNT_CHANGED_EVENT: 'trade-edge:active-broker-account-changed',
  resolveActiveBrokerAccount: account.resolve,
  applyBrokerAccountSwitch: account.switchAccount,
}));

import { ActiveBrokerAccountIndicator, ActiveBrokerAccountProvider } from '../ActiveBrokerAccountProvider';

function renderAccountControl() {
  return render(<ActiveBrokerAccountProvider><ActiveBrokerAccountIndicator /></ActiveBrokerAccountProvider>);
}

describe('ActiveBrokerAccountProvider and indicator', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('shows only a masked restored account identifier', async () => {
    account.resolve.mockResolvedValue({ status: 'ready', accountId: 'ACCT-SECRET-1234', accounts: [{ id: 'ACCT-SECRET-1234', label: 'Individual' }] });
    renderAccountControl();
    expect(await screen.findByRole('button', { name: /Individual.*1234/i })).toBeInTheDocument();
    expect(screen.queryByText('ACCT-SECRET-1234')).not.toBeInTheDocument();
    expect(screen.getByTestId('active-broker-account').className).not.toMatch(/\bfixed\b/);
  });

  it('offers all accounts once and routes the choice through the full-reload switch boundary', async () => {
    account.resolve.mockResolvedValue({ status: 'selection_required', accountId: null, accounts: [{ id: 'ACCT-A', label: 'IRA' }, { id: 'ACCT-B', label: 'Individual' }] });
    renderAccountControl();
    await userEvent.click(await screen.findByRole('button', { name: /choose active broker account/i }));
    expect(screen.getByRole('dialog', { name: /active broker account/i }).className).toMatch(/\babsolute\b/);
    expect(screen.getByRole('dialog', { name: /active broker account/i }).className).toMatch(/\btop-full\b/);
    await userEvent.click(screen.getByRole('button', { name: /IRA/i }));
    expect(account.switchAccount).toHaveBeenCalledWith('ACCT-A');
  });

  it('explains that a restored account disappeared and requires a replacement choice', async () => {
    account.resolve.mockResolvedValue({ status: 'selected_account_missing', accountId: null, accounts: [{ id: 'ACCT-B', label: 'Individual' }] });
    renderAccountControl();
    await userEvent.click(await screen.findByRole('button', { name: /choose active broker account/i }));
    await waitFor(() => expect(screen.getByText(/saved account is no longer available/i)).toBeInTheDocument());
  });
});
