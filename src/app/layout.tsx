import type { Metadata } from "next";
import "./base.css";
export const metadata: Metadata = {
  title: "映序 · AI 短剧工作台",
  description: "以节点组织协作，以资产承接创作。",
};
export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
