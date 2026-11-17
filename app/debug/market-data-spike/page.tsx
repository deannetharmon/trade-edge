// app/debug/market-data-spike/page.tsx
//
// OPTMAP-0001 S0 spike (read-only). A developer probe, not a feature: it asks
// TastyTrade (through the existing same-origin read proxy) for live option
// quotes on a few symbols, samples them twice 10 seconds apart, and reports
// whether the data is real-time, how old each quote is, which per-leg fields
// come back, where per-expiration IV lives, and whether an ex-dividend field
// exists. It places no orders and writes nothing. Output is plain text so it
// can be copied back to the team.

'use client';

import { useState } from 'react';
import { ttFetch } from '@/lib/tastytrade/client';
import {
  SPIKE_CONCEPTS,
  countAdvanced,
  pickExpirations,
  pickStrikes,
  spikeVerdict,
  summarizeQuotes,
  type QuoteSummary,
  type SpikeConceptKey,
  type SpikeItem,
} from '@/lib/trademap/marketDataSpike';

const DEFAULT_SYMBOLS = 'SOXL,SPY,UBER';
const EXPIRATION_TARGETS = [14, 38, 120];
const STRIKES_PER_EXPIRATION = 10;
const SAMPLE_GAP_MS = 10_000;
const QUOTE_CHUNK = 50;

interface SymbolPlan {
  symbol: string;
  spot: number | null;
  expirations: string;
  optionSymbols: string[];
  sample1: SpikeItem[];
  sample1At: number;
  error: string | null;
}

const sleep = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));

function num(value: unknown): number | null {
  const n = typeof value === 'number' ? value : parseFloat(String(value ?? ''));
  return Number.isFinite(n) ? n : null;
}

function dteOf(dateStr: string): number {
  const target = Date.parse(`${dateStr}T00:00:00Z`);
  const today = new Date();
  const todayUtc = Date.UTC(today.getFullYear(), today.getMonth(), today.getDate());
  return Math.round((target - todayUtc) / 86_400_000);
}

async function fetchQuotes(kind: 'equity' | 'equity-option', symbols: string[]): Promise<SpikeItem[]> {
  const items: SpikeItem[] = [];
  for (let i = 0; i < symbols.length; i += QUOTE_CHUNK) {
    const qs = symbols.slice(i, i + QUOTE_CHUNK).map(s => `${kind}=${encodeURIComponent(s)}`).join('&');
    const data = await ttFetch(`/market-data/by-type?${qs}`, '');
    for (const item of data?.data?.items ?? []) items.push(item as SpikeItem);
  }
  return items;
}

function fmt(n: number): string {
  return Number.isFinite(n) ? n.toFixed(1) : 'n/a';
}

function describeSummary(label: string, s: QuoteSummary, requested: number, maxAgeSec: number): string[] {
  const out: string[] = [];
  const v = spikeVerdict(s, maxAgeSec);
  out.push(`  ${label}: ${s.total}/${requested} quotes returned`);
  out.push(`    delayed flag: true=${s.delayedTrue} false=${s.delayedFalse} missing=${s.delayedUnknown} (keys: ${s.delayKeys.join(', ') || 'none'})`);
  const keys = Object.keys(s.ageByKey);
  if (keys.length === 0) out.push('    quote time: no time-like key on any quote');
  for (const k of keys) {
    const a = s.ageByKey[k];
    out.push(`    quote time key "${k}": ${a.count}/${s.total} quotes, age sec min ${fmt(a.minSec)} / median ${fmt(a.medianSec)} / max ${fmt(a.maxSec)}`);
  }
  const concepts = Object.keys(SPIKE_CONCEPTS) as SpikeConceptKey[];
  out.push('    fields (non-empty count; payload key names):');
  for (const c of concepts) {
    const cov = s.coverage[c];
    out.push(`      ${c}: ${cov.present}/${s.total}  [${cov.keys.join(', ') || 'no such key'}]`);
  }
  out.push(`    VERDICT: not delayed=${v.notDelayed}, quote fresh (<=${maxAgeSec}s median${v.freshnessKey ? ` on "${v.freshnessKey}"` : ''})=${v.quoteFresh}, IV on >=90% of legs=${v.ivPerLeg}`);
  return out;
}

