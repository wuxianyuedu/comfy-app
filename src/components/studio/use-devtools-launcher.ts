"use client";

/**
 * 「打开开发者工具」入口 —— 壳有没有带 `devtools` feature、开它的动作、以及快捷键。
 *
 * ## 能力判据在编译期，前端只能问
 *
 * Tauri 的 `open_devtools()` 门在 `#[cfg(any(debug_assertions, feature = "devtools"))]`
 * 后面，而本仓库的壳一律是 `cargo build --release` 编的（`debug_assertions` 恒为
 * false）——**有没有 `devtools` feature 才是唯一判据**，前端猜不出来，只能问壳
 * （`devtools_available`）。一次会话内不变（feature 是编译期的），挂载时问一次即可。
 *
 * 入口在发布壳里**整个不出现**：能力为 false 时既不渲染按钮、也不注册快捷键 ——
 * 强于「渲染出来点一下报『未启用 devtools』」。
 *
 * ## 快捷键为什么在前端而不是壳侧
 *
 * 两个入口（按钮 / 快捷键）指向同一个壳命令，判据只有一处。快捷键走项目既有的
 * `useHotkey` 基元（规范 16 §16.2.4.23 / P20 唯一出口），而不是壳里注入 JS 监听：
 * 后者要靠私有的页面加载事件在每次导航后重挂（壳内 splash → 应用 URL 的导航会换掉
 * 整个文档），而 React 侧随挂载自动跨导航生效。
 *
 * `enabled: available` 还有个必要副作用：**浏览器里（纯 web / `pnpm dev`）不注册**，
 * 于是 Ctrl/⌘+Shift+I / F12 保持浏览器自己的 DevTools 行为不被 `preventDefault` 抢走。
 *
 * `filterInput: false`：焦点在输入框里也要能开（开发者工具与文本编辑无关）。
 */

import { useCallback, useEffect, useState } from "react";

import { useHotkey } from "~/components/ui/use-hotkey";
import { devtoolsAvailable, openDevtools } from "~/lib/shell/desktop-shell-client";
import { beginStaleRun } from "~/lib/stale-run";

export type DevtoolsLauncher = {
  /** 这个壳是否带调试能力（决定入口渲不渲染 / 快捷键注不注册）。挂载前为 false。 */
  available: boolean;
  /** 打开开发者工具；失败已静默降级（调试动作不该弹错误打断当前操作）。 */
  open: () => void;
};

export function useDevtoolsLauncher(): DevtoolsLauncher {
  const [available, setAvailable] = useState(false);

  useEffect(() => {
    /* 守卫走 `~/lib/stale-run` 的唯一出口（规范 16 §16.2.4.34 / P31）：
       卸载后到达的能力查询结果不该再回写状态。 */
    const guard = beginStaleRun();
    void devtoolsAvailable().then((ok) => {
      guard.commit(() => setAvailable(ok));
    });
    return () => guard.dispose();
  }, []);

  const open = useCallback(() => {
    void openDevtools();
  }, []);

  useHotkey({ key: "i", mod: true, shift: true }, open, {
    enabled: available,
    filterInput: false,
  });
  /* F12 是浏览器与各家工具的通用「开 DevTools」键，一并支持。 */
  useHotkey({ key: "F12" }, open, {
    enabled: available,
    filterInput: false,
  });

  return { available, open };
}
