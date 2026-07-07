// app/wheel/page.tsx

'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import {
  fetchWheelChain,
  findBestWheelContract,
  getWheelQuote,
  type WheelStage,
  type WheelSelectedContract,
} from '@/lib/wheel/chainSearch';

const BASE = 'https://api.tastytrade.com';
const CLIENT_ID = '4d4c851b-bdaf-4ac9-b39b-811e604739f2';
const LS_ACCESS_TOKEN = 'tt_access_token_cache';
const LS_ACCESS_TOKEN_EXPIRY = 'tt_access_token_expiry';

// Same three-tier token caching used across the app (screener/portfolio).
async function getAccessToken(): Promise<string> {
  const sessionCached = sessionStorage.getItem('tt_access_token');
  if (sessionCached) return sessionCached;

  try {
    const lsCached = localStorage.getItem(LS_ACCESS_TOKEN);
    const expiry = localStorage.getItem(LS_ACCESS_TOKEN_EXPIRY);
    if (lsCached && expiry && Date.now() < parseInt(expiry)) {
      sessionStorage.setItem('tt_access_token', lsCached);
      return lsCached;
    }
  } catch {}

  const refreshToken = localStorage.getItem('tt_refresh_token');
  const clientSecret = localStorage.getItem('tt_client_secret') ?? '';
  if (!refreshToken || !clientSecret) { window.location.href = '/login'; throw new Error('Not authenticated'); }

  const res = await fetch(`${BASE}/oauth/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ grant_type: 'refresh_token', refresh_token: refreshToken, client_id: CLIENT_ID, client_secret: clientSecret }),
  });
  if (!res.ok) {
    sessionStorage.removeItem('tt_access_token');
    try { localStorage.removeItem(LS_ACCESS_TOKEN); localStorage.removeItem(LS_ACCESS_TOKEN_EXPIRY); } catch {}
    localStorage.removeItem('tt_refresh_token');
    window.location.href = '/login';
    throw new Error('Session expired');
  }
  const data = await res.json();
  const token = data.access_token;
  if (!token) { window.location.href = '/login'; throw new Error('No token'); }

  sessionStorage.setItem('tt_access_token', token);
  try {
    localStorage.setItem(LS_ACCESS_TOKEN, token);
    localStorage.setItem(LS_ACCESS_TOKEN_EXPIRY, String(Date.now() + 23 * 60 * 60 * 1000));
  } catch {}
  if (data.refresh_token && data.refresh_token !== refreshToken) {
    localStorage.setItem('tt_refresh_token', data.refresh_token);
  }
  return token;
}

interface WheelConfig {
  defaultDeltaMin: number;
  defaultDeltaMax: number;
  defaultDteMin: number;
  defaultDteMax: number;
  updatedAt: string;
}

interface WheelCandidate {
  symbol: string;
  sector?: string;
  wheelStage: WheelStage;
  costBasis?: number | null;
  deltaOverride?: { min: number; max: number } | null;
  dteOverride?: { min: number; max: number } | null;
  manualPick?: { expirationDate: string; strikePrice: number } | null;
  updatedAt: string;
}

// Row-level derived state: the actual selected contract (auto-searched or
// manually pinned) plus loading/error status. Kept separate from the
// persisted WheelCandidate since this is live market data, not user config.
interface RowResult {
  loading: boolean;
  error: string | null;
  contract: WheelSelectedContract | null;
  quote: number | null;
}

function fmtMoney(v: number | null | undefined, digits = 2): string {
  if (v == null || !Number.isFinite(v)) return '—';
  return `$${v.toLocaleString(undefined, { minimumFractionDigits: digits, maximumFractionDigits: digits })}`;
}

function fmtPct(v: number | null | undefined, digits = 1): string {
  if (v == null || !Number.isFinite(v)) return '—';
  return `${v.toFixed(digits)}%`;
}

// Computes the same Total Premium / Daily / Monthly / Annual / ROC math as
// Dean's Wheel_What-If spreadsheet, given a selected contract and 100-share
// lots. referencePrice is current stock price for hunting-csp, cost basis
// for own-writing-cc (falls back to current price if no basis set yet).
function computeYield(contract: WheelSelectedContract, referencePrice: number | null) {
  const premiumPerContract = contract.mid * 100; // per 1 options contract (100 sh)
  const totalPremium = premiumPerContract; // assumes 1 contract per row for now
  const daily = contract.dte > 0 ? totalPremium / contract.dte : 0;
  const monthly = (daily * 365) / 12;
  const annual = daily * 365;
  const cost = referencePrice != null ? referencePrice * 100 : null;
  const monthlyRoc = cost && cost > 0 ? (monthly / cost) * 100 : null;
  const annualRoc = monthlyRoc != null ? monthlyRoc * 12 : null;
  return { totalPremium, daily, monthly, annual, monthlyRoc, annualRoc };
}

export default function WheelPage() {
  const [config, setConfig] = useState<WheelConfig | null>(null);
  const [candidates, setCandidates] = useState<Record<string, WheelCandidate>>({});
  const [results, setResults] = useState<Record<string, RowResult>>({});
  const [newSymbol, setNewSymbol] = useState('');
  const [loadingInitial, setLoadingInitial] = useState(true);

  const loadConfigAndCandidates = useCallback(async () => {
    try {
      const [configRes, candidatesRes] = await Promise.all([
        fetch('/api/wheel-config'),
        fetch('/api/wheel-candidates'),
      ]);
      const configData = await configRes.json();
      const candidatesData = await candidatesRes.json();
      setConfig(configData.config);
      setCandidates(candidatesData.candidates ?? {});
    } catch (e) {
      console.error('Failed to load Wheel config/candidates:', e);
    } finally {
      setLoadingInitial(false);
    }
  }, []);

  useEffect(() => { loadConfigAndCandidates(); }, [loadConfigAndCandidates]);

  const searchRow = useCallback(async (candidate: WheelCandidate, cfg: WheelConfig) => {
    setResults(prev => ({ ...prev, [candidate.symbol]: { loading: true, error: null, contract: prev[candidate.symbol]?.contract ?? null, quote: prev[candidate.symbol]?.quote ?? null } }));

    try {
      const token = await getAccessToken();
      const deltaTarget = candidate.deltaOverride
        ? { min: candidate.deltaOverride.min / 100, max: candidate.deltaOverride.max / 100 }
        : { min: cfg.defaultDeltaMin / 100, max: cfg.defaultDeltaMax / 100 };
      const dteTarget = candidate.dteOverride ?? { min: cfg.defaultDteMin, max: cfg.defaultDteMax };

      const [chain, quote] = await Promise.all([
        fetchWheelChain(candidate.symbol, token, dteTarget),
        getWheelQuote(candidate.symbol, token),
      ]);

      let contract: WheelSelectedContract | null = null;

      if (candidate.manualPick) {
        const legs = chain.chains[candidate.manualPick.expirationDate] ?? [];
        const wantedType = candidate.wheelStage === 'hunting-csp' ? 'P' : 'C';
        const leg = legs.find(l => l.optionType === wantedType && l.strikePrice === candidate.manualPick!.strikePrice);
        if (leg && leg.delta != null) {
          contract = {
            expirationDate: candidate.manualPick.expirationDate,
            dte: Math.max(0, Math.round((new Date(candidate.manualPick.expirationDate).getTime() - Date.now()) / 86_400_000)),
            strikePrice: leg.strikePrice,
            delta: Math.abs(leg.delta),
            bid: leg.bid,
            ask: leg.ask,
            mid: leg.mid,
            openInterest: leg.openInterest,
            occSymbol: leg.occSymbol,
          };
        }
      } else {
        contract = findBestWheelContract(chain, candidate.wheelStage, deltaTarget, dteTarget);
      }

      setResults(prev => ({ ...prev, [candidate.symbol]: { loading: false, error: null, contract, quote } }));
    } catch (e: any) {
      setResults(prev => ({ ...prev, [candidate.symbol]: { loading: false, error: e.message ?? 'Search failed', contract: null, quote: null } }));
    }
  }, []);

  // Re-run the search for every candidate once config + candidates are loaded.
  useEffect(() => {
    if (!config || loadingInitial) return;
    for (const candidate of Object.values(candidates)) {
      searchRow(candidate, config);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [config, loadingInitial]);

  const addCandidate = useCallback(async () => {
    const symbol = newSymbol.trim().toUpperCase();
    if (!symbol) return;
    setNewSymbol('');

    const res = await fetch('/api/wheel-candidates', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ symbol, candidate: { wheelStage: 'hunting-csp' } }),
    });
    const data = await res.json();
    setCandidates(data.candidates ?? {});
    if (config && data.candidates?.[symbol]) {
      searchRow(data.candidates[symbol], config);
    }
  }, [newSymbol, config, searchRow]);

  const removeCandidate = useCallback(async (symbol: string) => {
    const res = await fetch(`/api/wheel-candidates?symbol=${encodeURIComponent(symbol)}`, { method: 'DELETE' });
    const data = await res.json();
    setCandidates(data.candidates ?? {});
    setResults(prev => {
      const next = { ...prev };
      delete next[symbol];
      return next;
    });
  }, []);

  const toggleStage = useCallback(async (symbol: string) => {
    const current = candidates[symbol];
    if (!current) return;
    const nextStage: WheelStage = current.wheelStage === 'hunting-csp' ? 'own-writing-cc' : 'hunting-csp';

    const res = await fetch('/api/wheel-candidates', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ symbol, candidate: { wheelStage: nextStage } }),
    });
    const data = await res.json();
    setCandidates(data.candidates ?? {});
    if (config && data.candidates?.[symbol]) {
      searchRow(data.candidates[symbol], config);
    }
  }, [candidates, config, searchRow]);

  const setCostBasis = useCallback(async (symbol: string, value: string) => {
    const parsed = parseFloat(value);
    const costBasis = Number.isFinite(parsed) && parsed > 0 ? parsed : null;

    const res = await fetch('/api/wheel-candidates', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ symbol, candidate: { costBasis } }),
    });
    const data = await res.json();
    setCandidates(data.candidates ?? {});
  }, []);

  const refreshRow = useCallback((symbol: string) => {
    const candidate = candidates[symbol];
    if (candidate && config) searchRow(candidate, config);
  }, [candidates, config, searchRow]);

  return (
    <div className="min-h-screen bg-black text-white" style={{ fontFamily: "'DM Sans', system-ui, sans-serif" }}>
      <div className="border-b border-white/10">
        <div className="flex items-center justify-between px-6 py-3">
          <span className="text-sm font-bold tracking-widest">TRADEEDGE</span>
        </div>
        <div className="flex items-center gap-0 w-full border-t border-white/10">
          <Link href="/"              className="text-[10px] font-bold px-3 py-2 text-white/55 hover:text-white/80 transition-colors tracking-wider">HOME</Link>
          <Link href="/portfolio"     className="text-[10px] font-bold px-3 py-2 text-white/55 hover:text-white/80 transition-colors tracking-wider">PORTFOLIO</Link>
          <Link href="/screener"      className="text-[10px] font-bold px-3 py-2 text-white/55 hover:text-white/80 transition-colors tracking-wider">SCREENER</Link>
          <Link href="/engine"        className="text-[10px] font-bold px-3 py-2 text-white/55 hover:text-white/80 transition-colors tracking-wider">INCOME ENGINE</Link>
          <span                       className="text-[10px] font-bold px-3 py-2 tracking-wider" style={{ color: '#00d4aa', borderBottom: '2px solid #00d4aa' }}>WHEEL</span>
          <Link href="/rinse-repeat"  className="text-[10px] font-bold px-3 py-2 text-white/55 hover:text-white/80 transition-colors tracking-wider">REPEAT STRATEGIES</Link>
          <Link href="/trade-log"     className="text-[10px] font-bold px-3 py-2 text-white/55 hover:text-white/80 transition-colors tracking-wider">TRADE LOG</Link>
          <Link href="/performance"   className="text-[10px] font-bold px-3 py-2 text-white/55 hover:text-white/80 transition-colors tracking-wider">PERFORMANCE</Link>
          <Link href="/help"          className="text-[10px] font-bold px-3 py-2 text-white/55 hover:text-white/80 transition-colors tracking-wider">HELP</Link>
        </div>
      </div>

      {/* Wheel sub-tab bar -- Candidates is the only tab for now */}
      <div className="border-b border-white/10 px-6">
        <div className="flex gap-0">
          <span className="flex items-center gap-1.5 px-4 py-3 text-xs font-medium tracking-wider border-b-2 text-white" style={{ borderColor: '#00d4aa' }}>
            Candidates
          </span>
        </div>
      </div>

      <div className="max-w-6xl mx-auto px-6 py-6 space-y-4">
        {config && (
          <div className="border border-white/10 rounded-lg p-3 flex items-center gap-6 text-xs text-white/50">
            <span>Default delta: {config.defaultDeltaMin}-{config.defaultDeltaMax}</span>
            <span>Default DTE: {config.defaultDteMin}-{config.defaultDteMax}</span>
          </div>
        )}

        <div className="flex items-center gap-2">
          <input
            value={newSymbol}
            onChange={e => setNewSymbol(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') addCandidate(); }}
            placeholder="Add symbol (e.g. MSFT)"
            className="bg-white/5 border border-white/10 rounded px-3 py-2 text-sm w-48 focus:outline-none focus:border-white/30"
          />
          <button onClick={addCandidate} className="text-xs font-bold px-3 py-2 rounded bg-white/10 hover:bg-white/15 transition-colors">
            Add
          </button>
        </div>

        {loadingInitial && <p className="text-white/40 text-sm">Loading...</p>}

        {!loadingInitial && Object.keys(candidates).length === 0 && (
          <p className="text-white/40 text-sm">No candidates yet — add a symbol above.</p>
        )}

        {!loadingInitial && Object.keys(candidates).length > 0 && (
          <div className="border border-white/10 rounded-lg overflow-hidden">
            <table className="w-full text-xs">
              <thead>
                <tr className="bg-white/5 text-white/40 uppercase tracking-wider text-[10px]">
                  <th className="text-left px-3 py-2">Symbol</th>
                  <th className="text-left px-3 py-2">Stage</th>
                  <th className="text-right px-3 py-2">Cost Basis</th>
                  <th className="text-right px-3 py-2">Current Price</th>
                  <th className="text-left px-3 py-2">Expiration</th>
                  <th className="text-right px-3 py-2">DTE</th>
                  <th className="text-right px-3 py-2">Strike</th>
                  <th className="text-right px-3 py-2">Delta</th>
                  <th className="text-right px-3 py-2">Bid</th>
                  <th className="text-right px-3 py-2">Total Premium</th>
                  <th className="text-right px-3 py-2">Monthly</th>
                  <th className="text-right px-3 py-2">Annual ROC</th>
                  <th className="px-3 py-2"></th>
                </tr>
              </thead>
              <tbody>
                {Object.values(candidates).map(candidate => {
                  const result = results[candidate.symbol];
                  const contract = result?.contract ?? null;
                  const referencePrice = candidate.wheelStage === 'own-writing-cc'
                    ? (candidate.costBasis ?? result?.quote ?? null)
                    : (result?.quote ?? null);

                  const yieldCalc = contract ? computeYield(contract, referencePrice) : null;

                  return (
                    <tr key={candidate.symbol} className="border-t border-white/5 hover:bg-white/[0.02]">
                      <td className="px-3 py-2 font-bold">{candidate.symbol}</td>
                      <td className="px-3 py-2">
                        <button
                          onClick={() => toggleStage(candidate.symbol)}
                          className={`text-[10px] font-bold px-2 py-1 rounded border ${
                            candidate.wheelStage === 'hunting-csp'
                              ? 'border-amber-500/60 bg-amber-500/10 text-amber-300'
                              : 'border-emerald-500/60 bg-emerald-500/10 text-emerald-300'
                          }`}
                        >
                          {candidate.wheelStage === 'hunting-csp' ? 'Hunting CSP' : 'Own — Writing CC'}
                        </button>
                      </td>
                      <td className="px-3 py-2 text-right">
                        {candidate.wheelStage === 'own-writing-cc' ? (
                          <input
                            key={candidate.costBasis ?? 'empty'}
                            type="number"
                            defaultValue={candidate.costBasis ?? ''}
                            onBlur={e => setCostBasis(candidate.symbol, e.target.value)}
                            onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
                            placeholder="basis"
                            className="bg-white/5 border border-white/10 rounded px-2 py-1 w-20 text-right text-xs focus:outline-none focus:border-white/30"
                          />
                        ) : (
                          <span className="text-white/30">—</span>
                        )}
                      </td>
                      <td className="px-3 py-2 text-right">{fmtMoney(result?.quote ?? null)}</td>

                      {result?.loading && (
                        <td colSpan={7} className="px-3 py-2 text-white/40">Searching...</td>
                      )}
                      {result?.error && (
                        <td colSpan={7} className="px-3 py-2 text-red-400">{result.error}</td>
                      )}
                      {!result?.loading && !result?.error && !contract && (
                        <td colSpan={7} className="px-3 py-2 text-white/30">No match in target range</td>
                      )}
                      {!result?.loading && contract && (
                        <>
                          <td className="px-3 py-2">{contract.expirationDate}</td>
                          <td className="px-3 py-2 text-right">{contract.dte}</td>
                          <td className="px-3 py-2 text-right">{contract.strikePrice}</td>
                          <td className="px-3 py-2 text-right">{contract.delta.toFixed(2)}</td>
                          <td className="px-3 py-2 text-right">{fmtMoney(contract.bid)}</td>
                          <td className="px-3 py-2 text-right">{yieldCalc ? fmtMoney(yieldCalc.totalPremium, 0) : '—'}</td>
                          <td className="px-3 py-2 text-right">{yieldCalc ? fmtMoney(yieldCalc.monthly, 0) : '—'}</td>
                          <td className={`px-3 py-2 text-right font-bold ${yieldCalc?.annualRoc != null && yieldCalc.annualRoc >= 12 ? 'text-emerald-400' : 'text-white/50'}`}>
                            {yieldCalc?.annualRoc != null ? fmtPct(yieldCalc.annualRoc) : '—'}
                          </td>
                        </>
                      )}

                      <td className="px-3 py-2 text-right whitespace-nowrap">
                        <button onClick={() => refreshRow(candidate.symbol)} className="text-white/40 hover:text-white/70 mr-2" title="Refresh">↻</button>
                        <button onClick={() => removeCandidate(candidate.symbol)} className="text-white/40 hover:text-red-400" title="Remove">✕</button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
