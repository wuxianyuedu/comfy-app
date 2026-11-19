"use client";

/**
 * 统一主题 Provider（next-themes）：经 <html> 的 `dark` class 驱动 globals.css 主题 token，持久化到 localStorage（storageKey `theme`，与历史实现同键）。
 * 约定（见 globals.css）：所有表面跟随 token，唯一例外是「固定暗色清单」（新增需满足准入判据）；默认 dark，用户选择后以 localStorage 偏好为准。
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
