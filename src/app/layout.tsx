import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { Toaster } from "@/components/ui/sonner";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "视频墙 · 多视频矩阵同时播放",
  description:
    "视频矩阵展示墙：自定义视频个数与几行几列布局，上传短视频、填写标题介绍，一键同时播放。支持拖拽导入、自动扩位、循环播放与批量静音。",
  keywords: ["视频墙", "视频展示", "同时播放", "视频矩阵", "H5"],
  icons: {
    icon: "https://z-cdn.chatglm.cn/z-ai/static/logo.svg",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN" suppressHydrationWarning>
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased bg-zinc-950 text-foreground`}
      >
        {children}
        {/* 底部居中：不遮挡顶部导航与弹层；同屏最多 2 条，防止堆叠 */}
        <Toaster position="bottom-center" richColors visibleToasts={2} />
      </body>
    </html>
  );
}
