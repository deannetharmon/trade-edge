// lib/autopilot/engine.ts

import { calculateDecisionConfidence, calculateOpportunityScore } from './scoring';
import { appendAutopilotLog, getAutopilotConfig, getAutopilotLog, getPaperAccount, savePaperAccount } from './store';
import type { AutopilotCandidate, AutopilotDecisionLogEntry, PaperAccount, PaperPosition } from './types';

const iso = () => new Date().toISOString();

function decision(entry: Omit<AutopilotDecisionLogEntry, 'id' | 'timestamp'>): AutopilotDecisionLogEntry {
  return { ...entry, id: crypto.randomUUID(), timestamp: iso() };
}

function dailyLossPct(account: PaperAccount): number {
  const today = iso().slice(0, 10);
  const start = account.dailyEquityCurve.find((p) => p.date === today)?.equity ?? account.currentBalance;
  return start > 0 ? Math.max(0, ((start - account.currentBalance) / start) * 100) : 0;
}

function drawdownPct(account: PaperAccount): number {
  return account.peakBalance > 0 ? Math.max(0, ((account.peakBalance - account.currentBalance) / account.peakBalance) * 100) : 0;
}

function entriesToday(account: PaperAccount): number {
  const today = iso().slice(0, 10);
  return [...account.openPositions, ...account.closedPositions].filter((p) => p.entryDate.slice(0, 10) === today).length;
}

function entriesThisWeek(account: PaperAccount): number {
  const cutoff = Date.now() - 7 * 86400000;
  return [...account.openPositions, ...account.closedPositions].filter((p) => new Date(p.entryDate).getTime() >= cutoff).length;
}

function demoCandidates(): AutopilotCandidate[] {
  return [
    {
      id: 'paper-demo-spy-bps', strategy: 'BPS', symbol: 'SPY', underlyingPrice: 620,
      estimatedCredit: 1.1, theoreticalMaxLoss: 390, pop: 74, roc: 8.5, ivr: 34,
      technicalFit: 72, goalAlignment: 1, correlationPenalty: 8, concentrationPenalty: 5,
      betaWeightedDelta: 12, sector: 'Index ETF', notes: ['Demo candidate until scanner is wired in.'],
      legs: [
        { symbol: 'SPY', underlyingSymbol: 'SPY', assetType: 'option', direction: 'short', optionType: 'put', strike: 600, expiration: 'paper-45d', quantity: 1, delta: -0.18, bid: 1.05, ask: 1.15, mid: 1.1 },
        { symbol: 'SPY', underlyingSymbol: 'SPY', assetType: 'option', direction: 'long', optionType: 'put', strike: 595, expiration: 'paper-45d', quantity: 1, delta: -0.14, bid: 0.25, ask: 0.32, mid: 0.29 },
      ],
    },
    {
      id: 'paper-demo-nvda-csp', strategy: 'CSP', symbol: 'NVDA', underlyingPrice: 158,
      estimatedCredit: 2.2, theoreticalMaxLoss: 14500, pop: 70, roc: 5.8, ivr: 42,
      technicalFit: 68, goalAlignment: 1.15, correlationPenalty: 18, concentrationPenalty: 20,
      betaWeightedDelta: 28, sector: 'Semiconductors', notes: ['Assignment-intent demo candidate.'],
      legs: [
        { symbol: 'NVDA', underlyingSymbol: 'NVDA', assetType: 'option', direction: 'short', optionType: 'put', strike: 145, expiration: 'paper-45d', quantity: 1, delta: -0.22, bid: 2.1, ask: 2.3, mid: 2.2 },
      ],
    },
  ];
}

function confidenceFor(candidate: AutopilotCandidate) {
  const quoteTimestamp = iso();
  return calculateDecisionConfidence({
    legs: candidate.legs.map((leg) => {
      const bid = leg.bid ?? leg.mid ?? 0;
      const ask = leg.ask ?? leg.mid ?? bid;
      const spread = Math.max(0.01, Math.abs(ask - bid));
      return { bidAskSpread: spread, averageBidAskSpread20: spread * 1.05, quoteTimestamp };
    }),
    vixNow: 18,
    vixThirtyMinutesAgo: 17.9,
  });
}

