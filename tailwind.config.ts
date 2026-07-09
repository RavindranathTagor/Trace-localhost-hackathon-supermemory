import type { Config } from "tailwindcss";

// Design tokens are OKLCH CSS variables defined in app/globals.css; Tailwind reads
// them so the whole UI is one coherent, easily-retuned system in light and dark.
const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        bg: "oklch(var(--bg) / <alpha-value>)",
        surface: "oklch(var(--surface) / <alpha-value>)",
        border: "oklch(var(--border) / <alpha-value>)",
        text: "oklch(var(--text) / <alpha-value>)",
        muted: "oklch(var(--muted) / <alpha-value>)",
        // Relation colors: drift = reversal (red), duplicate = redo (blue),
        // reaffirm = strengthening signal (green).
        drift: "oklch(var(--drift) / <alpha-value>)",
        duplicate: "oklch(var(--duplicate) / <alpha-value>)",
        reaffirm: "oklch(var(--reaffirm) / <alpha-value>)",
        accent: "oklch(var(--accent) / <alpha-value>)",
      },
      fontFamily: {
        mono: ["var(--font-mono)", "ui-monospace", "monospace"],
      },
      borderRadius: {
        card: "14px",
      },
    },
  },
  plugins: [],
};

export default config;
