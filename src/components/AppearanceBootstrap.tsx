"use client";

/**
 * 首帧应用已保存的外观偏好（圆角 / 标题字阶）。
 * 挂在根布局：这两档改全局 CSS 变量，只在设置页 setProperty 会在离开/刷新后悄悄失效
 *（半生效比没做更难查）。只在挂载后应用：服务端没有 localStorage，同 next-themes 口径。
 */
import { useEffect } from "react";

import { applyAppearance, readAppearance, restoreUserFonts } from "~/lib/appearance";
import { hydrateSizePresetsFromServer } from "~/lib/media/size-preset-store";
import { beginStaleRun } from "~/lib/stale-run";

export function AppearanceBootstrap() {
  useEffect(() => {
    const guard = beginStaleRun();
    /* 先恢复用户拖入的自定义字体（把它们重新注册进 document.fonts），再应用已保存的
       外观偏好 —— 这样偏好里引用的 family 名在首帧就已经能解析出字形，不用等闪一下
       回退栈。任一环节失败都不影响另一条：恢复出错时外观仍按保存值应用。 */
    void restoreUserFonts().finally(() => {
      guard.commit(() => {
        applyAppearance(readAppearance());
      });
    });
    /* 尺寸配置表从应用数据水合（ISSUE #3788）：画布 / 表单里的尺寸控件在首帧
       就读这份快照，水合完成后经订阅者换值。 */
    void hydrateSizePresetsFromServer();
    return () => {
      guard.dispose();
    };
  }, []);
  return null;
}
