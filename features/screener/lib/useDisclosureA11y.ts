// features/screener/lib/useDisclosureA11y.ts
//
// SCREENER-UX-0001 corrective pass — shared expand/collapse accessibility
// behavior for every disclosure this ticket added (BestOpportunitiesShortlist
// rows, DisqualifiedSection's section + cards, SymbolOutcomesDisclosure).
// Two things the first pass deferred, now both handled here:
//   1. A polite live-region announcement of the new state, so a screen-reader
//      user gets the same "expanded"/"collapsed" feedback a sighted user gets
//      from the caret glyph flipping.
//   2. Focus restoration to the trigger button whenever the panel closes --
//      covers the case where focus was inside the now-removed panel content
//      (e.g. the user tabbed to a link inside it) before it collapsed.

import { useCallback, useRef, useState, type RefObject } from 'react';

export interface DisclosureA11y {
  open: boolean;
  toggle: () => void;
  buttonRef: RefObject<HTMLButtonElement>;
  liveMessage: string;
}

export function useDisclosureA11y(labelWhenOpen: string, labelWhenClosed: string, initialOpen = false): DisclosureA11y {
  const [open, setOpen] = useState(initialOpen);
  const [liveMessage, setLiveMessage] = useState('');
  const buttonRef = useRef<HTMLButtonElement>(null);

  const toggle = useCallback(() => {
    setOpen(prev => {
      const next = !prev;
      setLiveMessage(next ? labelWhenOpen : labelWhenClosed);
      if (!next) {
        // Collapsing: if focus was inside the panel being removed, move it
        // back to the trigger rather than letting it fall to <body>.
        requestAnimationFrame(() => buttonRef.current?.focus());
      }
      return next;
    });
  }, [labelWhenOpen, labelWhenClosed]);

  return { open, toggle, buttonRef, liveMessage };
}
