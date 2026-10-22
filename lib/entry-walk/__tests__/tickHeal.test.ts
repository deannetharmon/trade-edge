// lib/entry-walk/__tests__/tickHeal.test.ts
//
// TICK-0002 (Quinn's scenarios): a rejected dry run is retried ONCE at the broker's tick; nothing else is ever retried.
// Golden case: NVDL 28P, entry $1.39, 50% target, 2x stop. The chain published "$0.01 below $3, then $0.05"; the broker accepts
// only multiples of $0.05 for this order.

import { beforeEach, describe, expect, it } from 'vitest';
import { bracketForPrice } from '../bracket';
import { buildCreditEntryOtoco } from '@/lib/screener/entryBracket';
import { describeHeal, describeLearnedTick, postWithTickHeal, type BrokerAttempt } from '../tickHeal';
import { learnedBrokerTick, resetLearnedBrokerTicks } from '@/lib/portfolio/brokerTick';
import { parseTickSizes, type TickTable } from '@/lib/portfolio/tickSize';

const CHAIN_TABLE = parseTickSizes([{ threshold: '3.0', value: '0.01' }, { value: '0.05' }]) as TickTable;
const NICKEL_MESSAGE = 'Price must be in increments of $0.05 for this order.';
const LEG = { action: 'Sell to Open', quantity: 1, symbol: 'NVDL  261120P00028000', 'instrument-type': 'Equity Option' };

const build = (entry: number, table: TickTable | null) =>
  buildCreditEntryOtoco({ ...bracketForPrice(entry, 50, 2, table), quantity: 1, legs: [LEG] });
type Payload = ReturnType<typeof build>;

/** The prices a payload carries: entry, target, stop trigger, stop limit. */
const pricesOf = (p: Payload): number[] => [
  Number(p['trigger-order'].price), Number(p.orders[0].price), Number((p.orders[1] as any)['stop-trigger']), Number(p.orders[1].price),
];

/** A fake broker that accepts only prices that are multiples of `tick` and says so in the broker's own words. */
function fakeBroker(tick: number, message = `Price must be in increments of $${tick.toFixed(2)} for this order.`) {
  const seen: Payload[] = [];
  const post = async (payload: Payload): Promise<BrokerAttempt> => {
    seen.push(payload);
    const ok = pricesOf(payload).every(price => Math.abs(Math.round(price / tick) * tick - price) < 1e-9);
    return ok ? { ok: true, message: '', data: { accepted: true } } : { ok: false, message, data: null };
  };
  return { post, seen };
}

beforeEach(() => resetLearnedBrokerTicks());

describe('postWithTickHeal: the reported NVDL case', () => {
  it('the first attempt is rejected, then exactly one retry at the broker tick succeeds with every price on a nickel', async () => {
    const broker = fakeBroker(0.05);
    const result = await postWithTickHeal({ root: 'NVDL', chainTable: CHAIN_TABLE, entry: 1.39, build, post: broker.post });
    expect(broker.seen).toHaveLength(2);
    expect(pricesOf(broker.seen[0])).toEqual([1.39, 0.69, 2.78, 3.1]); // exactly what failed on screen
    expect(result.ok).toBe(true);
    expect(pricesOf(broker.seen[1])).toEqual([1.35, 0.7, 2.7, 3]); // entry snapped down, exits derived from it
    expect(result.entry).toBe(1.35);
    expect(result.healed).toEqual({ tick: 0.05, entryBefore: 1.39, entryAfter: 1.35 });
    expect(learnedBrokerTick('NVDL')).toBe(0.05);
  });

  it('the next order for the same root needs no retry: it starts on the learned tick', async () => {
    await postWithTickHeal({ root: 'NVDL', chainTable: CHAIN_TABLE, entry: 1.39, build, post: fakeBroker(0.05).post });
    const second = fakeBroker(0.05);
    const result = await postWithTickHeal({ root: 'NVDL', chainTable: CHAIN_TABLE, entry: 1.42, build, post: second.post });
    expect(second.seen).toHaveLength(1);
    expect(result.ok).toBe(true);
    expect(pricesOf(second.seen[0])[0]).toBe(1.4);
    expect(result.healed).toBeNull();
  });

  it('a different root is not affected by what NVDL learned', async () => {
    await postWithTickHeal({ root: 'NVDL', chainTable: CHAIN_TABLE, entry: 1.39, build, post: fakeBroker(0.05).post });
    const penny = fakeBroker(0.01);
    const result = await postWithTickHeal({ root: 'NVDA', chainTable: CHAIN_TABLE, entry: 1.39, build, post: penny.post });
    expect(penny.seen).toHaveLength(1);
    expect(pricesOf(penny.seen[0])[0]).toBe(1.39);
    expect(result.ok).toBe(true);
  });

  it('every entry from $0.10 to $6.00 comes out on a nickel after healing, with the target below the entry and the limit at or above the trigger', async () => {
    for (let cents = 10; cents <= 600; cents++) {
      resetLearnedBrokerTicks();
      const broker = fakeBroker(0.05);
      const result = await postWithTickHeal({ root: 'NVDL', chainTable: CHAIN_TABLE, entry: cents / 100, build, post: broker.post });
      const last = pricesOf(broker.seen[broker.seen.length - 1]);
      expect(result.ok, `entry ${cents / 100}`).toBe(true);
      expect(last[1], `target for ${cents / 100}`).toBeLessThan(last[0]);
      expect(last[3], `limit for ${cents / 100}`).toBeGreaterThanOrEqual(last[2]);
    }
  });
});

