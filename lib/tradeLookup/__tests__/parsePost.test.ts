// lib/tradeLookup/__tests__/parsePost.test.ts

// TRADE-LOOKUP-0001: golden fixtures for the pasted-post parser. Every real post Dean shared is here,
// plus the fail-closed cases from the ticket. A new group format gets a fixture before the parser changes.

import { describe, expect, it } from 'vitest';
import { parsePost } from '../parsePost';
import type { ParsedContract, ParsedExit, ParseResult } from '../types';

function contract(text: string): ParsedContract {
  const r: ParseResult = parsePost(text);
  if (r.kind !== 'contract') throw new Error('expected a contract, got ' + JSON.stringify(r));
  return r;
}

function unreadable(text: string): string {
  const r: ParseResult = parsePost(text);
  if (r.kind !== 'unreadable') throw new Error('expected unreadable, got ' + JSON.stringify(r));
  return r.reason;
}

describe('parsePost: cash-secured puts', () => {
  it('NEW CSP SOXL 11/6 $120P @ $5.47', () => {
    const c = contract('NEW CSP SOXL 11/6 $120P @ $5.47');
    expect(c.strategy).toBe('CSP');
    expect(c.ticker).toBe('SOXL');
    expect(c.right).toBe('P');
    expect(c.strike).toBe(120);
    expect(c.expiry).toEqual({ month: 11, day: 6, year: null });
    expect(c.postedPrice).toBe(5.47);
    expect(c.postedAt).toBeNull();
    expect(c.isRollLike).toBe(false);
  });

  it('NEW CSP TQQQ 75.5P 11/6 @ 3.00 (decimal strike, strike before date)', () => {
    const c = contract('NEW CSP TQQQ 75.5P 11/6 @ 3.00');
    expect(c.ticker).toBe('TQQQ');
    expect(c.strike).toBe(75.5);
    expect(c.expiry).toEqual({ month: 11, day: 6, year: null });
    expect(c.postedPrice).toBe(3);
  });

  it('NEW CSP SOXL 75P 4.00 11/13 (bare price before the date)', () => {
    const c = contract('NEW CSP SOXL 75P 4.00 11/13');
    expect(c.ticker).toBe('SOXL');
    expect(c.strike).toBe(75);
    expect(c.expiry).toEqual({ month: 11, day: 13, year: null });
    expect(c.postedPrice).toBe(4);
  });
});

describe('parsePost: covered calls', () => {
  it('ETHU 8/21 15C @ 0.9 COVERED CALLS (no NEW, strategy words at the end)', () => {
    const c = contract('ETHU 8/21 15C @ 0.9 COVERED CALLS');
    expect(c.strategy).toBe('CC');
    expect(c.ticker).toBe('ETHU');
    expect(c.right).toBe('C');
    expect(c.strike).toBe(15);
    expect(c.expiry).toEqual({ month: 8, day: 21, year: null });
    expect(c.postedPrice).toBe(0.9);
  });

  it('BITX 8/28 16C @ 0.39 COVERED CALLS', () => {
    const c = contract('BITX 8/28 16C @ 0.39 COVERED CALLS');
    expect(c.ticker).toBe('BITX');
    expect(c.strike).toBe(16);
    expect(c.expiry).toEqual({ month: 8, day: 28, year: null });
    expect(c.postedPrice).toBe(0.39);
  });

  it('NEW BITX $16C 09/18 (no price, zero-padded date)', () => {
    const c = contract('NEW BITX $16C 09/18');
    expect(c.strategy).toBe('CC');
    expect(c.ticker).toBe('BITX');
    expect(c.strike).toBe(16);
    expect(c.expiry).toEqual({ month: 9, day: 18, year: null });
    expect(c.postedPrice).toBeNull();
  });

  it('NEW BITX $20C 6/18 (a far date still parses; the resolver decides)', () => {
    const c = contract('NEW BITX $20C 6/18');
    expect(c.strike).toBe(20);
    expect(c.expiry).toEqual({ month: 6, day: 18, year: null });
  });
});

