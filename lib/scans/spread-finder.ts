// lib/scans/spread-finder.ts
// Mechanically extracted from app/screener/page.tsx (TE-0005A). Verbatim — not rewritten.
import type { SpreadCandidate } from './types';
import type { RulesType } from './constants';
import { getWidthSteps, getBidAskMax, normalizeIv, calcSpreadPop, daysUntil } from './scan-utils';

export function trySpreadAtWidth(legs: any[], strategy: 'BPS' | 'BCS', expDate: string, width: number, price: number | null, RULES: RulesType, ivPctForPop?: number | null): SpreadCandidate | null {
  const bidAskMax = getBidAskMax(price);
  const candidates: SpreadCandidate[] = [];
  for (const shortLeg of legs) {
    const delta = shortLeg.delta; if (delta == null) continue;
    const absDelta = Math.abs(delta);
    if (absDelta < RULES.SPREAD_DELTA_MIN || absDelta > RULES.SPREAD_DELTA_MAX) continue;
    if (shortLeg.openInterest < RULES.OI_MIN || shortLeg.ask - shortLeg.bid > bidAskMax) continue;
    const longStrike = strategy === 'BPS' ? shortLeg.strikePrice - width : shortLeg.strikePrice + width;
    const longLeg = legs.find((o: any) => Math.abs(o.strikePrice - longStrike) < 0.01);
    if (!longLeg || longLeg.openInterest < RULES.OI_MIN || longLeg.ask - longLeg.bid > bidAskMax) continue;
    const credit = parseFloat((shortLeg.mid - longLeg.mid).toFixed(2)); if (credit <= 0) continue;
    const creditRatio = credit / width; if (creditRatio < RULES.CREDIT_RATIO_MIN) continue;
    const maxLoss = width - credit; const roc = maxLoss > 0 ? (credit / maxLoss) * 100 : 0; if (roc < RULES.ROC_MIN_SPREAD) continue;
    const ivForPop = normalizeIv(ivPctForPop) ?? normalizeIv(shortLeg.iv);
    const modelPop = calcSpreadPop(strategy, price, shortLeg.strikePrice, credit, daysUntil(expDate), ivForPop);
    if (modelPop == null) continue;
    const pop = modelPop;
    candidates.push({
          strategy,
          expiration: expDate,
          dte: daysUntil(expDate),
          shortStrike: shortLeg.strikePrice,
          longStrike,
          shortDelta: absDelta,
          shortOI: shortLeg.openInterest,
          longOI: longLeg.openInterest,
          credit,
          spreadWidth: width,
          creditRatio,
          roc,
          pop,
          optimized: true,
          shortOccSymbol: shortLeg.occSymbol,
          longOccSymbol: longLeg.occSymbol,
          shortIv: normalizeIv(shortLeg.iv),
          shortBid: shortLeg.bid,
          shortAsk: shortLeg.ask,
          longBid: longLeg.bid,
          longAsk: longLeg.ask,
          quoteFetchedAt: Math.max(shortLeg.fetchedAt ?? 0, longLeg.fetchedAt ?? 0),
          expirationIvx: null,   // populated in runChecklist after candidate selected
          expectedMove: null,    // populated in runChecklist after candidate selected
        });
  }
  if (candidates.length === 0) return null;
  // Pick best POP; use ROC as tiebreaker when POP difference is < 5%
  return candidates.sort((a, b) => {
    const popDiff = (b.pop ?? 0) - (a.pop ?? 0);
    if (Math.abs(popDiff) >= 5) return popDiff;
    return b.roc - a.roc;
  })[0];
}


export function findBestSpread(chain: any[], strategy: 'BPS' | 'BCS', expDate: string, price: number | null, RULES: RulesType, ivPctForPop?: number | null): SpreadCandidate | null {
  const legs = chain.filter(o => o.expirationDate === expDate && o.optionType === (strategy === 'BPS' ? 'P' : 'C'));
  const allCandidates: SpreadCandidate[] = [];
  for (const width of getWidthSteps(RULES.MAX_SPREAD_WIDTH, price)) {
    const c = trySpreadAtWidth(legs, strategy, expDate, width, price, RULES, ivPctForPop);
    if (c) allCandidates.push(c);
  }
  if (allCandidates.length === 0) return null;
  // Pick best POP across all widths; ROC tiebreaker when POP difference is < 5%
  return allCandidates.sort((a, b) => {
    const popDiff = (b.pop ?? 0) - (a.pop ?? 0);
    if (Math.abs(popDiff) >= 5) return popDiff;
    return b.roc - a.roc;
  })[0];
}


