// lib/portfolio-ai/snapshot.ts
//
// PORTFOLIO-AI-0001: the deterministic snapshot behind the Portfolio "Ask AI" panel.
//
// Everything here is computed from values the Portfolio page already holds. Nothing is
// fetched, scored or ranked. A figure that cannot be established is reported as "not
// available" and is never estimated. The model receives `contextText` as trusted data and
// may only quote figures that appear in it; `findUnsupportedFigures` checks its answer.

export interface PortfolioAiPositionInput {
  key: string;
  symbol: string;
  strategy: string;
  dte: number;
  /** Entry-relative P&L in percent, or null when entry economics are incomplete. */
  entryPnlPct: number | null;
  /** Reliable, supported max risk in dollars, or null (fail closed). */
  maxRisk: number | null;
  /** Percent distance from the stock to the short strike, or null. */
  bufferPct: number | null;
  /** The app's own canonical suggested action. The AI may not contradict it. */
  recommendationLabel: string | null;
  recommendationDetail: string | null;
  needsClose: boolean;
  hitTarget: boolean;
  hasGtc: boolean;
  /** True for a long call that is paired with a held short call (PMCC). */
  pmccPaired?: boolean;
}

export interface PortfolioAiLeverageGroupInput {
  economicUnderlying: string;
  memberSymbols: string[];
  maxCapitalLoss: number | null;
  capitalRiskComplete: boolean;
}

export interface PortfolioAiSnapshotInput {
  generatedAt: string;
  positions: PortfolioAiPositionInput[];
  thetaPerDay: number | null;
  leverageGroups: PortfolioAiLeverageGroupInput[];
}

export type PortfolioAiTone = 'neutral' | 'info' | 'good' | 'warn' | 'bad';

export interface PortfolioAiTile {
  id: 'theta' | 'at-risk' | 'concentration' | 'close-now';
  label: string;
  value: string;
  detail: string | null;
  tone: PortfolioAiTone;
}

export interface PortfolioAiSnapshot {
  generatedAt: string;
  positionCount: number;
  tiles: PortfolioAiTile[];
  watch: string[];
  notAvailable: string[];
  /** Every number the model is allowed to quote (dollars and percents alike). */
  allowedFigures: number[];
  /** Trusted context sent with each chat request. */
  contextText: string;
}

export const PORTFOLIO_AI_STALE_MS = 20 * 60 * 1000;
export const NOT_AVAILABLE = 'not available';

// Standing rule figures the AI may restate (21 DTE, 50% target, 2x credit stop).
const RULE_FIGURES = [21, 50, 2];
const TIGHT_BUFFER_PCT = 5;
const MAX_WATCH_LINES = 5;

const finite = (value: number | null | undefined): value is number =>
  typeof value === 'number' && Number.isFinite(value);

const money = (value: number, digits = 0): string =>
  `$${value.toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits })}`;

const signedMoney = (value: number): string => `${value < 0 ? '-' : '+'}${money(Math.abs(value), 2)}`;

function pct(value: number, digits = 0): string {
  return `${value.toFixed(digits)}%`;
}

