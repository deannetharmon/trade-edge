'use client';

import { useEffect, useRef, useState } from 'react';
import type { THEMES, Theme } from '@/lib/theme';

export interface AiTextPart { type: 'text'; text: string }
export interface AiImagePart { type: 'image'; source: { type: 'base64'; media_type: string; data: string } }
export type AiContent = string | Array<AiTextPart | AiImagePart>;
export interface AiMessage { role: 'user' | 'assistant'; content: AiContent }

export const POSITION_FOLLOW_UP_PROMPT = `You are a senior options portfolio manager answering follow-up questions about one live position or one proposed management action. Use the supplied POSITION SNAPSHOT and ACTION PROPOSAL as the source of truth. Distinguish confirmed broker evidence from estimates and say exactly what is unavailable. Be direct, concise, and quantitative. AI is advisory only: never claim to submit, cancel, replace, validate, or approve an order; never override a deterministic recommendation or safety block. If the proposal has changed, answer only from the current supplied proposal.`;

export const POSITION_SUGGESTIONS = [
  'What would make this go wrong fast?',
  'What is the strongest reason to wait?',
  'What risk deserves the most attention?',
  'What information is still missing?',
];

export const ACTION_SUGGESTIONS: Record<string, string[]> = {
  TAKE_PROFIT: ['Is the remaining premium worth the risk?', 'What could I gain by waiting?', 'How much capital will this release?', 'Is this an efficient exit?'],
  CUT_LOSSES: ['Is the thesis actually broken?', 'What is the risk of waiting?', 'Would rolling improve the economics?', 'What evidence supports exiting now?'],
  PLACE_GTC: ['Is this target appropriate for this trade?', 'Should the target change because of DTE?', 'Is the target realistically reachable?', 'What would justify a lower target?'],
  CLOSE: ['Am I closing too early?', 'What do I gain by waiting?', 'What risk am I removing?', 'Is this price reasonable?'],
  ROLL: ['Does this roll materially improve the trade?', 'What am I giving up by rolling?', 'Would closing be better?', 'Are the new strike and expiration appropriate?'],
};

async function requestFollowUp(messages: AiMessage[]): Promise<string> {
  const response = await fetch('/api/analyze', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ profile: 'chat', max_tokens: 1400, system: POSITION_FOLLOW_UP_PROMPT, messages }),
  });
  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    throw new Error(payload?.error ?? `API error: ${response.status}`);
  }
  const payload = await response.json();
  return String(payload?.content?.find((part: { type?: string; text?: string }) => part.type === 'text')?.text ?? '').trim();
}

