// lib/ai-policy/lexicon.ts
//
// Versioned prohibited-language lexicon. Ian owns this file (D9). Expanding it never needs a code change elsewhere.
// Entries are regular-expression fragments matched case-insensitively, NFKC-normalised, on word boundaries.
// Validator fixtures freeze only after this lexicon is final (Quinn).

export const LEXICON_VERSION = 'lex-v1-draft';

export type LexiconCategory =
  | 'recommendation'
  | 'orderCommand'
  | 'rankingComparison'
  | 'stateOverride'
  | 'prediction'
  | 'derivedMath'
  | 'numberWords'
  | 'stateWords';

export const LEXICON: Record<LexiconCategory, readonly string[]> = {
  recommendation: [
    'recommend(?:s|ed|ation|ations)?', 'suggest you', 'you should', 'you could consider',
    'consider (?:buy|buying|sell|selling|open|opening|close|closing|roll|rolling|entering)',
    'worth (?:taking|entering)', 'attractive', 'favorable', 'good entry', 'great setup', 'safe', 'safest',
    'low-risk trade', 'no-brainer',
  ],
  orderCommand: [
    'place (?:an )?orders?', 'submit', 'sell to open', 'buy to open', 'sell to close', 'buy to close',
    'limit orders?', 'market orders?', 'stop orders?', 'gtc', 'send the order', 'execute',
  ],
  rankingComparison: [
    'best', 'top pick', 'ranks?', 'ranked', 'better than', 'worse than', 'outperforms?', 'preferred', 'prefer',
    'winner', 'first choice',
  ],
  stateOverride: [
    'override', 'ignore the (?:warning|flag)', 'mark (?:it )?as (?:ready|eligible)', 'treat (?:it )?as (?:ready|eligible)',
    'despite being (?:ineligible|not ready)', 'loosen', 'widen your filters?', 'relax the', 'raise your (?:delta|dte)',
    'lower your (?:delta|dte)', 'change your (?:filter|criteria)',
  ],
  // Ian, 2026-09-19.
  prediction: ['likely to', 'should expect', 'will (?:expire|be assigned|hit|reach|rise|fall)', 'high probability', 'sweet spot', 'cheap', 'rich'],
  derivedMath: [
    'works out to', 'calculates to', 'adds up to', 'net of', 'minus', 'plus', 'times', 'multiplied by', 'divided by',
    'approximately equals', 'roughly equals',
  ],
  numberWords: [
    'zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve',
    'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen', 'twenty', 'thirty', 'forty',
    'fifty', 'sixty', 'seventy', 'eighty', 'ninety', 'hundreds?', 'thousands?', 'millions?', 'percent', 'per cent',
    'dollars?', 'bucks', 'half', 'double', 'triple',
  ],
  // Deterministic states may reach the reader only through a cited field, never through model-written prose.
  stateWords: ['hold', 'monitor', 'not ready', 'ineligible', 'eligible', 'unqualified', 'qualified', 'disqualified'],
};

/** Symbols that carry a number or a unit; `x%` from the seed list is covered by `%`. */
export const NUMBER_SYMBOLS_RE = /[%$€£¥]/;

const BOUNDARY_BEFORE = '(?<![\\p{L}\\p{N}_])';
const BOUNDARY_AFTER = '(?![\\p{L}\\p{N}_])';

export function compileCategory(category: LexiconCategory): RegExp {
  return new RegExp(`${BOUNDARY_BEFORE}(?:${LEXICON[category].join('|')})${BOUNDARY_AFTER}`, 'iu');
}

const COMPILED: Partial<Record<LexiconCategory, RegExp>> = {};
export function categoryRegex(category: LexiconCategory): RegExp {
  return (COMPILED[category] ??= compileCategory(category));
}

/** Categories checked by validator rule 6 (numberWords and stateWords have their own rules). */
export const PROSE_CATEGORIES: readonly LexiconCategory[] = [
  'recommendation', 'orderCommand', 'rankingComparison', 'stateOverride', 'prediction', 'derivedMath',
];
