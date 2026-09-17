/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        spotify: {
          green: '#1ed760',
          'green-hover': '#1fdf64',
          black: '#121212',
          base: '#000000',
          dark: '#181818',
          elevated: '#242424',
          highlight: '#2a2a2a',
          subtext: '#a7a7a7',
          border: '#282828'
        }
      },
      animation: {
        'pulse-subtle': 'pulse 3s cubic-bezier(0.4, 0, 0.6, 1) infinite',
      }
    },
  },
  plugins: [],
}
