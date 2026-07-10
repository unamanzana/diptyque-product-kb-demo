import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Diptyque 商品知识图谱",
  description: "Diptyque 产品 ontology、图谱浏览与问答演示",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN" className="h-full antialiased">
      <body className="min-h-full">{children}</body>
    </html>
  );
}
