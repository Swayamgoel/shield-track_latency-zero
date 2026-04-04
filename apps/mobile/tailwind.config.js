/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./app/**/*.{js,jsx,ts,tsx}",
    "./components/**/*.{js,jsx,ts,tsx}"
  ],
  presets: [require("nativewind/preset")],
  theme: {
    extend: {
      colors: {
        background: '#0c0c0f',
        card: '#15151a',
        primary: '#2574ff',
        error: '#ff6b6b',
        muted: '#1f1f26',
      }
    },
  },
  plugins: [],
}