export default function MarketDataSpikePage() {
  const [symbolsInput, setSymbolsInput] = useState(DEFAULT_SYMBOLS);
  const [maxAgeSec, setMaxAgeSec] = useState('15');
  const [running, setRunning] = useState(false);
  const [status, setStatus] = useState('');
  const [report, setReport] = useState('');
  const [copied, setCopied] = useState(false);

  const run = async () => {
    const symbols = symbolsInput.split(/[\s,]+/).map(s => s.trim().toUpperCase()).filter(Boolean);
    const maxAge = num(maxAgeSec) ?? 15;
    if (symbols.length === 0) return;
    setRunning(true);
    setReport('');
    setCopied(false);
    const lines: string[] = [];
    const startedAt = new Date();
    lines.push(`OPTMAP-0001 S0 SPIKE REPORT  ${startedAt.toISOString()}`);
    lines.push(`symbols: ${symbols.join(', ')}   freshness threshold: ${maxAge}s   sample gap: ${SAMPLE_GAP_MS / 1000}s`);
    lines.push('');

    try {
      // Phase A: plan each symbol and take sample 1.
      const plans: SymbolPlan[] = [];
      for (const symbol of symbols) {
        setStatus(`Sample 1: ${symbol}`);
        const plan: SymbolPlan = { symbol, spot: null, expirations: '', optionSymbols: [], sample1: [], sample1At: 0, error: null };
        try {
          const eq = await fetchQuotes('equity', [symbol]);
          const q = eq[0] ?? {};
          const bid = num(q.bid);
          const ask = num(q.ask);
          plan.spot = num(q.last) ?? num(q.mark) ?? (bid != null && ask != null ? (bid + ask) / 2 : null);
          if (plan.spot == null) throw new Error('no underlying price in equity quote');

          const chain = await ttFetch(`/option-chains/${encodeURIComponent(symbol)}/nested`, '');
          const groups: any[] = chain?.data?.items?.[0]?.expirations ?? [];
          const all = groups
            .filter(g => g['expiration-date'])
            .map(g => ({ date: String(g['expiration-date']), dte: dteOf(String(g['expiration-date'])) }));
          const chosen = pickExpirations(all, EXPIRATION_TARGETS);
          if (chosen.length === 0) throw new Error('no usable expirations');
          plan.expirations = chosen.map(c => `${c.date} (${c.dte} DTE)`).join(', ');

          for (const exp of chosen) {
            const group = groups.find(g => g['expiration-date'] === exp.date);
            const strikes: any[] = group?.strikes ?? [];
            const prices = strikes.map(s => num(s['strike-price'])).filter((n): n is number => n != null);
            const picked = pickStrikes(prices, plan.spot, STRIKES_PER_EXPIRATION);
            for (const s of strikes) {
              const sp = num(s['strike-price']);
              if (sp == null || picked.indexOf(sp) < 0) continue;
              if (s.call) plan.optionSymbols.push(String(s.call));
              if (s.put) plan.optionSymbols.push(String(s.put));
            }
          }
          plan.sample1 = await fetchQuotes('equity-option', plan.optionSymbols);
          plan.sample1At = Date.now();
        } catch (e: any) {
          plan.error = e?.message ?? String(e);
        }
        plans.push(plan);
      }

      setStatus(`Waiting ${SAMPLE_GAP_MS / 1000}s for sample 2...`);
      await sleep(SAMPLE_GAP_MS);

      // Phase B: sample 2, then report per symbol.
      for (const plan of plans) {
        lines.push(`=== ${plan.symbol} ===`);
        if (plan.error) {
          lines.push(`  ERROR: ${plan.error}`, '');
          continue;
        }
        setStatus(`Sample 2: ${plan.symbol}`);
        const sample2 = await fetchQuotes('equity-option', plan.optionSymbols);
        const sample2At = Date.now();
        const s1 = summarizeQuotes(plan.sample1, plan.sample1At);
        const s2 = summarizeQuotes(sample2, sample2At);
        lines.push(`  underlying: ${plan.spot}   expirations: ${plan.expirations}`);
        lines.push(...describeSummary('sample 1', s1, plan.optionSymbols.length, maxAge));
        lines.push(...describeSummary('sample 2 (10s later)', s2, plan.optionSymbols.length, maxAge));
        const adv = countAdvanced(s1.newestTimeBySymbol, s2.newestTimeBySymbol);
        lines.push(`  quote time advanced between samples: ${adv.advanced}/${adv.compared} symbols (a market that is open and streaming should advance)`);
        if (sample2[0]) lines.push(`  raw first option quote: ${JSON.stringify(sample2[0]).slice(0, 1500)}`);

        // Per-expiration IV and ex-dividend: market-metrics.
        setStatus(`Market metrics: ${plan.symbol}`);
        try {
          const mm = await ttFetch(`/market-metrics?symbols=${encodeURIComponent(plan.symbol)}`, '');
          const item: Record<string, any> = mm?.data?.items?.[0] ?? {};
          const expIv: any[] = item['option-expiration-implied-volatilities'] ?? [];
          lines.push(`  per-expiration IV source: market-metrics "option-expiration-implied-volatilities": ${expIv.length} entries${expIv[0] ? `, e.g. ${JSON.stringify(expIv[0])}` : ''}`);
          const divKeys = Object.keys(item).filter(k => /dividend|ex-div/i.test(k));
          lines.push(`  ex-dividend / dividend fields in market-metrics: ${divKeys.length ? divKeys.map(k => `${k}=${JSON.stringify(item[k])}`).join('; ') : 'NONE'}`);
          const ivKeys = Object.keys(item).filter(k => /volatil/i.test(k) && k !== 'option-expiration-implied-volatilities');
          lines.push(`  underlying IV fields: ${ivKeys.map(k => `${k}=${JSON.stringify(item[k])}`).join('; ') || 'NONE'}`);
        } catch (e: any) {
          lines.push(`  market-metrics ERROR: ${e?.message ?? e}`);
        }
        lines.push('');
      }

      // Item 5: DXLink quote token through the existing proxy.
      lines.push('=== DXLink (item 5) ===');
      try {
        const tok = await ttFetch('/api-quote-tokens', '');
        const keys = Object.keys(tok?.data ?? tok ?? {});
        lines.push(`  /api-quote-tokens reachable. Response keys: ${keys.join(', ')}. (Token value deliberately not printed.)`);
        lines.push('  Websocket subscription test NOT run by this page; separate slice if REST fails the pass criteria.');
      } catch (e: any) {
        lines.push(`  /api-quote-tokens NOT reachable through the read proxy: ${e?.message ?? e}`);
        lines.push('  The proxy only allows /customers/, /accounts/, /market-, /instruments/, /option-, /transactions. A DXLink test needs an allowlist change (shared proxy: Quinn/Ian gate).');
      }
    } catch (e: any) {
      lines.push(`FATAL: ${e?.message ?? e}`);
    } finally {
      setReport(lines.join('\n'));
      setStatus('Done');
      setRunning(false);
    }
  };

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(report);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  };

  return (
    <div style={{ padding: 24, fontFamily: 'var(--font-inter), system-ui, sans-serif', fontSize: 12, color: '#ddd', background: '#111', minHeight: '100vh' }}>
      <h1 style={{ fontSize: 14, marginBottom: 8 }}>OPTMAP-0001 S0: market-data spike (debug, read-only)</h1>
      <p style={{ marginBottom: 12, opacity: 0.7 }}>
        Reads quotes only. Places no orders and writes nothing. Run while the market is open, signed in to TradeEdge.
      </p>
      <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginBottom: 12, flexWrap: 'wrap' }}>
        <label>
          Symbols{' '}
          <input value={symbolsInput} onChange={e => setSymbolsInput(e.target.value)} disabled={running}
            style={{ background: '#222', color: '#ddd', border: '1px solid #444', padding: '2px 6px', width: 220 }} />
        </label>
        <label>
          Fresh if median age (s) &le;{' '}
          <input value={maxAgeSec} onChange={e => setMaxAgeSec(e.target.value)} disabled={running}
            style={{ background: '#222', color: '#ddd', border: '1px solid #444', padding: '2px 6px', width: 50 }} />
        </label>
        <button onClick={run} disabled={running} style={{ padding: '3px 12px', border: '1px solid #666', background: running ? '#333' : '#245', color: '#fff' }}>
          {running ? 'Running...' : 'Run spike'}
        </button>
        {report && (
          <button onClick={copy} style={{ padding: '3px 12px', border: '1px solid #666', background: '#333', color: '#fff' }}>
            {copied ? 'Copied' : 'Copy report'}
          </button>
        )}
        <span style={{ opacity: 0.7 }}>{status}</span>
      </div>
      {report && <pre style={{ whiteSpace: 'pre-wrap', lineHeight: 1.4 }}>{report}</pre>}
    </div>
  );
}
