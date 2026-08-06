// app/help/strategies/__tests__/OptionsStrategyReference.test.tsx
//
// HELP-0001 — UI/wiring tests for the Options Strategy Reference page: goal
// filtering, detail navigation, comparison tray behavior, accessibility, and
// the visible disclaimer/version footer.
//
// HELP-0001 corrective pass: rewritten for the goal-first default (no
// strategy cards render until a goal is chosen or "Browse all strategies"
// is explicitly activated) and the other corrections in this round --
// restored comparison dimensions, focus restoration from both openers, and
// dynamic Add/Remove compare labels. See docs/reviews/
// HELP-0001-Options-Strategy-Reference-Implementation-Report.md section on
// this corrective pass for the full defect list.
import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, within, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import userEvent from '@testing-library/user-event';
import fs from 'node:fs';
import path from 'node:path';
import StrategiesPage from '../page';
import { COMPARISON_LIMIT_MESSAGE, CONTENT_VERSION, LAST_REVIEWED, STRATEGIES } from '@/lib/help/optionsStrategyReference';

function openBtnFor(name: string) {
  const heading = screen.getByText(name);
  const card = heading.closest('div')!.parentElement as HTMLElement;
  return within(card).getByRole('button', { name: /View full reference/i });
}

// Reaches the "all 8 cards visible" state via the explicit secondary
// action, since that is no longer the page's default landing state.
async function browseAll() {
  await userEvent.click(screen.getByRole('button', { name: /Browse all strategies/i }));
}

