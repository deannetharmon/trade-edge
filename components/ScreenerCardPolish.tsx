'use client';

import { useEffect } from 'react';

function applyScreenerCardPolish() {
  if (typeof window === 'undefined') return;
  if (window.location.pathname !== '/screener') return;

  const spans = Array.from(document.querySelectorAll('span'));
  for (const span of spans) {
    const text = (span.textContent ?? '').trim().replace(/\s+/g, ' ');

    // The yellow DTE pill duplicates the expiration DTE already shown in the
    // row and creates noise/wrapping in narrow card states.
    if (text === '⚠ DTE') {
      (span as HTMLElement).style.display = 'none';
      continue;
    }

    // Keep follow-up state badges readable as one compact token.
    if (text.startsWith('✓ scheduled') || text.startsWith('✓ re-screen')) {
      const el = span as HTMLElement;
      el.style.whiteSpace = 'nowrap';
      el.style.display = 'inline-flex';
      el.style.alignItems = 'center';
      el.style.gap = '0.25rem';
      el.style.lineHeight = '1.1';
    }
  }
}

export function ScreenerCardPolish() {
  useEffect(() => {
    applyScreenerCardPolish();

    const observer = new MutationObserver(() => applyScreenerCardPolish());
    observer.observe(document.body, { childList: true, subtree: true, characterData: true });

    const onRoute = () => window.setTimeout(applyScreenerCardPolish, 0);
    window.addEventListener('popstate', onRoute);
    const timer = window.setInterval(applyScreenerCardPolish, 1000);

    return () => {
      observer.disconnect();
      window.removeEventListener('popstate', onRoute);
      window.clearInterval(timer);
    };
  }, []);

  return null;
}
