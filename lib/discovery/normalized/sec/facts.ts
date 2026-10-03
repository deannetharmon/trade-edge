// lib/discovery/normalized/sec/facts.ts

// LEAPS-QV-0001 Gate 2b -- turns a raw companyfacts payload into validated facts and resolves ONE logical item for ONE
// period. Pure and deterministic. Rules (all fail closed):
//  * only 10-K / 10-K/A / 10-Q / 10-Q/A facts, USD-family units the concept map expects, strict YYYY-MM-DD dates and
//    finite numbers are kept; everything else is dropped and counted, never repaired.
//  * amendments / restatements: for one (tag, start, end) the value from the LATEST filing wins; two different values
//    filed on the same day are AMBIGUOUS, never picked.
//  * EQUIVALENT items whose tags disagree for the same period are AMBIGUOUS; ORDERED items take the first reporting tag.

import { epochDayOfDateString } from '../dates';
import { DEBT_RECIPES, DEBT_RECIPE_TOLERANCE, SEC_ACCEPTED_FORMS, SEC_CONCEPT_MAP_VERSION, SEC_ITEMS, neededTags } from './conceptMap';
import type { SecItemDef } from './conceptMap';
import type { CompactFacts, SecCompanyFactsRaw, SecFact, SecProvenance } from './types';

export type CompactResult =
  | { readonly ok: true; readonly compact: CompactFacts }
  | { readonly ok: false; readonly reason: 'SEC_PAYLOAD_INVALID' | 'NOT_US_GAAP_XBRL' };

function bump(counts: Record<string, number>, key: string): void {
  counts[key] = (counts[key] || 0) + 1;
}

/** Validates and filters a raw companyfacts payload down to the facts the concept map can use. */
export function compactCompanyFacts(raw: unknown, cik: string): CompactResult {
  if (!raw || typeof raw !== 'object') return { ok: false, reason: 'SEC_PAYLOAD_INVALID' };
  const payload = raw as SecCompanyFactsRaw;
  const taxonomies = payload.facts;
  if (!taxonomies || typeof taxonomies !== 'object') return { ok: false, reason: 'SEC_PAYLOAD_INVALID' };
  if (!taxonomies['us-gaap'] || typeof taxonomies['us-gaap'] !== 'object') return { ok: false, reason: 'NOT_US_GAAP_XBRL' };

  const dropped: Record<string, number> = {};
  const facts: SecFact[] = [];
  neededTags().forEach(({ taxonomy, tag, unit }) => {
    const concept = taxonomies[taxonomy] ? taxonomies[taxonomy][tag] : undefined;
    if (!concept || !concept.units) return;
    const rows = concept.units[unit];
    if (!Array.isArray(rows)) {
      bump(dropped, 'UNEXPECTED_UNIT');
      return;
    }
    const duration = SEC_ITEMS_BY_TAG[`${taxonomy}:${tag}`] === 'DURATION';
    rows.forEach((row) => {
      if (!row || typeof row !== 'object') return bump(dropped, 'MALFORMED_FACT');
      if (typeof row.form !== 'string' || SEC_ACCEPTED_FORMS.indexOf(row.form) < 0) return bump(dropped, 'FORM_NOT_USED');
      if (typeof row.val !== 'number' || !Number.isFinite(row.val)) return bump(dropped, 'VALUE_NOT_FINITE');
      if (epochDayOfDateString(row.end) === null || epochDayOfDateString(row.filed) === null) return bump(dropped, 'DATE_INVALID');
      if (typeof row.accn !== 'string' || row.accn === '') return bump(dropped, 'MALFORMED_FACT');
      if (duration && epochDayOfDateString(row.start) === null) return bump(dropped, 'DATE_INVALID');
      facts.push({
        taxonomy,
        tag,
        unit,
        start: duration ? (row.start as string) : null,
        end: row.end as string,
        val: row.val,
        accn: row.accn,
        form: row.form,
        filed: row.filed as string,
      });
    });
  });
  facts.sort(compareFacts);
  return {
    ok: true,
    compact: Object.freeze({
      conceptMapVersion: SEC_CONCEPT_MAP_VERSION,
      cik,
      entityName: typeof payload.entityName === 'string' ? payload.entityName : null,
      facts: Object.freeze(facts),
      dropped: Object.freeze(dropped),
    }),
  };
}

