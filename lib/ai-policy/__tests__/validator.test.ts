// lib/ai-policy/__tests__/validator.test.ts
//
// Fixture table for the output validator: every prohibited category has >= 3 rejecting fixtures, and benign prose
// (including word-boundary near misses) must pass. Fixtures freeze only after Ian finalises the lexicon.

import { describe, expect, it } from 'vitest';
import { canonicalHash } from '../canonical';
import { MODEL_OUTPUT_JSON_SCHEMA, formatValue, validateAndRender } from '../validator';
import type { ValidationResult } from '../validator';
import { FRESH_AS_OF, NOW, TEST_PAYLOAD, TEST_REGISTRY, VALID_OUTPUT, makeInput, validOutputJson } from '../fixtures/testRoute';
import type { AnalysisInput, CitableFieldRegistry, ModelOutput } from '../types';

const input = makeInput();

function run(rawText: string, opts: { input?: AnalysisInput; registry?: CitableFieldRegistry } = {}): ValidationResult {
  return validateAndRender({ rawText, registry: opts.registry ?? TEST_REGISTRY, input: opts.input ?? input, nowMs: NOW });
}
/** Replace the first observation's prose (it keeps citing {{c:2}} and {{c:3}} unless the new text says otherwise). */
const withObservation = (text: string): string => validOutputJson((o) => { o.observations[0] = { text, citationIds: [2, 3] }; });
const withText = (text: string) => withObservation(`${text} {{c:2}} {{c:3}}`);
const rule = (r: ValidationResult): string | null => (r.ok ? null : r.rule);

describe('accepts a valid, fully cited output and renders canonical values', () => {
  const result = run(validOutputJson());

  it('passes', () => expect(result.ok).toBe(true));

  it('substitutes placeholders with canonical values formatted per the registry', () => {
    if (!result.ok) throw new Error('expected ok');
    expect(result.output.summary).toBe('The scan finished with 3 candidates.');
    expect(result.output.observations[0].text).toBe('Delta is 0.8123 and days to expiration are 412.');
    expect(result.output.tradeoffs[0].text).toBe('The estimated cost is $12,345.50.');
    expect(result.output.questionsForTrader[0].text).toBe('Does the expiration on Jan 15, 2027 fit your plan?');
  });

  it('exposes label, display value, source label and as-of to the client, never the pointer or hash', () => {
    if (!result.ok) throw new Error('expected ok');
    expect(result.output.citations[1]).toEqual({ id: 2, label: 'Delta', displayValue: '0.8123', sourceLabel: 'Quotes and Greeks', asOf: FRESH_AS_OF.quoteGreeks });
    expect(JSON.stringify(result.output)).not.toContain('/candidates');
    expect(JSON.stringify(result.output)).not.toMatch(/[0-9a-f]{64}/);
  });

  it('records pointer, value hash, source and as-of in provenance, plus the claim-to-citation map', () => {
    if (!result.ok) throw new Error('expected ok');
    expect(result.citations[1]).toEqual({ id: 2, pointer: '/candidates/0/delta', valueHash: canonicalHash(0.8123), format: 'number', source: 'quoteGreeks', asOf: FRESH_AS_OF.quoteGreeks });
    expect(result.claimMap).toContainEqual({ section: 'observations', index: 0, citationIds: [2, 3] });
  });
});

describe('placeholder rendering (spec AC 9)', () => {
  it.each([
    ['usd', 12345.5, '$12,345.50'], ['usd', -3, '-$3.00'], ['pct', 31.25, '31.25%'], ['number', 0.8123, '0.8123'], ['integer', 412, '412'],
    ['date', '2027-01-15', 'Jan 15, 2027'], ['text', 'Not ready', 'Not ready'], ['boolean', false, 'No'], ['boolean', true, 'Yes'],
  ] as const)('formats %s %s as %s', (format, value, expected) => expect(formatValue(format, value)).toBe(expected));

  it.each([
    ['usd', 'text'], ['integer', 1.5], ['date', '2027-02-30'], ['date', 'Jan 15'], ['text', 5], ['boolean', 'yes'], ['number', '1'],
  ] as const)('refuses %s with %s', (format, value) => expect(formatValue(format, value)).toBeNull());

  it.each([
    ['unknown placeholder id', validOutputJson((o) => { o.summary = 'Count {{c:9}}.'; })],
    ['spaced placeholder', validOutputJson((o) => { o.summary = 'Count {{ c:1 }}.'; })],
    ['non-numeric placeholder', validOutputJson((o) => { o.summary = 'Count {{c:x}}.'; })],
    ['stray braces', validOutputJson((o) => { o.limitations = [{ text: 'Read-only {{ note }}.' }]; })],
    ['placeholder not listed in claim citationIds', validOutputJson((o) => { o.observations[0].citationIds = [2]; })],
    ['claim citationId not declared', validOutputJson((o) => { o.observations[0].citationIds = [2, 3, 77]; })],
  ])('rejects %s', (_n, raw) => expect(rule(run(raw))).toBe('placeholder'));
});

