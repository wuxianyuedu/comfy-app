"use client";

import { useEffect } from "react";

import { clearLaunchLoadingStub } from "~/lib/shell/desktop-shell-client";

/**
 * 清掉桌面壳注入的启动期加载占位：启动期主窗的画面归属见 `docs/standards/launch-and-build.md`「启动等待期画面唯一出口」——首帧之前由壳注入的占位顶着
 *（WebView2 空白页 / Edge「无法访问此页面」错误页都不能露给用户），它自带对抗错误页换掉整个 DOM 的自我重贴定时器，只有应用自己能收尾。挂载即调 `clearLaunchLoadingStub()`；
 * 挂在根布局（所有路由共用，应用首帧即根布局挂载，晚一帧会让占位多盖一帧真界面）；非壳环境（浏览器开发 / e2e）没有占位，调用是空操作。
 */
export function LaunchLoadingStubCleaner() {
  useEffect(() => {
    clearLaunchLoadingStub();
  }, []);
  return null;
}
