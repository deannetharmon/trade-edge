// lib/ai-policy/fixtures/testRoute.ts
//
// Synthetic fixtures for the AI policy tests: a test route spec with a citable-field registry and template, a
// complete valid environment, a synthetic snapshot, and model outputs. No real account data. Test-only.

import { buildAnalysisInput } from '../inputStore';
import { ROUTE_SPECS } from '../routeSpecs';
import type { RouteSpec } from '../routeSpecs';
import type { AiRouteId, AnalysisInput, CitableFieldRegistry, Env, ModelOutput, SourceKind, TrustClass } from '../types';

export const TEST_KEY_HEX = 'a'.repeat(64);
export const TEST_KEY_PREVIOUS_HEX = 'b'.repeat(64);
export const NOW = Date.parse('2026-09-21T15:00:00.000Z');
export const USER = 'user-one@example.test';
export const OTHER_USER = 'user-two@example.test';

export const TEST_REGISTRY: CitableFieldRegistry = [
  { pattern: '/scan/count', label: 'Candidates found', source: 'scanCalculation', format: 'integer' },
  { pattern: '/candidates/*/id', label: 'Candidate', source: 'scanCalculation', format: 'text' },
  { pattern: '/candidates/*/delta', label: 'Delta', source: 'quoteGreeks', format: 'number' },
  { pattern: '/candidates/*/cost', label: 'Estimated cost', source: 'quoteGreeks', format: 'usd' },
  { pattern: '/candidates/*/dte', label: 'Days to expiration', source: 'scanCalculation', format: 'integer' },
  { pattern: '/candidates/*/expiration', label: 'Expiration', source: 'scanCalculation', format: 'date' },
  { pattern: '/candidates/*/ivPct', label: 'Implied volatility', source: 'quoteGreeks', format: 'pct' },
  { pattern: '/candidates/*/readiness', label: 'Readiness', source: 'scanCalculation', format: 'text' },
  { pattern: '/candidates/*/earnings', label: 'Next earnings', source: 'earningsCalendar', format: 'date' },
  { pattern: '/candidates/*/tradable', label: 'Tradable', source: 'scanCalculation', format: 'boolean' },
];

export const TEST_PAYLOAD = {
  scan: { count: 3 },
  candidates: [
    { id: 'AAA', delta: 0.8123, cost: 12345.5, dte: 412, expiration: '2027-01-15', ivPct: 31.25, readiness: 'Not ready', earnings: '2026-10-29', tradable: false },
    { id: 'BBB', delta: 0.75, cost: 9800, dte: 380, expiration: '2026-12-18', ivPct: 28, readiness: 'Ready', earnings: '2026-11-03', tradable: true },
  ],
};

export const FRESH_AS_OF: Record<SourceKind, string | null> = {
  quoteGreeks: new Date(NOW - 60_000).toISOString(),
  brokerPositionCapacity: new Date(NOW - 60_000).toISOString(),
  earningsCalendar: new Date(NOW - 3_600_000).toISOString(),
  scanCalculation: new Date(NOW - 600_000).toISOString(),
};

export const TEST_ENV: Env = {
  AI_POLICY_ENABLED: 'true',
  // Tests are not Production, so the ungated-preview bypass is honored; launchGates.test.ts covers the gated paths.
  AI_POLICY_ALLOW_UNGATED_PREVIEW: 'true',
  AI_POLICY_SCAN_SUMMARY_ENABLED: 'true',
  AI_POLICY_GROUNDED_CHAT_ENABLED: 'true',
  AI_POLICY_LEAPS_DEEP_ENABLED: 'true',
  AI_POLICY_PMCC_DEEP_ENABLED: 'true',
  AI_POLICY_ECONOMY_MODEL: 'gpt-5.6-luna',
  AI_POLICY_REASONING_MODEL: 'gpt-5.6-sol',
  AI_POLICY_ALLOWED_MODELS: 'gpt-5.6-luna,gpt-5.6-sol',
  AI_POLICY_PROVIDER_GOVERNANCE_ATTESTED: 'true',
  AI_POLICY_PROVIDER_POLICY_VERSION: 'test-policy-1',
  AI_POLICY_ARTIFACT_KEY: TEST_KEY_HEX,
  AI_POLICY_SCOPE_SECRET: 'test-scope-secret-0123456789',
  AI_POLICY_USER_MONTHLY_BUDGET_USD: '5',
  AI_POLICY_GLOBAL_DAILY_BUDGET_USD: '20',
  AI_POLICY_SCAN_SUMMARY_HOURLY_LIMIT: '5',
  AI_POLICY_GROUNDED_CHAT_HOURLY_LIMIT: '5',
  AI_POLICY_LEAPS_DEEP_HOURLY_LIMIT: '5',
  AI_POLICY_PMCC_DEEP_HOURLY_LIMIT: '5',
  OPENAI_API_KEY: 'sk-test-not-real',
};

