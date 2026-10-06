// app/screener/__tests__/FindLeapsGolden.test.tsx
//
// LEAPS-QV-0001 Gate 4c (spec Section 12, ruling Q4) -- production-path characterization of the EXISTING Find LEAPS
// scan. Renders the real ScreenerPage, mocks only the network (the app's TastyTrade proxy, answered from the sanitized
// UBER regular-hours audit fixture) and the access token, drives the real flow (add ticker -> FIND LEAPS -> RUN LEAPS
// SCAN) and compares the persisted LEAPS rows to goldens recorded from the unchanged baseline in a separate commit.
// Gate 4 adds modules only; if this fails, a Gate 4 change reached Find LEAPS. Never re-record in a Gate 4 change.

import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import userEvent from '@testing-library/user-event';
import { readFileSync } from 'fs';
import { join } from 'path';
import ScreenerPage from '../page';
import { CommandProvider } from '@/components/commands/CommandProvider';
import { TaskProvider } from '@/components/tasks/TaskProvider';
import { warmScreenerPage, WARM_HOOK_TIMEOUT_MS, WARM_FLOW_TIMEOUT_MS } from './helpers/warmScreenerPage';

const FIXTURE = JSON.parse(readFileSync(join(__dirname, '..', '..', '..', 'lib', 'discovery', 'leaps', '__fixtures__', 'uber-regular-hours-2026-10-05.json'), 'utf8'));
const GOLDEN_PATH = join(__dirname, '__goldens__', 'find-leaps-uber-2026-10-05.json');

const persisted = vi.fn();
vi.mock('@/lib/screener/scanSessionCache', async () => {
  const actual = await vi.importActual<typeof import('@/lib/screener/scanSessionCache')>('@/lib/screener/scanSessionCache');
  return { ...actual, persistLeapsSession: async (session: unknown) => { persisted(session); } };
});
vi.mock('@/lib/scans/tastytrade-client', async () => {
  const actual = await vi.importActual<typeof import('@/lib/scans/tastytrade-client')>('@/lib/scans/tastytrade-client');
  return { ...actual, getAccessToken: vi.fn().mockResolvedValue('fake-token') };
});

function respond(status: number, body: unknown) {
  return { status, ok: status >= 200 && status < 300, json: async () => body, text: async () => JSON.stringify(body) };
}

/** The app's same-origin proxy, answered from the fixture. Anything else the page asks for is an empty, valid reply. */
const proxyFetch = vi.fn(async (input: unknown) => {
  const url = String(input);
  const marker = '/api/tastytrade/proxy?path=';
  if (url.indexOf(marker) < 0) return respond(200, {});
  const path = decodeURIComponent(url.slice(url.indexOf(marker) + marker.length));
  if (path === '/market-data/by-type?equity=UBER') return respond(200, FIXTURE.underlyingQuote);
  if (path === '/option-chains/UBER/nested') return respond(200, FIXTURE.nestedChain);
  if (path.indexOf('/instruments/equities/UBER') === 0) return respond(200, { data: { symbol: 'UBER', 'instrument-type': 'Equity', 'is-etf': false, 'is-index': false } });
  if (path.indexOf('/market-data/by-type?equity-option=') === 0) {
    const asked = path.split('?')[1].split('&').map((p) => decodeURIComponent(p.split('=')[1]));
    return respond(200, { data: { items: FIXTURE.optionQuoteRows.filter((r: { symbol: string }) => asked.indexOf(r.symbol) >= 0) } });
  }
  return respond(200, { data: { items: [] } });
});

function renderScreener() {
  return render(<TaskProvider><CommandProvider><ScreenerPage /></CommandProvider></TaskProvider>);
}

async function runFindLeaps() {
  const input = await screen.findByPlaceholderText(/Add tickers \(comma-separated\)/i);
  await userEvent.type(input, 'UBER');
  await userEvent.click(screen.getByRole('button', { name: 'Add' }));
  await userEvent.click(await screen.findByRole('button', { name: /FIND LEAPS/i }));
  await userEvent.click(await screen.findByRole('button', { name: /RUN LEAPS SCAN/i }));
}

beforeAll(() => warmScreenerPage(async () => {
  renderScreener();
  await screen.findByPlaceholderText(/Add tickers \(comma-separated\)/i, undefined, { timeout: WARM_FLOW_TIMEOUT_MS });
}), WARM_HOOK_TIMEOUT_MS);

beforeEach(() => {
  window.localStorage.clear();
  persisted.mockReset();
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(FIXTURE.nowIso));
  vi.stubGlobal('fetch', proxyFetch);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('Find LEAPS production path (Section 12 goldens)', () => {
  it('produces the recorded rows for the UBER audit fixture', async () => {
    renderScreener();
    await runFindLeaps();
    await waitFor(() => expect(persisted).toHaveBeenCalled(), { timeout: 10_000 });
    const session = persisted.mock.calls[0][0] as { results: Record<string, unknown>[]; filters: unknown; scanBounds: unknown };
    const observed = {
      filters: session.filters,
      scanBounds: session.scanBounds,
      rows: session.results.map((r) => ({
        symbol: r.symbol, expiration: r.expiration, dte: r.dte, strike: r.strike, delta: r.delta, openInterest: r.openInterest,
        bid: r.bid, ask: r.ask, spreadPct: r.spreadPct, extrinsicValue: r.extrinsicValue, score: r.score,
        scoreIncomplete: r.scoreIncomplete, dataQuality: r.dataQuality, ivRank: r.ivRank, ivx: r.ivx, underlyingPrice: r.underlyingPrice,
      })),
    };
    if (process.env.RECORD_FIND_LEAPS_GOLDEN === '1') {
      require('fs').writeFileSync(GOLDEN_PATH, `${JSON.stringify(observed, null, 1)}\n`);
    }
    expect(observed).toEqual(JSON.parse(readFileSync(GOLDEN_PATH, 'utf8')));
  }, 20_000);
});
