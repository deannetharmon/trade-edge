// lib/__tests__/themeAccentStyle.test.ts
// @vitest-environment jsdom

import { describe, it, expect, beforeEach } from 'vitest';
import { injectAccentStyle } from '../theme';

const sheet = () => document.getElementById('hunter-accent-style')?.textContent ?? '';

describe('injectAccentStyle', () => {
  beforeEach(() => { document.head.innerHTML = ''; });

  it('injects one sheet with both ac-* and legacy accent-* classes', () => {
    injectAccentStyle();
    injectAccentStyle();
    expect(document.querySelectorAll('#hunter-accent-style')).toHaveLength(1);
    for (const cls of ['.ac-bg ', '.ac-bg-20', '.ac-btn-solid', '.ac-hover-border:hover', '.accent-bg', '.accent-text']) {
      expect(sheet()).toContain(cls);
    }
  });

  it('defines the hover:/focus: variant class names used in markup, and they match', () => {
    injectAccentStyle();
    for (const cls of ['hover:ac-text', 'hover:ac-border-faint', 'hover:ac-bg-10', 'hover:ac-bg-20', 'focus:ac-border']) {
      const el = document.createElement('div');
      el.className = cls;
      document.body.appendChild(el);
      const selector = `.${CSS.escape(cls)}`;
      expect(sheet()).toContain(selector);
      expect(document.querySelector(selector)).toBe(el);
      el.remove();
    }
  });

  it('upgrades a partial sheet another page injected first under the same id', () => {
    const old = document.createElement('style');
    old.id = 'hunter-accent-style';
    old.textContent = '.accent-text { color: var(--accent) !important; }';
    document.head.appendChild(old);

    injectAccentStyle();

    expect(document.querySelectorAll('#hunter-accent-style')).toHaveLength(1);
    expect(sheet()).toContain('.ac-bg-20');
  });
});
