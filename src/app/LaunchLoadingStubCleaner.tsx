"use client";

import { useEffect } from "react";

import { clearLaunchLoadingStub } from "~/lib/shell/desktop-shell-client";

/**
 * 清掉桌面壳注入的启动期加载占位。
 *
 * 启动期主窗的画面归属见 `docs/standards/launch-and-build.md`「启动等待期画面
 * 唯一出口」：应用首帧之前由壳注入的占位顶着（浏览器里的 WebView2 空白页 /
 * Edge「无法访问此页面」错误页都不能露给用户），而它自带一个自我重贴的定时器
 * 来对抗错误页换掉整个 DOM。那一步只有应用自己能收尾——本组件挂载即调
 * `clearLaunchLoadingStub()`，把定时器与占位一起收掉。
 *
 * 挂在根布局（所有路由共用）：应用首帧就是根布局的挂载，晚一帧都会让占位多
 * 盖住一帧真界面。非壳环境（浏览器开发 / e2e）没有占位，调用是空操作。
 */
export function LaunchLoadingStubCleaner() {
  useEffect(() => {
    clearLaunchLoadingStub();
  }, []);
  return null;
}
