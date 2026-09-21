// lib/ai-policy/index.ts
//
// Public exports only. Nothing in lib/scans, lib/portfolio-snapshot, lib/order-lifecycle, lib/decision-engine,
// lib/autopilot, lib/screener, lib/portfolio, or lib/paper-trading may import this module (import-boundary test).

export { runAiRoute } from './gateway';
export type { GatewayDeps, RunAiRouteRequest } from './gateway';
export { buildAnalysisInput, getInput, saveInput } from './inputStore';
export type { BuildInputParams } from './inputStore';
export { getArtifact, listArtifactIds } from './artifactStore';
export { getProvenance } from './provenance';
export { freezeScanSession } from './freezeScanSession';
export type { FreezeRequest, FreezeResult } from './freezeScanSession';
export { readArtifactForUser } from './artifactRead';
export type { ArtifactReadResult } from './artifactRead';
export { REASON_HTTP_STATUS } from './http';
export type { ProvenanceRecord } from './provenance';
export { accountScopeId } from './scope';
export { redactUserText, MAX_USER_TEXT_CHARS } from './redact';
export { ROUTE_SPECS } from './routeSpecs';
export type { PromptTemplate, RouteSpec } from './routeSpecs';
export { LEXICON_VERSION } from './lexicon';
export { VALIDATOR_VERSION } from './validator';
export { AI_ROUTE_IDS, SOURCE_KINDS, SOURCE_LABELS } from './types';
export type {
  AiArtifact, AiRouteId, AiRouteResult, AiTier, AnalysisInput, ArtifactStatus, CitableField, CitableFieldRegistry, ClientCitation,
  ReasonCode, RenderedOutput, SourceKind, TrustClass,
} from './types';
