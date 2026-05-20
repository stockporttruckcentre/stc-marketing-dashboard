'use client';

import { useEffect, useState } from 'react';
import { Sun, Moon } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';

export function ThemeToggle({ profileId, initialTheme }: { profileId: string; initialTheme: 'dark' | 'light' }) {
  const supabase = createClient();
  const [theme, setTheme] = useState<'dark' | 'light'>(initialTheme);

  // Apply on mount (in case server-rendered fell back)
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    document.cookie = 'stc_theme=' + theme + '; path=/; max-age=' + (60*60*24*365);
  }, [theme]);

  async function toggle() {
    const next = theme === 'dark' ? 'light' : 'dark';
    setTheme(next);
    document.documentElement.setAttribute('data-theme', next);
    document.cookie = 'stc_theme=' + next + '; path=/; max-age=' + (60*60*24*365);
    try {
      await supabase.from('profiles').update({ theme: next }).eq('id', profileId);
    } catch {}
  }

  return (
    <button onClick={toggle} className="theme-toggle" title={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'} aria-label="Toggle theme">
      {theme === 'dark' ? <Sun size={14} /> : <Moon size={14} />}
    </button>
  );
}
