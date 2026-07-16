// lib/portfolioHealth/index.ts
//
// PI-0011B: Portfolio Health Engine.

export { calculatePortfolioHealthScore } from './portfolioHealth';
export type {
  PortfolioHealthStatus,
  PortfolioHealthContributor,
  PortfolioHealthInput,
  PortfolioHealthResult,
} from './portfolioHealth';

export { DEFAULT_PORTFOLIO_HEALTH_CONFIG } from './config';
export type { PortfolioHealthConfig, PortfolioHealthFactorWeights } from './config';
