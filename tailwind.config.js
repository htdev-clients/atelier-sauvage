module.exports = {
  content: [
    "./*.html",
    "./_layouts/**/*.html",
    "./_includes/**/*.html",
    "./assets/js/**/*.js"
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
        }
      }
    }
  },
  plugins: [],
}