import type { Config } from 'tailwindcss';

const config: Config = {
  content: [
    './app/**/*.{js,ts,jsx,tsx,mdx}',
    './components/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        // Brand (legacy aliases - keep working)
        stc: {
          navy:        '#071458',
          'navy-light':'#0a1a6e',
          red:         '#cf2417',
          'red-dark':  '#a81b10',
          'red-glow':  '#ff5347',
        },
        // Semantic dark theme - mapped to CSS variables
        bg:           'var(--bg)',
        'bg-elevated':'var(--bg-elevated)',
        'bg-card':    'var(--bg-card)',
        'bg-hover':   'var(--bg-card-hover)',
        'fg-1':       'var(--fg-1)',
        'fg-2':       'var(--fg-2)',
        'fg-3':       'var(--fg-3)',
        'fg-4':       'var(--fg-4)',
        accent:       'var(--accent)',
        line:         'var(--border)',
        'line-strong':'var(--border-strong)',
      },
      fontFamily: {
        panton:  ['Panton', 'Inter', 'system-ui', 'sans-serif'],
        sans:    ['Inter', 'system-ui', '-apple-system', 'Segoe UI', 'sans-serif'],
        mono:    ['"IBM Plex Mono"', 'ui-monospace', 'monospace'],
      },
      maxWidth: {
        'screen-3xl': '1800px',
      },
    },
  },
  plugins: [],
};

export default config;
