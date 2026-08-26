"use client";

/**
 * useProjectManager — 项目画布「项目 CRUD + 项目列表 UI 状态」hook。
 *
 * 从 CanvasInner 抽出所有与项目生命周期相关的状态与动作：
 *  - 项目下拉菜单（projects / projMenu / openProjMenu）
 *  - 切换 / 新建 / 删除（含删除确认弹窗）/ 纯加载
 *  - 重命名（startRename / commitRename，含唯一化后缀）
 *
 * 切换 / 新建 / 重命名前的「保存当前项目」统一走 persistNow()
 * （draft-aware：空草稿回收而非落库），不再各自手写一份 upsert。
 * 删除走纯 loadProject（不保存已删除项目），语义与原来一致。
 */

import { useCallback, useState } from "react";
import type { Dispatch, SetStateAction } from "react";
import type { Edge, FitViewOptions } from "@xyflow/react";
import type { CanvasNodeType } from "./canvas-types";
import {
  clearActiveIfDraft,
  createDraftProject,
  deleteProject,
  findNextAvailableName,
  getProject,
  isEmptyDraftName,
  listProjects,
  reapEmptyProject,
  setActive,
  upsertProject,
  type CanvasProject,
} from "./canvas-store";
import { makeFitViewScheduler } from "./canvas-helpers";

export interface ProjectSnapshot {
  pid: string | null;
  name: string;
  nodes: CanvasNodeType[];
  edges: Edge[];
}

export interface UseProjectManagerOptions {
  /** 读取当前项目最新快照（由调用方用 refs 组装，避免闭包过期）。 */
  getCurrent: () => ProjectSnapshot;
  /** 切换 / 新建 / 重命名前「立即保存当前项目」（来自 useProjectPersistence）。 */
  persistNow: (nameOverride?: string) => void;
  setProjectId: Dispatch<SetStateAction<string | null>>;
  setProjectName: Dispatch<SetStateAction<string>>;
  setNodes: Dispatch<SetStateAction<CanvasNodeType[]>>;
  setEdges: Dispatch<SetStateAction<Edge[]>>;
  fitView: (options?: FitViewOptions) => void;
  toast: {
    info: (title: string, desc?: string) => void;
    error?: (title: string, desc?: string) => void;
    success?: (title: string, desc?: string) => void;
  };
}

