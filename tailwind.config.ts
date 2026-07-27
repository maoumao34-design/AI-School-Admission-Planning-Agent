import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        tier: {
          reach: "#d97706", // 冲刺 amber-600
          stable: "#2563eb", // 稳妥 blue-600
          safety: "#16a34a", // 保底 green-600
        },
      },
    },
  },
  plugins: [],
};

export default config;
