/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        background: {
          DEFAULT: '#0B0D0F',
          secondary: '#111418',
          tertiary: '#171B20',
          elevated: '#1D2228',
        },
        border: {
          subtle: 'rgba(255, 255, 255, 0.07)',
          DEFAULT: 'rgba(255, 255, 255, 0.12)',
          hover: 'rgba(255, 255, 255, 0.20)',
        },
        text: {
          primary: '#F3F4F6',
          secondary: '#9CA3AF',
          muted: '#6B7280',
          dim: '#4B5563',
        },
        accent: {
          DEFAULT: '#3B82F6',
          hover: '#2563EB',
          subtle: 'rgba(59, 130, 246, 0.12)',
          border: 'rgba(59, 130, 246, 0.35)',
        }
      },
      fontFamily: {
        sans: [
          'Segoe UI',
          '-apple-system',
          'BlinkMacSystemFont',
          'Inter',
          'Roboto',
          'Helvetica Neue',
          'sans-serif',
        ],
        mono: [
          'Cascadia Code',
          'Consolas',
          'ui-monospace',
          'monospace',
        ],
      },
    },
  },
  plugins: [],
}
