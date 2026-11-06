// features/screener/components/CollapsiblePanel.tsx

'use client';

import React, { useEffect, useState } from 'react';

const KEY_PREFIX = 'hunter-panel-collapsed:';

/** Reads the remembered collapsed state. Any storage failure means "open". */
export function readPanelCollapsed(id: string): boolean {
  try { return window.localStorage.getItem(KEY_PREFIX + id) === '1'; } catch { return false; }
}

export function writePanelCollapsed(id: string, collapsed: boolean): void {
  try {
    if (collapsed) window.localStorage.setItem(KEY_PREFIX + id, '1');
    else window.localStorage.removeItem(KEY_PREFIX + id);
  } catch { /* storage unavailable: the panel still works for this visit */ }
}

/**
 * A thin title bar above a panel that hides or shows it. Open by default; the
 * choice is remembered per panel. The content stays mounted while collapsed
 * (hidden, not removed) so filter state and inputs inside it are never lost.
 */
export function CollapsiblePanel({ id, title, children }: { id: string; title: string; children: React.ReactNode }) {
  const [collapsed, setCollapsed] = useState(false);
  useEffect(() => { setCollapsed(readPanelCollapsed(id)); }, [id]);
  const toggle = () => {
    setCollapsed(prev => { writePanelCollapsed(id, !prev); return !prev; });
  };
  return (
    <div data-testid={`collapsible-${id}`} className={collapsed ? 'mb-4' : ''}>
      <button
        type="button"
        onClick={toggle}
        aria-expanded={!collapsed}
        aria-controls={`panel-body-${id}`}
        className="mb-1 flex min-h-[44px] w-full items-center justify-between rounded-lg border border-slate-600/40 px-3 text-left text-[10px] font-bold uppercase tracking-widest text-slate-400 hover:text-slate-200"
      >
        <span>{title}</span>
        <span aria-hidden="true" className={`text-xs transition-transform ${collapsed ? '' : 'rotate-180'}`}>▾</span>
      </button>
      <div id={`panel-body-${id}`} hidden={collapsed}>{children}</div>
    </div>
  );
}
