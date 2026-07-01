/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        brand: {
          50:  '#eef2ff',
          100: '#e0e7ff',
          200: '#c7d2fe',
          300: '#a5b4fc',
          400: '#818cf8',
          500: '#6366f1',
          600: '#4f46e5',
          700: '#4338ca',
          800: '#3730a3',
          900: '#312e81',
        },
        gold: '#f59e0b',
        cream: '#F8F9FC',
        surface: '#FFFFFF',
        border: '#E2E8F0',
        text1: '#0f172a',
        text2: '#475569',
        text3: '#94a3b8',
      },
      fontFamily: {
        serif: ['Comic Neue', 'Comic Sans MS', 'Chalkboard SE', 'cursive'],
        sans: ['Comic Neue', 'Comic Sans MS', 'Chalkboard SE', 'cursive'],
      },
    },
  },
  plugins: [],
}
