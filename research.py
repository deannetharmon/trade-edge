#!/usr/bin/env python3
"""
Fix: AI Research panel overlapping position detail columns on the screener page.

Root cause: StockResearch rendered its open chat panel inline in Col 1 of the
ResultCard header row, with a fixed 520px width. When opened, it pushed into
/overlapped Col 2 (badges) and Col 3 (strikes/credit/POP/etc).

Fix:
  1. Split StockResearch into:
       - StockResearchButton  (small inline button, stays in Col 1)
       - StockResearchPanel   (full-width chat panel, presentational)
     State (open/loading/messages/etc.) moves up into ResultCard so both
     pieces share it.
  2. Clicking the button now also expands the card (setExpanded(true)).
  3. The panel renders full-width at the very bottom of the card, after the
     Open Position banner — so it can never overlap the header row columns.

Run from the repo root:
    python3 fix_research_layout.py
"""
import re
import sys

FILE = "app/screener/page.tsx"

with open(FILE, "r", encoding="utf-8") as f:
    src = f.read()

original_src = src

# ---------------------------------------------------------------------------
# 1. Replace the StockResearch component (button + panel combined) with two
#    separate components: StockResearchButton + StockResearchPanel, plus a
#    useStockResearch hook that owns the shared state.
# ---------------------------------------------------------------------------

old_component = '''function StockResearch({ symbol, th, riskContext, tradeContext }: {
  symbol: string; th: typeof THEMES[Theme]; riskContext?: string; tradeContext?: string;
}) {
  const [open, setOpen]           = useState(false);
  const [loading, setLoading]     = useState(false);
  const [initialResult, setInitialResult] = useState<string | null>(null);
  const [messages, setMessages]   = useState<ChatMessage[]>([]);
  const [input, setInput]         = useState('');
  const [chatLoading, setChatLoading] = useState(false);
  const [error, setError]         = useState('');
  const chatBottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const context = tradeContext ?? `${symbol} options analysis`;

  const handleOpen = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (open) { setOpen(false); return; }
    setOpen(true);
    if (initialResult) return;
    setLoading(true); setError('');
    try {
      const text = await fetchStockResearch(symbol, context, riskContext);
      setInitialResult(text);
      setMessages([{ role: 'assistant', content: text }]);
    } catch (err: any) {
      setError(err.message ?? 'Research failed');
    } finally {
      setLoading(false);
    }
  };

  const handleSend = async () => {
    const q = input.trim(); if (!q || chatLoading) return;
    const newMessages: ChatMessage[] = [...messages, { role: 'user', content: q }];
    setMessages(newMessages);
    setInput('');
    setChatLoading(true);
    try {
      const reply = await sendChatMessage(newMessages, symbol, context);
      setMessages(prev => [...prev, { role: 'assistant', content: reply }]);
    } catch (err: any) {
      setMessages(prev => [...prev, { role: 'assistant', content: `Error: ${err.message}` }]);
    } finally {
      setChatLoading(false);
      setTimeout(() => chatBottomRef.current?.scrollIntoView({ behavior: 'smooth' }), 100);
    }
  };

  return (
    <div onClick={e => e.stopPropagation()}>
      <button onClick={handleOpen}
        className={`inline-flex items-center gap-1 text-[9px] px-2 py-0.5 border rounded transition-colors ${
          open ? 'border-indigo-500 text-indigo-400 bg-indigo-500/10'
               : `${th.border} ${th.textFaint} hover:border-indigo-500 hover:text-indigo-400`
        }`}>
        <span className="text-[8px]">◎</span> Research
      </button>

      {open && (
        <div className={`mt-2 rounded-xl border border-indigo-500/30 bg-indigo-500/5 overflow-hidden`}
             style={{ width: '520px', maxWidth: '90vw' }}>
          {/* Header */}
          <div className="flex items-center justify-between px-3 py-2 border-b border-indigo-500/20">
            <p className="text-[9px] text-indigo-400 font-bold uppercase tracking-widest">◎ {symbol} — AI Research</p>
            <button onClick={() => setOpen(false)} className={`text-[10px] ${th.textFaint} hover:text-red-400`}>✕</button>
          </div>
          {/* Chat area */}
          <div className="px-3 py-2 space-y-3 max-h-64 overflow-y-auto">
            {loading && (
              <div className="flex items-center gap-2 py-2">
                <div className="w-3 h-3 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin shrink-0" />
                <span className={`text-[10px] ${th.textFaint}`}>Analyzing {symbol} trade setup...</span>
              </div>
            )}
            {error && <p className="text-red-400 text-[10px]">{error}</p>}
            {messages.map((m, i) => (
              <div key={i} className={`flex gap-2 ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                {m.role === 'assistant' && (
                  <span className="text-[8px] text-indigo-400 mt-1 shrink-0">◎</span>
                )}
                <div className={`text-[11px] leading-relaxed rounded-lg px-2.5 py-1.5 max-w-[90%] ${
                  m.role === 'user'
                    ? 'bg-indigo-500/15 text-indigo-200 border border-indigo-500/30'
                    : `${th.card} ${th.textMuted} border ${th.borderLight}`
                }`}>
                  {m.content}
                </div>
              </div>
            ))}
            {chatLoading && (
              <div className="flex gap-2">
                <span className="text-[8px] text-indigo-400 mt-1">◎</span>
                <div className={`text-[11px] ${th.card} border ${th.borderLight} rounded-lg px-2.5 py-1.5`}>
                  <div className="flex gap-1">
                    <span className="w-1 h-1 bg-indigo-400 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                    <span className="w-1 h-1 bg-indigo-400 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                    <span className="w-1 h-1 bg-indigo-400 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
                  </div>
                </div>
              </div>
            )}
            <div ref={chatBottomRef} />
          </div>
          {/* Input */}
          <div className={`flex gap-2 px-3 py-2 border-t border-indigo-500/20`}>
            <input
              ref={inputRef}
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); } }}
              placeholder="Ask about this trade..."
              className={`flex-1 text-[11px] ${th.input} border ${th.inputBorder} rounded-lg px-2.5 py-1.5 ${th.text} focus:outline-none focus:border-indigo-500 placeholder-slate-500`}
            />
            <button onClick={handleSend} disabled={!input.trim() || chatLoading || loading}
              className="text-[10px] px-3 py-1.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg font-medium transition-colors disabled:opacity-40">
              Send
            </button>
          </div>
        </div>
      )}
    </div>
  );
}'''

