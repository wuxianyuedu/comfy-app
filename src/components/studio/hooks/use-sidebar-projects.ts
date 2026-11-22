"use client";

// ── 侧栏「项目」分组的逻辑层（规范 17 §17.2 第②层）
// 取数与 use-works-gallery 同一支：读 `listProjectsWithServer()` 的并集（本地 ∪ 服务端）。
// 不能只读本地索引：index 是 hydrate 对账后的副本，画布页没开过就没有对账（ISSUE #1522）。
// ISSUE #4765 起**只列服务端已有的项目**（origin ≠ local），与「所有项目」屏同一口径；
// 本地刚建、还没推上去的行不列，等首推成功的事件把它带回来。

import { useEffect, useRef, useState } from "react";

import { subscribeAppEvent } from "~/lib/app-events";
import { getProject, listProjectsWithServer } from "~/lib/project-canvas/canvas-store";

/** 侧栏里列出的一条项目（与 `AppShell` 的 `SidebarProject` 同形）。 */
export type SidebarProjectEntry = {
  id: string;
  name: string;
};

/** 侧栏「项目」分组最多列几条 —— 列表长了该去「所有项目」那一屏看。 */
export const SIDEBAR_PROJECT_LIMIT = 8;

export function useSidebarProjects(): Array<SidebarProjectEntry> {
  const [projects, setProjects] = useState<Array<SidebarProjectEntry>>([]);
  /* 事件回调里要基于「当前列表」做增量判断，state 闭包会过期 —— 镜像一份。 */
  const projectsRef = useRef<Array<SidebarProjectEntry>>([]);
  useEffect(() => {
    projectsRef.current = projects;
  }, [projects]);

  useEffect(() => {
    let alive = true;
    /* `coalesce` 只给事件触发的那一跳（ISSUE #4678）：结构性事件与作品库共用
     * 同一短 TTL 在飞请求，不再两路各发一次 `project.list`；挂载首拉不带它，
     * 永远拿新鲜读数。 */
    const compute = (coalesce = false) => {
      void listProjectsWithServer({ coalesce }).then(({ entries }) => {
        /* 卸载后落定就别再 setState（`listProjectsWithServer` 是 async，
         * 快速切视图时这一帧可能已经不在）。 */
        if (!alive) {
          return;
        }
        /* 只列服务端已有的行（ISSUE #4765，与「所有项目」屏同一口径）：
         * 本地刚建、还没推上去的项目不进侧栏，等首推成功的事件带回来。 */
        const next = entries
          .filter((project) => project.origin !== "local")
          .slice(0, SIDEBAR_PROJECT_LIMIT)
          .map((project) => ({ id: project.id, name: project.name }));
        projectsRef.current = next;
        setProjects(next);
      });
    };
    /* 自动保存（save）就地改那一行，不再全量重拉并集（ISSUE #4600）：保存
     * 不改变「服务端有哪些行」，侧栏只消费 id/name——名字没变连 setState
     * 都省掉（复用旧引用，避免每 500ms 一拍的无谓重渲染）。不在当前列表里
     * 的行（可能刚挤进前 8）与结构性变化（增删 / 对账 / 建草稿）才重取。 */
    const applySave = (projectId: string): boolean => {
      const project = getProject(projectId);
      if (project === null) {
        /* 本地索引里没有这一行（server-only / 刚被删）：交给全量重取。 */
        return false;
      }
      const prev = projectsRef.current;
      const idx = prev.findIndex((entry) => entry.id === projectId);
      const current = prev[idx];
      if (idx === -1 || current === undefined) {
        /* 不在侧栏窗口里：updatedAt 刚被顶上去，可能挤进前 8，重取一次。 */
        return false;
      }
      if (current.name === project.name) {
        return true;
      }
      const next = [...prev];
      next[idx] = { id: project.id, name: project.name };
      projectsRef.current = next;
      setProjects(next);
      return true;
    };
    const onChanged = (payload: { projectId?: string; reason: string }): void => {
      if (
        payload.reason === "save" &&
        payload.projectId !== undefined &&
        applySave(payload.projectId)
      ) {
        return;
      }
      /* 「hydrate」= 服务端项目集合刚变（首推成功 / 对账回来）：必须拿**新鲜**读数
       * —— 走合并窗会复用推送落地前发起的在飞请求，新建的项目就永远进不了
       * 侧栏（ISSUE #4819）。其余结构性事件保持合并（ISSUE #4678 的省请求口径）。 */
      compute(payload.reason !== "hydrate");
    };
    compute();
    /* 与画布页 / 「所有项目」屏同一支刷新口径：编辑（upsert / rename / delete）
     * 会广播这一条 —— 结构性变化重取，自动保存就地改行。 */
    const unsubscribe = subscribeAppEvent("comfyapp:canvas-store-changed", onChanged);
    return () => {
      alive = false;
      unsubscribe();
    };
  }, []);

  return projects;
}
