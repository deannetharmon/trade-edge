// app/auth/complete/page.tsx
'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

function getCookie(name: string): string | null {
  if (typeof document === 'undefined') return null;
  const match = document.cookie.match(new RegExp('(?:^|; )' + name + '=([^;]*)'));
  return match ? decodeURIComponent(match[1]) : null;
}

function deleteCookie(name: string) {
  document.cookie = `${name}=; path=/; max-age=0; secure; samesite=lax`;
}

export default function AuthCompletePage() {
  const router = useRouter();

  useEffect(() => {
    const accessToken  = getCookie('tt_access_token_temp');
    const returnTo     = getCookie('tt_return_to_temp');

    if (accessToken) {
      sessionStorage.setItem('tt_access_token', accessToken);

      // Clean up the temp cookies
      deleteCookie('tt_access_token_temp');
      deleteCookie('tt_return_to_temp');

      router.replace(returnTo || '/portfolio');
    } else {
      // Tokens missing — OAuth flow didn't complete properly
      router.replace('/login?error=Auth+session+lost.+Please+try+again.');
    }
  }, [router]);

  return (
    <div className="min-h-screen flex items-center justify-center bg-[#0a0a0a]"
      style={{ fontFamily: "'DM Mono', monospace" }}>
      <p className="text-white/40 text-xs tracking-widest">COMPLETING LOGIN...</p>
    </div>
  );
}
