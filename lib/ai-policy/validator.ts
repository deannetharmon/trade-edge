// lib/ai-policy/validator.ts
//
// Default-reject output validation, citation verification, and placeholder rendering. First failure wins and its rule
// name is recorded. The model never writes a number: values appear in prose only as `{{c:N}}` placeholders, and the
// server substitutes the canonical payload value formatted per the registry. Any digit, number word, percent or currency
// symbol left in model prose is rejected, which makes invented or recomputed numbers structurally impossible.

import { canonicalHash } from './canonical';
import { evaluateSource } from './freshness';
import { NUMBER_SYMBOLS_RE, PROSE_CATEGORIES, categoryRegex } from './lexicon';
import { findCitableField, isPrimitiveValue, resolvePointer } from './pointer';
import type { CitationProvenance, ClaimMapEntry } from './provenance';
import { SOURCE_LABELS } from './types';
import type {
  AnalysisInput, CitableField, CitableFieldRegistry, ClientCitation, Claim, ModelCitation, ModelOutput, RenderedOutput,
  SourceKind, TextItem,
} from './types';

export const VALIDATOR_VERSION = 'val-v1';

export type ValidationRule =
  | 'malformed_json'
  | 'schema'
  | 'uncited'
  | 'placeholder'
  | 'pointer_unregistered'
  | 'pointer_unresolved'
  | 'pointer_not_primitive'
  | 'citation_format'
  | 'stale_source'
  | 'digit'
  | 'number_word'
  | 'markup'
  | 'state_word'
  | `lexicon:${string}`;

export type ValidationResult =
  | { ok: true; output: RenderedOutput; citations: CitationProvenance[]; claimMap: ClaimMapEntry[] }
  | { ok: false; rule: ValidationRule };

export interface ValidateParams {
  rawText: string;
  registry: CitableFieldRegistry;
  input: AnalysisInput;
  nowMs: number;
  maxAgeLookup?: (source: SourceKind) => number | null;
}

const MAX_RAW = 20_000;
const MODEL_KEYS = ['summary', 'observations', 'tradeoffs', 'missingOrStaleData', 'questionsForTrader', 'limitations', 'citations'];
const PLACEHOLDER = /\{\{c:(\d{1,3})\}\}/g;

const fail = (rule: ValidationRule): { ok: false; rule: ValidationRule } => ({ ok: false, rule });

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}
function hasExactKeys(v: Record<string, unknown>, keys: string[]): boolean {
  const actual = Object.keys(v);
  return actual.length === keys.length && keys.every((k) => Object.prototype.hasOwnProperty.call(v, k));
}
function boundedText(v: unknown, max: number): v is string {
  return typeof v === 'string' && v.trim().length > 0 && v.length <= max;
}
function positiveIntId(v: unknown): v is number {
  return typeof v === 'number' && Number.isInteger(v) && v >= 1 && v <= 999;
}

function parseClaims(v: unknown, max: number): Claim[] | null {
  if (!Array.isArray(v) || v.length > max) return null;
  const out: Claim[] = [];
  for (const item of v) {
    if (!isRecord(item) || !hasExactKeys(item, ['text', 'citationIds'])) return null;
    const ids = item.citationIds;
    if (!boundedText(item.text, 500) || !Array.isArray(ids) || ids.length > 10 || !ids.every(positiveIntId) || new Set(ids).size !== ids.length) return null;
    out.push({ text: item.text, citationIds: ids as number[] });
  }
  return out;
}

function parseTextItems(v: unknown, max: number): TextItem[] | null {
  if (!Array.isArray(v) || v.length > max) return null;
  const out: TextItem[] = [];
  for (const item of v) {
    if (!isRecord(item) || !hasExactKeys(item, ['text']) || !boundedText(item.text, 300)) return null;
    out.push({ text: item.text });
  }
  return out;
}

/** Rule 1: exact keys, types and bounds. */
function parseModelOutput(rawText: string): ModelOutput | ValidationRule {
  if (typeof rawText !== 'string' || rawText.length > MAX_RAW) return 'schema';
  let data: unknown;
  try {
    data = JSON.parse(rawText);
  } catch {
    return 'malformed_json';
  }
  if (!isRecord(data) || !hasExactKeys(data, MODEL_KEYS)) return 'schema';
  const observations = parseClaims(data.observations, 8);
  const tradeoffs = parseClaims(data.tradeoffs, 8);
  const missing = parseClaims(data.missingOrStaleData, 8);
  const questions = parseTextItems(data.questionsForTrader, 6);
  const limitations = parseTextItems(data.limitations, 6);
  if (!boundedText(data.summary, 800) || !observations || !tradeoffs || !missing || !questions || !limitations) return 'schema';
  if (!Array.isArray(data.citations) || data.citations.length > 40) return 'schema';
  const citations: ModelCitation[] = [];
  for (const c of data.citations) {
    if (!isRecord(c) || !hasExactKeys(c, ['id', 'pointer']) || !positiveIntId(c.id) || typeof c.pointer !== 'string' || c.pointer.length > 300) return 'schema';
    citations.push({ id: c.id, pointer: c.pointer });
  }
  if (new Set(citations.map((c) => c.id)).size !== citations.length) return 'schema';
  return { summary: data.summary, observations, tradeoffs, missingOrStaleData: missing, questionsForTrader: questions, limitations, citations };
}

