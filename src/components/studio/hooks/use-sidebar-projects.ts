"use client";

// ── 侧栏「项目」分组的逻辑层（规范 17 §17.2 第②层）──────────────────────
//
// 取数与 `~/components/studio/works/hooks/use-works-gallery` 同一支：都读
// `listProjectsWithServer()` 的**并集**（本地索引 ∪ 服务端）。
//
// 为什么侧栏不能只读本地索引（`listProjects()`）：索引是 `hydrateFromServer`
// 对账**之后**的本地副本，而画布页没打开过就没有那次对账 —— 于是「服务端有一行、
// 索引里没有」的项目在「所有项目」那一屏看得见（那一屏读并集，ISSUE #1522）、
// 侧栏却一条都不列，读起来就是「明明有项目，侧栏看不见」。
//
// 拉取失败（离线 / dev server 未起）仍照常列出本地索引那一份：本地索引是离线时
// 唯一有的那一份（local-first 的承诺），失败的表现只是少了服务端独有的那几行，
// 不是整组清空。

import { useEffect, useState } from "react";

import { subscribeAppEvent } from "~/lib/app-events";
import { listProjectsWithServer } from "~/lib/project-canvas/canvas-store";

/** 侧栏里列出的一条项目（与 `AppShell` 的 `SidebarProject` 同形）。 */
export type SidebarProjectEntry = {
  id: string;
  name: string;
};

/** 侧栏「项目」分组最多列几条 —— 列表长了该去「所有项目」那一屏看。 */
export const SIDEBAR_PROJECT_LIMIT = 8;

export function useSidebarProjects(): Array<SidebarProjectEntry> {
  const [projects, setProjects] = useState<Array<SidebarProjectEntry>>([]);

  useEffect(() => {
    let alive = true;
    const compute = () => {
      void listProjectsWithServer().then(({ entries }) => {
        /* 卸载后落定就别再 setState（`listProjectsWithServer` 是 async，
         * 快速切视图时这一帧可能已经不在）。 */
        if (!alive) {
          return;
        }
        setProjects(
          entries
            .slice(0, SIDEBAR_PROJECT_LIMIT)
            .map((project) => ({ id: project.id, name: project.name })),
        );
      });
    };
    compute();
    /* 与画布页 / 「所有项目」屏同一支刷新口径：编辑（upsert / rename / delete）
     * 会广播这一条，重取即可 —— 装配层不重复实现增量更新。 */
    const unsubscribe = subscribeAppEvent("comfyapp:canvas-store-changed", compute);
    return () => {
      alive = false;
      unsubscribe();
    };
  }, []);

  return projects;
}
