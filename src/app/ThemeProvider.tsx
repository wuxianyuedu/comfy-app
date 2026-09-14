"use client";

/**
 * 统一主题 Provider（基于 next-themes）。
 *
 * 应用外观（Light / Dark）由它作为单一真源管理：通过往 <html> 上加/去 `dark`
 * class 驱动 globals.css 里的主题 token 切换，并持久化到 localStorage
 * （storageKey `theme`，与历史 Navbar 手动实现保持同一键，避免用户偏好丢失）。
 *
 * 约定（见 globals.css 注释）：
 *  - **所有**表面跟随主题 token，不存在「暗色品牌页」——登录页 / 错误页 /
 *    404 与画布、面板、浮层一样随 `.dark` 切换；
 *  - 唯一的例外是 globals.css 的「固定暗色清单」（画布上极小面积的叠层），
 *    逐条写明理由，新增需满足该清单的准入判据。
 *
 * 默认 dark：用户尚未表达偏好时的初始外观（与既有视觉一致，避免冷启动闪成
 * Light）；用户在设置页选择后以 localStorage 的偏好为准。
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
