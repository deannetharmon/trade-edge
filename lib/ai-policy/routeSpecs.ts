// lib/ai-policy/routeSpecs.ts
//
// Registry of the five routes: tier, schema version, allowed trust classes, required sources, output schema, citable
// field registry, and prompt template. A route with an EMPTY registry and no template cannot produce a citable answer
// (fail closed): scan_summary and grounded_chat are registered by 0001B; the deep routes stay empty until 0001D / 0001E.
// `requiredSources` / `strictFreshness` / `maxOutputTokens` are defaults each phase confirms with Ian (field lists) and Alan.

import { SCAN_REGISTRY } from './registries/scanSession';
import { GROUNDED_CHAT_TEMPLATE, SCAN_SUMMARY_TEMPLATE, scanServerDisclosures } from './templates/scanTemplates';
import { MODEL_OUTPUT_JSON_SCHEMA } from './validator';
import type { AiRouteId, AiTier, AnalysisInput, CitableFieldRegistry, RenderedOutput, SourceKind, TrustClass } from './types';

export interface PromptTemplate {
  id: string;
  version: string;
  system: string;
  /**
   * Builds the user message from the frozen input, the redacted question (grounded_chat only), and the validated prior
   * outputs the server loaded (grounded_chat only; empty otherwise). Must be deterministic.
   */
  buildUserMessage(input: AnalysisInput, question: string | null, priorOutputs: readonly RenderedOutput[]): string;
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
  /**
   * The route whose input this route reads (defaults to this route). grounded_chat reads the scan snapshot frozen for
   * scan_summary, so one frozen input serves both routes.
   */
  inputKind?: AiRouteId;
  /** false: each artifact stands alone (chat turns); default true: a refresh supersedes older artifacts for the subject. */
  supersedesPrior?: boolean;
  /** true: the route may load the caller's earlier artifacts for the same input as validated context (grounded_chat). */
  allowsPriorArtifacts?: boolean;
  /** Server-written disclosures appended to `missingOrStaleData` regardless of model output (e.g. rows omitted by a cap). */
  serverDisclosures?: (input: AnalysisInput) => string[];
}

const NO_FIELDS: CitableFieldRegistry = [];

export const ROUTE_SPECS: Record<AiRouteId, RouteSpec> = {
  // Reasoning-capable models bill hidden reasoning tokens against the output limit, so these limits leave room for it.
  // Every scan field is scanCalculation, and validator rule 4 rejects citations to a stale source, so a scan older than
  // the D7 limit is unavailable up front (INPUT_STALE) instead of paying for a call that could only be rejected.
  scan_summary: {
    route: 'scan_summary', tier: 'economy', schemaVersion: 'scan_summary.v1', allowedTrust: ['client_attested'],
    requiredSources: ['scanCalculation'], strictFreshness: true, maxOutputTokens: 4000, requiresQuestion: false,
    outputSchema: MODEL_OUTPUT_JSON_SCHEMA, citableFields: SCAN_REGISTRY, template: SCAN_SUMMARY_TEMPLATE,
    serverDisclosures: scanServerDisclosures,
  },
  grounded_chat: {
    route: 'grounded_chat', tier: 'economy', schemaVersion: 'grounded_chat.v1', allowedTrust: ['client_attested'],
    requiredSources: ['scanCalculation'], strictFreshness: true, maxOutputTokens: 3000, requiresQuestion: true,
    outputSchema: MODEL_OUTPUT_JSON_SCHEMA, citableFields: SCAN_REGISTRY, template: GROUNDED_CHAT_TEMPLATE,
    // Chat reads the snapshot frozen for scan_summary; each turn stands alone; earlier turns are passed back by id.
    inputKind: 'scan_summary', supersedesPrior: false, allowsPriorArtifacts: true, serverDisclosures: scanServerDisclosures,
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
