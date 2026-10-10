module.exports = {
  content: [
    "./*.html",
    "./_layouts/**/*.html",
    "./_includes/**/*.html",
    "./assets/js/**/*.js"
  ],
  safelist: [
    'translate-y-24',
    'translate-x-20',
    '-translate-x-20',
    'opacity-0',
    'transition-opacity'
  ],
  future: {
    hoverOnlyWhenSupported: true,
  },
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
        },
        // The shop's orange, from the business card (misc/Carte/atelier_sauvage_carte_f37c2a.svg).
        brand: {
          orange: '#f37c2a',
        },
      }
    }
  },
  plugins: [],
}