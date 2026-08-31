import React from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { ExpirationDisclosure } from '../ExpirationDisclosure';

describe('ExpirationDisclosure', () => {
  it('is named by expiration, DTE, and count and announces collapse while retaining focus', async () => {
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => { callback(0); return 1; });
    render(<ExpirationDisclosure expiration="2026-09-18" dte={42} candidateCount={2}
      kind="qualified" defaultOpen borderClassName="border-slate-700"><a href="#x">candidate</a></ExpirationDisclosure>);
    const button = screen.getByRole('button', { name: '2026-09-18, 42 DTE, 2 qualified candidates' });
    expect(button).toHaveAttribute('aria-expanded', 'true');
    expect(button).toHaveTextContent('Expanded');
    await userEvent.click(button);
    expect(button).toHaveAttribute('aria-expanded', 'false');
    expect(button).toHaveTextContent('Collapsed');
    expect(screen.getByRole('status')).toHaveTextContent('collapsed');
    expect(button).toHaveFocus();
    vi.unstubAllGlobals();
  });

  it('starts disqualified groups collapsed and exposes the controlled panel when expanded', async () => {
    render(<ExpirationDisclosure expiration="2026-10-16" dte={35} candidateCount={1}
      kind="disqualified" defaultOpen={false} borderClassName="border-slate-700"><p>details</p></ExpirationDisclosure>);
    const button = screen.getByRole('button', { name: '2026-10-16, 35 DTE, 1 excluded contract' });
    expect(button).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByText('details')).not.toBeInTheDocument();
    await userEvent.click(button);
    expect(document.getElementById(button.getAttribute('aria-controls')!)).toBeInTheDocument();
  });
});
