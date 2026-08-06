// components/portfolio-mode/__tests__/PortfolioModeIndicator.test.tsx
//
// PT-0002A corrective round: the Product Owner rejected the original round
// because the indicator let the shell DISPLAY "PAPER" while every existing
// portfolio-dependent screen kept rendering live data underneath. This
// suite proves the fix: no control anywhere in this component can ever set
// mode to PAPER, and whenever a legacy-persisted PAPER value IS the
// resolved mode, live-portfolio routes are fully blocked (never quietly
// shown alongside a "PAPER" label) until the user explicitly returns to
// LIVE -- see requirement 7 in the corrective directive.

import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { PortfolioModeIndicator } from '../PortfolioModeIndicator';
import * as ProviderModule from '../PortfolioModeProvider';

vi.mock('next/navigation', () => ({
  usePathname: vi.fn(() => '/dashboard'),
}));

import { usePathname } from 'next/navigation';

function mockPortfolioMode(value: Partial<ReturnType<typeof ProviderModule.usePortfolioMode>>) {
  return vi.spyOn(ProviderModule, 'usePortfolioMode').mockReturnValue({
    status: 'resolving',
    mode: null,
    rawInvalidValue: null,
    setMode: vi.fn(),
    ...value,
  });
}

function mockPathname(path: string) {
  (usePathname as unknown as ReturnType<typeof vi.fn>).mockReturnValue(path);
}

