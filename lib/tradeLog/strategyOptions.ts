// lib/tradeLog/strategyOptions.ts
//
// Every strategy a closed trade can have, with its label. Typed against ClosedTrade so adding a strategy
// to the trade model forces a label here, and the Trade Log filter and its by-strategy summary can never
// silently leave a strategy out (cash-secured puts were missing from both).

import type { ClosedTrade } from './types';

export type TradeStrategy = ClosedTrade['strategy'];

export const TRADE_STRATEGY_LABELS: Record<TradeStrategy, string> = {
  BPS: 'BPS',
  BCS: 'BCS',
  IC: 'IC',
  SPREAD: 'Other spread',
  CSP: 'CSP',
  SHORT_CALL: 'Short call',
  OTHER: 'Other',
};

export const TRADE_STRATEGY_ORDER: readonly TradeStrategy[] = ['BPS', 'BCS', 'IC', 'CSP', 'SHORT_CALL', 'SPREAD', 'OTHER'];

export const TRADE_STRATEGY_FILTER_OPTIONS = TRADE_STRATEGY_ORDER.map(value => ({ value, label: TRADE_STRATEGY_LABELS[value] }));
