import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "AI 升学规划 Agent · 高考志愿",
  description:
    "依据当年本省官方规则校验资格、过滤候选、比较方案，生成可随条件调整的行动方案。只规划，不承诺录取。",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="zh-CN">
      <body className="min-h-screen">{children}</body>
    </html>
  );
}
