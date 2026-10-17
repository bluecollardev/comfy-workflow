/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{vue,js,ts,jsx,tsx}'],
  corePlugins: {
    // Bootstrap's reboot owns the base styles; Tailwind is utilities only.
    preflight: false,
  },
  // These Tailwind utilities collide with Bootstrap component classes of the same name.
  blocklist: ['collapse', 'container'],
  theme: {
    extend: {
      // PocketPT palette, mirrored so Tailwind utilities can use the same colors as Bootstrap.
      colors: {
        primary: '#00B8EC',
        secondary: '#444444',
        accent: '#EC6A37',
        success: { DEFAULT: '#9ECD3B', dark: '#55801F' },
        warning: '#E9A93C',
        danger: 'rgb(242, 22, 81)',
        purple: '#6B57B5',
        muted: '#BDC1C6',
        surface: { DEFAULT: '#1E1E1E', raised: '#262626', sunken: '#1D1D1D' },
      },
    },
  },
  plugins: [],
}