function placeholdersIn(text: string): number[] {
  return Array.from(text.matchAll(PLACEHOLDER), (m) => Number(m[1]));
}
function withoutPlaceholders(text: string): string {
  return text.replace(PLACEHOLDER, ' ');
}
/** NFKC-normalise and drop invisible format characters so fullwidth digits or zero-width joins cannot evade checks. */
function normalizeForChecks(text: string): string {
  return withoutPlaceholders(text).normalize('NFKC').replace(/[\p{Cf}]/gu, '');
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const groupedNumber = (v: number, maxFraction: number, minFraction = 0): string =>
  new Intl.NumberFormat('en-US', { minimumFractionDigits: minFraction, maximumFractionDigits: maxFraction }).format(v);

/** Returns the display string, or null when the value does not fit the registry format. */
export function formatValue(format: CitableField['format'], value: unknown): string | null {
  switch (format) {
    case 'usd':
      return typeof value === 'number' ? `${value < 0 ? '-' : ''}$${groupedNumber(Math.abs(value), 2, 2)}` : null;
    case 'pct':
      return typeof value === 'number' ? `${groupedNumber(value, 2)}%` : null;
    case 'number':
      return typeof value === 'number' ? groupedNumber(value, 4) : null;
    case 'integer':
      return typeof value === 'number' && Number.isInteger(value) ? groupedNumber(value, 0) : null;
    case 'date': {
      if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
      const [y, m, d] = value.split('-').map(Number);
      const check = new Date(Date.UTC(y, m - 1, d));
      if (check.getUTCFullYear() !== y || check.getUTCMonth() !== m - 1 || check.getUTCDate() !== d) return null;
      return `${MONTHS[m - 1]} ${d}, ${y}`;
    }
    case 'text':
      return typeof value === 'string' && value.length > 0 && value.length <= 200 ? value : null;
    case 'boolean':
      return typeof value === 'boolean' ? (value ? 'Yes' : 'No') : null;
    default:
      return null;
  }
}

const URL_RE = /(?:https?:\/\/|www\.|(?:javascript|data|vbscript):)/i;
const MARKDOWN_LINK_RE = /\[[^\]]*\]\([^)]*\)/;
const CODE_RE = /```|~~~|`/;
const HTML_RE = /<\/?[a-z!][^>]*>|<[a-z]/i;

function hasMarkup(text: string): boolean {
  return URL_RE.test(text) || MARKDOWN_LINK_RE.test(text) || CODE_RE.test(text) || HTML_RE.test(text);
}