export function useProjectManager(options: UseProjectManagerOptions) {
  const {
    getCurrent,
    persistNow,
    setProjectId,
    setProjectName,
    setNodes,
    setEdges,
    fitView,
    toast,
  } = options;

  const [projects, setProjects] = useState<CanvasProject[]>([]);
  const [projMenu, setProjMenu] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [renameVal, setRenameVal] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);

  /** 双 rAF fitView（替代 setTimeout(80ms) 魔法数字）。 */
  const requestFitView = useMemoScheduler(fitView);

  const closeMenus = useCallback(() => {
    setProjMenu(false);
    setRenaming(false);
  }, []);

  const openProjMenu = useCallback(() => {
    setProjects(listProjects());
    setRenaming(false);
    setProjMenu((value) => !value);
  }, []);

  const switchProject = useCallback(
    (id: string) => {
      const current = getCurrent();
      if (current.pid) {
        // 保存当前项目（draft-aware：空草稿回收而非落库）。
        persistNow();
      }
      const proj = getProject(id);
      if (!proj) return;
      setActive(id);
      setProjectId(proj.id);
      setProjectName(proj.name);
      setNodes((proj.nodes as CanvasNodeType[]) ?? []);
      setEdges(proj.edges ?? []);
      closeMenus();
      requestFitView();
    },
    [getCurrent, persistNow, setActive, setProjectId, setProjectName, setNodes, setEdges, closeMenus, requestFitView]
  );

  const newProject = useCallback(() => {
    const current = getCurrent();
    if (current.pid) {
      // 保存当前项目（draft-aware：空草稿回收而非落库）。
      persistNow();
    }
    // 新项目是 draft —— 只有用户真正产出内容后才落库。
    const p = createDraftProject();
    setProjectId(p.id);
    setProjectName(p.name);
    setNodes([]);
    setEdges([]);
    setProjects(listProjects());
    setProjMenu(false);
  }, [getCurrent, persistNow, setProjectId, setProjectName, setNodes, setEdges]);

  const deleteCurrent = useCallback(() => {
    const { pid } = getCurrent();
    if (!pid) return;
    // 自定义深色弹窗（R65），不用浏览器原生 confirm。
    setConfirmDelete(true);
  }, [getCurrent]);

  /**
   * 纯加载：从索引读项目并 hydrate 本地状态 —— 不先保存当前项目。
   * 用于删除当前项目后（其 id 已失效）或任何「再次保存当前项目是错误」的流程。
   * 与 switchProject 相反：切换下拉里要先保存再加载目标。
   */
  const loadProject = useCallback(
    (id: string) => {
      const proj = getProject(id);
      if (!proj) return;
      setActive(id);
      setProjectId(proj.id);
      setProjectName(proj.name);
      setNodes((proj.nodes as CanvasNodeType[]) ?? []);
      setEdges(proj.edges ?? []);
      closeMenus();
      requestFitView();
    },
    [setActive, setProjectId, setProjectName, setNodes, setEdges, closeMenus, requestFitView]
  );

  /** 删除确认弹窗的实际动作。 */
  const applyDeleteCurrent = useCallback(() => {
    const { pid } = getCurrent();
    if (!pid) return;
    // 先从索引删除。注意 projectIdRef 仍持有刚删除的 id，因此绝不能走
    // switchProject（会把死 id 重新落库、复活项目），而是用纯 loadProject。
    deleteProject(pid);
    const remaining = listProjects();
    if (remaining.length) {
      loadProject(remaining[0]!.id);
    } else {
      // 无项目了 —— 打开全新 draft（用户添加内容前不写行）。
      const p = createDraftProject();
      setProjectId(p.id);
      setProjectName(p.name);
      setNodes([]);
      setEdges([]);
    }
    setProjects(listProjects());
    setProjMenu(false);
    setConfirmDelete(false);
  }, [getCurrent, loadProject, setProjectId, setProjectName, setNodes, setEdges]);

  const startRename = useCallback(() => {
    setRenameVal(getCurrent().name);
    setRenaming(true);
  }, [getCurrent]);

  const commitRename = useCallback(() => {
    const { pid } = getCurrent();
    if (!pid) return;
    const rawName = renameVal.trim();
    // 输入被清空时回退默认「未命名」并走唯一化管线，
    // 得到「未命名」「未命名_2」…而不是覆盖兄弟项目。
    const baseName = rawName || "未命名";
    const finalName = findNextAvailableName(baseName, pid);
    setProjectName(finalName);
    // 用显式名字覆盖持久化（ref 尚未同步到 finalName），
    // draft-aware：空画布 + 默认名 → 回收而非落库。
    persistNow(finalName);
    // R65: 自动重命名要让用户知道「灵感」为何变成「灵感_2」。
    if (finalName !== baseName) {
      toast.info("已自动添加后缀", `项目名「${baseName}」已被占用，已保存为「${finalName}」。`);
    }
    setRenaming(false);
    setProjMenu(false);
    setProjects(listProjects());
  }, [renameVal, getCurrent, setProjectName, persistNow, toast]);

  return {
    projects,
    projMenu,
    renaming,
    renameVal,
    confirmDelete,
    setProjMenu,
    setRenaming,
    setRenameVal,
    setConfirmDelete,
    openProjMenu,
    switchProject,
    newProject,
    deleteCurrent,
    applyDeleteCurrent,
    loadProject,
    startRename,
    commitRename,
  };
}

/** 双 rAF fitView 调度器（模块内小工具，避免与 CanvasInner 重复）。 */
function useMemoScheduler(fitView: (options?: FitViewOptions) => void) {
  return makeFitViewScheduler(fitView);
}
