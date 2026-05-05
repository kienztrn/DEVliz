/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./src/renderer/index.html', './src/renderer/src/**/*.{ts,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        brand: {
          50: '#eef6ff',
          100: '#d9eaff',
          200: '#bcdbff',
          300: '#8ec4ff',
          400: '#59a5ff',
          500: '#3686ff',
          600: '#1e69f5',
          700: '#1854dd',
          800: '#1a48b3',
          900: '#1c408d',
        },
      },
    },
  },
  plugins: [],
}