const SEC_ITEMS_BY_TAG: Readonly<Record<string, 'DURATION' | 'INSTANT'>> = (() => {
  const map: Record<string, 'DURATION' | 'INSTANT'> = {};
  Object.keys(SEC_ITEMS).forEach((key) => {
    const def = SEC_ITEMS[key];
    def.tags.forEach((tag) => {
      map[`${def.taxonomy}:${tag}`] = def.kind;
    });
  });
  return map;
})();

/** Total order so the compact list (and anything cached from it) is byte-stable. */
function compareFacts(a: SecFact, b: SecFact): number {
  const text = (f: SecFact): string[] => [f.taxonomy, f.tag, f.end, f.start === null ? '' : f.start, f.filed, f.accn, f.form];
  const ta = text(a);
  const tb = text(b);
  for (let i = 0; i < ta.length; i += 1) {
    if (ta[i] < tb[i]) return -1;
    if (ta[i] > tb[i]) return 1;
  }
  return a.val < b.val ? -1 : a.val > b.val ? 1 : 0;
}

export type FactIndex = ReadonlyMap<string, readonly SecFact[]>;

export function buildFactIndex(facts: readonly SecFact[]): FactIndex {
  const index = new Map<string, SecFact[]>();
  facts.forEach((fact) => {
    const key = `${fact.taxonomy}:${fact.tag}`;
    const list = index.get(key);
    if (list) list.push(fact);
    else index.set(key, [fact]);
  });
  return index;
}

export type Resolved =
  | {
      readonly status: 'OK';
      readonly item: string;
      readonly value: number;
      readonly tag: string;
      readonly fact: SecFact;
      readonly restated: boolean;
      /** Earliest filing date any version of this period was published (point-in-time availability). */
      readonly firstFiled: string;
    }
  | { readonly status: 'MISSING'; readonly item: string }
  | { readonly status: 'AMBIGUOUS'; readonly item: string; readonly reason: 'TAGS_DISAGREE' | 'FILINGS_DISAGREE'; readonly tags: readonly string[] };

/** Resolves one item for the exact (start, end) period (`start` null for instants). */
export function resolveItemAt(index: FactIndex, def: SecItemDef, start: string | null, end: string): Resolved {
  const perTag: Array<{ tag: string; fact: SecFact; restated: boolean; firstFiled: string }> = [];
  for (const tag of def.tags) {
    const list = index.get(`${def.taxonomy}:${tag}`);
    if (!list) continue;
    const candidates = list.filter((f) => f.end === end && f.start === start);
    if (candidates.length === 0) continue;
    let latest = candidates[0];
    candidates.forEach((f) => {
      if (f.filed > latest.filed) latest = f;
    });
    const sameDay = candidates.filter((f) => f.filed === latest.filed);
    if (sameDay.some((f) => f.val !== latest.val)) {
      return { status: 'AMBIGUOUS', item: def.id, reason: 'FILINGS_DISAGREE', tags: [tag] };
    }
    const firstFiled = candidates.reduce((min, f) => (f.filed < min ? f.filed : min), candidates[0].filed);
    perTag.push({ tag, fact: latest, restated: candidates.some((f) => f.val !== latest.val), firstFiled });
  }
  if (perTag.length === 0) return { status: 'MISSING', item: def.id };
  if (def.mode === 'EQUIVALENT') {
    const first = perTag[0];
    if (perTag.some((p) => p.fact.val !== first.fact.val)) {
      return { status: 'AMBIGUOUS', item: def.id, reason: 'TAGS_DISAGREE', tags: perTag.map((p) => p.tag) };
    }
  }
  const chosen = perTag[0];
  return { status: 'OK', item: def.id, value: chosen.fact.val, tag: chosen.tag, fact: chosen.fact, restated: chosen.restated, firstFiled: chosen.firstFiled };
}

export function provenanceOf(resolved: Resolved, role: string): SecProvenance | null {
  if (resolved.status !== 'OK') return null;
  const f = resolved.fact;
  return {
    item: resolved.item,
    role,
    tag: resolved.tag,
    unit: f.unit,
    start: f.start,
    end: f.end,
    value: resolved.value,
    accn: f.accn,
    form: f.form,
    filed: f.filed,
    restated: resolved.restated,
  };
}

