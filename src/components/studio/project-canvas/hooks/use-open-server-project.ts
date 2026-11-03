"use client";

// ── 「打开一个项目」的装配层（规范 17 §17.2 第②层）
// 界面能看见项目不等于本机能打开：侧栏/所有项目读并集，而这一跳读本地索引，
// 索引里没有就交回 null、闸门要求再建一个（ISSUE #1874）。
// 所以前置是「先把这一行拉到本机」；设为活跃 + 跳转与打开本地项目共用同一条出口。
// 拉不到（离线 / 服务端也没有）**不抛**：onClick 里抛就是无人接的 rejection，让页面照常渲染闸门。

import { useCallback } from "react";

import { hydrateProjectFromServer, setActive } from "~/lib/project-canvas/canvas-store";
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