new_component = '''// Shared state for the AI Research feature. ResultCard owns one of these per
// card so the inline button (Col 1, header row) and the full-width panel
// (bottom of card, below the Open Position banner) can stay in sync without
// the panel needing to live next to the button in the layout.
function useStockResearch(symbol: string, tradeContext: string | undefined, riskContext: string | undefined) {
  const [open, setOpen]           = useState(false);
  const [loading, setLoading]     = useState(false);
  const [initialResult, setInitialResult] = useState<string | null>(null);
  const [messages, setMessages]   = useState<ChatMessage[]>([]);
  const [input, setInput]         = useState('');
  const [chatLoading, setChatLoading] = useState(false);
  const [error, setError]         = useState('');
  const chatBottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const context = tradeContext ?? `${symbol} options analysis`;

  const handleToggle = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (open) { setOpen(false); return; }
    setOpen(true);
    if (initialResult) return;
    setLoading(true); setError('');
    try {
      const text = await fetchStockResearch(symbol, context, riskContext);
      setInitialResult(text);
      setMessages([{ role: 'assistant', content: text }]);
    } catch (err: any) {
      setError(err.message ?? 'Research failed');
    } finally {
      setLoading(false);
    }
  };

  const handleSend = async () => {
    const q = input.trim(); if (!q || chatLoading) return;
    const newMessages: ChatMessage[] = [...messages, { role: 'user', content: q }];
    setMessages(newMessages);
    setInput('');
    setChatLoading(true);
    try {
      const reply = await sendChatMessage(newMessages, symbol, context);
      setMessages(prev => [...prev, { role: 'assistant', content: reply }]);
    } catch (err: any) {
      setMessages(prev => [...prev, { role: 'assistant', content: `Error: ${err.message}` }]);
    } finally {
      setChatLoading(false);
      setTimeout(() => chatBottomRef.current?.scrollIntoView({ behavior: 'smooth' }), 100);
    }
  };

  return {
    open, loading, error, messages, input, setInput, chatLoading,
    chatBottomRef, inputRef, handleToggle, handleSend,
  };
}

// Small inline trigger — lives in Col 1 of the ResultCard header row.
function StockResearchButton({ research, th }: {
  research: ReturnType<typeof useStockResearch>; th: typeof THEMES[Theme];
}) {
  return (
    <button onClick={research.handleToggle}
      className={`inline-flex items-center gap-1 text-[9px] px-2 py-0.5 border rounded transition-colors ${
        research.open ? 'border-indigo-500 text-indigo-400 bg-indigo-500/10'
             : `${th.border} ${th.textFaint} hover:border-indigo-500 hover:text-indigo-400`
      }`}>
      <span className="text-[8px]">◎</span> Research
    </button>
  );
}

// Full-width chat panel — rendered at the very bottom of the card, below the
// Open Position banner, so it never overlaps the strikes/credit/POP columns
// in the header row above it.
function StockResearchPanel({ symbol, th, research }: {
  symbol: string; th: typeof THEMES[Theme]; research: ReturnType<typeof useStockResearch>;
}) {
  if (!research.open) return null;
  return (
    <div onClick={e => e.stopPropagation()}
         className={`w-full border-t border-indigo-500/30 bg-indigo-500/5 overflow-hidden`}>
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2 border-b border-indigo-500/20">
        <p className="text-[9px] text-indigo-400 font-bold uppercase tracking-widest">◎ {symbol} — AI Research</p>
        <button onClick={(e) => { e.stopPropagation(); research.handleToggle(e); }} className={`text-[10px] ${th.textFaint} hover:text-red-400`}>✕</button>
      </div>
      {/* Chat area */}
      <div className="px-4 py-2 space-y-3 max-h-64 overflow-y-auto">
        {research.loading && (
          <div className="flex items-center gap-2 py-2">
            <div className="w-3 h-3 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin shrink-0" />
            <span className={`text-[10px] ${th.textFaint}`}>Analyzing {symbol} trade setup...</span>
          </div>
        )}
        {research.error && <p className="text-red-400 text-[10px]">{research.error}</p>}
        {research.messages.map((m, i) => (
          <div key={i} className={`flex gap-2 ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
            {m.role === 'assistant' && (
              <span className="text-[8px] text-indigo-400 mt-1 shrink-0">◎</span>
            )}
            <div className={`text-[11px] leading-relaxed rounded-lg px-2.5 py-1.5 max-w-[80%] ${
              m.role === 'user'
                ? 'bg-indigo-500/15 text-indigo-200 border border-indigo-500/30'
                : `${th.card} ${th.textMuted} border ${th.borderLight}`
            }`}>
              {m.content}
            </div>
          </div>
        ))}
        {research.chatLoading && (
          <div className="flex gap-2">
            <span className="text-[8px] text-indigo-400 mt-1">◎</span>
            <div className={`text-[11px] ${th.card} border ${th.borderLight} rounded-lg px-2.5 py-1.5`}>
              <div className="flex gap-1">
                <span className="w-1 h-1 bg-indigo-400 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                <span className="w-1 h-1 bg-indigo-400 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                <span className="w-1 h-1 bg-indigo-400 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
              </div>
            </div>
          </div>
        )}
        <div ref={research.chatBottomRef} />
      </div>
      {/* Input */}
      <div className={`flex gap-2 px-4 py-2 border-t border-indigo-500/20`}>
        <input
          ref={research.inputRef}
          value={research.input}
          onChange={e => research.setInput(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); research.handleSend(); } }}
          placeholder="Ask about this trade..."
          className={`flex-1 text-[11px] ${th.input} border ${th.inputBorder} rounded-lg px-2.5 py-1.5 ${th.text} focus:outline-none focus:border-indigo-500 placeholder-slate-500`}
        />
        <button onClick={research.handleSend} disabled={!research.input.trim() || research.chatLoading || research.loading}
          className="text-[10px] px-3 py-1.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg font-medium transition-colors disabled:opacity-40">
          Send
        </button>
      </div>
    </div>
  );
}'''

