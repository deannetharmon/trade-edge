// lib/discovery/qvIdentity.ts

// LEAPS-QV-0001 Gate 1 -- the identity (and only the identity) of the Quality Value LEAPS strategy.
// Gate 1 deliberately contains no QV thresholds, scoring or rules; those arrive in Gate 3 under this identity.

import { createStrategyIdentity } from './strategy';

export const QV_STRATEGY_ID = 'QV';
export const QV_V1_0_VERSION = 'QV-v1.0';

export const QV_V1_0_IDENTITY = createStrategyIdentity(QV_STRATEGY_ID, QV_V1_0_VERSION);
