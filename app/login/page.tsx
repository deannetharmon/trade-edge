// app/login/page.tsx
'use client';

import { useEffect, useState, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';

async function getAccessToken(): Promise<string> {
  const res = await fetch('/api/auth/tastytrade-token', {
    method: 'POST',
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data?.error_description ?? data?.error ?? 'Connection failed');
  if (!data.accessToken) throw new Error('No access token returned');
  return data.accessToken;
}

function EyeIcon({ open }: { open: boolean }) {
  return open ? (
    <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 12C3.75 7.5 7.5 4.5 12 4.5s8.25 3 9.75 7.5c-1.5 4.5-5.25 7.5-9.75 7.5S3.75 16.5 2.25 12z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  ) : (
    <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M3.98 8.223A10.477 10.477 0 002.25 12c1.5 4.5 5.25 7.5 9.75 7.5 1.76 0 3.42-.44 4.865-1.22M6.53 6.53A9.77 9.77 0 0112 4.5c4.5 0 8.25 3 9.75 7.5a10.49 10.49 0 01-2.34 3.71M6.53 6.53L3 3m3.53 3.53l10.94 10.94M16.47 16.47L21 21" />
    </svg>
  );
}

type Step = 'loading' | 'sign-in' | 'credentials' | 'connecting' | 'done';

function LoginContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const redirect = searchParams.get('redirect') ?? '/portfolio';

  const [step, setStep] = useState<Step>('loading');
  const [sessionUser, setSessionUser] = useState<{ name?: string | null; image?: string | null } | null>(null);
  const [refreshToken, setRefreshToken] = useState('');
  const [clientSecret, setClientSecret] = useState('');
  const [showRefresh, setShowRefresh] = useState(false);
  const [showSecret, setShowSecret] = useState(false);
  const [error, setError] = useState('');
  const [isConnecting, setIsConnecting] = useState(false);

  useEffect(() => {
    // Dynamically import next-auth/react to avoid prerender issues
    import('next-auth/react').then(({ getSession, signIn: _signIn }) => {
      getSession().then(async (session) => {
        if (!session?.user) {
          setStep('sign-in');
          return;
        }

        setSessionUser(session.user);
        setStep('connecting');

        try {
          const res = await fetch('/api/auth/get-credentials');
          const data = await res.json();

          if (data.hasCredentials) {
            const accessToken = await getAccessToken();
            sessionStorage.setItem('tt_access_token', accessToken);

            router.replace(redirect);
          } else {
            setStep('credentials');
          }
        } catch (e: any) {
          setError(e.message ?? 'Failed to load credentials');
          setStep('credentials');
        }
      });
    });
  }, []);

  const handleGoogleSignIn = () => {
    import('next-auth/react').then(({ signIn }) => {
      signIn('google', { callbackUrl: `/login?redirect=${redirect}` });
    });
  };

  const handleConnectTastyTrade = async () => {
    if (!refreshToken.trim()) { setError('Please enter your refresh token'); return; }
    if (!clientSecret.trim()) { setError('Please enter your client secret'); return; }
    setIsConnecting(true);
    setError('');

    try {
      await fetch('/api/auth/save-credentials', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          refreshToken: refreshToken.trim(),
          clientSecret: clientSecret.trim(),
        }),
      });

      const accessToken = await getAccessToken();
      sessionStorage.setItem('tt_access_token', accessToken);

      router.replace(redirect);
    } catch (e: any) {
      setError(e.message ?? 'Could not connect to TastyTrade');
      setIsConnecting(false);
    }
  };

  // ── Loading ───────────────────────────────────────────────────────────────
  if (step === 'loading' || step === 'connecting') {
    return (
      <div className="flex flex-col items-center gap-4">
        <div className="text-white/40 text-xs tracking-widest" style={{ fontFamily: "var(--font-inter), system-ui, sans-serif" }}>
          {step === 'connecting' ? 'CONNECTING...' : 'LOADING...'}
        </div>
      </div>
    );
  }

  // ── Sign in ───────────────────────────────────────────────────────────────
  if (step === 'sign-in') {
    return (
      <div className="w-full max-w-sm">
        <div className="text-center mb-10">
          <h1 className="text-xl font-bold tracking-widest text-white"
            style={{ fontFamily: "var(--font-inter), system-ui, sans-serif" }}>OPTIONS HUNTER</h1>
          <p className="text-[10px] text-white/40 mt-1 tracking-wider"
            style={{ fontFamily: "var(--font-inter), system-ui, sans-serif" }}>BPS · BCS · IRON CONDOR</p>
        </div>

        <div className="bg-[#111] border border-[#222] rounded-2xl p-8">
          <h2 className="text-sm font-bold text-white tracking-wider mb-2">SIGN IN</h2>
          <p className="text-xs text-white/40 mb-6 leading-relaxed">
            Sign in with Google to access your trading dashboard. Your TastyTrade credentials are stored securely and never shared.
          </p>

          <button
            onClick={handleGoogleSignIn}
            className="w-full py-3 bg-white text-black rounded-lg text-xs font-bold tracking-widest hover:bg-white/90 transition-colors flex items-center justify-center gap-3"
          >
            <svg className="w-4 h-4" viewBox="0 0 24 24">
              <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
              <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
              <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
              <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
            </svg>
            Continue with Google
          </button>
        </div>
      </div>
    );
  }

  // ── TastyTrade credentials ────────────────────────────────────────────────
  return (
    <div className="w-full max-w-sm">
      <div className="text-center mb-10">
        <h1 className="text-xl font-bold tracking-widest text-white"
          style={{ fontFamily: "var(--font-inter), system-ui, sans-serif" }}>OPTIONS HUNTER</h1>
        <p className="text-[10px] text-white/40 mt-1 tracking-wider"
          style={{ fontFamily: "var(--font-inter), system-ui, sans-serif" }}>BPS · BCS · IRON CONDOR</p>
      </div>

      <div className="bg-[#111] border border-[#222] rounded-2xl p-8">
        <div className="flex items-center gap-2 mb-2">
          {sessionUser?.image && (
            <img src={sessionUser.image} className="w-6 h-6 rounded-full" alt="" />
          )}
          <h2 className="text-sm font-bold text-white tracking-wider">CONNECT TASTYTRADE</h2>
        </div>
        <p className="text-xs text-white/40 mb-5 leading-relaxed">
          Welcome{sessionUser?.name ? `, ${sessionUser.name.split(' ')[0]}` : ''}! One-time setup — paste your TastyTrade API credentials below. They'll be stored securely and you'll never need to enter them again.
        </p>

        <div className="mb-5 bg-white/5 border border-white/10 rounded-lg p-3">
          <p className="text-[10px] text-white/50 leading-relaxed">
            <span className="text-white/70 font-bold">From TastyTrade:</span><br />
            1.{' '}
            <a href="https://my.tastytrade.com/settings/api" target="_blank" rel="noopener noreferrer"
              className="text-blue-400 hover:text-blue-300 underline">
              Settings → API → your app
            </a><br />
            2. Click <span className="text-white/70">Manage → Create Grant</span><br />
            3. Copy <span className="text-white/70">Refresh Token</span> and <span className="text-white/70">Client Secret</span>
          </p>
        </div>

        <div className="mb-4">
          <label className="text-[10px] text-white/40 tracking-wider uppercase">Refresh Token</label>
          <div className="relative mt-1">
            <input
              type={showRefresh ? 'text' : 'password'}
              value={refreshToken}
              onChange={e => setRefreshToken(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleConnectTastyTrade()}
              autoFocus
              className="w-full px-4 py-3 pr-11 bg-[#0a0a0a] border border-[#2c2c2c] rounded-lg text-white text-sm placeholder:text-white/20 focus:outline-none focus:border-white/30 transition-colors font-sans"
              placeholder="paste refresh token"
            />
            <button type="button" onClick={() => setShowRefresh(v => !v)}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-white/30 hover:text-white/70 transition-colors" tabIndex={-1}>
              <EyeIcon open={showRefresh} />
            </button>
          </div>
        </div>

        <div className="mb-5">
          <label className="text-[10px] text-white/40 tracking-wider uppercase">Client Secret</label>
          <div className="relative mt-1">
            <input
              type={showSecret ? 'text' : 'password'}
              value={clientSecret}
              onChange={e => setClientSecret(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleConnectTastyTrade()}
              className="w-full px-4 py-3 pr-11 bg-[#0a0a0a] border border-[#2c2c2c] rounded-lg text-white text-sm placeholder:text-white/20 focus:outline-none focus:border-white/30 transition-colors font-sans"
              placeholder="paste client secret"
            />
            <button type="button" onClick={() => setShowSecret(v => !v)}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-white/30 hover:text-white/70 transition-colors" tabIndex={-1}>
              <EyeIcon open={showSecret} />
            </button>
          </div>
        </div>

        {error && (
          <div className="mb-4 text-xs text-red-400 bg-red-500/10 border border-red-500/30 rounded-lg px-3 py-2 leading-relaxed">
            {error}
          </div>
        )}

        <button onClick={handleConnectTastyTrade} disabled={isConnecting}
          className="w-full py-3 bg-white text-black rounded-lg text-xs font-bold tracking-widest hover:bg-white/90 transition-colors disabled:opacity-40">
          {isConnecting ? 'CONNECTING...' : 'CONNECT →'}
        </button>

        <p className="text-[10px] text-white/20 text-center mt-5 leading-relaxed">
          Credentials are encrypted and stored securely. Never shared with third parties.
        </p>
      </div>
    </div>
  );
}

export default function LoginPage() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-[#0a0a0a] p-4"
      style={{ fontFamily: "var(--font-inter), system-ui, sans-serif" }}>
      <Suspense fallback={<div className="text-white/40 text-xs tracking-widest">LOADING...</div>}>
        <LoginContent />
      </Suspense>
    </div>
  );
}