export function buildPortfolioAiSnapshot(input: PortfolioAiSnapshotInput): PortfolioAiSnapshot {
  const { positions } = input;
  const notAvailable: string[] = [];
  const allowed: number[] = [...RULE_FIGURES, positions.length];

  // ── At risk: reliable max risk only, never a guess ────────────────────────
  const reliable = positions.filter(p => finite(p.maxRisk));
  const excluded = positions.length - reliable.length;
  const atRiskTotal = reliable.reduce((sum, p) => sum + (p.maxRisk as number), 0);
  const atRiskTile: PortfolioAiTile = reliable.length === 0
    ? { id: 'at-risk', label: 'AT RISK', value: positions.length === 0 ? '—' : 'Not available', detail: positions.length === 0 ? null : 'No reliable max-risk figure', tone: 'neutral' }
    : {
        id: 'at-risk',
        label: 'AT RISK',
        value: money(atRiskTotal),
        detail: excluded > 0 ? `${excluded} position${excluded === 1 ? '' : 's'} excluded (max risk not reliable)` : null,
        tone: 'neutral',
      };
  if (positions.length > 0 && reliable.length === 0) notAvailable.push('Total at risk (no reliable max-risk figures)');
  else if (excluded > 0) notAvailable.push(`Max risk for ${excluded} position${excluded === 1 ? '' : 's'} (excluded from at-risk total)`);
  if (reliable.length > 0) allowed.push(atRiskTotal, Math.round(atRiskTotal), excluded);

  // ── Theta ─────────────────────────────────────────────────────────────────
  const thetaTile: PortfolioAiTile = finite(input.thetaPerDay)
    ? { id: 'theta', label: 'THETA / DAY', value: signedMoney(input.thetaPerDay), detail: null, tone: input.thetaPerDay >= 0 ? 'info' : 'warn' }
    : { id: 'theta', label: 'THETA / DAY', value: positions.length === 0 ? '—' : 'Not available', detail: null, tone: 'neutral' };
  if (finite(input.thetaPerDay)) allowed.push(input.thetaPerDay, Math.abs(input.thetaPerDay), Math.round(input.thetaPerDay));
  else if (positions.length > 0) notAvailable.push('Net theta per day');

  // ── Concentration: largest symbol share of reliable at-risk ───────────────
  const riskBySymbol = new Map<string, number>();
  for (const p of reliable) {
    riskBySymbol.set(p.symbol, (riskBySymbol.get(p.symbol) ?? 0) + (p.maxRisk as number));
  }
  let topSymbol: string | null = null;
  let topShare: number | null = null;
  if (atRiskTotal > 0) {
    riskBySymbol.forEach((risk, symbol) => {
      const share = (risk / atRiskTotal) * 100;
      if (topShare == null || share > topShare) { topShare = share; topSymbol = symbol; }
    });
  }
  const concentrationTile: PortfolioAiTile = topShare != null && topSymbol != null
    ? {
        id: 'concentration',
        label: 'TOP CONCENTRATION',
        value: pct(topShare),
        detail: `${topSymbol} share of at-risk`,
        tone: topShare >= 25 ? 'warn' : 'neutral',
      }
    : { id: 'concentration', label: 'TOP CONCENTRATION', value: positions.length === 0 ? '—' : 'Not available', detail: null, tone: 'neutral' };
  if (topShare != null) allowed.push(topShare, Math.round(topShare));
  else if (positions.length > 0) notAvailable.push('Concentration (needs reliable max-risk figures)');

  // ── Close-now count (the page's own needsClose rule, which already exempts CSP/CC) ──
  const closeNow = positions.filter(p => p.needsClose);
  const closeTile: PortfolioAiTile = {
    id: 'close-now',
    label: 'CLOSE NOW (21 DTE)',
    value: String(closeNow.length),
    detail: closeNow.length === 1 ? 'position' : 'positions',
    tone: closeNow.length > 0 ? 'bad' : 'neutral',
  };
  allowed.push(closeNow.length);

  // ── Watch lines: one per position, worst reason first ─────────────────────
  const watch: string[] = [];
  const watched = new Set<string>();
  const addWatch = (p: PortfolioAiPositionInput, line: string) => {
    if (watched.has(p.key) || watch.length >= MAX_WATCH_LINES) return;
    watched.add(p.key);
    watch.push(line);
  };
  const appSays = (p: PortfolioAiPositionInput) => (p.recommendationLabel ? `; the app suggests ${p.recommendationLabel}` : '');
  for (const p of positions) {
    if (p.needsClose) addWatch(p, `${p.symbol} ${p.strategy} is at ${p.dte} DTE${appSays(p)}.`);
  }
  for (const p of positions) {
    if (finite(p.bufferPct) && p.bufferPct < TIGHT_BUFFER_PCT) {
      addWatch(p, `${p.symbol} buffer is ${pct(p.bufferPct, 1)} with ${p.dte} DTE${appSays(p)}.`);
    }
  }
  for (const p of positions) {
    if (p.hitTarget) addWatch(p, `${p.symbol} ${p.strategy} has hit its profit target${appSays(p)}.`);
  }
  for (const group of input.leverageGroups) {
    if (group.memberSymbols.length >= 2 && watch.length < MAX_WATCH_LINES) {
      watch.push(`${group.memberSymbols.join(', ')} share one leveraged-ETF cluster on ${group.economicUnderlying}.`);
    }
  }

  // ── Per-position lines for the model ──────────────────────────────────────
  const lines = positions.map(p => {
    const flags = [
      p.needsClose ? 'AT/UNDER 21 DTE' : '',
      p.hitTarget ? 'TARGET HIT' : '',
      p.hasGtc ? '' : 'NO GTC',
      p.pmccPaired ? 'PMCC long paired with a held short call' : '',
    ].filter(Boolean).join(', ');
    if (finite(p.entryPnlPct)) allowed.push(p.entryPnlPct, Math.round(p.entryPnlPct), Math.abs(p.entryPnlPct), Math.abs(Math.round(p.entryPnlPct)));
    if (finite(p.maxRisk)) allowed.push(p.maxRisk, Math.round(p.maxRisk));
    if (finite(p.bufferPct)) allowed.push(p.bufferPct, Math.round(p.bufferPct));
    allowed.push(p.dte);
    return [
      `${p.symbol} ${p.strategy}`,
      `DTE ${p.dte}`,
      `entry P&L ${finite(p.entryPnlPct) ? pct(p.entryPnlPct) : NOT_AVAILABLE}`,
      `max risk ${finite(p.maxRisk) ? money(p.maxRisk) : NOT_AVAILABLE}`,
      `buffer ${finite(p.bufferPct) ? pct(p.bufferPct, 1) : NOT_AVAILABLE}`,
      `app suggests: ${p.recommendationLabel ?? 'no canonical action'}${p.recommendationDetail ? ` (${p.recommendationDetail})` : ''}`,
      flags ? `flags: ${flags}` : '',
    ].filter(Boolean).join(' | ');
  });

  const leverageLines = input.leverageGroups
    .filter(g => g.memberSymbols.length >= 2)
    .map(g => {
      if (finite(g.maxCapitalLoss)) allowed.push(g.maxCapitalLoss, Math.round(g.maxCapitalLoss));
      const loss = g.capitalRiskComplete && finite(g.maxCapitalLoss) ? money(g.maxCapitalLoss) : NOT_AVAILABLE;
      return `${g.memberSymbols.join(', ')} on ${g.economicUnderlying} | combined max capital loss ${loss}`;
    });
  if (input.leverageGroups.some(g => g.memberSymbols.length >= 2 && !(g.capitalRiskComplete && finite(g.maxCapitalLoss)))) {
    notAvailable.push('Combined capital loss for a leveraged-ETF cluster (data incomplete)');
  }

  const generatedLabel = new Date(input.generatedAt).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  const contextText = [
    `PORTFOLIO SNAPSHOT (built by TradeEdge at ${generatedLabel}; read-only data for the selected account)`,
    `Positions: ${positions.length} | Net theta/day: ${finite(input.thetaPerDay) ? signedMoney(input.thetaPerDay) : NOT_AVAILABLE} | At risk (reliable max risk only): ${reliable.length > 0 ? money(atRiskTotal) : NOT_AVAILABLE}${excluded > 0 && reliable.length > 0 ? ` (${excluded} excluded)` : ''}`,
    `Largest symbol share of at-risk: ${topShare != null && topSymbol != null ? `${topSymbol} ${pct(topShare)}` : NOT_AVAILABLE} | Close-now count: ${closeNow.length}`,
    '',
    'POSITIONS:',
    lines.length > 0 ? lines.join('\n') : 'No open positions.',
    leverageLines.length > 0 ? `\nLEVERAGED CLUSTERS:\n${leverageLines.join('\n')}` : '',
    notAvailable.length > 0 ? `\nNOT AVAILABLE (do not estimate these):\n${notAvailable.map(n => `- ${n}`).join('\n')}` : '',
    '',
    'RULES FOR YOUR ANSWER:',
    '- Quote only figures that appear above. If a figure you need is not above, say it is not available.',
    '- Do not contradict the "app suggests" action for a position. If you disagree, say so on a separate line starting "AI NOTE:".',
    '- You cannot place, change or cancel orders. Actions are taken by the trader in the Positions Workspace.',
  ].filter((line, index, all) => !(line === '' && all[index - 1] === '')).join('\n');

  return {
    generatedAt: input.generatedAt,
    positionCount: positions.length,
    tiles: [thetaTile, atRiskTile, concentrationTile, closeTile],
    watch,
    notAvailable,
    allowedFigures: allowed.filter(finite),
    contextText,
  };
}

