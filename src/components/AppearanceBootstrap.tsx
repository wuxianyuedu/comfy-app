"use client";

/**
 * 首帧应用已保存的外观偏好（圆角 / 标题字阶）。
 * 挂在根布局：这两档改全局 CSS 变量，只在设置页 setProperty 会在离开/刷新后悄悄失效
 *（半生效比没做更难查）。只在挂载后应用：服务端没有 localStorage，同 next-themes 口径。
 */
import { useEffect } from "react";

import { applyAppearance, readAppearance, restoreUserFonts } from "~/lib/appearance";

export function AppearanceBootstrap() {
  useEffect(() => {
    let cancelled = false;
    /* 先恢复用户拖入的自定义字体（把它们重新注册进 document.fonts），再应用已保存的
       外观偏好 —— 这样偏好里引用的 family 名在首帧就已经能解析出字形，不用等闪一下
       回退栈。任一环节失败都不影响另一条：恢复出错时外观仍按保存值应用。 */
    void restoreUserFonts().finally(() => {
      if (!cancelled) {
        applyAppearance(readAppearance());
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);
  return null;
}