describe('rule 1: schema (extra keys / malformed JSON)', () => {
  const good = JSON.parse(validOutputJson()) as Record<string, unknown>;
  it.each([
    ['not json', 'not json', 'malformed_json'],
    ['truncated json', '{"summary":', 'malformed_json'],
    ['top-level array', '[]', 'schema'],
    ['extra top-level key', JSON.stringify({ ...good, confidence: 'high' }), 'schema'],
    ['missing key', JSON.stringify({ ...good, limitations: undefined }), 'schema'],
    ['wrong type', JSON.stringify({ ...good, summary: 5 }), 'schema'],
    ['claim with extra key', validOutputJson((o) => { (o.observations[0] as unknown as Record<string, unknown>).confidence = 1; }), 'schema'],
    ['citation with extra key', validOutputJson((o) => { (o.citations[0] as unknown as Record<string, unknown>).note = 'x'; }), 'schema'],
    ['duplicate citation ids', validOutputJson((o) => { o.citations.push({ id: 1, pointer: '/scan/count' }); }), 'schema'],
    ['too many observations', validOutputJson((o) => { o.observations = Array.from({ length: 9 }, () => ({ text: 'Delta {{c:2}}.', citationIds: [2] })); }), 'schema'],
    ['over-long text', validOutputJson((o) => { o.summary = `{{c:1}} ${'x'.repeat(900)}`; }), 'schema'],
    ['empty summary', validOutputJson((o) => { o.summary = '  '; }), 'schema'],
    ['oversized payload', 'x'.repeat(20_001), 'schema'],
  ])('%s', (_n, raw, expected) => expect(rule(run(raw))).toBe(expected));
});

describe('rule 2: uncited claims', () => {
  it.each([
    ['summary with no placeholder', validOutputJson((o) => { o.summary = 'The scan finished.'; })],
    ['observation with no placeholder', withObservation('Delta looks fine.')],
    ['observation with empty citationIds', validOutputJson((o) => { o.observations[0] = { text: 'Delta {{c:2}}.', citationIds: [] }; })],
    ['tradeoff with no placeholder', validOutputJson((o) => { o.tradeoffs[0] = { text: 'Cost matters.', citationIds: [4] }; })],
  ])('%s', (_n, raw) => expect(rule(run(raw))).toBe('uncited'));
});

describe('rule 3: pointers', () => {
  const withPointer = (pointer: string): string => validOutputJson((o) => { o.citations[1].pointer = pointer; });
  it.each([
    ['not in registry (account number)', '/candidates/0/accountNumber'],
    ['not in registry (container)', '/candidates/0'],
    ['not in registry (unknown branch)', '/scan/secret'],
    ['not in registry (extra depth)', '/candidates/0/delta/extra'],
    ['not a pointer', 'candidates.0.delta'],
    ['bad escape', '/candidates/0/del~ta'],
  ])('rejects pointer %s', (_n, pointer) => expect(rule(run(withPointer(pointer)))).toBe('pointer_unregistered'));

  it('rejects a registered pattern that does not resolve in this payload', () => {
    expect(rule(run(withPointer('/candidates/9/delta')))).toBe('pointer_unresolved');
  });

  it.each([
    ['an object', { pattern: '/candidates/*', label: 'Candidate row', source: 'scanCalculation', format: 'text' }, TEST_PAYLOAD, '/candidates/0'],
    ['an array', { pattern: '/candidates', label: 'Candidates', source: 'scanCalculation', format: 'text' }, TEST_PAYLOAD, '/candidates'],
    ['null', { pattern: '/scan/count', label: 'Count', source: 'scanCalculation', format: 'integer' }, { scan: { count: null } }, '/scan/count'],
  ] as const)('rejects a pointer that resolves to %s', (_n, field, payload, pointer) => {
    const registry: CitableFieldRegistry = [field];
    const custom = { ...input, payload, payloadHash: canonicalHash(payload) };
    const raw = validOutputJson((o) => { o.citations = [{ id: 1, pointer }]; o.summary = 'Value {{c:1}}.'; o.observations = []; o.tradeoffs = []; o.questionsForTrader = []; });
    expect(rule(run(raw, { input: custom as AnalysisInput, registry }))).toBe('pointer_not_primitive');
  });

  it('rejects a value that does not fit its registered format', () => {
    const registry: CitableFieldRegistry = [{ pattern: '/candidates/*/id', label: 'Cost', source: 'scanCalculation', format: 'usd' }];
    const raw = validOutputJson((o) => { o.citations = [{ id: 1, pointer: '/candidates/0/id' }]; o.summary = 'Value {{c:1}}.'; o.observations = []; o.tradeoffs = []; o.questionsForTrader = []; });
    expect(rule(run(raw, { registry }))).toBe('citation_format');
  });
});

