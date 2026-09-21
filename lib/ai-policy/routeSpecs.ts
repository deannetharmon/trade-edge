// lib/ai-policy/routeSpecs.ts
//
// Registry of the five routes: tier, schema version, allowed trust classes, required sources, output schema, citable
// field registry, and prompt template. In 0001A the citable-field registries are EMPTY and no template exists: a route
// therefore cannot produce a citable answer (fail closed) until its phase (0001B / 0001D / 0001E) registers its fields
// and template text. `requiredSources` / `strictFreshness` / `maxOutputTokens` below are provisional defaults that those
// phases confirm with Ian (field lists) and Alan.

import { MODEL_OUTPUT_JSON_SCHEMA } from './validator';
import type { AiRouteId, AiTier, AnalysisInput, CitableFieldRegistry, SourceKind, TrustClass } from './types';

export interface PromptTemplate {
  id: string;
  version: string;
  system: string;
  /** Builds the user message from the frozen input (and, for grounded_chat, the redacted question). Must be deterministic. */
  buildUserMessage(input: AnalysisInput, question: string | null): string;
}

export interface RouteSpec {
  route: AiRouteId;
  tier: AiTier;
  schemaVersion: string;
  allowedTrust: readonly TrustClass[];
  /** Sources this route covers. */
  requiredSources: readonly SourceKind[];
  /** Deep routes: any missing/stale required source makes the route unavailable. Summary/chat: proceed and disclose. */
  strictFreshness: boolean;
  maxOutputTokens: number;
  requiresQuestion: boolean;
  outputSchema: Record<string, unknown>;
  citableFields: CitableFieldRegistry;
  template: PromptTemplate | null;
  /** Deferred routes (0001G) are never dispatched by this gateway. */
  deferred?: boolean;
}

const NO_FIELDS: CitableFieldRegistry = [];

export const ROUTE_SPECS: Record<AiRouteId, RouteSpec> = {
  scan_summary: {
    route: 'scan_summary', tier: 'economy', schemaVersion: 'scan_summary.v1', allowedTrust: ['client_attested'],
    requiredSources: ['scanCalculation'], strictFreshness: false, maxOutputTokens: 900, requiresQuestion: false,
    outputSchema: MODEL_OUTPUT_JSON_SCHEMA, citableFields: NO_FIELDS, template: null,
  },
  grounded_chat: {
    route: 'grounded_chat', tier: 'economy', schemaVersion: 'grounded_chat.v1', allowedTrust: ['client_attested'],
    requiredSources: ['scanCalculation'], strictFreshness: false, maxOutputTokens: 700, requiresQuestion: true,
    outputSchema: MODEL_OUTPUT_JSON_SCHEMA, citableFields: NO_FIELDS, template: null,
  },
  leaps_deep_analysis: {
    route: 'leaps_deep_analysis', tier: 'reasoning', schemaVersion: 'leaps_deep_analysis.v1', allowedTrust: ['server_verified'],
    requiredSources: ['quoteGreeks', 'earningsCalendar', 'scanCalculation'], strictFreshness: true, maxOutputTokens: 3000, requiresQuestion: false,
    outputSchema: MODEL_OUTPUT_JSON_SCHEMA, citableFields: NO_FIELDS, template: null,
  },
  pmcc_deep_analysis: {
    route: 'pmcc_deep_analysis', tier: 'reasoning', schemaVersion: 'pmcc_deep_analysis.v1', allowedTrust: ['server_verified'],
    requiredSources: ['quoteGreeks', 'brokerPositionCapacity', 'earningsCalendar'], strictFreshness: true, maxOutputTokens: 3000, requiresQuestion: false,
    outputSchema: MODEL_OUTPUT_JSON_SCHEMA, citableFields: NO_FIELDS, template: null,
  },
  retrospective_batch: {
    route: 'retrospective_batch', tier: 'batch', schemaVersion: 'retrospective_batch.v1', allowedTrust: ['server_verified'],
    requiredSources: [], strictFreshness: true, maxOutputTokens: 0, requiresQuestion: false,
    outputSchema: MODEL_OUTPUT_JSON_SCHEMA, citableFields: NO_FIELDS, template: null, deferred: true,
  },
};
