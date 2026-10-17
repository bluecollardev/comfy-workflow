/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{vue,js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        // Dark theme color palette
        dark: {
          50: '#f8f8fa',
          100: '#e8e8f0',
          200: '#d0d0e0',
          300: '#b0b0c0',
          400: '#8080a0',
          500: '#6060a0',
          600: '#4a4a80',
          700: '#3a3a60',
          800: '#2a2a3e',
          900: '#1a1a2e',
          950: '#0f0f1e',
        },
        // Accent colors
        primary: '#4a9eff',
        success: '#4caf50',
        danger: '#f44336',
        warning: '#ffc107',
        info: '#00d9ff',
      },
      backgroundColor: {
        card: 'rgba(42, 42, 62, 0.5)',
        cardDark: 'rgba(30, 30, 46, 0.5)',
      },
      backgroundImage: {
        'gradient-dark': 'linear-gradient(135deg, #0f0f1e 0%, #1a1a2e 100%)',
        'gradient-card': 'linear-gradient(135deg, #2a2a3e 0%, #1e1e2e 100%)',
      },
      borderColor: {
        light: 'rgba(255, 255, 255, 0.1)',
        lighter: 'rgba(255, 255, 255, 0.2)',
      },
    },
  },
  darkMode: 'class',
  plugins: [],
}