describe('parsePost: pasted Discord text', () => {
  it('uses the timestamp as the reference date and does not read it as an expiration', () => {
    const c = contract('Market.Moves.Matt  10/8/26, 9:01 AM\nNEW CSP SOXL 11/6 $120P @ $5.47');
    expect(c.postedAt).toEqual({ year: 2026, month: 10, day: 8 });
    expect(c.expiry).toEqual({ month: 11, day: 6, year: null });
    expect(c.postedPrice).toBe(5.47);
  });

  it('skips the @everyone line, emoji and reaction text', () => {
    const c = contract('Market.Moves.Matt ⚡MM 🔥 6/29/26, 11:18 AM\nETHU 8/21 15C @ 0.9 COVERED CALLS\n@everyone remember we are covering here fully ONLY fo…\n\ncover half if you want a little excitement in your life\n😂 3');
    expect(c.postedAt).toEqual({ year: 2026, month: 6, day: 29 });
    expect(c.ticker).toBe('ETHU');
    expect(c.strike).toBe(15);
    expect(c.isRollLike).toBe(false);
  });

  it('flags a roll-like body but still reads the new call', () => {
    const c = contract('NEW BITX $16C 09/18\nYou can exit the current cc and push this out to a furth…\n@everyone');
    expect(c.ticker).toBe('BITX');
    expect(c.isRollLike).toBe(true);
  });

  it('ignores a bare time such as 7:39 AM', () => {
    const c = contract('7:39 AM\nNEW CSP SOXL 75P 4.00 11/13');
    expect(c.postedAt).toBeNull();
    expect(c.postedPrice).toBe(4);
    expect(c.expiry).toEqual({ month: 11, day: 13, year: null });
  });
});

describe('parsePost: exit posts', () => {
  it('DFEN + GGLL EXIT', () => {
    const r = parsePost('DFEN + GGLL EXIT') as ParsedExit;
    expect(r.kind).toBe('exit');
    expect(r.tickers).toEqual(['DFEN', 'GGLL']);
  });

  it('reads tickers only from the EXIT line, not from the prose below it', () => {
    const r = parsePost('Market.Moves.Matt ⚡MM 🔥 10/12/26, 9:19 AM\n@everyone DFEN + GGLL EXIT\n\nMaking money when the market drops is a gift take it') as ParsedExit;
    expect(r.kind).toBe('exit');
    expect(r.tickers).toEqual(['DFEN', 'GGLL']);
  });
});

describe('parsePost: fails closed', () => {
  it('two expirations', () => {
    expect(unreadable('NEW SOXL 11/6 11/13 120P')).toMatch(/Two expirations found \(11\/6 and 11\/13\)/);
  });

  it('two strikes', () => {
    expect(unreadable('NEW CSP SOXL 11/6 120P 115P')).toMatch(/Two strikes found/);
  });

  it('no contract and no EXIT', () => {
    expect(unreadable('hello world')).toMatch(/No option contract found/);
  });

  it('empty paste', () => {
    expect(unreadable('   ')).toMatch(/Nothing was pasted/);
  });

  it('no expiration', () => {
    expect(unreadable('NEW CSP SOXL $120P @ $5.47')).toMatch(/No expiration date found/);
  });

  it('not a real month/day', () => {
    expect(unreadable('NEW CSP SOXL 13/40 120P')).toMatch(/not a real month\/day/);
  });

  it('two tickers', () => {
    expect(unreadable('NEW CSP SOXL TQQQ 11/6 120P')).toMatch(/More than one ticker found \(SOXL, TQQQ\)/);
  });

  it('lowercase ticker is not guessed', () => {
    expect(unreadable('new csp soxl 11/6 120p')).toMatch(/No ticker found/);
  });

  it('two @ prices', () => {
    expect(unreadable('NEW CSP SOXL 11/6 120P @ 5.47 @ 5.00')).toMatch(/More than one @ price/);
  });

  it('two bare prices', () => {
    expect(unreadable('NEW CSP SOXL 11/6 120P 5.47 5.00')).toMatch(/More than one price/);
  });

  it('CSP keyword with a call strike', () => {
    expect(unreadable('NEW CSP SOXL 11/6 120C')).toMatch(/says CSP but the strike is a call/);
  });

  it('covered-call keyword with a put strike', () => {
    expect(unreadable('SOXL 11/6 120P COVERED CALLS')).toMatch(/says covered call but the strike is a put/);
  });
});
