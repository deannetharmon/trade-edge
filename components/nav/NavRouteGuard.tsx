// components/nav/NavRouteGuard.tsx
'use client';

// NAV-HIDE-0001: a hidden tab's page is not reachable by typing its URL.
// Redirects to Home once the user's config is known. Mounted once in
// app/providers.tsx.

import { useEffect } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { useNavConfig } from '@/components/nav/NavConfigProvider';
import { isPathHidden } from '@/lib/nav/tabs';

export function NavRouteGuard() {
  const pathname = usePathname();
  const router = useRouter();
  const { hiddenTabs, loaded } = useNavConfig();

  useEffect(() => {
    if (loaded && isPathHidden(pathname, hiddenTabs)) {
      router.replace('/');
    }
  }, [loaded, pathname, hiddenTabs, router]);

  return null;
}