describe('rule 4: cited source freshness is re-checked', () => {
  const old = (source: keyof typeof FRESH_AS_OF, seconds: number): AnalysisInput => makeInput({ sourceAsOf: { [source]: new Date(NOW - seconds * 1000).toISOString() } });
  it.each([
    ['stale quotes/Greeks (delta is quoteGreeks)', old('quoteGreeks', 301)],
    ['stale scan calculation (count is scanCalculation)', old('scanCalculation', 8 * 3600 + 1)],
    ['missing quotes/Greeks', makeInput({ sourceAsOf: { quoteGreeks: null } })],
  ])('%s', (_n, stale) => expect(rule(run(validOutputJson(), { input: stale }))).toBe('stale_source'));

  it('a stale source that is NOT cited does not reject', () => {
    const raw = validOutputJson((o) => { o.observations = []; o.tradeoffs = []; o.questionsForTrader = []; o.citations = [{ id: 1, pointer: '/scan/count' }]; });
    expect(run(raw, { input: makeInput({ sourceAsOf: { quoteGreeks: null } }) }).ok).toBe(true);
  });
});

describe('rule 5: invented numbers', () => {
  it.each([
    ['ascii digit', 'Delta is roughly 0.8 and'], ['ordinal', 'The 2nd expiration and'], ['digit in word', 'Version v2 of the data and'],
    ['fullwidth digit', 'It moved １２ points and'], ['arabic-indic digit', 'About ٣ contracts and'],
  ])('digit: %s', (_n, text) => expect(rule(run(withText(text)))).toBe('digit'));

  it.each([
    ['spelled number', 'Delta is about eighty and'], ['percent word', 'The move is ten percent and'], ['percent sign', 'The move is % and'],
    ['dollar sign', 'It costs $ and'], ['euro sign', 'It costs € and'], ['dollars', 'It costs some dollars and'], ['half', 'Roughly half of it and'],
    ['double', 'It could double and'], ['hundred', 'A hundred lots and'], ['zero-width split', 'It is twen\u200bty and'],
  ])('number word or symbol: %s', (_n, text) => expect(rule(run(withText(text)))).toBe('number_word'));
});

describe('rule 6: lexicon categories', () => {
  const cases: Array<[string, string[]]> = [
    ['derivedMath', ['The value works out to a decent amount and', 'Cost minus fees and', 'Delta multiplied by exposure and', 'Roughly equals the other and']],
    ['rankingComparison', ['This is the best candidate and', 'It ranks above the other and', 'It is better than the alternative and', 'The winner is clear and']],
    ['recommendation', ['You should look at it and', 'I recommend this candidate and', 'This looks attractive and', 'It is a no-brainer and']],
    ['orderCommand', ['Submit a limit order and', 'Place an order and', 'Sell to open and', 'Buy to close and']],
    ['stateOverride', ['Ignore the warning and', 'Relax the filters and', 'Raise your delta and', 'Mark it as ready and']],
    ['prediction', ['It is likely to rise and', 'Traders should expect gains and', 'It will expire worthless and', 'This is the sweet spot and']],
  ];
  for (const [category, phrases] of cases) {
    it.each(phrases.map((p) => [p]))(`${category}: %s`, (phrase) => {
      const got = rule(run(withText(phrase)));
      expect(got).not.toBeNull();
      expect(got).toBe(`lexicon:${category}`);
    });
  }

  it('an ineligible candidate cannot be ranked', () => {
    for (const text of ['The ineligible candidate ranks first and', 'Ranked highest despite being ineligible and', 'It outperforms the rest though ineligible and']) {
      expect(run(withText(text)).ok).toBe(false);
    }
  });

  it('matching is case-insensitive and NFKC-normalised, and ignores zero-width joins', () => {
    expect(rule(run(withText('YOU SHOULD look and')))).toBe('lexicon:recommendation');
    expect(rule(run(withText('ｒｅｃｏｍｍｅｎｄ this and')))).toBe('lexicon:recommendation');
    expect(rule(run(withText('You sho\u200buld look and')))).toBe('lexicon:recommendation');
  });
});

