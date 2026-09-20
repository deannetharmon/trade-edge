// app/api/ocr/route.ts
//
// Extracts ticker symbols from a screenshot via OpenAI vision.
// AI-SEC-0001: requires a signed-in session; reads only the server-side
// OPENAI_API_KEY (no NEXT_PUBLIC_ fallback); rejects non-image media types.

import { NextRequest, NextResponse } from 'next/server';
import { requireSessionUserId } from '@/lib/ai/requireSession';

const ALLOWED_MEDIA_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif']);

export async function POST(req: NextRequest) {
  const userId = await requireSessionUserId();
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return NextResponse.json({ error: 'OpenAI API key not configured' }, { status: 500 });

  try {
    const { base64, mediaType } = await req.json();
    if (!base64 || !mediaType) {
      return NextResponse.json({ error: 'Missing base64 or mediaType' }, { status: 400 });
    }
    if (!ALLOWED_MEDIA_TYPES.has(String(mediaType))) {
      return NextResponse.json({ error: 'Unsupported image type' }, { status: 400 });
    }

    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: 'gpt-4o',
        max_tokens: 500,
        messages: [{
          role: 'user',
          content: [
            {
              type: 'image_url',
              image_url: {
                url: `data:${mediaType};base64,${base64}`,
                detail: 'high',
              },
            },
            {
              type: 'text',
              text: `This screenshot shows US stock ticker symbols. They may appear as:
- A simple vertical list (one ticker per line)
- A grid of badge/pill UI elements (multiple tickers per row)

Extract every ticker symbol visible. Return ONLY the ticker symbols as a comma-separated list on a single line, nothing else.

Rules:
- Tickers are 2-5 uppercase letters (e.g. AAPL, MSFT, BRK-B)
- Do NOT include: single letters, common words, UI labels, column headers, numbers, percentages
- Do NOT include: ETF, BPS, BCS, IC, IVR, DTE, ROC, POP, NYSE, NASDAQ, or any other non-ticker text
- Preserve hyphens for tickers like BRK-B
- If uncertain whether something is a ticker, omit it
- Return nothing except the comma-separated ticker symbols`,
            },
          ],
        }],
      }),
    });

    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      return NextResponse.json(
        { error: `OpenAI error: ${response.status} — ${err?.error?.message ?? 'unknown'}` },
        { status: response.status }
      );
    }

    const data = await response.json();
    const text: string = data?.choices?.[0]?.message?.content ?? '';
    return NextResponse.json({ text });
  } catch (e: any) {
    return NextResponse.json({ error: e.message ?? 'Internal error' }, { status: 500 });
  }
}
