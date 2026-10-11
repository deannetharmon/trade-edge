// components/nav/__tests__/AppHeader.mobile.test.tsx

// MOBILE-LAYOUT-0001: phone header is a compact bar with a MENU button that
// opens the panel holding actions and the tab bar.

import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

vi.mock('next/navigation', () => ({ usePathname: () => '/trade-log' }));
vi.mock('next/link', () => ({ default: ({ href, children, ...rest }: any) => <a href={href} {...rest}>{children}</a> }));

import { AppHeader } from '../AppHeader';

describe('AppHeader on phones', () => {
  it('shows the current tab on the menu button and toggles the panel', async () => {
    const user = userEvent.setup();
    render(<AppHeader active="trade-log" actions={<button>Page action</button>} />);
    const button = screen.getByRole('button', { name: /TRADE LOG/ });
    const panel = document.getElementById('app-header-panel') as HTMLElement;
    expect(button).toHaveAttribute('aria-expanded', 'false');
    expect(panel.className).toContain('hidden');
    await user.click(button);
    expect(screen.getByRole('button', { name: /CLOSE/ })).toHaveAttribute('aria-expanded', 'true');
    expect(panel.className).toContain('block');
    expect(panel.className).not.toMatch(/(^| )hidden( |$)/);
    expect(panel).toContainElement(screen.getByRole('button', { name: 'Page action' }));
    expect(panel).toContainElement(screen.getByRole('navigation', { name: 'Primary' }));
  });

  it('keeps exactly one chip slot', () => {
    const { container } = render(<AppHeader active="home" />);
    expect(container.querySelectorAll('[data-global-header-context]').length).toBe(1);
  });
});
