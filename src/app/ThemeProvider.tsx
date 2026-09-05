"use client";

/**
 * 统一主题 Provider（基于 next-themes）。
 *
 * 应用外观（Light / Dark）由它作为单一真源管理：通过往 <html> 上加/去 `dark`
 * class 驱动 globals.css 里的主题 token 切换，并持久化到 localStorage
 * （storageKey `theme`，与历史 Navbar 手动实现保持同一键，避免用户偏好丢失）。
 *
 * 约定（见 globals.css 注释）：
 *  - canvas / node / editor 等"固定暗色"表面不随主题变化，属有意设计；
 *  - 其余外层 chrome 与表单跟随主题 token。
 *
 * 默认 dark：与应用既有暗色优先的视觉一致，避免冷启动闪成 Light。
 */

import { ThemeProvider as NextThemesProvider } from "next-themes";
import type { ComponentProps } from "react";

type ThemeProviderProps = ComponentProps<typeof NextThemesProvider>;

export function ThemeProvider({ children, ...props }: ThemeProviderProps) {
  return (
    <NextThemesProvider
      attribute="class"
      defaultTheme="dark"
      enableSystem={false}
      storageKey="theme"
      {...props}
    >
      {children}
    </NextThemesProvider>
  );
}
