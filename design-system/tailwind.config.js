/** STC Design System - Tailwind config
 *  Semantic names resolve to the CSS variables in tokens.css, so a theme
 *  switch is a single data attribute on <html>, not a class sweep. */
module.exports = {
  darkMode: ['class', '[data-stc-theme="dark"]'],
  theme: {
    extend: {
      colors: {
        navy:   { 50:'#EFF2F8',100:'#D9DEEC',200:'#B4BDD8',300:'#8492C0',400:'#5A6DA8',
                  500:'#3D5290',600:'#2B3F78',700:'#1E2F63',800:'#13224F',900:'#09163A',950:'#050D26' },
        stcred: { 50:'#FDF2F1',100:'#FCE3E1',200:'#F9C3BE',300:'#F49189',400:'#EC6055',
                  500:'#E03B2E',600:'#CF2417',700:'#B31F14',800:'#9C1B11',900:'#7A150D' },
        sand:   { 0:'#FFFFFF',50:'#F7F7F5',100:'#EFEFEC',200:'#E2E2DE',300:'#CBCBC6',
                  400:'#A3A39D',500:'#7A7A74',600:'#5B5B56',700:'#43433F',800:'#2B2B28',900:'#1A1A18' },

        bg: 'var(--bg)', 'bg-subtle': 'var(--bg-subtle)',
        surface: 'var(--surface)', 'surface-raised': 'var(--surface-raised)',
        'surface-sunken': 'var(--surface-sunken)', 'surface-inverse': 'var(--surface-inverse)',
        border: 'var(--border)', 'border-strong': 'var(--border-strong)', 'border-emphasis': 'var(--border-emphasis)',
        fg: 'var(--text)', 'fg-muted': 'var(--text-muted)', 'fg-subtle': 'var(--text-subtle)', 'fg-inverse': 'var(--text-inverse)',
        primary: { DEFAULT:'var(--primary)', hover:'var(--primary-hover)', fg:'var(--primary-fg)' },
        accent:  { DEFAULT:'var(--accent)',  hover:'var(--accent-hover)',  fg:'var(--accent-fg)'  },
        success:'var(--success)', warning:'var(--warning)', danger:'var(--danger)', info:'var(--info)',
        chart: { 1:'#09163A',2:'#CF2417',3:'#3D5290',4:'#E0C63F',5:'#1F9E3C',6:'#8492C0',7:'#7A150D',8:'#A3A39D' }
      },
      fontFamily: {
        display: ['Panton','sans-serif'],
        sans:    ['Inter','system-ui','sans-serif'],
        mono:    ['ui-monospace','SFMono-Regular','Menlo','monospace']
      },
      fontSize: {
        label:   ['11px', { lineHeight:'1',    letterSpacing:'0.16em'  }],
        caption: ['12px', { lineHeight:'1.45'                          }],
        sm:      ['13px', { lineHeight:'1.5',  letterSpacing:'-0.01em' }],
        base:    ['14px', { lineHeight:'1.55', letterSpacing:'-0.01em' }],
        lg:      ['15px', { lineHeight:'1.6',  letterSpacing:'-0.01em' }],
        h3:      ['17px', { lineHeight:'1.3',  letterSpacing:'-0.02em' }],
        h2:      ['22px', { lineHeight:'1.2',  letterSpacing:'-0.025em'}],
        h1:      ['30px', { lineHeight:'1.15', letterSpacing:'-0.03em' }],
        display: ['44px', { lineHeight:'1.05', letterSpacing:'-0.04em' }]
      },
      borderRadius: { sm:'2px', DEFAULT:'4px', md:'6px', lg:'8px' },
      boxShadow: { 1:'var(--shadow-1)', 2:'var(--shadow-2)', 3:'var(--shadow-3)', 4:'var(--shadow-4)' },
      spacing: { control:'32px','control-sm':'28px','control-lg':'38px', row:'36px','row-lg':'44px' },
      transitionTimingFunction: { stc:'cubic-bezier(0.2, 0, 0, 1)' },
      transitionDuration: { 120:'120ms', 160:'160ms', 220:'220ms' },
      maxWidth: { content:'1440px' }
    }
  },
  plugins: []
};