const template = {
  id: 'test-template',
  version: 't1',
  system: 'Explain the frozen facts. Refer to values only with placeholders.',
  buildUserMessage: (input: AnalysisInput, question: string | null): string => JSON.stringify({ payload: input.payload, question }),
};

export function testSpecs(): Record<AiRouteId, RouteSpec> {
  return {
    ...ROUTE_SPECS,
    // The real 0001B scan routes are strict and share one input; these test specs keep the plain 0001A semantics.
    scan_summary: { ...ROUTE_SPECS.scan_summary, strictFreshness: false, serverDisclosures: undefined, citableFields: TEST_REGISTRY, template },
    grounded_chat: {
      ...ROUTE_SPECS.grounded_chat, strictFreshness: false, inputKind: undefined, supersedesPrior: undefined, allowsPriorArtifacts: undefined,
      serverDisclosures: undefined, citableFields: TEST_REGISTRY, template,
    },
    leaps_deep_analysis: { ...ROUTE_SPECS.leaps_deep_analysis, citableFields: TEST_REGISTRY, template },
  };
}

export function makeInput(overrides: {
  route?: AiRouteId;
  userId?: string;
  trust?: TrustClass;
  sourceAsOf?: Partial<Record<SourceKind, string | null>>;
  payload?: unknown;
  subjectKey?: string;
} = {}): AnalysisInput {
  const route = overrides.route ?? 'scan_summary';
  const spec = testSpecs()[route];
  const built = buildAnalysisInput({
    userId: overrides.userId ?? USER,
    accountScope: 'scope-synthetic-0001',
    route,
    trust: overrides.trust ?? spec.allowedTrust[0],
    schemaVersion: spec.schemaVersion,
    subjectKey: overrides.subjectKey ?? 'scan-session-1',
    deterministicStates: ['Not ready'],
    payload: overrides.payload ?? TEST_PAYLOAD,
    sourceAsOf: { ...FRESH_AS_OF, ...overrides.sourceAsOf },
    registry: TEST_REGISTRY,
    nowMs: NOW,
  });
  if (!built.ok) throw new Error(`fixture input invalid: ${built.detail}`);
  return built.input;
}

export const VALID_OUTPUT: ModelOutput = {
  summary: 'The scan finished with {{c:1}} candidates.',
  observations: [{ text: 'Delta is {{c:2}} and days to expiration are {{c:3}}.', citationIds: [2, 3] }],
  tradeoffs: [{ text: 'The estimated cost is {{c:4}}.', citationIds: [4] }],
  missingOrStaleData: [],
  questionsForTrader: [{ text: 'Does the expiration on {{c:5}} fit your plan?' }],
  limitations: [{ text: 'This explanation is read-only.' }],
  citations: [
    { id: 1, pointer: '/scan/count' },
    { id: 2, pointer: '/candidates/0/delta' },
    { id: 3, pointer: '/candidates/0/dte' },
    { id: 4, pointer: '/candidates/0/cost' },
    { id: 5, pointer: '/candidates/0/expiration' },
  ],
};

export const validOutputJson = (mutate?: (o: ModelOutput) => void): string => {
  const copy = JSON.parse(JSON.stringify(VALID_OUTPUT)) as ModelOutput;
  mutate?.(copy);
  return JSON.stringify(copy);
};

/** A fetch stand-in that returns a chat-completions style body. */
export function fakeFetch(text: string, usage = { prompt_tokens: 400, completion_tokens: 200 }): typeof fetch {
  return (async () =>
    new Response(JSON.stringify({ model: 'test-model-2026', usage, choices: [{ message: { content: text } }] }), { status: 200 })) as unknown as typeof fetch;
}