export function PositionAiConversation({ contextKey, initialContext, suggestions = POSITION_SUGGESTIONS, th, defaultOpen = true, label = 'Ask a follow-up' }: {
  contextKey: string;
  initialContext: string;
  suggestions?: string[];
  th: typeof THEMES[Theme];
  defaultOpen?: boolean;
  label?: string;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const [messages, setMessages] = useState<AiMessage[]>([{ role: 'assistant', content: initialContext }]);
  const [input, setInput] = useState('');
  const [images, setImages] = useState<Array<{ name: string; preview: string; mediaType: string; data: string }>>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [failedMessage, setFailedMessage] = useState<AiMessage | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    setMessages([{ role: 'assistant', content: initialContext }]);
    setInput(''); setImages([]); setError(null); setFailedMessage(null); setLoading(false);
  }, [contextKey, initialContext]);

  const sendMessage = async (message: AiMessage, retry = false) => {
    if (loading) return;
    const base = retry ? messages : [...messages, message];
    if (!retry) setMessages(base);
    setInput(''); setImages([]); setError(null); setFailedMessage(null); setLoading(true);
    try {
      const reply = await requestFollowUp(base);
      setMessages(current => [...current, { role: 'assistant', content: reply }]);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Follow-up failed');
      setFailedMessage(message);
    } finally { setLoading(false); }
  };

  const submit = () => {
    const text = input.trim();
    if ((!text && images.length === 0) || loading) return;
    const content: AiContent = images.length === 0 ? text : [
      ...images.map(image => ({ type: 'image' as const, source: { type: 'base64' as const, media_type: image.mediaType, data: image.data } })),
      ...(text ? [{ type: 'text' as const, text }] : []),
    ];
    void sendMessage({ role: 'user', content });
  };

  const selectImages = (files: FileList | null) => {
    const selected = Array.from(files ?? []).slice(0, Math.max(0, 5 - images.length));
    selected.forEach(file => {
      const reader = new FileReader();
      reader.onload = () => {
        const preview = String(reader.result ?? '');
        const [, data = ''] = preview.split(',');
        setImages(current => [...current, { name: file.name, preview, data, mediaType: file.type || 'image/jpeg' }].slice(0, 5));
      };
      reader.readAsDataURL(file);
    });
  };

  const textOf = (content: AiContent) => typeof content === 'string' ? content : content.filter((part): part is AiTextPart => part.type === 'text').map(part => part.text).join(' ');

  return <section className={`border-t ${th.border}`} aria-label={label}>
    <button type="button" aria-expanded={open} onClick={() => setOpen(value => !value)} className={`flex min-h-11 w-full items-center justify-between px-4 text-left text-xs font-bold text-indigo-300 focus:ring-2 focus:ring-indigo-400`}>
      <span>◈ {label}</span><span aria-hidden="true">{open ? '−' : '+'}</span>
    </button>
    {open && <div className="space-y-3 px-4 pb-4">
      {messages.length > 1 && <div className="max-h-72 space-y-2 overflow-y-auto" aria-live="polite">{messages.slice(1).map((message, index) => <div key={index} className={`rounded-lg border px-3 py-2 text-xs ${message.role === 'user' ? 'ml-8 border-indigo-500/40 bg-indigo-500/10 text-indigo-100' : `${th.border} ${th.card} ${th.textMuted}`}`}>{textOf(message.content)}</div>)}{loading && <p className="text-xs text-indigo-300">Thinking…</p>}</div>}
      {messages.length === 1 && <div className="flex flex-wrap gap-1.5">{suggestions.map(suggestion => <button key={suggestion} type="button" onClick={() => { setInput(suggestion); inputRef.current?.focus(); }} className={`rounded-full border ${th.border} px-2.5 py-1 text-[10px] ${th.textFaint} hover:border-indigo-500 hover:text-indigo-300`}>{suggestion}</button>)}</div>}
      {images.length > 0 && <div className="flex flex-wrap gap-2">{images.map((image, index) => <div key={`${image.name}-${index}`} className="relative"><img src={image.preview} alt={image.name} className="max-h-20 rounded border border-indigo-500/40"/><button type="button" aria-label={`Remove ${image.name}`} onClick={() => setImages(current => current.filter((_, i) => i !== index))} className="absolute -right-1 -top-1 rounded-full bg-red-600 px-1 text-[9px]">×</button></div>)}</div>}
      {error && <div role="alert" className="text-xs text-red-400">{error}{failedMessage && <button type="button" onClick={() => void sendMessage(failedMessage, true)} className="ml-2 underline">Retry</button>}</div>}
      <div className="flex items-end gap-2">
        <input ref={fileRef} className="hidden" type="file" accept="image/*" multiple onChange={event => { selectImages(event.target.files); event.target.value = ''; }}/>
        <button type="button" aria-label="Attach images" disabled={loading || images.length >= 5} onClick={() => fileRef.current?.click()} className={`min-h-9 min-w-9 rounded border ${th.border} ${th.textFaint}`}>⌕</button>
        <textarea ref={inputRef} value={input} onChange={event => setInput(event.target.value)} onKeyDown={event => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); submit(); } }} rows={2} disabled={loading} placeholder="Ask a follow-up question…" className={`min-h-11 flex-1 resize-y rounded border ${th.inputBorder} ${th.input} px-3 py-2 text-xs ${th.text}`}/>
        <button type="button" onClick={submit} disabled={loading || (!input.trim() && images.length === 0)} className="min-h-11 rounded bg-indigo-600 px-3 text-xs font-bold text-white disabled:opacity-40">Send</button>
      </div>
      <p className={`text-[10px] ${th.textFaint}`}>Advisory only. AI cannot change the Suggested Action, modify this proposal, or submit an order.</p>
    </div>}
  </section>;
}
