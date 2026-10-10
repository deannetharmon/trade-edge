// components/nav/NavConfigProvider.tsx
'use client';

// NAV-HIDE-0001: loads the signed-in user's hidden-tab list once and shares it
// with AppNav, the Home cards, the profile page and the route guard.
// Default (no config, signed out, or fetch failure) is "everything visible".
// The last known list is cached per user in localStorage so a hidden tab does
// not flash on page load.

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { useSession } from 'next-auth/react';
import { sanitizeHiddenTabs, TabId } from '@/lib/nav/tabs';

interface NavConfigValue {
  hiddenTabs: TabId[];
  /** True once the server list (or a cached one) has been applied. */
  loaded: boolean;
  /** Persist a new hidden list. Resolves true on success. */
  saveHiddenTabs: (next: TabId[]) => Promise<boolean>;
}

const NavConfigContext = createContext<NavConfigValue>({
  hiddenTabs: [],
  loaded: false,
  saveHiddenTabs: async () => false,
});

function cacheKey(userId: string) {
  return `nav-hidden:${userId}`;
}

function readCache(userId: string): TabId[] | null {
  try {
    const raw = window.localStorage.getItem(cacheKey(userId));
    return raw ? sanitizeHiddenTabs(JSON.parse(raw)) : null;
  } catch {
    return null;
  }
}

function writeCache(userId: string, hidden: TabId[]) {
  try {
    window.localStorage.setItem(cacheKey(userId), JSON.stringify(hidden));
  } catch {
    /* storage unavailable: server copy still applies */
  }
}

export function NavConfigProvider({ children }: { children: React.ReactNode }) {
  const { data: session, status } = useSession();
  const userId: string | null = (session?.user as any)?.id ?? null;

  const [hiddenTabs, setHiddenTabs] = useState<TabId[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (status === 'loading') return;
    if (!userId) {
      setHiddenTabs([]);
      setLoaded(true);
      return;
    }

    const cached = readCache(userId);
    if (cached) {
      setHiddenTabs(cached);
      setLoaded(true);
    }

    let cancelled = false;
    fetch('/api/nav-config', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (cancelled) return;
        if (data?.config) {
          const list = sanitizeHiddenTabs(data.config.hiddenTabs);
          setHiddenTabs(list);
          writeCache(userId, list);
        }
        setLoaded(true);
      })
      .catch(() => {
        if (!cancelled) setLoaded(true);
      });

    return () => {
      cancelled = true;
    };
  }, [userId, status]);

  const saveHiddenTabs = useCallback(
    async (next: TabId[]) => {
      if (!userId) return false;
      const clean = sanitizeHiddenTabs(next);
      try {
        const res = await fetch('/api/nav-config', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ hiddenTabs: clean }),
        });
        if (!res.ok) return false;
        setHiddenTabs(clean);
        writeCache(userId, clean);
        return true;
      } catch {
        return false;
      }
    },
    [userId],
  );

  const value = useMemo(() => ({ hiddenTabs, loaded, saveHiddenTabs }), [hiddenTabs, loaded, saveHiddenTabs]);

  return <NavConfigContext.Provider value={value}>{children}</NavConfigContext.Provider>;
}

export function useNavConfig(): NavConfigValue {
  return useContext(NavConfigContext);
}
