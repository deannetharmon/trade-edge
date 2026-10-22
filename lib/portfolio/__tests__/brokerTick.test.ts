// lib/portfolio/__tests__/brokerTick.test.ts
//
// TICK-0002 (Alan's fixtures): the broker's stated tick is a floor under the chain's table, remembered per option root.
// Golden case: NVDL 28P, chain table "$0.01 below $3, then $0.05", broker demands $0.05 for the order.

import { beforeEach, describe, expect, it } from 'vitest';
import {
  applyBrokerTick, ceilToTick, floorToTick, parseBrokerTick, snapEntryCredit, stepByTick, tickSizeFor, parseTickSizes, type TickTable,
} from '../tickSize';
import { effectiveTickTable, learnBrokerTick, learnFromBrokerMessage, learnedBrokerTick, optionRootOf, resetLearnedBrokerTicks } from '../brokerTick';

const PENNY_UNDER_3 = parseTickSizes([{ threshold: '3.0', value: '0.01' }, { value: '0.05' }]) as TickTable;
const NICKEL_DIME = parseTickSizes([{ threshold: '3.0', value: '0.05' }, { value: '0.10' }]) as TickTable;
const BROKER_MESSAGE = 'Price must be in increments of $0.05 for this order.';

beforeEach(() => resetLearnedBrokerTicks());

describe('parseBrokerTick', () => {
  it('reads the tick the broker names', () => {
    expect(parseBrokerTick(BROKER_MESSAGE)).toBe(0.05);
    expect(parseBrokerTick('Invalid price — Price must be in increments of $0.10 for this order')).toBe(0.1);
    expect(parseBrokerTick('price must be in increment of 0.01')).toBe(0.01);
    expect(parseBrokerTick('increments of $.05')).toBe(0.05);
  });
  it('trusts nothing it cannot read: no tick, not whole cents, zero, or more than a dollar is null', () => {
    expect(parseBrokerTick('Insufficient buying power')).toBeNull();
    expect(parseBrokerTick('increments of $0.055')).toBeNull();
    expect(parseBrokerTick('increments of $0.00')).toBeNull();
    expect(parseBrokerTick('increments of $5')).toBeNull();
    expect(parseBrokerTick(undefined)).toBeNull();
    expect(parseBrokerTick(42)).toBeNull();
    expect(parseBrokerTick('')).toBeNull();
  });
});

describe('applyBrokerTick: tick = max(broker tick, table tick at that price)', () => {
  it('raises every step of a finer table, so the NVDL chain table becomes a nickel table', () => {
    const table = applyBrokerTick(PENNY_UNDER_3, 0.05);
    expect(table).toEqual([{ threshold: 3, value: 0.05 }, { threshold: null, value: 0.05 }]);
    expect(tickSizeFor(1.39, table)).toBe(0.05);
  });
  it('never lowers a coarser step', () => {
    expect(applyBrokerTick(NICKEL_DIME, 0.05)).toEqual(NICKEL_DIME);
    expect(applyBrokerTick(NICKEL_DIME, 0.1)).toEqual([{ threshold: 3, value: 0.1 }, { threshold: null, value: 0.1 }]);
  });
  it('with no table the broker tick applies at every price; with no broker tick the table is untouched', () => {
    expect(applyBrokerTick(null, 0.05)).toEqual([{ threshold: null, value: 0.05 }]);
    expect(applyBrokerTick(PENNY_UNDER_3, null)).toBe(PENNY_UNDER_3);
    expect(applyBrokerTick(null, null)).toBeNull();
    expect(applyBrokerTick(PENNY_UNDER_3, 0)).toBe(PENNY_UNDER_3);
    expect(applyBrokerTick(PENNY_UNDER_3, Number.NaN)).toBe(PENNY_UNDER_3);
  });
});

describe('snapEntryCredit: down to the tick, never below one tick', () => {
  const nickel = applyBrokerTick(PENNY_UNDER_3, 0.05);
  it('the reported NVDL entry $1.39 becomes $1.35', () => {
    expect(snapEntryCredit(1.39, nickel)).toBe(1.35);
    expect(snapEntryCredit(1.39, PENNY_UNDER_3)).toBe(1.39);
  });
  it('an on-tick price is unchanged; float noise does not drop a tick', () => {
    expect(snapEntryCredit(1.4, nickel)).toBe(1.4);
    expect(snapEntryCredit(0.7000000000000001, nickel)).toBe(0.7);
    expect(snapEntryCredit(2.95, nickel)).toBe(2.95);
  });
  it('never below one tick, and with no table it is whole cents', () => {
    expect(snapEntryCredit(0.02, nickel)).toBe(0.05);
    expect(snapEntryCredit(0.004, nickel)).toBe(0.05);
    expect(snapEntryCredit(1.386, null)).toBe(1.39);
  });
  it('crossing $3 respects the coarser band', () => {
    expect(snapEntryCredit(3.02, NICKEL_DIME)).toBe(3);
    expect(snapEntryCredit(3.19, NICKEL_DIME)).toBe(3.1);
  });
});