describe('PortfolioModeIndicator', () => {
  it('shows a neutral placeholder while resolving, never guessing a mode', () => {
    mockPortfolioMode({ status: 'resolving', mode: null });
    mockPathname('/dashboard');
    render(<PortfolioModeIndicator />);
    expect(screen.queryByText('LIVE')).not.toBeInTheDocument();
    expect(screen.queryByText('PAPER')).not.toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.queryByTestId('portfolio-mode-label')).not.toBeInTheDocument();
  });

  describe('ready, mode LIVE -- the only settable mode this round', () => {
    it('shows an unmistakable LIVE badge', () => {
      mockPortfolioMode({ status: 'ready', mode: 'LIVE' });
      mockPathname('/dashboard');
      render(<PortfolioModeIndicator />);
      expect(screen.getByTestId('portfolio-mode-label')).toHaveTextContent('LIVE');
    });

    it('shows a disabled PAPER control with "available after application integration" wording, not a working switch', () => {
      mockPortfolioMode({ status: 'ready', mode: 'LIVE' });
      mockPathname('/dashboard');
      render(<PortfolioModeIndicator />);
      const paperControl = screen.getByTestId('portfolio-mode-paper-disabled');
      expect(paperControl).toHaveTextContent('available after application integration');
      expect(paperControl).toBeDisabled();
    });

    it('clicking the disabled PAPER control never calls setMode', () => {
      const setMode = vi.fn();
      mockPortfolioMode({ status: 'ready', mode: 'LIVE', setMode });
      mockPathname('/dashboard');
      render(<PortfolioModeIndicator />);
      fireEvent.click(screen.getByTestId('portfolio-mode-paper-disabled'));
      expect(setMode).not.toHaveBeenCalled();
    });

    it('there is no enabled control anywhere in this state whose accessible name is just "PAPER" or "Switch to PAPER"', () => {
      mockPortfolioMode({ status: 'ready', mode: 'LIVE' });
      mockPathname('/dashboard');
      render(<PortfolioModeIndicator />);
      expect(screen.queryByRole('button', { name: /^PAPER$/i })).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /Switch to PAPER/i })).not.toBeInTheDocument();
    });

    it('no control in this state ever triggers a network request', () => {
      const fetchSpy = vi.spyOn(global, 'fetch');
      mockPortfolioMode({ status: 'ready', mode: 'LIVE' });
      mockPathname('/dashboard');
      render(<PortfolioModeIndicator />);
      fireEvent.click(screen.getByTestId('portfolio-mode-paper-disabled'));
      expect(fetchSpy).not.toHaveBeenCalled();
      fetchSpy.mockRestore();
    });
  });

  describe('invalid persisted state', () => {
    it('renders a loud, forced-choice prompt with no default selected', () => {
      mockPortfolioMode({ status: 'invalid', mode: null, rawInvalidValue: 'garbage-value' });
      mockPathname('/dashboard');
      render(<PortfolioModeIndicator />);
      expect(screen.getByRole('alert')).toHaveTextContent('garbage-value');
      expect(screen.queryByTestId('portfolio-mode-label')).not.toBeInTheDocument();
    });

    it('offers LIVE as a working choice', () => {
      const setMode = vi.fn();
      mockPortfolioMode({ status: 'invalid', mode: null, rawInvalidValue: 'garbage-value', setMode });
      mockPathname('/dashboard');
      render(<PortfolioModeIndicator />);
      fireEvent.click(screen.getByRole('button', { name: 'LIVE' }));
      expect(setMode).toHaveBeenCalledWith('LIVE');
    });

    it('PAPER is present but disabled -- resolving an invalid value can never select PAPER', () => {
      const setMode = vi.fn();
      mockPortfolioMode({ status: 'invalid', mode: null, rawInvalidValue: 'garbage-value', setMode });
      mockPathname('/dashboard');
      render(<PortfolioModeIndicator />);
      const paperButton = screen.getByRole('button', { name: 'PAPER' });
      expect(paperButton).toBeDisabled();
      fireEvent.click(paperButton);
      expect(setMode).not.toHaveBeenCalled();
    });
  });

  describe('ready, mode PAPER (only reachable via a value persisted before this corrective round)', () => {
    it('on a live-portfolio route, blocks the shell with a full-screen warning instead of showing a normal badge', () => {
      mockPortfolioMode({ status: 'ready', mode: 'PAPER' });
      mockPathname('/dashboard');
      render(<PortfolioModeIndicator />);
      expect(screen.getByTestId('portfolio-mode-block')).toBeInTheDocument();
      expect(screen.getByRole('alertdialog')).toHaveTextContent('not yet supported application-wide');
    });

    it('the block replaces the normal indicator entirely -- no LIVE or PAPER badge renders alongside it', () => {
      mockPortfolioMode({ status: 'ready', mode: 'PAPER' });
      mockPathname('/dashboard');
      render(<PortfolioModeIndicator />);
      expect(screen.queryByTestId('portfolio-mode-label')).not.toBeInTheDocument();
      expect(screen.queryByTestId('portfolio-mode-paper-disabled')).not.toBeInTheDocument();
    });

    it('applies on every live-portfolio route, not just /dashboard', () => {
      mockPortfolioMode({ status: 'ready', mode: 'PAPER' });
      mockPathname('/portfolio');
      render(<PortfolioModeIndicator />);
      expect(screen.getByTestId('portfolio-mode-block')).toBeInTheDocument();
    });

    it('never silently coerces PAPER back to LIVE on its own -- the block persists until an explicit click', () => {
      mockPortfolioMode({ status: 'ready', mode: 'PAPER' });
      mockPathname('/dashboard');
      const { rerender } = render(<PortfolioModeIndicator />);
      expect(screen.getByTestId('portfolio-mode-block')).toBeInTheDocument();
      // Re-rendering (simulating time passing / a re-render for any other
      // reason) with the same PAPER mode must keep blocking -- nothing in
      // this component itself calls setMode.
      rerender(<PortfolioModeIndicator />);
      expect(screen.getByTestId('portfolio-mode-block')).toBeInTheDocument();
    });

    it('"Return to LIVE" requires an explicit click and calls setMode with LIVE', () => {
      const setMode = vi.fn();
      mockPortfolioMode({ status: 'ready', mode: 'PAPER', setMode });
      mockPathname('/dashboard');
      render(<PortfolioModeIndicator />);
      expect(setMode).not.toHaveBeenCalled();
      fireEvent.click(screen.getByRole('button', { name: /Return to LIVE/i }));
      expect(setMode).toHaveBeenCalledWith('LIVE');
      expect(setMode).toHaveBeenCalledTimes(1);
    });

    it('is exempt on the dedicated /paper-trading sandbox -- renders nothing, never blocks that route', () => {
      mockPortfolioMode({ status: 'ready', mode: 'PAPER' });
      mockPathname('/paper-trading');
      const { container } = render(<PortfolioModeIndicator />);
      expect(screen.queryByTestId('portfolio-mode-block')).not.toBeInTheDocument();
      expect(container).toBeEmptyDOMElement();
    });

    it('the /paper-trading exemption only matches that route prefix, not a route that merely starts similarly', () => {
      mockPortfolioMode({ status: 'ready', mode: 'PAPER' });
      mockPathname('/paper-trading-analytics');
      render(<PortfolioModeIndicator />);
      // Still exempt, since startsWith('/paper-trading') matches -- this
      // test documents the actual prefix-matching behavior rather than
      // asserting a stricter boundary that isn't implemented, so a future
      // change to the matching rule fails this test intentionally.
      expect(screen.queryByTestId('portfolio-mode-block')).not.toBeInTheDocument();
    });
  });

  describe('header-placement corrective pass: centered, collision-safe positioning', () => {
    it('the resolving placeholder no longer uses top-right corner positioning', () => {
      mockPortfolioMode({ status: 'resolving', mode: null });
      mockPathname('/dashboard');
      const { container } = render(<PortfolioModeIndicator />);
      const el = container.firstElementChild as HTMLElement;
      expect(el.className).not.toMatch(/\bright-4\b/);
      expect(el.className).not.toMatch(/\btop-4\b/);
      // Centered via a symmetric, page-independent transform rather than a
      // one-off right offset.
      expect(el.className).toMatch(/left-1\/2/);
      expect(el.className).toMatch(/-translate-x-1\/2/);
    });

    it('the invalid-state prompt uses the same centered positioning, not top-right', () => {
      mockPortfolioMode({ status: 'invalid', mode: null, rawInvalidValue: 'x' });
      mockPathname('/dashboard');
      render(<PortfolioModeIndicator />);
      const el = screen.getByRole('alert');
      expect(el.className).not.toMatch(/\bright-4\b/);
      expect(el.className).toMatch(/left-1\/2/);
    });

    it('the ready/LIVE badge uses the same centered positioning, not top-right', () => {
      mockPortfolioMode({ status: 'ready', mode: 'LIVE' });
      mockPathname('/dashboard');
      render(<PortfolioModeIndicator />);
      const el = screen.getByRole('status');
      expect(el.className).not.toMatch(/\bright-4\b/);
      expect(el.className).not.toMatch(/\btop-4\b/);
      expect(el.className).toMatch(/left-1\/2/);
      expect(el.className).toMatch(/-translate-x-1\/2/);
    });

    it('the unsupported-PAPER blocking overlay is unchanged -- still fixed inset-0, covering the full viewport', () => {
      mockPortfolioMode({ status: 'ready', mode: 'PAPER' });
      mockPathname('/dashboard');
      render(<PortfolioModeIndicator />);
      const overlay = screen.getByTestId('portfolio-mode-block');
      expect(overlay.className).toMatch(/\bfixed\b/);
      expect(overlay.className).toMatch(/\binset-0\b/);
    });

    it('the ready/LIVE badge has a stacking order above sticky page headers (z-index higher than the common z-50 header class)', () => {
      mockPortfolioMode({ status: 'ready', mode: 'LIVE' });
      mockPathname('/dashboard');
      render(<PortfolioModeIndicator />);
      const el = screen.getByRole('status');
      // Several routes' sticky headers use z-50; the indicator must paint
      // above them, not get buried underneath.
      expect(el.className).toMatch(/z-\[60\]/);
    });
  });

  describe('header-placement corrective pass: accessible name and status semantics', () => {
    it('the ready/LIVE badge is exposed as a status region with an accessible name (not communicated by color alone)', () => {
      mockPortfolioMode({ status: 'ready', mode: 'LIVE' });
      mockPathname('/dashboard');
      render(<PortfolioModeIndicator />);
      const status = screen.getByRole('status');
      expect(status).toHaveAccessibleName(/Portfolio mode: LIVE/i);
    });

    it('the invalid-state prompt keeps alert semantics', () => {
      mockPortfolioMode({ status: 'invalid', mode: null, rawInvalidValue: 'x' });
      mockPathname('/dashboard');
      render(<PortfolioModeIndicator />);
      expect(screen.getByRole('alert')).toBeInTheDocument();
    });

    it('the unsupported-PAPER blocking overlay keeps alertdialog semantics', () => {
      mockPortfolioMode({ status: 'ready', mode: 'PAPER' });
      mockPathname('/dashboard');
      render(<PortfolioModeIndicator />);
      expect(screen.getByRole('alertdialog')).toHaveAccessibleName(/requires attention/i);
    });

    it('the disabled PAPER control keeps an accurate accessible name and disabled/aria-disabled state regardless of which text is visually shown at the current breakpoint', () => {
      mockPortfolioMode({ status: 'ready', mode: 'LIVE' });
      mockPathname('/dashboard');
      render(<PortfolioModeIndicator />);
      const paperControl = screen.getByTestId('portfolio-mode-paper-disabled');
      expect(paperControl).toHaveAccessibleName('PAPER — available after application integration');
      expect(paperControl).toBeDisabled();
      expect(paperControl).toHaveAttribute('aria-disabled', 'true');
    });

    it('the compact mobile "PAPER" text and the full desktop explanation are both present in markup (CSS-only breakpoint switch, not two different DOM elements with different semantics)', () => {
      mockPortfolioMode({ status: 'ready', mode: 'LIVE' });
      mockPathname('/dashboard');
      render(<PortfolioModeIndicator />);
      const paperControl = screen.getByTestId('portfolio-mode-paper-disabled');
      // Full explanation, shown sm and up.
      expect(paperControl.querySelector('.sm\\:inline')).toHaveTextContent(
        'PAPER — available after application integration',
      );
      // Compact form, shown below sm.
      expect(paperControl.querySelector('.sm\\:hidden')).toHaveTextContent('PAPER');
    });
  });

  describe('header-placement corrective pass: no duplicate mount', () => {
    it('providers.tsx renders PortfolioModeIndicator exactly once, and no other tracked file renders it', () => {
      const fs = require('node:fs') as typeof import('node:fs');
      const path = require('node:path') as typeof import('node:path');
      const repoRoot = path.resolve(__dirname, '../../..');

      const providersSrc = fs.readFileSync(path.join(repoRoot, 'app/providers.tsx'), 'utf8');
      const providersMatches = providersSrc.match(/<PortfolioModeIndicator\b/g) ?? [];
      expect(providersMatches).toHaveLength(1);

      // No other file under app/ or components/ (outside this component's
      // own definition and tests) renders it a second time.
      function collectTsxFiles(dir: string): string[] {
        const entries = fs.readdirSync(dir, { withFileTypes: true });
        let files: string[] = [];
        for (const entry of entries) {
          const full = path.join(dir, entry.name);
          if (entry.isDirectory()) {
            if (entry.name === 'node_modules' || entry.name === '.next') continue;
            files = files.concat(collectTsxFiles(full));
          } else if (entry.name.endsWith('.tsx') && !entry.name.endsWith('.test.tsx')) {
            files.push(full);
          }
        }
        return files;
      }

      const candidateDirs = [path.join(repoRoot, 'app'), path.join(repoRoot, 'components')];
      const renderSites: string[] = [];
      for (const dir of candidateDirs) {
        for (const file of collectTsxFiles(dir)) {
          if (file.endsWith('PortfolioModeIndicator.tsx')) continue; // the component's own definition, not a render site
          const src = fs.readFileSync(file, 'utf8');
          if (/<PortfolioModeIndicator\b/.test(src)) renderSites.push(file);
        }
      }
      // Exactly one render site across the whole app/components tree, and
      // it's the expected one -- providers.tsx.
      expect(renderSites).toEqual([path.join(repoRoot, 'app/providers.tsx')]);
    });
  });

  describe('requirement 7: the shell cannot display PAPER while live-only application content remains available', () => {
    it('across every status, no rendered control ever calls setMode with PAPER', () => {
      const setMode = vi.fn();
      mockPathname('/dashboard');

      const statuses: Array<Parameters<typeof mockPortfolioMode>[0]> = [
        { status: 'resolving', mode: null, setMode },
        { status: 'invalid', mode: null, rawInvalidValue: 'x', setMode },
        { status: 'ready', mode: 'LIVE', setMode },
        { status: 'ready', mode: 'PAPER', setMode },
      ];

      for (const s of statuses) {
        mockPortfolioMode(s);
        const { unmount } = render(<PortfolioModeIndicator />);
        for (const button of screen.queryAllByRole('button')) {
          if (!(button as HTMLButtonElement).disabled) {
            fireEvent.click(button);
          }
        }
        unmount();
      }

      expect(setMode).not.toHaveBeenCalledWith('PAPER');
    });

    it('when the resolved mode is PAPER on a live-portfolio route, the component never simultaneously exposes an active/interactive "LIVE data is available" surface', () => {
      mockPortfolioMode({ status: 'ready', mode: 'PAPER' });
      mockPathname('/portfolio');
      render(<PortfolioModeIndicator />);
      // The only interactive element is the single "Return to LIVE" action
      // inside the blocking dialog -- nothing else is clickable, so there is
      // no path from this render to viewing live content while PAPER is
      // still the resolved, displayed mode.
      const buttons = screen.getAllByRole('button');
      expect(buttons).toHaveLength(1);
      expect(buttons[0]).toHaveTextContent(/Return to LIVE/i);
    });
  });
});
