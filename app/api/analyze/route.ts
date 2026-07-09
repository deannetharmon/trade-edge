// app/api/analyze/route.ts
// Server-side proxy for OpenAI API with optional web-search support.
// Model names are selected by AI profile in lib/ai/models.ts.

import { NextRequest, NextResponse } from 'next/server';
import { getAiModel, isAiProfile, type AiProfile } from '@/lib/ai/models';

const OPENAI_API = 'https://api.openai.com/v1/chat/completions';
const OPENAI_RESPONSES_API = 'https://api.openai.com/v1/responses';
const SAFE_FALLBACK_MODEL = process.env.AI_FAST_MODEL ?? process.env.AI_DEFAULT_MODEL ?? 'gpt-4o-mini';

function requestedProfile(body: any, fallback: AiProfile): AiProfile {
  return isAiProfile(body?.profile) ? body.profile : fallback;
}

function selectedModel(body: any, fallbackProfile: AiProfile): string {
  // Keep backward compatibility: if a caller explicitly sends "model", try it first.
  // If that model is unavailable, the route retries with the configured profile/default model.
  if (typeof body?.model === 'string' && body.model.trim()) return body.model.trim();
  return getAiModel(requestedProfile(body, fallbackProfile));
}

function fallbackModel(body: any, fallbackProfile: AiProfile): string {
  const configured = getAiModel(requestedProfile(body, fallbackProfile));
  return configured || SAFE_FALLBACK_MODEL;
}

function shouldRetryWithFallback(status: number, message: string, attempted: string, fallback: string): boolean {
  if (!attempted || attempted === fallback) return false;
  const msg = message.toLowerCase();
  return status === 400 || status === 404 || msg.includes('model') || msg.includes('does not exist') || msg.includes('access');
}

// Converts an Anthropic-shaped image content part
// ({ type: 'image', source: { type: 'base64', media_type, data } })
// into the shape OpenAI's Chat Completions API actually accepts
// ({ type: 'image_url', image_url: { url: 'data:<mime>;base64,<data>' } }).
function toOpenAiContent(content: any): any {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return content;

  return content.map((part: any) => {
    if (part?.type === 'image' && part?.source?.type === 'base64') {
      const mediaType = part.source.media_type ?? 'image/jpeg';
      const data = part.source.data ?? '';
      return { type: 'image_url', image_url: { url: `data:${mediaType};base64,${data}` } };
    }
    return part;
  });
}

function normalizeChatMessages(body: any): any[] {
  const messages: any[] = [];

  if (body.system) {
    messages.push({ role: 'system', content: body.system });
  }

  for (const m of body.messages ?? []) {
    if (!m?.role) continue;
    messages.push({ role: m.role, content: toOpenAiContent(m.content) });
  }

  return messages;
}

function extractResponsesText(data: any): string {
  if (typeof data?.output_text === 'string') return data.output_text;

  const outputItems: any[] = data?.output ?? [];
  return outputItems
    .filter((item: any) => item.type === 'message')
    .flatMap((item: any) => item.content ?? [])
    .filter((c: any) => c.type === 'output_text' || c.type === 'text')
    .map((c: any) => c.text ?? '')
    .join('');
}

async function callChatCompletions(apiKey: string, model: string, messages: any[], maxTokens: number) {
  const res = await fetch(OPENAI_API, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      max_tokens: maxTokens,
      messages,
    }),
  });

  const data = await res.json();
  return { res, data };
}

export async function POST(req: NextRequest) {
  const apiKey = process.env.OPENAI_API_KEY ?? process.env.NEXT_PUBLIC_OPENAI_API_KEY;

  if (!apiKey) {
    return NextResponse.json({ error: 'OPENAI_API_KEY not configured' }, { status: 500 });
  }

  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
  }

  const wantsSearch = body.web_search === true;

  if (wantsSearch) {
    return handleWithSearch(body, apiKey);
  }

  return handleStandard(body, apiKey);
}

// ── Standard chat completions ──────────────────────────────────────────────
async function handleStandard(body: any, apiKey: string) {
  const messages = normalizeChatMessages(body);
  const profile = requestedProfile(body, 'analysis');
  const model = selectedModel(body, 'analysis');
  const fallback = fallbackModel(body, 'analysis');
  const maxTokens = body.max_tokens ?? 1000;

  try {
    let { res, data } = await callChatCompletions(apiKey, model, messages, maxTokens);

    if (!res.ok) {
      const message = data?.error?.message ?? `OpenAI error ${res.status}`;
      if (shouldRetryWithFallback(res.status, message, model, fallback)) {
        ({ res, data } = await callChatCompletions(apiKey, fallback, messages, maxTokens));
      }
    }

    if (!res.ok && fallback !== SAFE_FALLBACK_MODEL) {
      const message = data?.error?.message ?? `OpenAI error ${res.status}`;
      if (shouldRetryWithFallback(res.status, message, fallback, SAFE_FALLBACK_MODEL)) {
        ({ res, data } = await callChatCompletions(apiKey, SAFE_FALLBACK_MODEL, messages, maxTokens));
      }
    }

    if (!res.ok) {
      return NextResponse.json(
        {
          error: data?.error?.message ?? `OpenAI error ${res.status}`,
          model,
          profile,
        },
        { status: res.status }
      );
    }

    const text = data?.choices?.[0]?.message?.content ?? '';
    return NextResponse.json({ content: [{ type: 'text', text }], model: data?.model ?? model });
  } catch (e: any) {
    return NextResponse.json({ error: e.message ?? 'Proxy fetch failed', model }, { status: 502 });
  }
}

// ── Optional web search via Responses API ──────────────────────────────────
async function handleWithSearch(body: any, apiKey: string) {
  const model = selectedModel(body, 'search');

  const input: any[] = [];
  for (const m of body.messages ?? []) {
    if (m.role === 'user') {
      input.push({ role: 'user', content: m.content });
    } else if (m.role === 'assistant') {
      const content = typeof m.content === 'string'
        ? m.content
        : m.content?.find((p: any) => p.type === 'text')?.text ?? '';
      input.push({ role: 'assistant', content });
    }
  }

  try {
    const res = await fetch(OPENAI_RESPONSES_API, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        tools: [{ type: 'web_search_preview' }],
        instructions: body.system ?? '',
        input,
        max_output_tokens: body.max_tokens ?? 1000,
      }),
    });

    const data = await res.json();

    if (!res.ok) {
      return NextResponse.json(
        {
          error: data?.error?.message ?? `OpenAI search error ${res.status}`,
          model,
          profile: requestedProfile(body, 'search'),
        },
        { status: res.status }
      );
    }

    const text = extractResponsesText(data);
    return NextResponse.json({ content: [{ type: 'text', text }], model });
  } catch (e: any) {
    return NextResponse.json({ error: e.message ?? 'Search proxy failed', model }, { status: 502 });
  }
}
