"use client";

// ── 「所有项目」屏逻辑层（规范 17 §17.2 第②层）──
// 取数走 listProjectsWithServer() 并集，删除走 deleteProjectEverywhere()。
// ISSUE #4765 起**只显示服务端已有的项目**（origin ≠ local）：本地还没推上去的
// 草稿不再列出（新建入口已改为「先命名、确认后再创建」，创建即推服务端，
// 首推成功会广播事件让本屏取回这一行）。拉取失败 serverOk=false，视图给一句
// 降级说明，而不是把空列表说成「没有项目」。

import { useCallback, useEffect, useRef, useState } from "react";

import { subscribeAppEvent } from "~/lib/app-events";
import { useSyncRefusalNotice } from "../../project-canvas/hooks/use-sync-refusal-notice";
import {
  deleteProjectEverywhere,
  getProject,
  listProjectsWithServer,
  reapAllEmptyDrafts,
  type ProjectListEntry,
} from "~/lib/project-canvas/canvas-store";

export type WorksGalleryController = {
  cancelDelete: () => void;
  /** 确认删除。落定后返回被删那一行的名字（toast 用；没有目标则 null）。 */
  confirmDelete: () => Promise<string | null>;
  /** 正在删（确认框的 spinner 态）。 */
  deleting: boolean;
  /** 首次取数完成前为真（视图显示加载态，而不是「还没有项目」）。 */
  loading: boolean;
  /** 打开某个项目（由容器接线到 workspace 的「设为活跃 + 跳主页」）。 */
  openProject: (id: string) => void;
  /** 确认框开关 + 目标行。 */
  pendingDelete: ProjectListEntry | null;
  /** 要渲染的全部项目行（并集，倒序）。 */
  projects: Array<ProjectListEntry>;
  /** 手动重取一次。 */
  refresh: () => void;
  /** 请求删除某个项目（弹确认框；真正删除在 `confirmDelete` 里）。 */
  requestDelete: (id: string) => void;
  /** 服务端列表这一轮拉到了没有。false ⇒ 视图给一句降级说明。 */
  serverOk: boolean;
};

export function useWorksGallery(onOpenProject?: (id: string) => void): WorksGalleryController {
  const [projects, setProjects] = useState<Array<ProjectListEntry>>([]);
  const [loading, setLoading] = useState(true);
  const [serverOk, setServerOk] = useState(true);
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  /* 卸载守卫（#4239）：快速切视图时 load 的回包可能晚于卸载——与
   * use-sidebar-projects 同款 alive 判据，卸载后不落地。 */
  const aliveRef = useRef(true);

  /* 服务端明确拒收时的用户可见出口（硬规则 4）。这一屏是**发起删除**的那一页，
   * 所以它得自己说得出「没能从服务端删掉」—— 否则失败的表现就是「删了没反应」
   * （此前那是画布页的 hook 管的，而这一屏上没有它）。 */
  useSyncRefusalNotice();

  /* `coalesce` 只给事件触发的那一跳（ISSUE #4678）：结构性事件与侧栏共用
   * 同一短 TTL 在飞请求，不再两路各发一次 `project.list`；挂载首拉与手动
   * `refresh()` 不带它，永远拿新鲜读数。 */
  const load = useCallback(async (coalesce = false): Promise<void> => {
    const { entries, ok } = await listProjectsWithServer({ coalesce });
    if (!aliveRef.current) {
      return;
    }
    /* 只列服务端已有的行（ISSUE #4765）：本地刚建、还没推上去的项目不进本屏，
     * 等首推成功的事件把它带回来。 */
    setProjects(entries.filter((entry) => entry.origin !== "local"));
    setServerOk(ok);
    setLoading(false);
  }, []);

  /* 事件回调里要基于「当前列表」做增量判断，state 闭包会过期 —— 镜像一份。 */
  const projectsRef = useRef<Array<ProjectListEntry>>([]);
  useEffect(() => {
    projectsRef.current = projects;
  }, [projects]);

  useEffect(() => {
    /* StrictMode 双挂载（挂载 → 卸载 → 再挂载）共用这一个 ref：上一次卸载把它
     * 置 false 后，这次 effect 不先复活的话，本次 `load()` 的回包会被「上一次
     * 已卸载」的状态误丢 —— 网络正常、无报错，列表却永久停在「正在读取项目列表…」
     * （ISSUE #4781）。每个 effect 运行周期先复活判活标记，与 use-agent-run /
     * use-console 等同族 hook 的写法对齐；卸载守卫语义（#4239）不变。 */
    aliveRef.current = true;
    /* 列之前先清掉遗留的空默认名草稿（挂载时的一次性清扫，与工作区首页同口径）。
     * 它现在**两侧一起删**（ISSUE #1501 修的就是这个），所以这里不会再攒出
     * 「服务端有、本地没有」的新孤儿。 */
    reapAllEmptyDrafts();
    /* 挂载即取一次并集。这里 setState 在**异步回调**里落定（`listProjectsWithServer`
     * 是 async），首帧仍是 `loading: true` 的那一态，与 SSR 输出一致；
     * 规则认的是「effect 体里同步调了一个会 setState 的函数」，而那条判据要防的
     * 是级联渲染 —— 这个调用点不产生它（同一约定见 `use-workspace-tabs`）。 */
    void load();
    /* 自动保存（save）就地改那一行，不再全量重拉并集（ISSUE #4600）：画布
     * 编辑期每 500ms 一拍，画廊只在该行真的变化时换引用；结构性变化
     * （增删 / 对账 / 建草稿）与「不在当前列表里的行」才重取。 */
    const applySave = (projectId: string): boolean => {
      const project = getProject(projectId);
      if (project === null) {
        return false;
      }
      const prev = projectsRef.current;
      const idx = prev.findIndex((entry) => entry.id === projectId);
      const before = prev[idx];
      if (idx === -1 || before === undefined) {
        return false;
      }
      if (before.name === project.name && before.updatedAt === project.updatedAt) {
        return true;
      }
      const next = [...prev];
      next[idx] = { ...project, origin: before.origin };
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
      /* 结构性事件：与侧栏共用的短 TTL 合并取数（ISSUE #4678）。 */
      void load(true);
    };
    const unsubscribe = subscribeAppEvent("comfyapp:canvas-store-changed", onChanged);
    return () => {
      aliveRef.current = false;
      unsubscribe();
    };
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
    if (deleting) {
      return;
    }
    setPendingDeleteId(null);
  }, [deleting]);

  const confirmDelete = useCallback((): Promise<string | null> => {
    if (pendingDeleteId === null || pendingDeleteId === "") {
      return Promise.resolve(null);
    }
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
      return Promise.resolve(target?.name ?? "未命名");
    } finally {
      setDeleting(false);
      setPendingDeleteId(null);
    }
  }, [pendingDeleteId, projects]);

  const pendingDelete = projects.find((project) => project.id === pendingDeleteId) ?? null;

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
    refresh: () => {
      void load();
    },
  };
}
