import type { Metadata, Viewport } from "next";
import { Inter, JetBrains_Mono } from "next/font/google";
import { ThemeProvider } from "next-themes";
import "./globals.css";
import { Toaster } from "@/components/ui/sonner";

/* 设计规范（DESIGN.md）指定：Inter 正文 + JetBrains Mono 技术标签 */
const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
});

const jetbrainsMono = JetBrains_Mono({
  variable: "--font-jetbrains-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "OmniCompare 灵动对比 · 多内容并行对比工作台",
  description:
    "把多个 AI 模型生成的结果放进同一矩阵并行对比：视频与 HTML 网页混合展示、自定义数量与行列布局、批量上传、统一播放控制、暗亮双主题。数据持久化在服务端，换设备不丢。",
  keywords: ["OmniCompare", "灵动对比", "AI 对比", "视频矩阵", "HTML 预览", "对比工作台"],
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
        className={`${inter.variable} ${jetbrainsMono.variable} antialiased bg-background text-foreground`}
      >
        {/* class 策略 + 暗色默认（DESIGN.md），切换由顶栏按钮控制 */}
        <ThemeProvider attribute="class" defaultTheme="dark" enableSystem={false} disableTransitionOnChange>
          {children}
          {/* 底部居中：不遮挡顶部导航与弹层；同屏最多 2 条，防止堆叠 */}
          <Toaster position="bottom-center" richColors visibleToasts={2} />
        </ThemeProvider>
      </body>
    </html>
  );
}