count = src.count(old_component)
if count != 1:
    print(f"ERROR: expected 1 match for StockResearch component block, found {count}.")
    print("Aborting without writing changes.")
    sys.exit(1)
src = src.replace(old_component, new_component)

# ---------------------------------------------------------------------------
# 2. In ResultCard: create the research hook near the top of the function
#    body (right after matchingPositions is computed, so symbol/context info
#    is available).
# ---------------------------------------------------------------------------

old_matching = '''  const matchingPositions = (existingPositions ?? []).filter(p => p.symbol === result.symbol);'''

new_matching = '''  const matchingPositions = (existingPositions ?? []).filter(p => p.symbol === result.symbol);

  // AI Research: state lives here so the Col-1 button and the full-width
  // panel at the bottom of the card can share it. See useStockResearch.
  const researchRiskContext = portfolioRisk && (portfolioRisk.sameSymbolCount > 0 || portfolioRisk.sectorCount >= SECTOR_LIMIT)
    ? [
        portfolioRisk.sameSymbolCount > 0 ? `Already holds ${portfolioRisk.sameSymbolCount} position(s) on this symbol.` : null,
        portfolioRisk.sectorCount >= SECTOR_LIMIT ? `${portfolioRisk.sectorCount} open positions in ${portfolioRisk.sectorName} sector.` : null,
      ].filter(Boolean).join(' ')
    : undefined;
  const researchTradeContext = result.bestCandidate
    ? `${result.strategy} ${result.bestCandidate.shortStrike}/${result.bestCandidate.longStrike}${result.strategy === 'IC' ? ` · ${result.bestCandidate.shortCallStrike}/${result.bestCandidate.longCallStrike}` : ''} exp ${result.bestCandidate.expiration} (${result.bestCandidate.dte}d) · credit $${(result.bestCandidate.totalCredit ?? result.bestCandidate.credit).toFixed(2)} · ROC ${result.bestCandidate.roc.toFixed(0)}% · POP ${result.bestCandidate.pop?.toFixed(0)}% · IVR ${result.ivr?.toFixed(1)}%`
    : `${result.strategy} on ${result.symbol}`;
  const research = useStockResearch(result.symbol, researchTradeContext, researchRiskContext);
  // Opening Research expands the card so the full-width panel at the bottom
  // is immediately visible; closing Research does not force a collapse.
  useEffect(() => {
    if (research.open) setExpanded(true);
  }, [research.open]);'''