export function tryICSideAtWidth(legs: any[], side: 'put' | 'call', width: number, price: number | null, RULES: RulesType, minCallStrike?: number): { shortStrike: number; longStrike: number; shortDelta: number; credit: number; creditRatio: number; roc: number; shortOI: number; longOI: number; pop: number; shortOccSymbol?: string; longOccSymbol?: string } | null {
  const bidAskMax = getBidAskMax(price);
  const candidates: { shortStrike: number; longStrike: number; shortDelta: number; credit: number; creditRatio: number; roc: number; shortOI: number; longOI: number; pop: number; shortOccSymbol?: string; longOccSymbol?: string }[] = [];
  for (const shortLeg of legs) {
    if (side === 'call' && minCallStrike != null && shortLeg.strikePrice <= minCallStrike) continue;
    const delta = shortLeg.delta; if (delta == null) continue;
    const absDelta = Math.abs(delta);
    if (absDelta < RULES.IC_DELTA_MIN || absDelta > RULES.IC_DELTA_MAX) continue;
    if (shortLeg.openInterest < RULES.OI_MIN || shortLeg.ask - shortLeg.bid > bidAskMax) continue;
    const longStrike = side === 'put' ? shortLeg.strikePrice - width : shortLeg.strikePrice + width;
    const longLeg = legs.find((o: any) => Math.abs(o.strikePrice - longStrike) < 0.01);
    if (!longLeg || longLeg.openInterest < RULES.OI_MIN || longLeg.ask - longLeg.bid > bidAskMax) continue;
    const credit = parseFloat((shortLeg.mid - longLeg.mid).toFixed(2)); if (credit <= 0) continue;
    const creditRatio = credit / width; if (creditRatio < RULES.CREDIT_RATIO_MIN) continue;
    const maxLoss = width - credit; const roc = maxLoss > 0 ? (credit / maxLoss) * 100 : 0;
    const pop = (1 - absDelta) * 100;
    if (pop < RULES.POP_MIN) continue;
      candidates.push({ shortStrike: shortLeg.strikePrice, longStrike, shortDelta: absDelta, credit, creditRatio, roc, shortOI: shortLeg.openInterest, longOI: longLeg.openInterest, pop, shortOccSymbol: shortLeg.occSymbol, longOccSymbol: longLeg.occSymbol });
    }
    if (candidates.length === 0) return null;
    // Pick best POP; ROC tiebreaker within 5%
    return candidates.sort((a, b) => {
    const popDiff = b.pop - a.pop;
    if (Math.abs(popDiff) >= 5) return popDiff;
    return b.roc - a.roc;
  })[0];
}


export function findBestIC(chain: any[], expDate: string, price: number | null, RULES: RulesType): SpreadCandidate | null {
  const puts = chain.filter((o: any) => o.expirationDate === expDate && o.optionType === 'P');
  const calls = chain.filter((o: any) => o.expirationDate === expDate && o.optionType === 'C');
  const widthSteps = getWidthSteps(RULES.MAX_SPREAD_WIDTH, price);
  let bestPut: (ReturnType<typeof tryICSideAtWidth> & { width: number }) | null = null;
  for (const width of widthSteps) { const c = tryICSideAtWidth(puts, 'put', width, price, RULES); if (c && (bestPut === null || c.roc > bestPut.roc)) bestPut = { ...c, width }; }
  if (!bestPut) return null;
  let bestCall: (ReturnType<typeof tryICSideAtWidth> & { width: number }) | null = null;
  for (const width of widthSteps) { const c = tryICSideAtWidth(calls, 'call', width, price, RULES, bestPut.shortStrike); if (c && (bestCall === null || c.roc > bestCall.roc)) bestCall = { ...c, width }; }
  if (!bestCall) return null;
  const totalCredit = parseFloat((bestPut.credit + bestCall.credit).toFixed(2));
  const maxLoss = Math.max(bestPut.width - bestPut.credit, bestCall.width - bestCall.credit);
  const roc = maxLoss > 0 ? (totalCredit / maxLoss) * 100 : 0; if (roc < RULES.ROC_MIN_IC) return null;
  return { strategy: 'IC', expiration: expDate, dte: daysUntil(expDate), shortStrike: bestPut.shortStrike, longStrike: bestPut.longStrike, shortDelta: bestPut.shortDelta, shortOI: bestPut.shortOI, longOI: bestPut.longOI, credit: bestPut.credit, spreadWidth: bestPut.width, creditRatio: bestPut.creditRatio, roc, pop: (1 - bestPut.shortDelta - bestCall.shortDelta) * 100, shortCallStrike: bestCall.shortStrike, longCallStrike: bestCall.longStrike, shortCallOI: bestCall.shortOI, longCallOI: bestCall.longOI, callCredit: bestCall.credit, callWidth: bestCall.width, totalCredit, optimized: true, shortOccSymbol: bestPut.shortOccSymbol, longOccSymbol: bestPut.longOccSymbol, shortCallOccSymbol: bestCall.shortOccSymbol, longCallOccSymbol: bestCall.longOccSymbol };
}


