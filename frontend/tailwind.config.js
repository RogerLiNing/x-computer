/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        ct: {
          bg: '#0D0D0D',
          surface: '#161616',
          'surface-raised': '#1E1E1E',
          accent: '#C8A96E',
          text: '#F0EDE8',
          'text-secondary': '#8A857D',
          'text-tertiary': '#5C5852',
          border: 'rgba(255, 255, 255, 0.06)',
          'border-visible': 'rgba(255, 255, 255, 0.10)',
          'user-bg': '#1A1A1A',
        },
        desktop: {
          bg: '#1a1a2e',
          surface: '#16213e',
          accent: '#0f3460',
          highlight: '#e94560',
          text: '#eaeaea',
          muted: '#a0a0b0',
          taskbar: '#0a0a1a',
          window: '#1e1e3a',
          'window-header': '#252550',
        },
      },
      fontFamily: {
        system: ['"Inter"', '"SF Pro Display"', 'system-ui', 'sans-serif'],
        mono: ['"JetBrains Mono"', '"Fira Code"', 'monospace'],
      },
      boxShadow: {
        window: '0 8px 32px rgba(0, 0, 0, 0.4)',
        'window-focused': '0 12px 48px rgba(233, 69, 96, 0.15)',
      },
    },
  },
  plugins: [],
};