// ── Figure check ────────────────────────────────────────────────────────────

const FIGURE_PATTERN = /(\$\s?\d[\d,]*(?:\.\d+)?\s?[kK]?)|(\d[\d,]*(?:\.\d+)?\s?%)/g;

export interface ExtractedFigure { raw: string; value: number; isPercent: boolean }

/** Pulls dollar amounts and percentages out of free text. Dates, DTE and years are ignored. */
export function extractFigures(text: string): ExtractedFigure[] {
  const out: ExtractedFigure[] = [];
  for (const match of Array.from(text.matchAll(FIGURE_PATTERN))) {
    const raw = match[0].trim();
    const isPercent = raw.endsWith('%');
    let numeric = raw.replace(/[$,%\s]/g, '');
    let multiplier = 1;
    if (/[kK]$/.test(numeric)) { multiplier = 1000; numeric = numeric.slice(0, -1); }
    const value = Number(numeric) * multiplier;
    if (Number.isFinite(value)) out.push({ raw, value, isPercent });
  }
  return out;
}

function matchesAllowed(value: number, allowed: number[], isPercent: boolean): boolean {
  return allowed.some(a => {
    const tolerance = isPercent ? 0.5 : Math.max(1, Math.abs(a) * 0.005);
    return Math.abs(a - value) <= tolerance;
  });
}

