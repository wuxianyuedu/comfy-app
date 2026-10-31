import "~/app/globals.css";

import { type Metadata } from "next";
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
 * 根元数据。它此前一直是脚手架带过来的默认值（英文的示例应用名与描述），
 * 是个不该留在成品里的残留。
 *
 * **可见面要说准**（这条容易想当然）：桌面壳的窗口标题由壳侧显式设定
 * （`src-tauri/src/lib.rs` 的 `WebviewWindowBuilder::title("Comfy APP")`），
 * 前端自绘的页签行也不读 `document.title` —— 所以它**不进桌面壳的标题栏**。
 * 真正取到它的是**浏览器形态**（`pnpm dev` 起的那条开发链路，README 里写明
 * 前端可在浏览器里调试）：页签文字、书签/历史记录名。
 *
 * `template` 而非写死品牌：子路由只声明自己的那一段（如「模型库」），
 * 品牌由这一处收口，新增页面不会漏带、也不会各页手抄一遍。
 *
 * 刻意**不**在这里补 `viewport.themeColor`：那颗 meta 管的是浏览器 UI
 * （地址栏 / 窗饰）的着色，而桌面壳没有原生装饰、窗口底色由壳侧
 * `tauri.conf.json` 的 `backgroundColor` 决定，前端这层给它一个值并不承重 ——
 * 添一个没人消费的配置项，等于给下一个人留一道「它到底管什么」的题。
 */
export const metadata: Metadata = {
  description: "基于 ComfyUI 的本地 AI 创作桌面应用",
  icons: [{ rel: "icon", url: "/favicon.ico" }],
  title: { default: "Comfy-APP", template: "%s · Comfy-APP" },
};

const geist = Geist({
  subsets: ["latin"],
  variable: "--font-geist-sans",
});

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    /* suppressHydrationWarning：主题 class 由 next-themes 内联脚本在首帧前
     * 依据 localStorage 写入，需跳过 SSR 与客户端对 <html> 属性的水合告警。 */
    <html className={`${geist.variable}`} lang="zh-CN" suppressHydrationWarning>
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
