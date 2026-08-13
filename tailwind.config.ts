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

        // ---- STC UI kit, merged from design-system/tailwind.config.js ----
        // Names that would clobber the legacy tokens above (bg, accent, border)
        // are deliberately omitted: those still resolve to the current dark
        // theme at :root, and kit surfaces get the kit values via the .kit
        // scope in kit-tokens.css. Everything else is additive.
        navy:   { 50:'#EFF2F8',100:'#D9DEEC',200:'#B4BDD8',300:'#8492C0',400:'#5A6DA8',
                  500:'#3D5290',600:'#2B3F78',700:'#1E2F63',800:'#13224F',900:'#09163A',950:'#050D26' },
        stcred: { 50:'#FDF2F1',100:'#FCE3E1',200:'#F9C3BE',300:'#F49189',400:'#EC6055',
                  500:'#E03B2E',600:'#CF2417',700:'#B31F14',800:'#9C1B11',900:'#7A150D' },
        sand:   { 0:'#FFFFFF',50:'#F7F7F5',100:'#EFEFEC',200:'#E2E2DE',300:'#CBCBC6',
                  400:'#A3A39D',500:'#7A7A74',600:'#5B5B56',700:'#43433F',800:'#2B2B28',900:'#1A1A18' },
        'bg-subtle':      'var(--bg-subtle)',
        surface:          'var(--surface)',
        'surface-raised': 'var(--surface-raised)',
        'surface-sunken': 'var(--surface-sunken)',
        'border-strong':  'var(--border-strong)',
        'border-emphasis':'var(--border-emphasis)',
        fg:               'var(--text)',
        'fg-muted':       'var(--text-muted)',
        'fg-subtle':      'var(--text-subtle)',
        'fg-inverse':     'var(--text-inverse)',
        primary: { DEFAULT:'var(--primary)', hover:'var(--primary-hover)', fg:'var(--primary-fg)' },
        success: 'var(--success)',
        warning: 'var(--warning)',
        danger:  'var(--danger)',
        info:    'var(--info)',
        chart:   { 1:'#09163A',2:'#CF2417',3:'#3D5290',4:'#E0C63F',5:'#1F9E3C',6:'#8492C0',7:'#7A150D',8:'#A3A39D' },
      },
      fontFamily: {
        panton:  ['Panton', 'Inter', 'system-ui', 'sans-serif'],
        display: ['Panton', 'sans-serif'],
        sans:    ['Inter', 'system-ui', '-apple-system', 'Segoe UI', 'sans-serif'],
        mono:    ['"IBM Plex Mono"', 'ui-monospace', 'monospace'],
      },
      fontSize: {
        label:   ['11px', { lineHeight:'1',    letterSpacing:'0.16em'  }],
        caption: ['12px', { lineHeight:'1.45'                          }],
        h3:      ['17px', { lineHeight:'1.3',  letterSpacing:'-0.02em' }],
        h2:      ['22px', { lineHeight:'1.2',  letterSpacing:'-0.025em'}],
        h1:      ['30px', { lineHeight:'1.15', letterSpacing:'-0.03em' }],
        display: ['44px', { lineHeight:'1.05', letterSpacing:'-0.04em' }],
      },
      borderRadius: { DEFAULT: '4px', md: '6px', lg: '8px' },
      boxShadow: { 1:'var(--shadow-1)', 2:'var(--shadow-2)', 3:'var(--shadow-3)', 4:'var(--shadow-4)' },
      spacing: { control:'32px','control-sm':'28px','control-lg':'38px', row:'36px','row-lg':'44px' },
      transitionTimingFunction: { stc:'cubic-bezier(0.2, 0, 0, 1)' },
      transitionDuration: { 120:'120ms', 160:'160ms', 220:'220ms' },
      maxWidth: {
        'screen-3xl': '1800px',
        content: '1440px',
      },
    },
  },
  plugins: [],
};

export default config;
