/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        background: "#0d1117",
        card: "#161b22",
        border: "#30363d",
        foreground: "#e6edf3",
        muted: "#8b949e",
        primary: "#3fb950",
        "primary-dark": "#2ea043",
        danger: "#f85149",
      },
      fontFamily: {
        mono: ["'JetBrains Mono'", "Consolas", "monospace"],
      },
    },
  },
  plugins: [],
}