export function findBestSpreadUnfiltered(chain: any[], strategy: 'BPS' | 'BCS', expDate: string, price: number | null): SpreadCandidate | null {
  const legs = chain.filter(o =>
    o.expirationDate === expDate &&
    o.optionType === (strategy === 'BPS' ? 'P' : 'C')
  );

  const candidates: SpreadCandidate[] = [];
  const stepSize = price == null ? 5 : price >= 2000 ? 25 : 5;
  const maxWidth = price == null ? 100 : Math.min(price * 0.15, 500);

  for (let width = stepSize; width <= maxWidth; width += stepSize) {
    for (const shortLeg of legs) {
      const delta = shortLeg.delta;
      if (delta == null) continue;

      const absDelta = Math.abs(delta);
      if (absDelta < 0.05 || absDelta > 0.60) continue;

      const longStrike =
        strategy === 'BPS'
          ? shortLeg.strikePrice - width
          : shortLeg.strikePrice + width;

      const longLeg = legs.find((o: any) => Math.abs(o.strikePrice - longStrike) < 0.01);
      if (!longLeg) continue;

      const credit = parseFloat((shortLeg.mid - longLeg.mid).toFixed(2));
      if (credit <= 0) continue;

      const creditRatio = credit / width;
      const maxLoss = width - credit;
      const roc = maxLoss > 0 ? (credit / maxLoss) * 100 : 0;

      const ivForPop = normalizeIv(shortLeg.iv);
      const modelPop = calcSpreadPop(
        strategy,
        price,
        shortLeg.strikePrice,
        credit,
        daysUntil(expDate),
        ivForPop
      );
      if (modelPop == null) continue;
      const pop = modelPop;

      candidates.push({
        strategy,
        expiration: expDate,
        dte: daysUntil(expDate),
        shortStrike: shortLeg.strikePrice,
        longStrike,
        shortDelta: absDelta,
        shortOI: shortLeg.openInterest ?? 0,
        longOI: longLeg.openInterest ?? 0,
        credit,
        spreadWidth: width,
        creditRatio,
        roc,
        pop,
        optimized: false,
        shortOccSymbol: shortLeg.occSymbol,
        longOccSymbol: longLeg.occSymbol,
      });
    }
  }

  if (candidates.length === 0) return null;

  return candidates.sort((a, b) => {
    const popDiff = (b.pop ?? 0) - (a.pop ?? 0);
    if (Math.abs(popDiff) >= 5) return popDiff;
    return b.roc - a.roc;
  })[0];
}


export function findBestICUnfiltered(chain: any[], expDate: string, price: number | null): SpreadCandidate | null {
  const puts = chain.filter((o: any) => o.expirationDate === expDate && o.optionType === 'P');
  const calls = chain.filter((o: any) => o.expirationDate === expDate && o.optionType === 'C');
  const putSpread = findBestSpreadUnfiltered([...puts.map((o: any) => ({ ...o, optionType: 'P' })), ...puts.map((o: any) => ({ ...o, optionType: 'P' }))], 'BPS', expDate, price);
  const callSpread = findBestSpreadUnfiltered([...calls.map((o: any) => ({ ...o, optionType: 'C' })), ...calls.map((o: any) => ({ ...o, optionType: 'C' }))], 'BCS', expDate, price);
  if (!putSpread || !callSpread) return null;
  const totalCredit = parseFloat((putSpread.credit + callSpread.credit).toFixed(2));
  const maxLoss = Math.max(putSpread.spreadWidth - putSpread.credit, callSpread.spreadWidth - callSpread.credit);
  const roc = maxLoss > 0 ? (totalCredit / maxLoss) * 100 : 0;
  return { strategy: 'IC', expiration: expDate, dte: daysUntil(expDate), shortStrike: putSpread.shortStrike, longStrike: putSpread.longStrike, shortDelta: putSpread.shortDelta, shortOI: putSpread.shortOI, longOI: putSpread.longOI, credit: putSpread.credit, spreadWidth: putSpread.spreadWidth, creditRatio: putSpread.creditRatio, roc, pop: (1 - putSpread.shortDelta - callSpread.shortDelta) * 100, shortCallStrike: callSpread.shortStrike, longCallStrike: callSpread.longStrike, shortCallOI: callSpread.shortOI, longCallOI: callSpread.longOI, callCredit: callSpread.credit, callWidth: callSpread.spreadWidth, totalCredit, optimized: false, shortOccSymbol: putSpread.shortOccSymbol, longOccSymbol: putSpread.longOccSymbol, shortCallOccSymbol: callSpread.shortOccSymbol, longCallOccSymbol: callSpread.longOccSymbol };
}