describe('postWithTickHeal: an entry one tick wide', () => {
  it('has no room for a profit target below it, so it is a visible error after the first rejection, never a second silent attempt', async () => {
    const broker = fakeBroker(0.05);
    await expect(postWithTickHeal({ root: 'NVDL', chainTable: CHAIN_TABLE, entry: 0.05, build, post: broker.post }))
      .rejects.toThrow('Profit target must close below the entry credit');
    expect(broker.seen.length).toBeLessThanOrEqual(1);
  });
});

describe('postWithTickHeal: what is never retried', () => {
  it('a rejection that names no tick is one dry run and a visible error, with nothing learned', async () => {
    const seen: Payload[] = [];
    const result = await postWithTickHeal({
      root: 'NVDL', chainTable: CHAIN_TABLE, entry: 1.39, build,
      post: async payload => { seen.push(payload); return { ok: false, message: 'Insufficient buying power', data: null }; },
    });
    expect(seen).toHaveLength(1);
    expect(result).toMatchObject({ ok: false, message: 'Insufficient buying power', healed: null });
    expect(learnedBrokerTick('NVDL')).toBeNull();
  });

  it('an unreadable tick message (a format change) is one dry run and an error, not a loop', async () => {
    const seen: Payload[] = [];
    const result = await postWithTickHeal({
      root: 'NVDL', chainTable: CHAIN_TABLE, entry: 1.39, build,
      post: async payload => { seen.push(payload); return { ok: false, message: 'Price increment violation', data: null }; },
    });
    expect(seen).toHaveLength(1);
    expect(result.ok).toBe(false);
  });

  it('the broker naming a tick that is already in force is not retried (the table was not the problem)', async () => {
    const seen: Payload[] = [];
    const first = await postWithTickHeal({ root: 'NVDL', chainTable: CHAIN_TABLE, entry: 1.39, build, post: fakeBroker(0.05).post });
    expect(first.ok).toBe(true);
    const result = await postWithTickHeal({
      root: 'NVDL', chainTable: CHAIN_TABLE, entry: 1.39, build,
      post: async payload => { seen.push(payload); return { ok: false, message: NICKEL_MESSAGE, data: null }; },
    });
    expect(seen).toHaveLength(1);
    expect(result.ok).toBe(false);
  });

  it('a retry that is also rejected with a coarser tick stops at two attempts and remembers the coarser tick', async () => {
    const dime = fakeBroker(0.1, 'Price must be in increments of $0.10 for this order.');
    const nickelThenDime = async (payload: Payload): Promise<BrokerAttempt> => {
      dime.seen.push(payload);
      return dime.seen.length === 1 ? { ok: false, message: NICKEL_MESSAGE, data: null } : { ok: false, message: 'Price must be in increments of $0.10 for this order.', data: null };
    };
    const result = await postWithTickHeal({ root: 'NVDL', chainTable: CHAIN_TABLE, entry: 1.39, build, post: nickelThenDime });
    expect(dime.seen).toHaveLength(2);
    expect(result.ok).toBe(false);
    expect(result).toMatchObject({ firstMessage: NICKEL_MESSAGE, message: 'Price must be in increments of $0.10 for this order.' });
    expect(learnedBrokerTick('NVDL')).toBe(0.1);
  });

  it('a network or auth failure is not swallowed', async () => {
    await expect(postWithTickHeal({
      root: 'NVDL', chainTable: CHAIN_TABLE, entry: 1.39, build, post: async () => { throw new Error('Session expired'); },
    })).rejects.toThrow('Session expired');
  });

  it('with no chain table at all the broker still heals (whole cents sent first, the broker tick after)', async () => {
    const broker = fakeBroker(0.05);
    const result = await postWithTickHeal({ root: 'NVDL', chainTable: null, entry: 1.39, build, post: broker.post });
    expect(broker.seen).toHaveLength(2);
    expect(result.ok).toBe(true);
    expect(pricesOf(broker.seen[1])[0]).toBe(1.35);
  });
});

describe('live submits are never resent: only the tick is learned', () => {
  it('describeLearnedTick remembers the tick and tells the trader to review and place again; it sends nothing', () => {
    const text = describeLearnedTick('NVDL', NICKEL_MESSAGE);
    expect(text).toContain('$0.05');
    expect(text).toContain('nothing was resent');
    expect(learnedBrokerTick('NVDL')).toBe(0.05);
  });
  it('a rejection that names no tick adds no note', () => {
    expect(describeLearnedTick('NVDL', 'Order rejected')).toBeNull();
  });
  it('describeHeal says what moved, and says nothing when nothing was healed', () => {
    expect(describeHeal('NVDL', { tick: 0.05, entryBefore: 1.39, entryAfter: 1.35 })).toBe(
      "The broker's tick for NVDL is $0.05, so prices were adjusted to it. Entry sent at $1.35 (was $1.39).",
    );
    expect(describeHeal('NVDL', { tick: 0.05, entryBefore: 1.4, entryAfter: 1.4 })).toBe("The broker's tick for NVDL is $0.05, so prices were adjusted to it.");
    expect(describeHeal('NVDL', null)).toBeNull();
  });
});