/**
 * Instant item at the balance-sheet date nearest `targetEnd` within `toleranceDays`. Two different dates equally near
 * are AMBIGUOUS. `end` of the chosen date is reported through `resolved.fact.end`.
 */
export function resolveInstantNear(index: FactIndex, def: SecItemDef, targetEndDay: number, toleranceDays: number, endToDay: (end: string) => number): Resolved {
  const ends = new Set<string>();
  def.tags.forEach((tag) => {
    (index.get(`${def.taxonomy}:${tag}`) || []).forEach((f) => {
      if (Math.abs(endToDay(f.end) - targetEndDay) <= toleranceDays) ends.add(f.end);
    });
  });
  if (ends.size === 0) return { status: 'MISSING', item: def.id };
  const ranked = Array.from(ends).sort((a, b) => Math.abs(endToDay(a) - targetEndDay) - Math.abs(endToDay(b) - targetEndDay) || (a < b ? -1 : 1));
  if (ranked.length > 1 && Math.abs(endToDay(ranked[0]) - targetEndDay) === Math.abs(endToDay(ranked[1]) - targetEndDay)) {
    return { status: 'AMBIGUOUS', item: def.id, reason: 'FILINGS_DISAGREE', tags: [...def.tags] };
  }
  return resolveItemAt(index, def, null, ranked[0]);
}

export interface DebtResolution {
  readonly status: 'OK' | 'MISSING' | 'AMBIGUOUS';
  readonly value?: number;
  readonly recipe?: string;
  readonly components: readonly Resolved[];
  readonly reason: string;
}

/** Total debt (debt-v1) at one balance-sheet date. */
export function resolveDebt(index: FactIndex, end: string): DebtResolution {
  const cache = new Map<string, Resolved>();
  const at = (id: string): Resolved => {
    let r = cache.get(id);
    if (!r) {
      r = resolveItemAt(index, SEC_ITEMS[id], null, end);
      cache.set(id, r);
    }
    return r;
  };
  const computed: Array<{ id: string; value: number; parts: Resolved[]; longTerm: number }> = [];
  for (const recipe of DEBT_RECIPES) {
    const required = recipe.required.map(at);
    const ambiguous = required.find((r) => r.status === 'AMBIGUOUS');
    if (ambiguous) return { status: 'AMBIGUOUS', components: [ambiguous], reason: `AMBIGUOUS_CONCEPT:${ambiguous.item}` };
    if (required.some((r) => r.status !== 'OK')) continue;
    const optional = recipe.optional.map(at);
    const optAmbiguous = optional.find((r) => r.status === 'AMBIGUOUS');
    if (optAmbiguous) return { status: 'AMBIGUOUS', components: [optAmbiguous], reason: `AMBIGUOUS_CONCEPT:${optAmbiguous.item}` };
    const parts = [...required, ...optional.filter((r) => r.status === 'OK')];
    const sum = parts.reduce((total, r) => total + (r.status === 'OK' ? r.value : 0), 0);
    const longTerm = required.reduce((total, r) => total + (r.status === 'OK' ? r.value : 0), 0);
    computed.push({ id: recipe.id, value: sum, parts, longTerm });
  }
  if (computed.length === 0) return { status: 'MISSING', components: [], reason: 'DEBT_COMPONENTS_NOT_REPORTED' };
  const a = computed.find((c) => c.id === 'A');
  const b = computed.find((c) => c.id === 'B');
  if (a && b) {
    const aLongTerm = at('longTermDebt');
    const bLongTerm = [at('longTermDebtNoncurrent'), at('longTermDebtCurrent')].reduce((t, r) => t + (r.status === 'OK' ? r.value : 0), 0);
    if (aLongTerm.status === 'OK' && Math.abs(aLongTerm.value - bLongTerm) > DEBT_RECIPE_TOLERANCE * Math.max(Math.abs(aLongTerm.value), Math.abs(bLongTerm))) {
      return { status: 'AMBIGUOUS', components: a.parts, reason: 'AMBIGUOUS_CONCEPT:totalDebt' };
    }
  }
  const chosen = computed[0];
  return { status: 'OK', value: chosen.value, recipe: chosen.id, components: chosen.parts, reason: '' };
}
