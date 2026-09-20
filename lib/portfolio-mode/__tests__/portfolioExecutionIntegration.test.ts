import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import {
  assertLiveContextReady,
  PortfolioModeGuardError,
} from '../guardrails';

const portfolioSource = readFileSync(
  resolve(process.cwd(), 'app/portfolio/page.tsx'),
  'utf8',
);

function section(start: string, end: string): string {
  const startIndex = portfolioSource.indexOf(start);
  const endIndex = portfolioSource.indexOf(
    end,
    startIndex + start.length,
  );

  expect(startIndex, `Missing source marker: ${start}`)
    .toBeGreaterThanOrEqual(0);
  expect(endIndex, `Missing source marker: ${end}`)
    .toBeGreaterThan(startIndex);

  return portfolioSource.slice(startIndex, endIndex);
}

function guardedAction(
  status: 'resolving' | 'ready' | 'invalid',
  mode: 'LIVE' | 'PAPER' | null,
  brokerMutation: () => void,
): void {
  assertLiveContextReady(status, mode, 'test portfolio mutation');
  brokerMutation();
}

describe('PT-0002B portfolio execution integration', () => {
  it.each([
    ['resolving', null],
    ['invalid', null],
    ['ready', 'PAPER'],
  ] as const)(
    'blocks %s/%s before a broker mutation executes',
    (status, mode) => {
      const brokerMutation = vi.fn();

      expect(() =>
        guardedAction(status, mode, brokerMutation),
      ).toThrow(PortfolioModeGuardError);

      expect(brokerMutation).not.toHaveBeenCalled();
    },
  );

  it('allows a confirmed LIVE context', () => {
    const brokerMutation = vi.fn();

    guardedAction('ready', 'LIVE', brokerMutation);

    expect(brokerMutation).toHaveBeenCalledOnce();
  });

  // Each stop-order component has its own submit(); slice per component so the check cannot silently pick up a
  // neighbour's submit (StandaloneLeapsStopControl sits between SetStopLossButton and SetStopLossButtonInner).
  function expectGuardBeforeBrokerWork(componentStart: string, componentEnd: string, guardLabel: string) {
    const block = section(componentStart, componentEnd);
    const submitIndex = block.indexOf('const submit = async () => {');
    const guardIndex = block.indexOf(guardLabel, submitIndex);
    const accessTokenIndex = block.indexOf('const token = await getAccessToken();', submitIndex);

    expect(submitIndex).toBeGreaterThanOrEqual(0);
    expect(guardIndex, `${guardLabel} guard must be inside submit()`).toBeGreaterThan(submitIndex);
    expect(accessTokenIndex, 'the broker token must be requested only after the guard').toBeGreaterThan(guardIndex);
  }

  it('guards SetStopLossButtonInner.submit before submission work', () => {
    expectGuardBeforeBrokerWork('function SetStopLossButtonInner', 'export default function PortfolioPage', "'set stop-loss order'");
  });

  it('guards StandaloneLeapsStopControl.submit before submission work', () => {
    expectGuardBeforeBrokerWork('function StandaloneLeapsStopControl', '// STOP-DIALOG-LABELING-0001 follow-up', "'set standalone LEAPS stop'");
  });

  it('guards cancelPendingOrder before ttDelete', () => {
    const block = section(
      'const cancelPendingOrder = async',
      'const replacePendingOrder = async',
    );

    expect(block.indexOf("'cancel pending order'"))
      .toBeGreaterThanOrEqual(0);
    expect(block.indexOf("'cancel pending order'"))
      .toBeLessThan(block.indexOf('await ttDelete('));
  });

  it('guards replacePendingOrder before its workflow', () => {
    const start = portfolioSource.indexOf(
      'const replacePendingOrder = async',
    );
    const block = portfolioSource.slice(start, start + 6000);

    expect(block.indexOf("'replace pending order'"))
      .toBeGreaterThanOrEqual(0);
    expect(block.indexOf("'replace pending order'"))
      .toBeLessThan(
        block.indexOf(
          'await runPendingOrderReplacementWorkflow(',
        ),
      );
  });

  it('gates PortfolioPage rendering to ready LIVE mode', () => {
    const block = portfolioSource.slice(
      portfolioSource.indexOf(
        'export default function PortfolioPage',
      ),
    );

    expect(block).toContain(
      "portfolioMode.status === 'ready'",
    );
    expect(block).toContain(
      "portfolioMode.mode === 'LIVE'",
    );
    expect(block).toContain('<PortfolioModeGateNotice');
    expect(block).toContain('screenName="Portfolio"');
  });
});
