// lib/tradeLookup/parsePost.ts

// TRADE-LOOKUP-0001: reads one pasted post from Dean's trading group.
//
// Tokens are recognized by shape, never by position, because the group varies the order
// ("11/6 $120P @ $5.47", "75.5P 11/6 @ 3.00", "75P 4.00 11/13"). Anything doubtful fails
// closed with a reason; this module never guesses a ticker, strike, expiration or strategy.
//
// Tickers must be written in capitals, as the group posts them. A lowercase paste fails closed
// ("No ticker found") rather than risk reading a word of prose as a symbol.
//
// Pure function: no network, no broker calls, no clock. Year resolution lives in resolveExpiry.ts.

import type { DateParts, ParseResult, PostedExpiry } from './types';

// Words that appear in posts but are never a ticker.
const KEYWORDS: Record<string, true> = {
  NEW: true,
  CSP: true,
  CC: true,
  COVERED: true,
  CALL: true,
  CALLS: true,
  PUT: true,
  PUTS: true,
  SELL: true,
  STO: true,
  BTC: true,
  EXIT: true,
  ROLL: true,
  EVERYONE: true,
  MM: true,
};

const STRIKE_RE = /(^|[^A-Za-z0-9.])\$?(\d+(?:\.\d+)?)([PCpc])(?![A-Za-z0-9])/g;
const STRIKE_PROBE_RE = /(^|[^A-Za-z0-9.])\$?\d+(?:\.\d+)?[PCpc](?![A-Za-z0-9])/;
const EXPIRY_RE = /(^|[^0-9./])(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?(?![0-9/])/g;
const FULL_TIMESTAMP_RE = /(\d{1,2})\/(\d{1,2})\/(\d{2,4}),?\s+\d{1,2}:\d{2}\s*(?:AM|PM)/i;
const TIME_ONLY_RE = /\b\d{1,2}:\d{2}\s*(?:AM|PM)\b/gi;
const ROLL_RE = /\broll(?:ing|ed)?\b|\bexit\b[^.\n]{0,40}\b(?:cc|call|put|csp)\b|\bpush\b[^.\n]{0,20}\bout\b/i;

function fullYear(raw: string | undefined): number | null {
  if (raw === undefined || raw === '') return null;
  const n = parseInt(raw, 10);
  if (isNaN(n)) return null;
  return raw.length <= 2 ? 2000 + n : n;
}

function validMonthDay(month: number, day: number): boolean {
  return month >= 1 && month <= 12 && day >= 1 && day <= 31;
}

function fmtExpiry(e: { month: number; day: number }): string {
  return e.month + '/' + e.day;
}

/** Unique all-capital words of 1-5 letters in the text, minus the post keywords. */
function capitalTickers(text: string): string[] {
  const out: string[] = [];
  const words = text.split(/[^A-Za-z]+/);
  for (let i = 0; i < words.length; i++) {
    const w = words[i];
    if (w.length >= 1 && w.length <= 5 && w === w.toUpperCase() && !KEYWORDS[w] && out.indexOf(w) === -1) out.push(w);
  }
  return out;
}

export function parsePost(rawText: string): ParseResult {
  const text = (rawText || '').replace(/\r/g, '');
  if (text.trim() === '') return { kind: 'unreadable', reason: 'Nothing was pasted.' };

  // 1. Pull out a Discord timestamp ("10/8/26, 9:01 AM"). It is only a reference date for the year.
  let postedAt: DateParts | null = null;
  let cleaned = text;
  const stamp = FULL_TIMESTAMP_RE.exec(text);
  if (stamp) {
    const month = parseInt(stamp[1], 10);
    const day = parseInt(stamp[2], 10);
    const year = fullYear(stamp[3]);
    if (year !== null && validMonthDay(month, day)) postedAt = { year, month, day };
    cleaned = cleaned.replace(FULL_TIMESTAMP_RE, ' ');
  }
  cleaned = cleaned.replace(TIME_ONLY_RE, ' ').replace(/@everyone/gi, ' ').replace(/@here/gi, ' ');

  const lines = cleaned
    .split('\n')
    .map(function (l) { return l.trim(); })
    .filter(function (l) { return l !== ''; });

  // 2. The headline is the first line that holds a strike token such as "$120P" or "15C".
  let headlineIndex = -1;
  for (let i = 0; i < lines.length; i++) {
    if (STRIKE_PROBE_RE.test(lines[i])) {
      headlineIndex = i;
      break;
    }
  }

  // 3. No contract anywhere: an EXIT post, or unreadable. EXIT must be in capitals, as posted.
  if (headlineIndex === -1) {
    for (let i = 0; i < lines.length; i++) {
      if (/\bEXIT\b/.test(lines[i])) {
        const found = capitalTickers(lines[i]);
        if (found.length === 0) return { kind: 'unreadable', reason: 'Exit post with no ticker.' };
        return { kind: 'exit', tickers: found };
      }
    }
    return { kind: 'unreadable', reason: 'No option contract found (looked for a strike such as 120P or 15C).' };
  }

  const headline = lines[headlineIndex];
  const bodyText = lines.slice(headlineIndex + 1).join('\n');

  // 4. Expiration(s): M/D with an optional year. Remove them so they cannot be read as prices.
  const expiries: PostedExpiry[] = [];
  let em: RegExpExecArray | null;
  EXPIRY_RE.lastIndex = 0;
  while ((em = EXPIRY_RE.exec(headline)) !== null) {
    const month = parseInt(em[2], 10);
    const day = parseInt(em[3], 10);
    if (!validMonthDay(month, day)) {
      return { kind: 'unreadable', reason: 'The date ' + em[2] + '/' + em[3] + ' is not a real month/day.' };
    }
    expiries.push({ month, day, year: fullYear(em[4]) });
    EXPIRY_RE.lastIndex = em.index + em[0].length - 1;
  }
  let work = headline.replace(EXPIRY_RE, '$1 ');
  if (expiries.length === 0) return { kind: 'unreadable', reason: 'No expiration date found (looked for a date such as 11/6).' };
  if (expiries.length > 1) {
    return {
      kind: 'unreadable',
      reason: 'Two expirations found (' + fmtExpiry(expiries[0]) + ' and ' + fmtExpiry(expiries[1]) + '). Nothing was guessed.',
    };
  }

  // 5. Strike and right (P or C).
  const strikes: { value: number; right: 'P' | 'C'; text: string }[] = [];
  let sm: RegExpExecArray | null;
  STRIKE_RE.lastIndex = 0;
  while ((sm = STRIKE_RE.exec(work)) !== null) {
    strikes.push({ value: parseFloat(sm[2]), right: sm[3].toUpperCase() as 'P' | 'C', text: sm[2] + sm[3].toUpperCase() });
    STRIKE_RE.lastIndex = sm.index + sm[0].length - 1;
  }
  if (strikes.length === 0) return { kind: 'unreadable', reason: 'No strike found.' };
  if (strikes.length > 1) {
    return {
      kind: 'unreadable',
      reason: 'Two strikes found (' + strikes[0].text + ' and ' + strikes[1].text + '). Nothing was guessed.',
    };
  }
  const strike = strikes[0];
  work = work.replace(STRIKE_RE, '$1 ');

  // 6. Posted price: "@ $5.47" wins; otherwise a single bare decimal ("4.00"). Optional.
  let postedPrice: number | null = null;
  const atPrices: number[] = [];
  const atRe = /@\s*\$?(\d+(?:\.\d+)?)/g;
  let am: RegExpExecArray | null;
  while ((am = atRe.exec(work)) !== null) atPrices.push(parseFloat(am[1]));
  if (atPrices.length > 1) return { kind: 'unreadable', reason: 'More than one @ price found. Nothing was guessed.' };
  if (atPrices.length === 1) {
    postedPrice = atPrices[0];
    work = work.replace(atRe, ' ');
  } else {
    const bare: number[] = [];
    const bareRe = /(^|[^A-Za-z0-9.])\$?(\d+\.\d+)(?![A-Za-z0-9.])/g;
    let bm: RegExpExecArray | null;
    while ((bm = bareRe.exec(work)) !== null) {
      bare.push(parseFloat(bm[2]));
      bareRe.lastIndex = bm.index + bm[0].length - 1;
    }
    if (bare.length > 1) return { kind: 'unreadable', reason: 'More than one price found. Nothing was guessed.' };
    if (bare.length === 1) postedPrice = bare[0];
  }

  // 7. Ticker: the one all-capital word of 1-5 letters left after the keywords are dropped.
  const tickers = capitalTickers(work);
  if (tickers.length === 0) return { kind: 'unreadable', reason: 'No ticker found (tickers must be written in capitals).' };
  if (tickers.length > 1) {
    return { kind: 'unreadable', reason: 'More than one ticker found (' + tickers.join(', ') + '). Nothing was guessed.' };
  }

  // 8. Strategy comes from the right. A keyword that disagrees with it is a failure, not a guess.
  const headlineUpper = headline.toUpperCase();
  if (strike.right === 'C' && /\bCSP\b/.test(headlineUpper)) {
    return { kind: 'unreadable', reason: 'The post says CSP but the strike is a call.' };
  }
  if (strike.right === 'P' && (/\bCC\b/.test(headlineUpper) || /\bCOVERED\b/.test(headlineUpper))) {
    return { kind: 'unreadable', reason: 'The post says covered call but the strike is a put.' };
  }

  return {
    kind: 'contract',
    strategy: strike.right === 'P' ? 'CSP' : 'CC',
    ticker: tickers[0],
    right: strike.right,
    strike: strike.value,
    expiry: expiries[0],
    postedPrice,
    postedAt,
    isRollLike: ROLL_RE.test(bodyText) || ROLL_RE.test(headline),
  };
}
