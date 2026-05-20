'use client';

import { useEffect, useState } from 'react';
import { LogOut } from 'lucide-react';
import type { Profile } from '@/lib/types';

export function Header({ profile, lushaBalance }: { profile: Profile; lushaBalance: number }) {
  const [balance, setBalance] = useState(lushaBalance);

  useEffect(() => {
    // Re-fetch balance periodically so it stays live as users spend credits
    // Auto-polling removed: Lusha account/usage is 5 req/min rate-limited.
    // Component appears unused in current layout; balance comes from TopBar pill instead.
  }, []);

  return (
    <header className="bg-stc-navy text-white px-6 py-3 shadow-lg">
      <div className="max-w-screen-3xl mx-auto flex items-center justify-between">
        <div className="flex items-center gap-4">
          <div className="text-2xl font-bold tracking-wide">STC</div>
          <div className="text-sm opacity-80 hidden sm:block">Marketing Dashboard</div>
        </div>

        <div className="flex items-center gap-6">
          <div className="text-sm hidden sm:block">
            <span className="opacity-70">Lusha credits:</span>
            <span className="ml-2 font-semibold">{balance.toLocaleString()}</span>
          </div>

          <div className="flex items-center gap-3">
            <div className="text-right hidden md:block">
              <div className="text-sm font-medium leading-tight">{profile.full_name}</div>
              <div className="text-xs opacity-70 capitalize">{profile.role}</div>
            </div>
            <div className="w-9 h-9 rounded-full bg-stc-red flex items-center justify-center font-bold">
              {profile.full_name.charAt(0).toUpperCase()}
            </div>
            <form action="/auth/signout" method="post">
              <button
                type="submit"
                title="Sign out"
                className="p-2 rounded hover:bg-white/10"
                aria-label="Sign out"
              >
                <LogOut size={16} />
              </button>
            </form>
          </div>
        </div>
      </div>
    </header>
  );
}
