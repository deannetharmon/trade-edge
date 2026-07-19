// components/portfolio-mode/__tests__/PortfolioModeProvider.test.tsx
//
// PT-0002A: Provider/persistence test requirements from the Implementation
// Directive -- first-use initialization, refresh persistence, navigation
// persistence, hydration-safe rendering, and invalid persisted state
// surfacing a safe, visible resolution path rather than a silent fallback.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { PortfolioModeProvider, usePortfolioMode } from '../PortfolioModeProvider';
import { PORTFOLIO_MODE_STORAGE_KEY } from '@/lib/portfolio-mode/persistence';

function Probe() {
  const ctx = usePortfolioMode();
  return (
    <div>
      <span data-testid="status">{ctx.status}</span>
      <span data-testid="mode">{ctx.mode ?? 'null'}</span>
      <span data-testid="raw">{ctx.rawInvalidValue ?? 'null'}</span>
      <button onClick={() => ctx.setMode('LIVE')}>set-live</button>
      <button onClick={() => ctx.setMode('PAPER')}>set-paper</button>
    </div>
  );
}

describe('PortfolioModeProvider', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    cleanup();
  });

  it('throws when usePortfolioMode is used outside the provider', () => {
    const BadConsumer = () => {
      usePortfolioMode();
      return null;
    };
    // Silence the expected React error boundary console noise for this
    // negative-path assertion, matching this repo's other "must be used
    // within" provider tests.
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(() => render(<BadConsumer />)).toThrow('usePortfolioMode must be used within a PortfolioModeProvider');
    spy.mockRestore();
  });

  it('first-use initialization: no persisted value resolves to LIVE and persists it', async () => {
    render(
      <PortfolioModeProvider>
        <Probe />
      </PortfolioModeProvider>,
    );
    expect(await screen.findByTestId('status')).toHaveTextContent('ready');
    expect(screen.getByTestId('mode')).toHaveTextContent('LIVE');
    expect(localStorage.getItem(PORTFOLIO_MODE_STORAGE_KEY)).toBe('LIVE');
  });

  it('refresh persistence: a previously persisted PAPER value is read back on mount', async () => {
    localStorage.setItem(PORTFOLIO_MODE_STORAGE_KEY, 'PAPER');
    render(
      <PortfolioModeProvider>
        <Probe />
      </PortfolioModeProvider>,
    );
    expect(await screen.findByTestId('status')).toHaveTextContent('ready');
    expect(screen.getByTestId('mode')).toHaveTextContent('PAPER');
  });

  it('navigation persistence: a mode set in one mount survives a fresh provider mount (simulating navigation/reload)', async () => {
    const first = render(
      <PortfolioModeProvider>
        <Probe />
      </PortfolioModeProvider>,
    );
    await screen.findByTestId('status');
    fireEvent.click(screen.getByText('set-paper'));
    expect(screen.getByTestId('mode')).toHaveTextContent('PAPER');
    first.unmount();

    render(
      <PortfolioModeProvider>
        <Probe />
      </PortfolioModeProvider>,
    );
    expect(await screen.findByTestId('status')).toHaveTextContent('ready');
    expect(screen.getByTestId('mode')).toHaveTextContent('PAPER');
  });

  it('hydration-safe rendering: the first rendered status is "resolving", identical to what a server render would produce', () => {
    const onRender: any = () => {};
    onRender.statuses = [];
    const Recorder = () => {
      const ctx = usePortfolioMode();
      onRender.statuses.push(ctx.status);
      return <span data-testid="status">{ctx.status}</span>;
    };
    render(
      <PortfolioModeProvider>
        <Recorder />
      </PortfolioModeProvider>,
    );
    expect(onRender.statuses[0]).toBe('resolving');
  });

  it('invalid persisted state surfaces a safe, visible resolution path rather than defaulting to LIVE or PAPER', async () => {
    localStorage.setItem(PORTFOLIO_MODE_STORAGE_KEY, 'not-a-real-mode');
    render(
      <PortfolioModeProvider>
        <Probe />
      </PortfolioModeProvider>,
    );
    expect(await screen.findByTestId('status')).toHaveTextContent('invalid');
    expect(screen.getByTestId('mode')).toHaveTextContent('null');
    expect(screen.getByTestId('raw')).toHaveTextContent('not-a-real-mode');

    // Resolution must be an explicit user choice, not automatic.
    fireEvent.click(screen.getByText('set-live'));
    expect(screen.getByTestId('status')).toHaveTextContent('ready');
    expect(screen.getByTestId('mode')).toHaveTextContent('LIVE');
    expect(localStorage.getItem(PORTFOLIO_MODE_STORAGE_KEY)).toBe('LIVE');
  });

  it('switching modes performs no network request (no execution side effect)', async () => {
    const fetchSpy = vi.spyOn(global, 'fetch');
    render(
      <PortfolioModeProvider>
        <Probe />
      </PortfolioModeProvider>,
    );
    await screen.findByTestId('status');
    fireEvent.click(screen.getByText('set-paper'));
    fireEvent.click(screen.getByText('set-live'));
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });
});
