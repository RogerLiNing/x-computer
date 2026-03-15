/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
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
