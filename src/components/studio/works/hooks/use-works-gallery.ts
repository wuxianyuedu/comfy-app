"use client";

// ── 「所有项目」屏的逻辑层（规范 17 §17.2 第②层）──────────────────────────
//
// 这一屏原本在组件里直接读 `listProjects()` + `deleteProject()`（本地索引那一侧），
// 于是**「服务端有一行、索引里没有」的项目在界面上既看不见、也删不掉**
//（ISSUE #1522 问的正是这个口子）。现在取数走 `listProjectsWithServer()` 的并集，
// 删除走 `deleteProjectEverywhere()`（索引里没有的那一行也删得掉）。
//
// 三条口径：
//   · 列表 = 本地索引 ∪ 服务端，按 `updatedAt` 倒序（同 id 取较新的一侧）；
//   · 每一行标 `origin`（服务端独有 / 本地独有 / 两侧都有），视图据此如实说明
//     这一行从哪来 —— 「服务端有但本地没有」必须看得出口，否则用户删完一个
//     不该删的才发现删的是什么；
//   · 拉取失败（离线 / dev server 未起）照常列本地项目，只是 `serverOk` 为 false，
//     视图据此给一句「服务端那份没拉到」，而不是把空列表端上去。

import { useCallback, useEffect, useState } from "react";

import { subscribeAppEvent } from "~/lib/app-events";
import { useSyncRefusalNotice } from "../../project-canvas/hooks/use-sync-refusal-notice";
import {
  deleteProjectEverywhere,
  listProjectsWithServer,
  reapAllEmptyDrafts,
  type ProjectListEntry,
} from "~/lib/project-canvas/canvas-store";

export interface WorksGalleryController {
  /** 要渲染的全部项目行（并集，倒序）。 */
  projects: ProjectListEntry[];
  /** 首次取数完成前为真（视图显示加载态，而不是「还没有项目」）。 */
  loading: boolean;
  /** 服务端列表这一轮拉到了没有。false ⇒ 视图给一句降级说明。 */
  serverOk: boolean;
  /** 打开某个项目（由容器接线到 workspace 的「设为活跃 + 跳主页」）。 */
  openProject: (id: string) => void;
  /** 请求删除某个项目（弹确认框；真正删除在 `confirmDelete` 里）。 */
  requestDelete: (id: string) => void;
  /** 确认框开关 + 目标行。 */
  pendingDelete: ProjectListEntry | null;
  cancelDelete: () => void;
  /** 确认删除。落定后返回被删那一行的名字（toast 用；没有目标则 null）。 */
  confirmDelete: () => Promise<string | null>;
  /** 正在删（确认框的 spinner 态）。 */
  deleting: boolean;
  /** 手动重取一次。 */
  refresh: () => void;
}

export function useWorksGallery(
  onOpenProject?: (id: string) => void,
): WorksGalleryController {
  const [projects, setProjects] = useState<ProjectListEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [serverOk, setServerOk] = useState(true);
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);

  /* 服务端明确拒收时的用户可见出口（硬规则 4）。这一屏是**发起删除**的那一页，
   * 所以它得自己说得出「没能从服务端删掉」—— 否则失败的表现就是「删了没反应」
   * （此前那是画布页的 hook 管的，而这一屏上没有它）。 */
  useSyncRefusalNotice();

  const load = useCallback(async (): Promise<void> => {
    const { entries, ok } = await listProjectsWithServer();
    setProjects(entries);
    setServerOk(ok);
    setLoading(false);
  }, []);

  useEffect(() => {
    /* 列之前先清掉遗留的空默认名草稿（挂载时的一次性清扫，与工作区首页同口径）。
     * 它现在**两侧一起删**（ISSUE #1501 修的就是这个），所以这里不会再攒出
     * 「服务端有、本地没有」的新孤儿。 */
    reapAllEmptyDrafts();
    /* 挂载即取一次并集。这里 setState 在**异步回调**里落定（`listProjectsWithServer`
     * 是 async），首帧仍是 `loading: true` 的那一态，与 SSR 输出一致；
     * 规则认的是「effect 体里同步调了一个会 setState 的函数」，而那条判据要防的
     * 是级联渲染 —— 这个调用点不产生它（同一约定见 `use-workspace-tabs`）。 */
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
    /* 画布内的编辑（upsert / rename / delete）会广播这一条，重取即可 ——
     * 装配层不重复实现增量更新。 */
    return subscribeAppEvent("comfyapp:canvas-store-changed", () => {
      void load();
    });
  }, [load]);

  const openProject = useCallback(
    (id: string) => {
      onOpenProject?.(id);
    },
    [onOpenProject],
  );

  const requestDelete = useCallback((id: string) => {
    setPendingDeleteId(id);
  }, []);

  const cancelDelete = useCallback(() => {
    if (deleting) return;
    setPendingDeleteId(null);
  }, [deleting]);

  const confirmDelete = useCallback(async (): Promise<string | null> => {
    if (!pendingDeleteId) return null;
    const target = projects.find((project) => project.id === pendingDeleteId);
    const id = pendingDeleteId;
    setDeleting(true);
    try {
      /* 用 `deleteProjectEverywhere` 而不是 `deleteProject`：前者对
       * 「索引里没有、只在服务端」的行才有行为（那正是这一屏新增的那一类）。 */
      deleteProjectEverywhere(id, target?.name);
      /* 广播是 `deleteProjectEverywhere` 发的（`comfyapp:canvas-store-changed`），
       * 上面那个订阅会重取；但索引里没有的那一行**不进**索引，重取仍然会从
       * 服务端列表里把它带回来直到删除落定 —— 所以这里本地先摘掉，
       * 免得好几秒内列表上它还挂着（用户以为没删掉、又点一次）。 */
      setProjects((prev) => prev.filter((project) => project.id !== id));
      return target?.name ?? "未命名";
    } finally {
      setDeleting(false);
      setPendingDeleteId(null);
    }
  }, [pendingDeleteId, projects]);

  const pendingDelete =
    projects.find((project) => project.id === pendingDeleteId) ?? null;

  return {
    projects,
    loading,
    serverOk,
    openProject,
    requestDelete,
    pendingDelete,
    cancelDelete,
    confirmDelete,
    deleting,
    refresh: () => void load(),
  };
}
