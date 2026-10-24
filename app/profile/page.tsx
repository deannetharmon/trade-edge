// app/profile/page.tsx
'use client';

// NAV-HIDE-0001: user profile. First setting: choose which optional tabs to
// show. Everything is visible by default; changes save immediately and apply
// to every page. Hiding a tab never removes its code.

import { useEffect, useState } from 'react';
import { useSession, signOut } from 'next-auth/react';
import { AppHeader } from '@/components/nav/AppHeader';
import { useNavConfig } from '@/components/nav/NavConfigProvider';
import { TABS, TabId } from '@/lib/nav/tabs';
import { isCardsDisabled, loadPositionsViewStored, savePositionsViewStored, type PositionsViewSetting } from '@/features/portfolio/positions-workspace/model/positionsViewSetting';

export default function ProfilePage() {
  const { data: session } = useSession();
  const { hiddenTabs, saveHiddenTabs, loaded } = useNavConfig();
  const [status, setStatus] = useState<'idle' | 'saved' | 'error'>('idle');

  const hideable = TABS.filter((t) => t.hideable);

  // POSITIONS-CARDS-0001: which layout Position Analysis opens with. Table is the default; per-browser, like the table's other preferences.
  const cardsDisabled = isCardsDisabled();
  const [viewSetting, setViewSetting] = useState<PositionsViewSetting>('table');
  useEffect(() => { setViewSetting(loadPositionsViewStored().setting); }, []);
  const chooseViewSetting = (next: PositionsViewSetting) => {
    setViewSetting(next);
    savePositionsViewStored({ ...loadPositionsViewStored(), setting: next });
  };

  const toggle = async (id: TabId) => {
    const next = hiddenTabs.indexOf(id) === -1 ? hiddenTabs.concat(id) : hiddenTabs.filter((h) => h !== id);
    const ok = await saveHiddenTabs(next);
    setStatus(ok ? 'saved' : 'error');
    setTimeout(() => setStatus('idle'), 1500);
  };

  const showAll = async () => {
    const ok = await saveHiddenTabs([]);
    setStatus(ok ? 'saved' : 'error');
    setTimeout(() => setStatus('idle'), 1500);
  };

  return (
    <div className="min-h-screen bg-black text-white" style={{ fontFamily: 'var(--font-inter), system-ui, sans-serif' }}>
      <AppHeader />

      <div className="max-w-2xl mx-auto px-6 py-8 space-y-6">
        <div>
          <h1 className="text-base font-bold tracking-widest">PROFILE</h1>
          {session?.user?.email && <p className="text-[11px] text-white/50 mt-1">{session.user.email}</p>}
        </div>

        <div className="border border-white/10 bg-white/[0.03] rounded-xl p-6 space-y-3">
          <div className="flex items-center justify-between border-b border-white/10 pb-2">
            <h2 className="text-xs font-bold tracking-widest text-white/80 uppercase">Tabs</h2>
            <span className="text-[10px] text-white/50" aria-live="polite">
              {status === 'saved' ? 'Saved' : status === 'error' ? 'Could not save, try again' : ''}
            </span>
          </div>
          <p className="text-[11px] text-white/50">
            Choose which optional tabs appear in the navigation. Hidden tabs can be turned back on here at any time.
          </p>

          {hideable.map((t) => {
            const shown = hiddenTabs.indexOf(t.id) === -1;
            return (
              <label key={t.id} className="flex items-center justify-between py-2 cursor-pointer">
                <span>
                  <span className="block text-xs font-bold tracking-wider">{t.label}</span>
                  <span className="block text-[10px] text-white/50">{t.desc}</span>
                </span>
                <input
                  type="checkbox"
                  checked={shown}
                  disabled={!loaded}
                  onChange={() => toggle(t.id)}
                  aria-label={`Show ${t.label}`}
                  className="h-4 w-4 accent-[#00d4aa]"
                />
              </label>
            );
          })}

          <div className="pt-2">
            <button
              onClick={showAll}
              disabled={!loaded || hiddenTabs.length === 0}
              className="text-[10px] px-3 py-1.5 border border-white/20 rounded-lg text-white/70 hover:border-[#00d4aa] hover:text-[#00d4aa] transition-colors disabled:opacity-40"
            >
              Show all tabs
            </button>
          </div>
        </div>

        {!cardsDisabled && (
          <div className="border border-white/10 bg-white/[0.03] rounded-xl p-6 space-y-3">
            <h2 className="text-xs font-bold tracking-widest text-white/80 uppercase border-b border-white/10 pb-2">Positions view</h2>
            <p className="text-[11px] text-white/50">Which layout Position Analysis opens with. Saved in this browser. You can switch any time on the page itself.</p>
            <div role="radiogroup" aria-label="Positions view" className="space-y-1">
              {([['table', 'Table', 'The full table (default).'], ['cards', 'Cards', 'One card per position.'], ['last', 'Last used', 'Open with whichever you used last.']] as const).map(([id, label, desc]) => (
                <label key={id} className="flex items-center justify-between py-2 cursor-pointer">
                  <span>
                    <span className="block text-xs font-bold tracking-wider">{label}</span>
                    <span className="block text-[10px] text-white/50">{desc}</span>
                  </span>
                  <input type="radio" name="positions-view" checked={viewSetting === id} onChange={() => chooseViewSetting(id)} aria-label={label} className="h-4 w-4 accent-[#00d4aa]" />
                </label>
              ))}
            </div>
          </div>
        )}

        <button
          onClick={() => signOut({ callbackUrl: '/login' })}
          className="text-[10px] px-3 py-1.5 border border-white/20 rounded-lg text-white/70 hover:text-white transition-colors"
        >
          Sign out
        </button>
      </div>
    </div>
  );
}
