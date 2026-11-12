// Tailwind build (v3) for public/styles.css. Run `npm run build:css` after changing
// classes in public/ (npm test fails if the committed CSS is stale).
//
// Dark theme. Palette: background #2C2C2C, text #E4E4E4, accent cyan #A8DADC
// (links, data, focus), accent pink #FFC1CC (decorative only: tab underline, labels),
// lavender #B39CD0 (buttons / active chips, with dark text).
// Grays are inverted (50 = page, 900 = brightest text) so existing classes read right.
// Status scales are dark-tinted (50/100 = dark tinted fill, 500-800 = pastel text).
// Pastel green = Yea/passed, pastel coral = Nay/rejected; parties use outlined chips.
export default {
  // Every class is written out in full in these files (none are assembled in code).
  content: ['./public/**/*.{html,js}'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Inter', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        serif: ['"Source Serif 4"', 'ui-serif', 'Georgia', 'serif'],
      },
      colors: {
        gray: { 50: '#2c2c2c', 100: '#333333', 200: '#444444', 300: '#555555', 400: '#a0a0a0', 500: '#b0b0b0', 600: '#c4c4c4', 700: '#d4d4d4', 800: '#e4e4e4', 900: '#f3f3f3' },
        surface: { DEFAULT: '#363636', deep: '#232323' },
        ink: '#2c2c2c',
        accent: { DEFAULT: '#a8dadc', light: '#cdebec' },
        pink: { DEFAULT: '#ffc1cc' },
        cta: { DEFAULT: '#b39cd0', light: '#c8b6df' },
        // Yea / passed: pastel lime-green. Nay / rejected / errors: pastel coral-red.
        green: { 50: '#26331c', 100: '#30451f', 200: '#456230', 700: '#b5e48c', 800: '#c9eda8' },
        red: { 50: '#3a2a22', 100: '#523226', 200: '#6e4130', 500: '#f4a07a', 600: '#f6ad8d', 700: '#f4a07a', 800: '#f8b89c' },
        yellow: { 50: '#373220', 100: '#4a4126', 800: '#f0db8c' },
        // Party chips are outlined (ring + text), never filled, so they don't read as Yea/Nay.
        party: { r: '#f59a9a', d: '#a3b4f7', i: '#c4c4c4' },
      },
    },
  },
};