export async function runAutopilotPaperCycle(userId: string, suppliedCandidates?: AutopilotCandidate[]) {
  const config = await getAutopilotConfig(userId);
  let account = await getPaperAccount(userId);
  const decisions: AutopilotDecisionLogEntry[] = [];

  async function log(entry: AutopilotDecisionLogEntry) {
    decisions.push(entry);
    await appendAutopilotLog(userId, entry);
  }

  if (config.killSwitchEnabled) {
    await log(decision({ action: 'no_action', reason: 'Paper Autopilot kill switch is enabled.', rulesTriggered: ['kill_switch'], rulesBlocked: ['new_entries'], configSnapshot: config }));
    return { timestamp: iso(), userId, scannedCandidates: 0, openedPositions: 0, suppressedCandidates: 0, decisions, account };
  }

  if (dailyLossPct(account) >= config.thresholds.dailyLossPausePct || drawdownPct(account) >= config.thresholds.monthlyDrawdownDefensivePct) {
    await log(decision({ action: 'manage_only', reason: 'Drawdown circuit breaker active; new paper entries paused.', rulesTriggered: ['drawdown_circuit_breaker'], rulesBlocked: ['new_entries'], configSnapshot: config }));
    account.lastRunAt = iso();
    account = await savePaperAccount(account);
    return { timestamp: iso(), userId, scannedCandidates: 0, openedPositions: 0, suppressedCandidates: 0, decisions, account };
  }

  let openedPositions = 0;
  let suppressedCandidates = 0;
  const candidates = suppliedCandidates ?? demoCandidates();

  for (const candidate of candidates) {
    const confidence = confidenceFor(candidate);
    const opportunity = calculateOpportunityScore(candidate, config, account);
    const blocked: string[] = [];

    if (confidence.total < config.thresholds.decisionConfidenceMinimum) blocked.push('decision_confidence_below_minimum');
    if (opportunity.total <= 0) blocked.push('opportunity_score_zero');
    if (entriesToday(account) + openedPositions >= config.thresholds.maxEntriesPerDay) blocked.push('daily_entry_limit');
    if (entriesThisWeek(account) + openedPositions >= config.thresholds.maxEntriesPerWeek) blocked.push('weekly_entry_limit');

    if (blocked.length > 0) {
      suppressedCandidates += 1;
      await log(decision({ strategy: candidate.strategy, symbol: candidate.symbol, action: 'suppress_entry', opportunityScore: opportunity.total, decisionConfidence: confidence.total, reason: `Paper candidate suppressed: ${blocked.join(', ')}.`, rulesTriggered: ['paper_scan', candidate.strategy], rulesBlocked: blocked, configSnapshot: config, metadata: { candidate, confidence, opportunity } }));
      continue;
    }

    const position: PaperPosition = {
      id: crypto.randomUUID(), strategy: candidate.strategy, symbol: candidate.symbol, legs: candidate.legs,
      entryDate: iso(), entryCredit: candidate.estimatedCredit * 100, simulatedFillPrice: candidate.estimatedCredit,
      theoreticalMaxLoss: candidate.theoreticalMaxLoss, status: 'open', managementLog: [],
      goalAtEntry: config.perStrategyGoal[candidate.strategy], decisionConfidenceAtEntry: confidence.total,
      opportunityScoreAtEntry: opportunity.total,
    };

    const opened = decision({ strategy: candidate.strategy, symbol: candidate.symbol, action: 'open_paper_position', opportunityScore: opportunity.total, decisionConfidence: confidence.total, reason: `Simulated paper ${candidate.strategy} entry on ${candidate.symbol}.`, rulesTriggered: ['paper_scan', candidate.strategy, 'decision_confidence_passed', 'opportunity_score_passed'], rulesBlocked: [], configSnapshot: config, metadata: { positionId: position.id, candidate, confidence, opportunity } });
    position.managementLog.push(opened);
    account.openPositions.unshift(position);
    openedPositions += 1;
    await log(opened);
  }

  account.lastRunAt = iso();
  account = await savePaperAccount(account);
  return { timestamp: iso(), userId, scannedCandidates: candidates.length, openedPositions, suppressedCandidates, decisions, account };
}

export async function unlockCoveredCallShares(userId: string, positionId: string): Promise<PaperAccount> {
  const config = await getAutopilotConfig(userId);
  const account = await getPaperAccount(userId);
  const position = account.openPositions.find((p) => p.id === positionId && p.strategy === 'CC');
  if (!position) throw new Error('Active paper covered call not found');

  const entry = decision({ strategy: 'CC', symbol: position.symbol, action: 'unlock_shares', reason: 'Manual Unlock Shares override recorded for paper position.', rulesTriggered: ['unlock_shares_manual_override'], rulesBlocked: [], configSnapshot: config, metadata: { positionId } });
  position.status = 'review_required';
  position.managementLog.unshift(entry);
  await appendAutopilotLog(userId, entry);
  return savePaperAccount(account);
}

export async function getAutopilotSnapshot(userId: string) {
  const [config, account, log] = await Promise.all([getAutopilotConfig(userId), getPaperAccount(userId), getAutopilotLog(userId, 100)]);
  return { config, account, log };
}
