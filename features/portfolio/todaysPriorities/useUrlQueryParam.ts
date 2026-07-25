// features/portfolio/todaysPriorities/useUrlQueryParam.ts
//
// WA-0003: minimal, mechanical URL query-param read helper -- not a router,
// not new domain logic. Reads a single named query parameter from
// `window.location.search` on mount and re-reads it on `popstate` (browser
// back/forward), so the deep-link contracts in
// docs/design/WA-0003-Todays-Priorities-Finite-Queue-CES.md section 13
// survive refresh and standard back navigation without any client-side
// router dependency, matching this app's existing localStorage-based
// client-only state pattern (see priorityWorkflowState.ts's own doc
// comment) rather than introducing next/navigation's useSearchParams (which
// would require a new Suspense boundary this app does not otherwise use).

'use client';

import { useEffect, useState } from 'react';

function readParam(name: string): string | null {
  if (typeof window === 'undefined') return null;
  return new URLSearchParams(window.location.search).get(name);
}

export function useUrlQueryParam(name: string): string | null {
  const [value, setValue] = useState<string | null>(() => readParam(name));

  useEffect(() => {
    setValue(readParam(name));
    const handler = () => setValue(readParam(name));
    window.addEventListener('popstate', handler);
    return () => window.removeEventListener('popstate', handler);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [name]);

  return value;
}
