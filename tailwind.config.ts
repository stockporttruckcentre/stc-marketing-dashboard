import type { Config } from 'tailwindcss';

const config: Config = {
  content: [
    './app/**/*.{js,ts,jsx,tsx,mdx}',
    './components/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        stc: {
          navy: '#071458',
          'navy-light': '#0a1d75',
          red: '#cf2417',
          'red-dark': '#b01f13',
        },
      },
      maxWidth: {
        'screen-3xl': '1800px',
      },
    },
  },
  plugins: [],
};

export default config;
