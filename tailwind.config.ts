import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{js,ts,jsx,tsx,mdx}"],
  theme: {
    extend: {
      colors: {
        ide: {
          bg:               "#050505",   // editor background — deep black
          surface:          "#0a0a0a",   // intermediate surface
          panel:            "#0a0a0a",   // sidebar / chat / status
          elevated:         "#101010",   // hover surfaces, popovers
          border:           "rgba(245,245,245,0.06)" as any,
          "border-strong":  "rgba(245,245,245,0.10)" as any,
          "border-vivid":   "rgba(245,245,245,0.18)" as any,
          text:             "#f5f5f5",   // warm off-white primary
          "text-soft":      "rgba(245,245,245,0.72)" as any,
          muted:            "rgba(245,245,245,0.5)" as any,
          faint:            "rgba(245,245,245,0.32)" as any,
          hover:            "rgba(255,255,255,0.03)",
          "hover-strong":   "rgba(255,255,255,0.06)",
          active:           "rgba(255,255,255,0.07)",
          highlight:        "rgba(255,255,255,0.10)",
        },
        // White accent — Manuscript ink-on-paper aesthetic
        accent: {
          DEFAULT: "#ffffff",
          hover:   "#ffffff",
          dim:     "rgba(255,255,255,0.10)",
          glow:    "rgba(255,255,255,0.06)",
          ring:    "rgba(255,255,255,0.35)",
          deep:    "rgba(255,255,255,0.85)",
        },
        severity: {
          error:       "#d45f6a",
          "error-soft": "rgba(212,95,106,0.10)",
          "error-vivid":"rgba(212,95,106,0.20)",
          warn:        "#d4a050",
          "warn-soft": "rgba(212,160,80,0.10)",
          ok:          "#5a9e72",
          "ok-soft":   "rgba(90,158,114,0.10)",
          info:        "#7aacb8",
          "info-soft": "rgba(122,172,184,0.10)",
        },
      },
      fontFamily: {
        sans: [
          '"Fraunces"',
          "Georgia",
          '"Times New Roman"',
          "serif",
        ],
        ui: [
          '"Fraunces"',
          "Georgia",
          "serif",
        ],
        serif: [
          '"Fraunces"',
          "Georgia",
          '"Times New Roman"',
          "serif",
        ],
        logo: ['"Sofi Logo"', '"Publica Sans"', "sans-serif"],
        mono: [
          '"SF Mono"',
          '"Cascadia Mono"',
          '"JetBrains Mono"',
          "Menlo",
          "Consolas",
          "monospace",
        ],
      },
      fontSize: {
        "2xs": ["10px", "1.3"],
        "tiny": ["11px", "1.4"],
      },
      letterSpacing: {
        wider:  "0.04em",
        widest: "0.10em",
      },
      boxShadow: {
        "panel":      "inset 0 0 0 1px rgba(255,252,240,0.02)",
        "card":       "0 8px 24px -8px rgba(0,0,0,0.6), 0 0 0 1px rgba(255,252,240,0.04)",
        "modal":      "0 24px 64px -12px rgba(0,0,0,0.8), 0 0 0 1px rgba(255,252,240,0.06)",
        "ring-accent":"0 0 0 1px rgba(201,168,108,0.40)",
        "amber-glow": "0 0 20px rgba(201,168,108,0.08)",
      },
      keyframes: {
        "fade-in": {
          "0%":   { opacity: "0", transform: "translateY(3px)" },
          "100%": { opacity: "1", transform: "translateY(0)" },
        },
        "scale-in": {
          "0%":   { opacity: "0", transform: "scale(0.97)" },
          "100%": { opacity: "1", transform: "scale(1)" },
        },
        "shimmer": {
          "0%":   { backgroundPosition: "-200% 0" },
          "100%": { backgroundPosition: "200% 0" },
        },
        "pulse-amber": {
          "0%, 100%": { opacity: "1" },
          "50%":      { opacity: "0.4" },
        },
      },
      animation: {
        "fade-in":     "fade-in 0.18s ease-out",
        "scale-in":    "scale-in 0.14s ease-out",
        "shimmer":     "shimmer 2.4s linear infinite",
        "pulse-amber": "pulse-amber 1.8s ease-in-out infinite",
      },
    },
  },
  plugins: [],
};

export default config;
