// lib/nav/__tests__/tabs.test.ts

import { describe, it, expect } from 'vitest';
import { TABS, HIDEABLE_TAB_IDS, sanitizeHiddenTabs, visibleTabs, tabForPath, isPathHidden } from '../tabs';

describe('tab registry', () => {
  it('has unique ids and hrefs', () => {
    expect(new Set(TABS.map((t) => t.id)).size).toBe(TABS.length);
    expect(new Set(TABS.map((t) => t.href)).size).toBe(TABS.length);
  });

  it('never allows the core tabs to be hidden', () => {
    ['home', 'portfolio', 'screener', 'trade-log', 'performance', 'help'].forEach((id) => {
      expect(HIDEABLE_TAB_IDS).not.toContain(id);
    });
  });

  it('income engine is hideable', () => {
    expect(HIDEABLE_TAB_IDS).toContain('engine');
  });
});

describe('sanitizeHiddenTabs', () => {
  it('defaults to nothing hidden for bad input', () => {
    expect(sanitizeHiddenTabs(undefined)).toEqual([]);
    expect(sanitizeHiddenTabs('engine')).toEqual([]);
    expect(sanitizeHiddenTabs(null)).toEqual([]);
  });

  it('drops unknown, non-hideable and duplicate ids', () => {
    expect(sanitizeHiddenTabs(['engine', 'engine', 'portfolio', 'nope', 42, 'wheel'])).toEqual(['engine', 'wheel']);
  });
});

describe('visibleTabs', () => {
  it('shows every tab when nothing is hidden', () => {
    expect(visibleTabs([]).length).toBe(TABS.length);
  });

  it('removes only the hidden tabs', () => {
    const ids = visibleTabs(['engine']).map((t) => t.id);
    expect(ids).not.toContain('engine');
    expect(ids).toContain('rinse-repeat');
  });
});

describe('route matching', () => {
  it('maps a pathname to its tab, including subpaths', () => {
    expect(tabForPath('/engine')?.id).toBe('engine');
    expect(tabForPath('/engine/anything')?.id).toBe('engine');
    expect(tabForPath('/help/strategies')?.id).toBe('help');
  });

  it('does not match look-alike prefixes or non-tab routes', () => {
    expect(tabForPath('/wheel-simulator')?.id).toBe('wheel-simulator');
    expect(tabForPath('/wheelx')).toBeNull();
    expect(tabForPath('/profile')).toBeNull();
    expect(tabForPath('/')).toBeNull();
  });

  it('flags only hidden routes', () => {
    expect(isPathHidden('/engine', ['engine'])).toBe(true);
    expect(isPathHidden('/wheel', ['engine'])).toBe(false);
    expect(isPathHidden('/profile', ['engine'])).toBe(false);
  });
});
