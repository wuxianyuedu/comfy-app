"use client";

/**
 * 首帧应用已保存的外观偏好（圆角 / 标题字阶）。
 *
 * 为什么单独一个组件、挂在根布局：这两档改的是全局 CSS 变量。只在设置页里
 * setProperty 的话，用户一离开设置页或刷新到别的路由，偏好就悄悄不生效 ——
 * 表现是"设置有时管用有时不管用"，这种半生效比没做更难查。
 *
 * 只在挂载后应用（不在 SSR 里）：`<html>` 的 style 由客户端写，服务端没有
 * localStorage 可读；这与 next-themes 处理 `dark` class 的时机同一口径。
 */
import { useEffect } from "react";

import { applyAppearance, readAppearance } from "~/lib/appearance";

export function AppearanceBootstrap() {
  useEffect(() => {
    applyAppearance(readAppearance());
  }, []);
  return null;
}
