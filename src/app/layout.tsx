import "~/app/globals.css";

import type { Metadata } from "next";
import { Geist } from "next/font/google";

import { TRPCReactProvider } from "~/trpc/react";
import { LaunchLoadingStubCleaner } from "~/app/LaunchLoadingStubCleaner";
import { TooltipProvider } from "~/components/ui/tooltip";
import { Toaster } from "~/components/ui/sonner";
import { ThemeProvider } from "~/app/ThemeProvider";
import { LogProvider } from "~/components/studio/logs/LogProvider";
import { LogPanel } from "~/components/studio/logs/LogPanel";
import { ToastProvider } from "~/components/studio/ToastProvider";
import { BrowserStatusBar } from "~/components/studio/BrowserStatusBar";
import { UpdateCheckProvider } from "~/components/update-check/UpdateCheckProvider";
import { CodeUpdateWatcher } from "~/components/code-update/CodeUpdateWatcher";
import { AppearanceBootstrap } from "~/components/AppearanceBootstrap";
import { MessageCenterPanel } from "~/components/message-center/MessageCenterPanel";

/**
 * 根元数据。可见面：桌面壳窗口标题由壳侧设定（`src-tauri/src/lib.rs`）、页签行不读 `document.title`，真正取到它的是浏览器形态（页签文字、书签/历史名）。
 * 用 `template` 收口品牌，子路由只声明自己那段。刻意不补 `viewport.themeColor`：桌面壳无原生装饰，底色由壳侧 `backgroundColor` 决定，给了也没人消费。
 */
export const metadata: Metadata = {
  title: { default: "Comfy-APP", template: "%s · Comfy-APP" },
  description: "基于 ComfyUI 的本地 AI 创作桌面应用",
  icons: [{ rel: "icon", url: "/favicon.ico" }],
};

const geist = Geist({
  subsets: ["latin"],
  variable: "--font-geist-sans",
});

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    /* suppressHydrationWarning：主题 class 由 next-themes 内联脚本在首帧前
     * 依据 localStorage 写入，需跳过 SSR 与客户端对 <html> 属性的水合告警。 */
    <html className={geist.variable} lang="zh-CN" suppressHydrationWarning>
      <body className="font-sans antialiased">
        {/* 外观偏好（圆角 / 标题字阶）改的是全局 CSS 变量，必须在任何路由下都成立，
            所以引导挂在根布局而不是设置页内部。 */}
        <AppearanceBootstrap />
        <ThemeProvider>
          <TooltipProvider>
            <TRPCReactProvider>
              {/* 底部状态栏/日志面板全局常驻：所有路由（含设置页）都可见，
                  贴底内容需自行预留 24px（pb-6），不再逐页补挂 */}
              <LogProvider>
                <ToastProvider>
                  {/* 启动期占位的收尾：壳在应用首帧之前注入它（浏览器空白页 / Edge
                      错误页都不能露给用户），应用挂载时连同它的重贴定时器一起收掉 */}
                  <LaunchLoadingStubCleaner />
                  {children}
                  <LogPanel />
                  <BrowserStatusBar />
                  {/* 消息中心全屏面板：由状态栏铃铛按钮切换 open；空态时不渲染 */}
                  <MessageCenterPanel />
                  {/* 运行期「本地更新需重启」检测：轮询 + Ctrl+Shift+U 手动，
                      挂一次即可，自身渲染空节点、用应用内 toast 提示 */}
                  <UpdateCheckProvider />
                  {/* 运行期「页面还跑着上一版代码」检测：长开窗口 + 拉新代码时，
                      已挂载组件里的旧实例会与新模块错位（表现为某个功能静默失效，
                      或整块画布被打成错误页）。这里观测构建标识变化，真发生时用
                      应用内通知把「重载一次即恢复」讲清楚（toast + 消息中心留底）。 */}
                  <CodeUpdateWatcher />
                </ToastProvider>
              </LogProvider>
            </TRPCReactProvider>
            <Toaster />
          </TooltipProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