/**
 * Dollar amounts and percentages in `answer` that are neither in the snapshot nor in what the
 * trader typed. Derived figures (a sum the model worked out) are flagged too: the panel shows a
 * note and leaves the text alone, so the trader decides.
 */
export function findUnsupportedFigures(answer: string, allowedFigures: number[], userTexts: string[] = []): string[] {
  const userFigures = userTexts.flatMap(text => extractFigures(text).map(f => f.value));
  const allowed = [...allowedFigures, ...userFigures];
  const flagged: string[] = [];
  for (const figure of extractFigures(answer)) {
    if (!matchesAllowed(figure.value, allowed, figure.isPercent) && !flagged.includes(figure.raw)) {
      flagged.push(figure.raw);
    }
  }
  return flagged;
}

export interface FigureRedaction { text: string; removedCount: number }

/**
 * Replaces every unsupported dollar/percent figure with "[figure hidden]" so a number that is not
 * in the snapshot never reaches the trader as if it were real. The count drives the panel banner.
 */
export function redactUnsupportedFigures(answer: string, allowedFigures: number[], userTexts: string[] = []): FigureRedaction {
  const userFigures = userTexts.flatMap(text => extractFigures(text).map(f => f.value));
  const allowed = [...allowedFigures, ...userFigures];
  let removedCount = 0;
  const text = answer.replace(FIGURE_PATTERN, (raw: string) => {
    const [figure] = extractFigures(raw);
    if (!figure || matchesAllowed(figure.value, allowed, figure.isPercent)) return raw;
    removedCount += 1;
    return '[figure hidden]';
  });
  return { text, removedCount };
}