describe('stepByTick: the +/- buttons land on valid ticks', () => {
  const nickel = applyBrokerTick(PENNY_UNDER_3, 0.05);
  it('moves a nickel from an on-tick price, up and down', () => {
    expect(stepByTick(1.35, 1, nickel)).toBe(1.4);
    expect(stepByTick(1.35, -1, nickel)).toBe(1.3);
  });
  it('from an off-tick price it lands on the nearest valid tick in that direction (the old buttons gave 1.34 and 1.44)', () => {
    expect(stepByTick(1.39, -1, nickel)).toBe(1.35);
    expect(stepByTick(1.39, 1, nickel)).toBe(1.4);
  });
  it('never below one tick; a dime band moves a dime', () => {
    expect(stepByTick(0.05, -1, nickel)).toBe(0.05);
    expect(stepByTick(3.5, 1, NICKEL_DIME)).toBe(3.6);
    expect(stepByTick(3.5, -1, NICKEL_DIME)).toBe(3.4);
  });
  it('with no table it keeps the previous behaviour: five cents, never below one cent', () => {
    expect(stepByTick(1.39, 1, null)).toBe(1.44);
    expect(stepByTick(1.39, -1, null)).toBe(1.34);
    expect(stepByTick(0.03, -1, null)).toBe(0.01);
  });
});

describe('ceilToTick / floorToTick (moved here from the bracket, behaviour unchanged)', () => {
  it('ceil and floor on a nickel band', () => {
    const nickel = applyBrokerTick(PENNY_UNDER_3, 0.05);
    expect(ceilToTick(1.36, nickel)).toBe(1.4);
    expect(floorToTick(1.39, nickel)).toBe(1.35);
    expect(ceilToTick(1.4, nickel)).toBe(1.4);
    expect(floorToTick(0.01, nickel)).toBe(0.05);
  });
});

describe('learned broker ticks are per option root', () => {
  it('optionRootOf reads the root from an OCC symbol or a bare root', () => {
    expect(optionRootOf('NVDL  261120P00028000')).toBe('NVDL');
    expect(optionRootOf('AAPL1 271217C00190000')).toBe('AAPL1');
    expect(optionRootOf('nvdl')).toBe('NVDL');
  });
  it('NVDL learning a nickel does not change NVDA', () => {
    expect(learnFromBrokerMessage('NVDL', BROKER_MESSAGE)).toEqual({ tick: 0.05, changed: true });
    expect(learnedBrokerTick('NVDL')).toBe(0.05);
    expect(learnedBrokerTick('NVDA')).toBeNull();
    expect(effectiveTickTable(PENNY_UNDER_3, 'NVDL')).toEqual([{ threshold: 3, value: 0.05 }, { threshold: null, value: 0.05 }]);
    expect(effectiveTickTable(PENNY_UNDER_3, 'NVDA')).toBe(PENNY_UNDER_3);
  });
  it('a tick only rises; naming it again is not a change', () => {
    expect(learnBrokerTick('NVDL', 0.1)).toEqual({ tick: 0.1, changed: true });
    expect(learnBrokerTick('NVDL', 0.05)).toEqual({ tick: 0.1, changed: false });
    expect(learnBrokerTick('NVDL', 0.1)).toEqual({ tick: 0.1, changed: false });
    expect(learnedBrokerTick('NVDL')).toBe(0.1);
  });
  it('a message that names no tick teaches nothing', () => {
    expect(learnFromBrokerMessage('NVDL', 'Insufficient buying power')).toBeNull();
    expect(learnedBrokerTick('NVDL')).toBeNull();
  });
  it('with no table and a learned tick, the broker tick alone is the table', () => {
    learnBrokerTick('NVDL', 0.05);
    expect(effectiveTickTable(null, 'NVDL')).toEqual([{ threshold: null, value: 0.05 }]);
  });
});
