"use client";

// ── 侧栏「项目」分组的逻辑层（规范 17 §17.2 第②层）
// 取数与 use-works-gallery 同一支：读 `listProjectsWithServer()` 的并集（本地 ∪ 服务端）。
// 不能只读本地索引：index 是 hydrate 对账后的副本，画布页没开过就没有对账（ISSUE #1522）。
// 拉取失败仍列本地索引那一份（local-first），只是少了服务端独有行，不清空整组。

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
    const compute = () => {
      void listProjectsWithServer().then(({ entries }) => {
        /* 卸载后落定就别再 setState（`listProjectsWithServer` 是 async，
         * 快速切视图时这一帧可能已经不在）。 */
        if (!alive) {
          return;
        }
        const next = entries
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
      compute();
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
