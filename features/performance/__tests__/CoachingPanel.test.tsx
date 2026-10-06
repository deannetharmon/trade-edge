// features/performance/__tests__/CoachingPanel.test.tsx

import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import type { ClosedTrade } from '@/lib/tradeLog/types';
import { buildPerformanceReport } from '@/lib/tradeLog/performanceMetrics';
import { buildCoachingInput } from '@/lib/tradeLog/coachingInput';
import { CoachingPanel } from '../CoachingPanel';
import dean from '@/lib/tradeLog/__tests__/fixtures/dean-trade-log-2026-10-06.json';

const th = { card: '', border: '', text: '', textMuted: '', textFaint: '' };
const input = (trades: ClosedTrade[]) => buildCoachingInput({ report: buildPerformanceReport(trades), from: '2026-04-29', to: '2026-10-05', label: 'Apr 29 – Oct 5', accountProfit: { status: 'UNAVAILABLE', reason: 'No balance.' }, balanceHistory: [], sizeOverrides: new Set() });
const reply = (summary: string) => ({ ok: true, json: async () => ({ model: 'gpt-5.6-terra', content: [{ type: 'text', text: JSON.stringify({ summary, habits: { beyondStop: 'Five trades blew through the stop.' }, strategies: {}, tickers: '', changes: [{ title: 'Close at the stop', habit: 'beyondStop', detail: 'No exceptions.' }] }) }] }) });

afterEach(() => { vi.unstubAllGlobals(); });

describe('PERF-AI-0001 coaching panel', () => {
  it('renders app-computed cards, the AI text, the model, and the change dollars from the input', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(reply('The period made $2,450; the stop breaches cost $1,637.')));
    render(<CoachingPanel th={th} input={input(dean as unknown as ClosedTrade[])} onClose={() => {}} />);
    expect(await screen.findByText('The period made $2,450; the stop breaches cost $1,637.')).toBeInTheDocument();
    expect(screen.getByText(/model: gpt-5.6-terra/)).toBeInTheDocument();
    expect(screen.getByText('Lost more than the 2× stop')).toBeInTheDocument();
    expect(screen.getByText(/\+\$402 saved by closing at the stop this period/)).toBeInTheDocument();
    expect(screen.queryByText(/Unverified figures/)).not.toBeInTheDocument();
  });
  it('retries once on an invented figure, then shows the unverified banner', async () => {
    const fetchMock = vi.fn().mockResolvedValue(reply('You lost $9,999 to the stop.'));
    vi.stubGlobal('fetch', fetchMock);
    render(<CoachingPanel th={th} input={input(dean as unknown as ClosedTrade[])} onClose={() => {}} />);
    expect(await screen.findByText(/Unverified figures/)).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const retryBody = JSON.parse(fetchMock.mock.calls[1][1].body);
    expect(retryBody.messages[2].content).toContain('$9,999');
    expect(retryBody.model).toBe('gpt-5.6-terra');
  });
  it('shows the AI-unavailable state without touching the numbers', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 503, json: async () => ({ error: 'OpenAI error 503' }) }));
    render(<CoachingPanel th={th} input={input(dean as unknown as ClosedTrade[])} onClose={() => {}} />);
    await waitFor(() => expect(screen.getByText(/did not respond \(OpenAI error 503\)/)).toBeInTheDocument());
    expect(screen.getByText('Lost more than the 2× stop')).toBeInTheDocument();
  });
  it('empty period: no AI call, a clear message', () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    render(<CoachingPanel th={th} input={input([])} onClose={() => {}} />);
    expect(screen.getByText(/No closed trades between/)).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