count = src.count(old_matching)
if count != 1:
    print(f"ERROR: expected 1 match for matchingPositions line, found {count}.")
    sys.exit(1)
src = src.replace(old_matching, new_matching)

# ---------------------------------------------------------------------------
# 3. Replace the old <StockResearch ... /> invocation (Col 1) with the new
#    <StockResearchButton /> using the shared `research` state.
# ---------------------------------------------------------------------------

old_invocation = '''          <StockResearch
            symbol={result.symbol}
            th={th}
            riskContext={portfolioRisk && (portfolioRisk.sameSymbolCount > 0 || portfolioRisk.sectorCount >= SECTOR_LIMIT)
              ? [
                  portfolioRisk.sameSymbolCount > 0 ? `Already holds ${portfolioRisk.sameSymbolCount} position(s) on this symbol.` : null,
                  portfolioRisk.sectorCount >= SECTOR_LIMIT ? `${portfolioRisk.sectorCount} open positions in ${portfolioRisk.sectorName} sector.` : null,
                ].filter(Boolean).join(' ')
              : undefined}
            tradeContext={c ? `${result.strategy} ${c.shortStrike}/${c.longStrike}${c.strategy === 'IC' ? ` · ${c.shortCallStrike}/${c.longCallStrike}` : ''} exp ${c.expiration} (${c.dte}d) · credit $${(c.totalCredit ?? c.credit).toFixed(2)} · ROC ${c.roc.toFixed(0)}% · POP ${c.pop?.toFixed(0)}% · IVR ${result.ivr?.toFixed(1)}%` : `${result.strategy} on ${result.symbol}`}
          />
        </div>'''

new_invocation = '''          <StockResearchButton research={research} th={th} />
        </div>'''

count = src.count(old_invocation)
if count != 1:
    print(f"ERROR: expected 1 match for StockResearch invocation, found {count}.")
    sys.exit(1)
src = src.replace(old_invocation, new_invocation)

# ---------------------------------------------------------------------------
# 4. Render <StockResearchPanel /> full-width at the very bottom of the card,
#    after the Open Position banner, before the closing </div> of the card.
# ---------------------------------------------------------------------------

old_tail = '''      {/* Best Opportunity Modal — rendered via portal to escape card click handler */}
      {showBestFinder && createPortal(
       <BestOpportunityFinder
          symbol={result.symbol}
          onClose={() => setShowBestFinder(false)}
          th={th}
          rules={rules}
          preferredStrategy={result.strategy as 'BPS' | 'BCS' | 'IC'}
          cachedEntry={cachedEntry}
          onTrade={onTrade}
          originalDte={result.bestCandidate?.dte}
        />,
        document.body
      )}
    </div>
  );
}'''

new_tail = '''      {/* AI Research panel — full width, always last, so it never overlaps
          the header row's strikes/credit/POP columns above it. */}
      <StockResearchPanel symbol={result.symbol} th={th} research={research} />

      {/* Best Opportunity Modal — rendered via portal to escape card click handler */}
      {showBestFinder && createPortal(
       <BestOpportunityFinder
          symbol={result.symbol}
          onClose={() => setShowBestFinder(false)}
          th={th}
          rules={rules}
          preferredStrategy={result.strategy as 'BPS' | 'BCS' | 'IC'}
          cachedEntry={cachedEntry}
          onTrade={onTrade}
          originalDte={result.bestCandidate?.dte}
        />,
        document.body
      )}
    </div>
  );
}'''

count = src.count(old_tail)
if count != 1:
    print(f"ERROR: expected 1 match for card tail block, found {count}.")
    sys.exit(1)
src = src.replace(old_tail, new_tail)

if src == original_src:
    print("ERROR: no changes were made (this shouldn't happen given the checks above).")
    sys.exit(1)

with open(FILE, "w", encoding="utf-8") as f:
    f.write(src)

print(f"Patched {FILE} successfully.")
print("Changes:")
print("  - StockResearch split into useStockResearch + StockResearchButton + StockResearchPanel")
print("  - ResultCard now owns research state via useStockResearch")
print("  - Opening Research auto-expands the card (useEffect on research.open)")
print("  - StockResearchPanel renders full-width at the bottom of the card,")
print("    after the Open Position banner, instead of inline in Col 1")
print("Next: run `npx next build` to verify, then commit + push.")