export function validateAndRender(params: ValidateParams): ValidationResult {
  // 1. Exact schema.
  const parsed = parseModelOutput(params.rawText);
  if (typeof parsed === 'string') return fail(parsed);
  const out = parsed;

  const declared = new Map(out.citations.map((c) => [c.id, c.pointer]));

  // 2. Placeholder integrity and citation coverage.
  const allTexts: string[] = [
    out.summary,
    ...out.observations.map((c) => c.text),
    ...out.tradeoffs.map((c) => c.text),
    ...out.missingOrStaleData.map((c) => c.text),
    ...out.questionsForTrader.map((t) => t.text),
    ...out.limitations.map((t) => t.text),
  ];
  for (const text of allTexts) {
    if (/\{\{|\}\}/.test(text.replace(PLACEHOLDER, ''))) return fail('placeholder');
    if (placeholdersIn(text).some((id) => !declared.has(id))) return fail('placeholder');
  }
  const summaryIds = placeholdersIn(out.summary);
  if (summaryIds.length === 0) return fail('uncited');
  for (const claim of [...out.observations, ...out.tradeoffs]) {
    const ids = placeholdersIn(claim.text);
    if (claim.citationIds.length === 0 || ids.length === 0) return fail('uncited');
    if (!ids.every((id) => claim.citationIds.includes(id)) || !claim.citationIds.every((id) => declared.has(id))) return fail('placeholder');
  }
  for (const claim of out.missingOrStaleData) {
    if (!claim.citationIds.every((id) => declared.has(id)) || !placeholdersIn(claim.text).every((id) => claim.citationIds.includes(id))) return fail('placeholder');
  }

  // 3. Every pointer is registered, resolves, and is a primitive of the registered format.
  const resolved = new Map<number, { field: CitableField; value: unknown; display: string }>();
  for (const citation of out.citations) {
    const field = findCitableField(params.registry, citation.pointer);
    if (!field) return fail('pointer_unregistered');
    const hit = resolvePointer(params.input.payload, citation.pointer);
    if (!hit.found) return fail('pointer_unresolved');
    if (!isPrimitiveValue(hit.value)) return fail('pointer_not_primitive');
    const display = formatValue(field.format, hit.value);
    if (display == null) return fail('citation_format');
    resolved.set(citation.id, { field, value: hit.value, display });
  }

  // 4. Cited source freshness, re-checked now.
  for (const { field } of resolved.values()) {
    if (evaluateSource(field.source, params.input.sourceAsOf[field.source], params.nowMs, params.maxAgeLookup).state !== 'fresh') return fail('stale_source');
  }

  // 5-8. Prose rules, on text with placeholders removed.
  const numberWords = categoryRegex('numberWords');
  const stateWords = categoryRegex('stateWords');
  for (const text of allTexts) {
    const norm = normalizeForChecks(text);
    if (/\p{Nd}/u.test(norm)) return fail('digit');
    if (NUMBER_SYMBOLS_RE.test(norm) || numberWords.test(norm)) return fail('number_word');
  }
  for (const text of allTexts) {
    const norm = normalizeForChecks(text);
    for (const category of PROSE_CATEGORIES) if (categoryRegex(category).test(norm)) return fail(`lexicon:${category}`);
  }
  for (const text of allTexts) if (hasMarkup(text.normalize('NFKC'))) return fail('markup');
  for (const text of allTexts) if (stateWords.test(normalizeForChecks(text))) return fail('state_word');

  // Render: substitute canonical values for placeholders.
  const render = (text: string): string => text.replace(PLACEHOLDER, (_m, id: string) => resolved.get(Number(id))!.display);
  const usedIds = new Set<number>(allTexts.flatMap(placeholdersIn));
  for (const claim of [...out.observations, ...out.tradeoffs, ...out.missingOrStaleData]) claim.citationIds.forEach((id) => usedIds.add(id));

  const citations: ClientCitation[] = [];
  const provenance: CitationProvenance[] = [];
  for (const citation of out.citations) {
    if (!usedIds.has(citation.id)) continue;
    const { field, value, display } = resolved.get(citation.id)!;
    citations.push({ id: citation.id, label: field.label, displayValue: display, sourceLabel: SOURCE_LABELS[field.source], asOf: params.input.sourceAsOf[field.source]! });
    provenance.push({ id: citation.id, pointer: citation.pointer, valueHash: canonicalHash(value), format: field.format, source: field.source, asOf: params.input.sourceAsOf[field.source] });
  }

  const renderClaims = (claims: Claim[]): Claim[] => claims.map((c) => ({ text: render(c.text), citationIds: c.citationIds }));
  const output: RenderedOutput = {
    summary: render(out.summary),
    observations: renderClaims(out.observations),
    tradeoffs: renderClaims(out.tradeoffs),
    missingOrStaleData: renderClaims(out.missingOrStaleData),
    questionsForTrader: out.questionsForTrader.map((t) => ({ text: render(t.text) })),
    limitations: out.limitations.map((t) => ({ text: render(t.text) })),
    citations,
  };

  const claimMap: ClaimMapEntry[] = [{ section: 'summary', index: 0, citationIds: [...new Set(summaryIds)] }];
  (['observations', 'tradeoffs', 'missingOrStaleData'] as const).forEach((section) =>
    out[section].forEach((claim, index) => claimMap.push({ section, index, citationIds: claim.citationIds })),
  );
  return { ok: true, output, citations: provenance, claimMap };
}

/** JSON schema handed to the provider (strict mode). Bounds are enforced by the validator, not by schema keywords. */
export const MODEL_OUTPUT_JSON_SCHEMA: Record<string, unknown> = {
  type: 'object',
  additionalProperties: false,
  required: MODEL_KEYS,
  properties: {
    summary: { type: 'string' },
    observations: { type: 'array', items: claimSchema() },
    tradeoffs: { type: 'array', items: claimSchema() },
    missingOrStaleData: { type: 'array', items: claimSchema() },
    questionsForTrader: { type: 'array', items: textSchema() },
    limitations: { type: 'array', items: textSchema() },
    citations: {
      type: 'array',
      items: { type: 'object', additionalProperties: false, required: ['id', 'pointer'], properties: { id: { type: 'integer' }, pointer: { type: 'string' } } },
    },
  },
};

function claimSchema(): Record<string, unknown> {
  return {
    type: 'object',
    additionalProperties: false,
    required: ['text', 'citationIds'],
    properties: { text: { type: 'string' }, citationIds: { type: 'array', items: { type: 'integer' } } },
  };
}
function textSchema(): Record<string, unknown> {
  return { type: 'object', additionalProperties: false, required: ['text'], properties: { text: { type: 'string' } } };
}
