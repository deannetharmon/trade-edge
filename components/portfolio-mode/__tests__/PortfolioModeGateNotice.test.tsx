import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { PortfolioModeGateNotice } from '../PortfolioModeGateNotice';
import { THEMES } from '@/lib/theme';

vi.mock('next/link', () => ({
  default: ({
    children,
    href,
    ...props
  }: {
    children: React.ReactNode;
    href: string;
  }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

describe('PortfolioModeGateNotice', () => {
  const th = THEMES.dark;

  it('uses polite status semantics while portfolio mode is resolving', () => {
    render(
      <PortfolioModeGateNotice
        portfolioMode={{
          status: 'resolving',
          mode: null,
          rawInvalidValue: null,
          setMode: vi.fn(),
        }}
        th={th}
        screenName="Portfolio"
      />,
    );

    const status = screen.getByRole('status');

    expect(status).toHaveAttribute('aria-live', 'polite');
    expect(status).toHaveTextContent('Resolving portfolio mode…');
    expect(status).toHaveTextContent(
      'Determining your current portfolio mode…',
    );
  });

  it('uses alert semantics when the persisted portfolio mode is invalid', () => {
    render(
      <PortfolioModeGateNotice
        portfolioMode={{
          status: 'invalid',
          mode: null,
          rawInvalidValue: 'unexpected-value',
          setMode: vi.fn(),
        }}
        th={th}
        screenName="Portfolio"
      />,
    );

    expect(screen.getByRole('alert')).toHaveTextContent(
      'Portfolio mode needs to be resolved',
    );
  });

  it('explains that the screen currently supports LIVE mode only', () => {
    render(
      <PortfolioModeGateNotice
        portfolioMode={{
          status: 'ready',
          mode: 'PAPER',
          rawInvalidValue: null,
          setMode: vi.fn(),
        }}
        th={th}
        screenName="Portfolio"
      />,
    );

    expect(
      screen.getByText('Portfolio: Currently supports LIVE mode only'),
    ).toHaveClass(th.text);

    expect(
      screen.getByText(/Paper mode isn’t wired into this screen yet/i),
    ).toHaveClass(th.textMuted);

    expect(
      screen.getByRole('link', { name: 'Go to Paper Trading' }),
    ).toHaveAttribute('href', '/paper-trading');
  });
});
