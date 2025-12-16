/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./*.{html,js}"], 
  theme: {
    extend: {
      fontFamily: {
        serif: ['"Playfair Display"', 'serif'],
        sans: ['"Lato"', 'sans-serif'],
      },
      colors: {
        stone: {
          50: '#faf9f6',
          800: '#2e2e2e',
          900: '#1c1c1c',
        }
      }
    }
  },
  plugins: [],
}