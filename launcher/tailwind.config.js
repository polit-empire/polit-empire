/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      // Цвета берутся из CSS-переменных (:root в styles.css) в виде
      // RGB-триплетов — так работают модификаторы прозрачности (bg-primary/15),
      // а сезонные темы (src/lib/theme.ts) могут переопределять палитру
      // в рантайме без пересборки.
      colors: {
        background: "rgb(var(--pe-background) / <alpha-value>)",
        card: "rgb(var(--pe-card) / <alpha-value>)",
        border: "rgb(var(--pe-border) / <alpha-value>)",
        foreground: "rgb(var(--pe-foreground) / <alpha-value>)",
        muted: "rgb(var(--pe-muted) / <alpha-value>)",
        primary: "rgb(var(--pe-primary) / <alpha-value>)",
        "primary-dark": "rgb(var(--pe-primary-dark) / <alpha-value>)",
        danger: "rgb(var(--pe-danger) / <alpha-value>)",
      },
      fontFamily: {
        mono: ["'JetBrains Mono'", "Consolas", "monospace"],
      },
    },
  },
  plugins: [],
}
