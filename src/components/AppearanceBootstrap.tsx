"use client";

/**
 * 首帧应用已保存的外观偏好（圆角 / 标题字阶）。
 * 挂在根布局：这两档改全局 CSS 变量，只在设置页 setProperty 会在离开/刷新后悄悄失效
 *（半生效比没做更难查）。只在挂载后应用：服务端没有 localStorage，同 next-themes 口径。
 */
import { useEffect } from "react";

import { applyAppearance, readAppearance } from "~/lib/appearance";

export function AppearanceBootstrap() {
  useEffect(() => {
    applyAppearance(readAppearance());
  }, []);
  return null;
}