describe('rule 7: URLs and markup', () => {
  it.each([
    ['URL', 'See https://example.io for more and'], ['bare www', 'Visit www.example.org and'], ['markdown link', 'Read [the docs](x) and'],
    ['code fence', 'Use ``` block and'], ['inline code', 'The `delta` field and'], ['html tag', 'Use <b>bold</b> and'], ['script tag', 'Add <script>x</script> and'],
    ['javascript scheme', 'Click javascript:alert and'],
  ])('%s', (_n, text) => expect(rule(run(withText(text)))).toBe('markup'));
});

describe('rule 8: state words appear only via a cited field', () => {
  it.each([
    ['not ready', 'The candidate is not ready and'], ['eligible', 'This candidate is eligible and'], ['qualified', 'It is qualified and'],
    ['hold', 'Keep it on hold and'], ['monitor', 'You can monitor it and'], ['ineligible', 'It is ineligible and'],
  ])('rejects "%s" written by the model, even next to a citation', (_n, text) => expect(rule(run(withText(text)))).toBe('state_word'));

  it('a state word without any citation (limitations) is rejected', () => {
    expect(rule(run(validOutputJson((o) => { o.limitations = [{ text: 'The candidate is not ready.' }]; })))).toBe('state_word');
  });

  it('the state can still reach the reader through a cited field', () => {
    const raw = validOutputJson((o) => {
      o.citations.push({ id: 6, pointer: '/candidates/0/readiness' });
      o.observations[0] = { text: 'Readiness reads {{c:6}} for this candidate.', citationIds: [6] };
    });
    const result = run(raw);
    expect(result.ok && result.output.observations[0].text).toBe('Readiness reads Not ready for this candidate.');
  });
});

describe('benign prose passes', () => {
  it.each([
    ['plain explanation', 'Delta is {{c:2}} and days to expiration are {{c:3}}.'],
    ['readiness via citation', 'Readiness reads {{c:2}} in this snapshot.'],
    ['volatility and dates', 'The data lists delta {{c:2}} next to expiration {{c:3}}.'],
    ['hedged description', 'The spread between the values {{c:2}} and {{c:3}} is wide.'],
    ['boundary: frank', 'A frank note about {{c:2}} and {{c:3}}.'],
    ['boundary: safety', 'Safety margins are described alongside {{c:2}} and {{c:3}}.'],
    ['boundary: submitted', 'The submitted-by field is absent near {{c:2}} and {{c:3}}.'],
    ['boundary: monitoring', 'Monitoring data is described near {{c:2}} and {{c:3}}.'],
    ['boundary: candidate', 'Each candidate row lists {{c:2}} and {{c:3}}.'],
  ])('%s', (_n, text) => {
    const got = run(validOutputJson((o) => { o.observations[0] = { text, citationIds: [2, 3] }; }));
    expect(rule(got)).toBeNull();
  });

  it('a missing-data claim may carry no citation', () => {
    const raw = validOutputJson((o) => { o.missingOrStaleData = [{ text: 'Earnings data was not available.', citationIds: [] }]; });
    expect(run(raw).ok).toBe(true);
  });
});

describe('schema handed to the provider', () => {
  it('is strict-mode compatible: exact keys, no extras, no unsupported bound keywords', () => {
    const text = JSON.stringify(MODEL_OUTPUT_JSON_SCHEMA);
    expect(MODEL_OUTPUT_JSON_SCHEMA.additionalProperties).toBe(false);
    expect(MODEL_OUTPUT_JSON_SCHEMA.required).toEqual(['summary', 'observations', 'tradeoffs', 'missingOrStaleData', 'questionsForTrader', 'limitations', 'citations']);
    expect(text).not.toMatch(/maxLength|minLength|maxItems|minItems|pattern/);
    expect((text.match(/"additionalProperties":false/g) ?? []).length).toBeGreaterThanOrEqual(5);
  });

  it('VALID_OUTPUT itself matches that shape', () => {
    const keys = Object.keys(VALID_OUTPUT as ModelOutput).sort();
    expect(keys).toEqual([...(MODEL_OUTPUT_JSON_SCHEMA.required as string[])].sort());
  });
});