describe('HELP-0001: Options Strategy Reference page', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  describe('goal-first default / initial state (corrective pass item 5)', () => {
    it('shows NO strategy cards before any goal is chosen or Browse all is activated', () => {
      render(<StrategiesPage />);
      expect(screen.queryAllByRole('button', { name: /View full reference/i }).length).toBe(0);
    });

    it('exposes a real, unchecked initial radio state -- no goal is pre-selected', () => {
      render(<StrategiesPage />);
      const radios = screen.getAllByRole('radio');
      expect(radios.length).toBe(6);
      // Real assertion of the initial state, not a vacuous always-true check.
      for (const r of radios) expect(r).not.toBeChecked();
    });

    it('"Browse all strategies" is a secondary action OUTSIDE the 6-option radiogroup', () => {
      render(<StrategiesPage />);
      expect(screen.getAllByRole('radio').length).toBe(6);
      const browseBtn = screen.getByRole('button', { name: /Browse all strategies/i });
      expect(browseBtn.tagName).toBe('BUTTON');
      // Not part of the radiogroup fieldset's radio inputs.
      expect(screen.queryByRole('radio', { name: /Browse all strategies/i })).not.toBeInTheDocument();
    });

    it('activating "Browse all strategies" shows all 8 strategy cards', async () => {
      render(<StrategiesPage />);
      await browseAll();
      expect(screen.getAllByRole('button', { name: /View full reference/i }).length).toBe(STRATEGIES.length);
      expect(STRATEGIES.length).toBe(8);
      for (const s of STRATEGIES) expect(screen.getByText(s.displayName)).toBeInTheDocument();
    });

    it('selecting a goal directly from the initial state shows only that goal\'s cards (no need to Browse all first)', async () => {
      render(<StrategiesPage />);
      await userEvent.click(screen.getByRole('radio', { name: /Get paid while waiting to buy shares/i }));
      expect(screen.getAllByRole('button', { name: /View full reference/i }).length).toBe(1);
      expect(screen.getByText('Cash-Secured Put')).toBeInTheDocument();
    });
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

    it('"Browse all strategies" (shown once a goal is active) clears the goal filter back to all 8', async () => {
      render(<StrategiesPage />);
      await userEvent.click(screen.getByRole('radio', { name: /Get paid while waiting to buy shares/i }));
      expect(screen.getAllByRole('button', { name: /View full reference/i }).length).toBe(1);

      await browseAll();
      expect(screen.getAllByRole('button', { name: /View full reference/i }).length).toBe(8);
      // And no goal radio is checked anymore.
      for (const r of screen.getAllByRole('radio')) expect(r).not.toBeChecked();
    });

    it('neutral/range goal shows Bull Put Spread labeled "Neutral to bullish" and Bear Call Spread labeled "Neutral to bearish"', async () => {
      render(<StrategiesPage />);
      await userEvent.click(screen.getByRole('radio', { name: /Trade a range or neutral outlook/i }));
      const bpsCard = screen.getByText('Bull Put Spread').closest('div')!.parentElement as HTMLElement;
      expect(within(bpsCard).getByText('Neutral to bullish')).toBeInTheDocument();
      const bcsCard = screen.getByText('Bear Call Spread').closest('div')!.parentElement as HTMLElement;
      expect(within(bcsCard).getByText('Neutral to bearish')).toBeInTheDocument();
    });
  });

  describe('opening the correct detail from a card', () => {
    it('clicking a card\'s "View full reference" opens THAT strategy\'s detail, not a scroll target', async () => {
      render(<StrategiesPage />);
      await browseAll();
      await userEvent.click(openBtnFor('Iron Condor'));

      expect(screen.queryAllByRole('button', { name: /View full reference/i }).length).toBe(0);
      expect(screen.getByRole('heading', { name: 'Iron Condor' })).toBeInTheDocument();
      expect(screen.getByText('$150')).toBeInTheDocument();
    });

    it('detail heading receives focus when opened (accessible navigation, not just a visual change)', async () => {
      render(<StrategiesPage />);
      await browseAll();
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
      expect(screen.getByRole('radio', { name: /Make a bullish trade with limited risk/i })).toBeChecked();
      expect(screen.getAllByRole('button', { name: /View full reference/i }).length).toBe(3);
    });
  });

  describe('focus restoration for every opening source (corrective pass item 4)', () => {
    it('focus returns to the CARD button that opened the detail', async () => {
      render(<StrategiesPage />);
      await browseAll();
      const openButtons = screen.getAllByRole('button', { name: /View full reference/i });
      const firstId = openButtons[0].id;
      await userEvent.click(openButtons[0]);
      await userEvent.click(screen.getByRole('button', { name: /Back to results/i }));
      await waitFor(() => expect(document.getElementById(firstId)).toHaveFocus());
    });

    it('focus returns to the COMPARISON-TRAY button that opened the detail', async () => {
      render(<StrategiesPage />);
      await browseAll();
      const checkbox = screen.getByRole('checkbox', { name: /Add Iron Condor to comparison/i });
      await userEvent.click(checkbox);

      const trayOpenBtn = within(screen.getByRole('region', { name: /Strategy comparison/i }) as HTMLElement)
        .getByRole('button', { name: 'Iron Condor' });
      const trayOpenBtnId = trayOpenBtn.id;
      await userEvent.click(trayOpenBtn);
      expect(screen.getByRole('heading', { name: 'Iron Condor' })).toBeInTheDocument();

      await userEvent.click(screen.getByRole('button', { name: /Back to results/i }));
      await waitFor(() => expect(document.getElementById(trayOpenBtnId)).toHaveFocus());
    });

    it('required regression: comparing Covered Call, selecting a goal that excludes it, opening it from the comparison tray, and returning lands focus on a valid visible control', async () => {
      render(<StrategiesPage />);
      await browseAll();

      // 1. Add Covered Call to comparison.
      await userEvent.click(screen.getByRole('checkbox', { name: /Add Covered Call to comparison/i }));

      // 2. Select a goal that excludes Covered Call (Bear Call Spread only).
      await userEvent.click(screen.getByRole('radio', { name: /Make a bearish trade with limited risk/i }));
      // Its CARD open-button is gone (goal-filtered out) -- the comparison
      // tray's own same-named button is a distinct element and legitimately
      // still exists, which is exactly the scenario this regression covers.
      expect(document.getElementById('strategy-card-open-covered_call')).toBeNull();

      // 3. Open Covered Call from the comparison tray (its card no longer exists).
      const trayOpenBtn = within(screen.getByRole('region', { name: /Strategy comparison/i }) as HTMLElement)
        .getByRole('button', { name: 'Covered Call' });
      await userEvent.click(trayOpenBtn);
      expect(screen.getByRole('heading', { name: 'Covered Call' })).toBeInTheDocument();

      // 4. Activate Back to Results.
      await userEvent.click(screen.getByRole('button', { name: /Back to results/i }));

      // 5. Focus lands on a valid, visible, focusable control -- in this
      // case the SAME comparison-tray button still exists (goal selection
      // does not remove anything from comparison), so it should be the
      // exact opener. This is the literal defect the original bug produced:
      // it only ever looked for a matching CARD id, which does not exist
      // for Covered Call under this goal, so focus was silently dropped.
      await waitFor(() => expect(document.activeElement).not.toBe(document.body));
      const active = document.activeElement as HTMLElement;
      expect(active).toBeVisible();
      expect(active.tagName === 'BUTTON' || active.tagName === 'H2' || active.tagName === 'INPUT').toBe(true);
    });

    it('fallback: when the opener control no longer exists at all, focus lands on a documented fallback (comparison heading, results heading, or goal picker)', async () => {
      render(<StrategiesPage />);
      await browseAll();
      await userEvent.click(screen.getByRole('checkbox', { name: /Add Covered Call to comparison/i }));

      const trayOpenBtn = within(screen.getByRole('region', { name: /Strategy comparison/i }) as HTMLElement)
        .getByRole('button', { name: 'Covered Call' });
      await userEvent.click(trayOpenBtn);
      expect(screen.getByRole('heading', { name: 'Covered Call' })).toBeInTheDocument();

      // Remove Covered Call from comparison WHILE viewing its own detail --
      // this makes the tray button (the opener) disappear entirely, and
      // since it was the only compared strategy, the whole tray (including
      // its heading) disappears too.
      const detailCheckbox = screen.getByRole('checkbox', { name: /Remove Covered Call from comparison/i });
      await userEvent.click(detailCheckbox);

      await userEvent.click(screen.getByRole('button', { name: /Back to results/i }));

      // A real, visible, focusable control still receives focus -- never a
      // silent focus loss to document.body.
      await waitFor(() => expect(document.activeElement).not.toBe(document.body));
      const active = document.activeElement as HTMLElement;
      expect(active).toBeVisible();
      // With nothing left in comparison, the documented fallback chain lands
      // on the filtered-results heading (Browse-all was active).
      expect(active.id === 'strategy-results-heading' || active.tagName === 'INPUT').toBe(true);
    });
  });

  describe('comparison selection and removal', () => {
    it('checking "Compare" on cards adds them to the comparison tray', async () => {
      render(<StrategiesPage />);
      await browseAll();
      const checkboxes = screen.getAllByRole('checkbox', { name: /Add .* to comparison/i });
      await userEvent.click(checkboxes[0]);
      await userEvent.click(checkboxes[1]);
      expect(screen.getByText(/Comparing 2 strategies/i)).toBeInTheDocument();
    });

    it('"Remove" on a compared strategy takes it out of the tray', async () => {
      render(<StrategiesPage />);
      await browseAll();
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
      await browseAll();
      const checkboxes = screen.getAllByRole('checkbox', { name: /Add .* to comparison/i });
      await userEvent.click(checkboxes[0]);
      await userEvent.click(checkboxes[1]);
      await userEvent.click(checkboxes[2]);
      expect(screen.getByText(/Comparing 3 strategies/i)).toBeInTheDocument();

      await userEvent.click(checkboxes[3]);
      expect(screen.getByText(/Comparing 3 strategies/i)).toBeInTheDocument();
      expect(checkboxes[3]).not.toBeChecked();
      expect(screen.getByText(COMPARISON_LIMIT_MESSAGE)).toBeInTheDocument();
    });

    it('the limit message is delivered via an accessible live region', async () => {
      render(<StrategiesPage />);
      await browseAll();
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
      await browseAll();
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
      await browseAll();
      const checkboxes = screen.getAllByRole('checkbox', { name: /Add .* to comparison/i });
      await userEvent.click(checkboxes[0]);
      expect(screen.getByText(/Comparing 1 strategy\b/i)).toBeInTheDocument();

      await userEvent.click(screen.getAllByRole('button', { name: /View full reference/i })[1]);
      await userEvent.click(screen.getByRole('button', { name: /Back to results/i }));

      expect(screen.getByText(/Comparing 1 strategy\b/i)).toBeInTheDocument();
      expect(screen.getAllByRole('checkbox', { name: /(Add|Remove) .* (to|from) comparison/i })[0]).toBeChecked();
    });

    it('the detail view\'s own Compare checkbox reflects and controls the same state as the card', async () => {
      render(<StrategiesPage />);
      await browseAll();
      const checkboxes = screen.getAllByRole('checkbox', { name: /Add .* to comparison/i });
      const firstDisplayName = STRATEGIES[0].displayName;
      await userEvent.click(checkboxes[0]);

      await userEvent.click(screen.getAllByRole('button', { name: /View full reference/i })[0]);
      const detailCheckbox = screen.getByRole('checkbox', { name: new RegExp(`Remove ${firstDisplayName} from comparison`) });
      expect(detailCheckbox).toBeChecked();

      await userEvent.click(detailCheckbox);
      await userEvent.click(screen.getByRole('button', { name: /Back to results/i }));
      expect(screen.queryByText(/Comparing \d+ strateg/i)).not.toBeInTheDocument();
    });
  });

  describe('dynamic compare checkbox accessible label (corrective pass item 6)', () => {
    it('reads "Add X to comparison" when unchecked and "Remove X from comparison" once checked', async () => {
      render(<StrategiesPage />);
      await browseAll();
      const name = STRATEGIES[0].displayName;
      const checkbox = screen.getByRole('checkbox', { name: new RegExp(`Add ${name} to comparison`) });
      expect(checkbox).not.toBeChecked();

      await userEvent.click(checkbox);
      const sameCheckbox = screen.getByRole('checkbox', { name: new RegExp(`Remove ${name} from comparison`) });
      expect(sameCheckbox).toBeChecked();
      expect(screen.queryByRole('checkbox', { name: new RegExp(`Add ${name} to comparison`) })).not.toBeInTheDocument();

      await userEvent.click(sameCheckbox);
      expect(screen.getByRole('checkbox', { name: new RegExp(`Add ${name} to comparison`) })).not.toBeChecked();
    });
  });

  describe('the six required comparison dimensions (corrective pass item 3)', () => {
    it('shows exactly the six approved primary dimension labels, sourced from the selected strategy records', async () => {
      render(<StrategiesPage />);
      await browseAll();
      await userEvent.click(screen.getByRole('checkbox', { name: /Add Covered Call to comparison/i }));
      await userEvent.click(screen.getByRole('checkbox', { name: /Add Iron Condor to comparison/i }));

      const tray = screen.getByRole('region', { name: /Strategy comparison/i }) as HTMLElement;
      for (const label of ['Typical outlook', 'Capital commitment', 'Maximum-loss type', 'Assignment or exercise obligation', 'Complexity and mechanics', 'Time-decay tendency']) {
        expect(within(tray).getAllByText(label).length).toBeGreaterThan(0);
      }
      // Must NOT substitute in maximum profit / example maximum loss.
      expect(within(tray).queryByText('Max profit')).not.toBeInTheDocument();
      expect(within(tray).queryByText('Max loss')).not.toBeInTheDocument();

      // Values come from the actual canonical records, not placeholders.
      const cc = STRATEGIES.find(s => s.strategyId === 'covered_call')!;
      const ic = STRATEGIES.find(s => s.strategyId === 'iron_condor')!;
      expect(within(tray).getByText(cc.typicalOutlook)).toBeInTheDocument();
      expect(within(tray).getByText(ic.mechanicalLabels.capitalType)).toBeInTheDocument();
      expect(within(tray).getByText(cc.mechanicalLabels.riskLabel)).toBeInTheDocument();
      expect(within(tray).getByText(ic.assignmentExercise)).toBeInTheDocument();
      expect(within(tray).getByText(cc.mechanicalLabels.positionShape)).toBeInTheDocument();
      expect(within(tray).getByText(ic.timeDecay)).toBeInTheDocument();
    });
  });

  describe('desktop and mobile rendering behavior', () => {
    it('the card grid uses a mobile-first single column that expands at wider breakpoints', async () => {
      const { container } = render(<StrategiesPage />);
      await browseAll();
      const grid = container.querySelector('.grid.grid-cols-1.sm\\:grid-cols-2.lg\\:grid-cols-3');
      expect(grid).not.toBeNull();
    });

    it('the comparison tray stacks vertically on mobile (grid-cols-1 base, no default horizontal layout)', async () => {
      const { container } = render(<StrategiesPage />);
      await browseAll();
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
      for (const r of radios) expect(r).not.toBeChecked();

      await userEvent.click(radios[0]);
      expect(radios[0]).toBeChecked();
      expect(radios.slice(1).every(r => !(r as HTMLInputElement).checked)).toBe(true);
    });

    it('compare checkboxes expose an accessible name distinguishing each strategy', async () => {
      render(<StrategiesPage />);
      await browseAll();
      const checkboxes = screen.getAllByRole('checkbox', { name: /Add .* to comparison/i });
      const labels = checkboxes.map(c => c.getAttribute('aria-label'));
      expect(new Set(labels).size).toBe(labels.length);
    });

    it('detail subsections use native disclosure controls exposing open/closed state', async () => {
      render(<StrategiesPage />);
      await browseAll();
      await userEvent.click(screen.getAllByRole('button', { name: /View full reference/i })[0]);
      const details = document.querySelectorAll('details');
      expect(details.length).toBeGreaterThan(5);
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
