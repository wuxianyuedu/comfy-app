"use client";

// ── 「打开一个项目」的装配层（规范 17 §17.2 第②层）────────────────────────
//
// 界面能看见项目，不等于本机能打开它：
//   · 侧栏与「所有项目」那一屏读的是**并集**（`listProjectsWithServer`），
//     于是「服务端有一行、本机索引里没有」的项目看得见、点得着；
//   · 而打开它这一跳读的是本地索引（`getProject(id)`）—— 索引里没有就交回
//     null，页面的闸门照旧弹「先创建或选择一个项目」。用户对着一个**已经存在
//     的项目**，被要求再建一个（ISSUE #1874）。
//
// 所以这一跳的前置是「先把这一行拉到本机」；两个动作（设为活跃 + 落到项目主页）
// 与打开本地项目共用同一条出口，这里不重写一遍。
//
// 拉不到（离线 / 服务端也没有这一行）**不抛**：这是 `onClick` 里的一跳，抛出去
// 就是一句没人接的 unhandled rejection，用户看到的是「点了没反应」。让页面照旧
// 渲染闸门，用户至少看得见「现在没有项目」这件事。

import { useCallback } from "react";

import {
  hydrateProjectFromServer,
  setActive,
} from "~/lib/project-canvas/canvas-store";
import type { WorkspaceView } from "../../NavItems";

/** 打开某个项目（先把服务端那一行拉到本机，再设为活跃并跳到项目主页）。 */
export function useOpenServerProject(
  navigate: (view: WorkspaceView) => void,
): (id: string) => Promise<void> {
  return useCallback(
    async (id: string) => {
      await hydrateProjectFromServer(id);
      setActive(id);
      navigate("project");
    },
    [navigate],
  );
}
