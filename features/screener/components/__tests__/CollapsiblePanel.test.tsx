// features/screener/components/__tests__/CollapsiblePanel.test.tsx

import React from 'react';
import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { CollapsiblePanel } from '../CollapsiblePanel';

describe('CollapsiblePanel', () => {
  beforeEach(() => { window.localStorage.clear(); });

  it('is open by default and keeps content mounted when collapsed', () => {
    render(<CollapsiblePanel id="t1" title="Active rules"><input aria-label="inner" defaultValue="5" /></CollapsiblePanel>);
    const btn = screen.getByRole('button', { name: /active rules/i });
    expect(btn.getAttribute('aria-expanded')).toBe('true');
    fireEvent.click(btn);
    expect(btn.getAttribute('aria-expanded')).toBe('false');
    expect(document.getElementById('panel-body-t1')!.hidden).toBe(true);
    expect((document.querySelector('input') as HTMLInputElement).value).toBe('5'); // still mounted
    fireEvent.click(btn);
    expect(document.getElementById('panel-body-t1')!.hidden).toBe(false);
  });

  it('remembers the collapsed choice per panel', () => {
    const { unmount } = render(<CollapsiblePanel id="t2" title="Result controls"><p>body</p></CollapsiblePanel>);
    fireEvent.click(screen.getByRole('button', { name: /result controls/i }));
    unmount();
    render(<CollapsiblePanel id="t2" title="Result controls"><p>body</p></CollapsiblePanel>);
    expect(screen.getByRole('button', { name: /result controls/i }).getAttribute('aria-expanded')).toBe('false');
    render(<CollapsiblePanel id="other" title="Other"><p>x</p></CollapsiblePanel>);
    expect(screen.getByRole('button', { name: /other/i }).getAttribute('aria-expanded')).toBe('true');
  });
});
