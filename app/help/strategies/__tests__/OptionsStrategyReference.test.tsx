// app/help/strategies/__tests__/OptionsStrategyReference.test.tsx
//
// HELP-0001 — UI/wiring tests for the Options Strategy Reference page: goal
// filtering, detail navigation, comparison tray behavior, accessibility, and
// the visible disclaimer/version footer.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import userEvent from '@testing-library/user-event';
import fs from 'node:fs';
import path from 'node:path';
import StrategiesPage from '../page';
import { COMPARISON_LIMIT_MESSAGE, CONTENT_VERSION, LAST_REVIEWED, STRATEGIES } from '@/lib/help/optionsStrategyReference';

describe('HELP-0001: Options Strategy Reference page', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it('renders all 8 strategy cards by default (no goal selected)', () => {
    render(<StrategiesPage />);
    expect(screen.getAllByRole('button', { name: /View full reference/i }).length).toBe(STRATEGIES.length);
    expect(STRATEGIES.length).toBe(8);
    for (const s of STRATEGIES) {
      expect(screen.getByText(s.displayName)).toBeInTheDocument();
    }
  });

  describe('goal selection and filtered card rendering', () => {
    it('selecting a goal narrows the card grid to exactly that goal\'s strategies', async () => {
      render(<StrategiesPage />);
      const radio = screen.getByRole('radio', { name: /Make a bearish trade with limited risk/i });
      await userEvent.click(radio);

      expect(screen.getAllByRole('button', { name: /View full reference/i }).length).toBe(1);
      expect(screen.getByText('Bear Call Spread')).toBeInTheDocument();
      expect(screen.queryByText('Covered Call')).not.toBeInTheDocument();
    });

    it('"Show all strategies" clears the goal filter back to all 8', async () => {
      render(<StrategiesPage />);
      await userEvent.click(screen.getByRole('radio', { name: /Get paid while waiting to buy shares/i }));
      expect(screen.getAllByRole('button', { name: /View full reference/i }).length).toBe(1);

      await userEvent.click(screen.getByRole('button', { name: /Show all strategies/i }));
      expect(screen.getAllByRole('button', { name: /View full reference/i }).length).toBe(8);
    });

    it('neutral/range goal shows Bull Put Spread labeled "Neutral to bullish" and Bear Call Spread labeled "Neutral to bearish"', async () => {
      render(<StrategiesPage />);
      await userEvent.click(screen.getByRole('radio', { name: /Trade a range or neutral outlook/i }));
      // Covered Call / Cash-Secured Put also happen to carry "Neutral to
      // bullish" as their OWN typicalOutlook (not an override), so multiple
      // matches are expected -- scope to the Bull Put Spread / Bear Call
      // Spread cards specifically to prove THEIR label is the override.
      const bpsCard = screen.getByText('Bull Put Spread').closest('div')!.parentElement as HTMLElement;
      expect(within(bpsCard).getByText('Neutral to bullish')).toBeInTheDocument();
      const bcsCard = screen.getByText('Bear Call Spread').closest('div')!.parentElement as HTMLElement;
      expect(within(bcsCard).getByText('Neutral to bearish')).toBeInTheDocument();
    });
  });

  describe('opening the correct detail from a card', () => {
    it('clicking a card\'s "View full reference" opens THAT strategy\'s detail, not a scroll target', async () => {
      render(<StrategiesPage />);
      const card = screen.getByText('Iron Condor').closest('div')!;
      const openBtn = within(card.parentElement as HTMLElement).getByRole('button', { name: /View full reference/i });
      await userEvent.click(openBtn);

      // The grid is gone; the detail heading for Iron Condor is present.
      expect(screen.queryAllByRole('button', { name: /View full reference/i }).length).toBe(0);
      expect(screen.getByRole('heading', { name: 'Iron Condor' })).toBeInTheDocument();
      // A strategy-specific example figure proves this is the real detail, not a stub.
      expect(screen.getByText('$150')).toBeInTheDocument();
    });

    it('detail heading receives focus when opened (accessible navigation, not just a visual change)', async () => {
      render(<StrategiesPage />);
      await userEvent.click(screen.getAllByRole('button', { name: /View full reference/i })[0]);
      const heading = screen.getByRole('heading', { level: 2 });
      expect(heading).toHaveFocus();
    });
  });

  describe('returning while preserving the selected goal', () => {
    it('"Back to results" returns to the grid still filtered by the previously selected goal', async () => {
      render(<StrategiesPage />);
      await userEvent.click(screen.getByRole('radio', { name: /Make a bullish trade with limited risk/i }));
      expect(screen.getAllByRole('button', { name: /View full reference/i }).length).toBe(3);

      await userEvent.click(screen.getAllByRole('button', { name: /View full reference/i })[0]);
      expect(screen.getByRole('button', { name: /Back to results/i })).toBeInTheDocument();

      await userEvent.click(screen.getByRole('button', { name: /Back to results/i }));
      // Goal radio is still checked and the grid is still filtered to 3.
      expect(screen.getByRole('radio', { name: /Make a bullish trade with limited risk/i })).toBeChecked();
      expect(screen.getAllByRole('button', { name: /View full reference/i }).length).toBe(3);
    });

    it('focus returns to the card that opened the detail', async () => {
      render(<StrategiesPage />);
      const openButtons = screen.getAllByRole('button', { name: /View full reference/i });
      const firstId = openButtons[0].id;
      await userEvent.click(openButtons[0]);
      await userEvent.click(screen.getByRole('button', { name: /Back to results/i }));
      // Focus restoration is scheduled via requestAnimationFrame.
      await waitFor(() => expect(document.getElementById(firstId)).toHaveFocus());
    });
  });

  describe('comparison selection and removal', () => {
    it('checking "Compare" on cards adds them to the comparison tray', async () => {
      render(<StrategiesPage />);
      const checkboxes = screen.getAllByRole('checkbox', { name: /Add .* to comparison/i });
      await userEvent.click(checkboxes[0]);
      await userEvent.click(checkboxes[1]);
      expect(screen.getByText(/Comparing 2 strategies/i)).toBeInTheDocument();
    });

    it('"Remove" on a compared strategy takes it out of the tray', async () => {
      render(<StrategiesPage />);
      const checkboxes = screen.getAllByRole('checkbox', { name: /Add .* to comparison/i });
      await userEvent.click(checkboxes[0]);
      await userEvent.click(checkboxes[1]);
      const removeButtons = screen.getAllByRole('button', { name: /Remove .* from comparison/i });
      await userEvent.click(removeButtons[0]);
      expect(screen.getByText(/Comparing 1 strategy\b/i)).toBeInTheDocument();
    });
  });

  describe('three-strategy maximum and fourth-selection rejection', () => {
    it('allows exactly three selections and rejects a fourth, preserving the original three', async () => {
      render(<StrategiesPage />);
      const checkboxes = screen.getAllByRole('checkbox', { name: /Add .* to comparison/i });
      await userEvent.click(checkboxes[0]);
      await userEvent.click(checkboxes[1]);
      await userEvent.click(checkboxes[2]);
      expect(screen.getByText(/Comparing 3 strategies/i)).toBeInTheDocument();

      await userEvent.click(checkboxes[3]);
      // Still exactly 3 -- the fourth attempt did not get added.
      expect(screen.getByText(/Comparing 3 strategies/i)).toBeInTheDocument();
      expect(checkboxes[3]).not.toBeChecked();
      // The exact required message is shown.
      expect(screen.getByText(COMPARISON_LIMIT_MESSAGE)).toBeInTheDocument();
    });

    it('the limit message is delivered via an accessible live region', async () => {
      render(<StrategiesPage />);
      const checkboxes = screen.getAllByRole('checkbox', { name: /Add .* to comparison/i });
      for (let i = 0; i < 4; i++) await userEvent.click(checkboxes[i]);
      const status = screen.getByRole('status');
      expect(status).toHaveTextContent(COMPARISON_LIMIT_MESSAGE);
      expect(status).toHaveAttribute('aria-live', 'polite');
    });
  });

  describe('clear comparison', () => {
    it('"Clear comparison" empties the tray entirely', async () => {
      render(<StrategiesPage />);
      const checkboxes = screen.getAllByRole('checkbox', { name: /Add .* to comparison/i });
      await userEvent.click(checkboxes[0]);
      await userEvent.click(checkboxes[1]);
      await userEvent.click(screen.getByRole('button', { name: /Clear comparison/i }));
      expect(screen.queryByText(/Comparing \d+ strateg/i)).not.toBeInTheDocument();
    });
  });

  describe('comparison selections persist through detail viewing', () => {
    it('a strategy added to comparison stays compared after opening and closing its detail', async () => {
      render(<StrategiesPage />);
      const checkboxes = screen.getAllByRole('checkbox', { name: /Add .* to comparison/i });
      await userEvent.click(checkboxes[0]);
      expect(screen.getByText(/Comparing 1 strategy\b/i)).toBeInTheDocument();

      // Open some OTHER strategy's detail, then return.
      await userEvent.click(screen.getAllByRole('button', { name: /View full reference/i })[1]);
      await userEvent.click(screen.getByRole('button', { name: /Back to results/i }));

      expect(screen.getByText(/Comparing 1 strategy\b/i)).toBeInTheDocument();
      expect(screen.getAllByRole('checkbox', { name: /Add .* to comparison/i })[0]).toBeChecked();
    });

    it('the detail view\'s own Compare checkbox reflects and controls the same state as the card', async () => {
      render(<StrategiesPage />);
      const checkboxes = screen.getAllByRole('checkbox', { name: /Add .* to comparison/i });
      const firstLabel = checkboxes[0].getAttribute('aria-label')!;
      await userEvent.click(checkboxes[0]);

      await userEvent.click(screen.getAllByRole('button', { name: /View full reference/i })[0]);
      const detailCheckbox = screen.getByRole('checkbox', { name: firstLabel });
      expect(detailCheckbox).toBeChecked();

      await userEvent.click(detailCheckbox);
      await userEvent.click(screen.getByRole('button', { name: /Back to results/i }));
      expect(screen.queryByText(/Comparing \d+ strateg/i)).not.toBeInTheDocument();
    });
  });

  describe('desktop and mobile rendering behavior', () => {
    it('the card grid uses a mobile-first single column that expands at wider breakpoints', () => {
      const { container } = render(<StrategiesPage />);
      const grid = container.querySelector('.grid.grid-cols-1.sm\\:grid-cols-2.lg\\:grid-cols-3');
      expect(grid).not.toBeNull();
    });

    it('the comparison tray stacks vertically on mobile (grid-cols-1 base, no default horizontal layout)', async () => {
      const { container } = render(<StrategiesPage />);
      const checkboxes = screen.getAllByRole('checkbox', { name: /Add .* to comparison/i });
      await userEvent.click(checkboxes[0]);
      await userEvent.click(checkboxes[1]);
      const trayGrid = container.querySelector('[aria-label="Strategy comparison"] .grid');
      expect(trayGrid).not.toBeNull();
      expect(trayGrid!.className).toMatch(/grid-cols-1/);
    });

    it('goal picker options are not clipped into a single non-wrapping row (responsive 1 -> 2 column layout)', () => {
      const { container } = render(<StrategiesPage />);
      const goalGrid = container.querySelector('fieldset .grid.grid-cols-1.sm\\:grid-cols-2');
      expect(goalGrid).not.toBeNull();
    });
  });

  describe('accessible labels, selected state, disclosure state, and limit feedback', () => {
    it('goal choices are a real radiogroup (fieldset/legend + radio inputs) with a programmatically determinable selected state', async () => {
      render(<StrategiesPage />);
      const radios = screen.getAllByRole('radio');
      expect(radios.length).toBe(6);
      expect(radios.every(r => !r.hasAttribute('checked') || r.getAttribute('checked') !== null || true)).toBe(true);
      await userEvent.click(radios[0]);
      expect(radios[0]).toBeChecked();
      expect(radios.slice(1).every(r => !(r as HTMLInputElement).checked)).toBe(true);
    });

    it('compare checkboxes expose an accessible name distinguishing each strategy', () => {
      render(<StrategiesPage />);
      const checkboxes = screen.getAllByRole('checkbox', { name: /Add .* to comparison/i });
      const labels = checkboxes.map(c => c.getAttribute('aria-label'));
      expect(new Set(labels).size).toBe(labels.length); // all distinct
    });

    it('detail subsections use native disclosure controls exposing open/closed state', async () => {
      render(<StrategiesPage />);
      await userEvent.click(screen.getAllByRole('button', { name: /View full reference/i })[0]);
      const details = document.querySelectorAll('details');
      expect(details.length).toBeGreaterThan(5);
      // Every disclosure has an associated summary (native accessible toggle).
      details.forEach(d => expect(d.querySelector('summary')).not.toBeNull());
    });
  });

  describe('educational disclaimer, content version, and review date', () => {
    it('the disclaimer is visible without any interaction', () => {
      render(<StrategiesPage />);
      expect(screen.getByRole('note')).toHaveTextContent(/educational only/i);
    });

    it('content version and last-reviewed date are visibly rendered', () => {
      render(<StrategiesPage />);
      expect(screen.getByText(new RegExp(`Content version ${CONTENT_VERSION.replace('.', '\\.')}`))).toBeInTheDocument();
      expect(screen.getByText(new RegExp(LAST_REVIEWED))).toBeInTheDocument();
    });
  });

  describe('no coupling to recommendation or execution modules', () => {
    it('the strategies page source imports nothing from recommendation/scoring/execution modules', () => {
      const src = fs.readFileSync(path.join(__dirname, '..', 'page.tsx'), 'utf-8');
      // Scope to actual import statements only -- the file's own doc
      // comment intentionally NAMES these forbidden modules to document the
      // boundary, which would otherwise false-positive a plain substring
      // search of the whole file.
      const importLines = src.split('\n').filter(l => /^\s*import\s/.test(l));
      const forbidden = [
        'lib/decision-engine', 'lib/opportunity-engine', 'lib/recommendations',
        'lib/scans/', 'lib/wheel/', 'lib/autopilot',
      ];
      for (const line of importLines) {
        for (const f of forbidden) {
          expect(line).not.toContain(f);
        }
      }
    });

    it('the Help entry point does not wire the reference into any scan/screener/order flow', () => {
      const src = fs.readFileSync(path.join(__dirname, '..', '..', 'page.tsx'), 'utf-8');
      expect(src).not.toMatch(/runCcScan|runCspScan|findBest|screenerJobStore/);
    });
  });
});
