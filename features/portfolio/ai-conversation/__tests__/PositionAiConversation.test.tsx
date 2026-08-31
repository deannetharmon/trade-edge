import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { THEMES } from '@/lib/theme';
import { PositionAiConversation } from '../PositionAiConversation';

describe('PositionAiConversation', () => {
  beforeEach(() => vi.restoreAllMocks());

  it('keeps complete multi-turn history and never exposes an execution callback', async () => {
    const requests: any[] = [];
    vi.stubGlobal('fetch', vi.fn(async (_input, init) => {
      requests.push(JSON.parse(String(init?.body)));
      return { ok: true, json: async () => ({ content: [{ type: 'text', text: `answer ${requests.length}` }] }) } as Response;
    }));
    const user = userEvent.setup();
    render(<PositionAiConversation contextKey="AAPL-1" initialContext="POSITION SNAPSHOT AAPL-1" th={THEMES.dark} />);
    const input = screen.getByPlaceholderText('Ask a follow-up question…');
    await user.type(input, 'first question');
    await user.keyboard('{Enter}');
    expect(await screen.findByText('answer 1')).toBeInTheDocument();
    await user.type(input, 'second question');
    await user.keyboard('{Enter}');
    expect(await screen.findByText('answer 2')).toBeInTheDocument();
    expect(requests[1].messages.map((message: any) => message.content)).toEqual([
      'POSITION SNAPSHOT AAPL-1', 'first question', 'answer 1', 'second question',
    ]);
    expect(screen.getByText(/AI cannot change the Suggested Action/)).toBeInTheDocument();
  });

  it('retries the exact failed outbound message', async () => {
    let attempt = 0;
    const bodies: any[] = [];
    vi.stubGlobal('fetch', vi.fn(async (_input, init) => {
      attempt += 1; bodies.push(JSON.parse(String(init?.body)));
      if (attempt === 1) return { ok: false, status: 503, json: async () => ({ error: 'temporarily unavailable' }) } as Response;
      return { ok: true, json: async () => ({ content: [{ type: 'text', text: 'recovered' }] }) } as Response;
    }));
    const user = userEvent.setup();
    render(<PositionAiConversation contextKey="AAPL-1" initialContext="snapshot" th={THEMES.dark} />);
    await user.type(screen.getByPlaceholderText('Ask a follow-up question…'), 'retain this question');
    await user.keyboard('{Enter}');
    await user.click(await screen.findByRole('button', { name: 'Retry' }));
    expect(await screen.findByText('recovered')).toBeInTheDocument();
    expect(bodies[1].messages[1].content).toBe('retain this question');
    expect(screen.getAllByText('retain this question')).toHaveLength(1);
  });
});
