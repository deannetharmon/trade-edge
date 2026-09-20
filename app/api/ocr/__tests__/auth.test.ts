// app/api/ocr/__tests__/auth.test.ts
//
// AI-SEC-0001: /api/ocr requires a signed-in session and the server-only
// OPENAI_API_KEY, and accepts only image media types.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const getServerSession = vi.fn();

vi.mock('next-auth', () => ({ getServerSession: (...args: unknown[]) => getServerSession(...args) }));
vi.mock('@/lib/auth', () => ({ authOptions: {} }));

const fetchMock = vi.fn();

function requestWith(body: unknown) {
  const json = vi.fn(async () => body);
  return { req: { json } as unknown as import('next/server').NextRequest, json };
}

beforeEach(() => {
  getServerSession.mockReset();
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
  vi.stubEnv('OPENAI_API_KEY', 'test-server-key');
  vi.stubEnv('NEXT_PUBLIC_OPENAI_API_KEY', '');
});

afterEach(() => {
  vi.unstubAllEnvs();
  delete process.env.OPENAI_API_KEY;
  vi.unstubAllGlobals();
});

describe('POST /api/ocr authentication and input checks', () => {
  it('returns 401 without a session and never reads the body or calls OpenAI', async () => {
    getServerSession.mockResolvedValue(null);
    const { POST } = await import('../route');
    const { req, json } = requestWith({ base64: 'AAAA', mediaType: 'image/png' });

    const res = await POST(req);

    expect(res.status).toBe(401);
    expect(json).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('does not fall back to NEXT_PUBLIC_OPENAI_API_KEY', async () => {
    getServerSession.mockResolvedValue({ user: { id: 'user-1' } });
    // Truly unset (not empty string): an empty string is not nullish, so it would
    // not exercise a `??` fallback to the public-named variable.
    delete process.env.OPENAI_API_KEY;
    vi.stubEnv('NEXT_PUBLIC_OPENAI_API_KEY', 'public-named-key');
    const { POST } = await import('../route');
    const { req } = requestWith({ base64: 'AAAA', mediaType: 'image/png' });

    const res = await POST(req);

    expect(res.status).toBe(500);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rejects a non-image media type before any upstream call', async () => {
    getServerSession.mockResolvedValue({ user: { id: 'user-1' } });
    const { POST } = await import('../route');
    const { req } = requestWith({ base64: 'AAAA', mediaType: 'application/pdf' });

    const res = await POST(req);

    expect(res.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('still requires base64 and mediaType', async () => {
    getServerSession.mockResolvedValue({ user: { id: 'user-1' } });
    const { POST } = await import('../route');
    const { req } = requestWith({ mediaType: 'image/png' });

    const res = await POST(req);

    expect(res.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('calls OpenAI with the server-only key for a signed-in user', async () => {
    getServerSession.mockResolvedValue({ user: { id: 'user-1' } });
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ choices: [{ message: { content: 'AAPL, MSFT' } }] }),
    });
    const { POST } = await import('../route');
    const { req } = requestWith({ base64: 'AAAA', mediaType: 'image/png' });

    const res = await POST(req);
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data).toEqual({ text: 'AAPL, MSFT' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://api.openai.com/v1/chat/completions');
    expect((init as { headers: Record<string, string> }).headers.Authorization).toBe('Bearer test-server-key');
  });
});
