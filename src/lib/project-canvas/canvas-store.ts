/* ── 画布项目持久化（可命名、可多个） ──
 * 用一套「项目索引」取代旧的单草稿 localStorage 键，
 * 让用户可以保留多个命名画布并安全切换。
 */

import type { Edge } from "@xyflow/react";
import type { CanvasNodeType } from "~/lib/project-canvas/canvas-types";
import { vanillaApi } from "~/trpc/vanilla";

export interface CanvasProject {
  id: string;
  name: string;
  updatedAt: number;
  /** 收窄为 CanvasNodeType：workflowArdot 纯视觉节点也持久化（起）。 */
  nodes: CanvasNodeType[];
  edges: Edge[];
}

const INDEX_KEY = "comfyapp.canvas.projects.v1";
const ACTIVE_KEY = "comfyapp.canvas.active.v1";
/* 每次画布仓库变更（upsert / delete / create）都会广播的事件名。
 * 订阅它的页面（例如工作区首页）会重读仓库，刷新依赖它的视图
 *（最近项目、切换器标签等）。 */
const CHANGED_EVENT = "comfyapp:canvas-store-changed";

function emitChanged() {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event(CHANGED_EVENT));
  }
}

function safeParse<T>(raw: string | null, fallback: T): T {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

export function listProjects(): CanvasProject[] {
  if (typeof localStorage === "undefined") return []; // SSR guard
  const all = safeParse<CanvasProject[]>(localStorage.getItem(INDEX_KEY), []);
  return all.sort((left, right) => right.updatedAt - left.updatedAt);
}

export function getProject(id: string): CanvasProject | null {
  if (typeof localStorage === "undefined") return null; // SSR guard
  const all = safeParse<CanvasProject[]>(localStorage.getItem(INDEX_KEY), []);
  return all.find((all) => all.id === id) ?? null;
}

/* 直写到服务端。尽力而为：失败被吞掉，网络/服务端不稳时绝不阻塞本地优先的界面。
 * 每次有意义的变更都会从 `upsertProject` 调它，于是服务端副本在换端口 / 换设备时
 * 也保持同步（单靠 localStorage 是按来源隔离的，换端口时数据会静默丢失，
 * 例如从 3100 换到 3102）。
 */
async function persistProjectToServer(p: CanvasProject): Promise<void> {
  if (typeof window === "undefined") return;
  try {
    await vanillaApi.project.upsert.mutate({
      id: p.id,
      name: p.name,
      nodes: p.nodes ?? [],
      edges: p.edges ?? [],
    });
  } catch {
    /* 离线或服务端挂了 —— localStorage 里已经有了 */
  }
}

/* 在服务端硬删除（尽力而为）。与 `deleteProject` 对应。
 */
function deleteProjectOnServer(id: string): void {
  if (typeof window === "undefined") return;
  vanillaApi.project.delete.mutate({ projectId: id }).catch(() => undefined);
}

export function upsertProject(p: CanvasProject): void {
  if (typeof localStorage === "undefined") return; // SSR guard
  const all = safeParse<CanvasProject[]>(localStorage.getItem(INDEX_KEY), []);
  const idx = all.findIndex((item) => item.id === p.id);
  const next: CanvasProject = { ...p, updatedAt: Date.now() };
  if (idx >= 0) all[idx] = next;
  else all.push(next);
  localStorage.setItem(INDEX_KEY, JSON.stringify(all));
  emitChanged();
  // 同步到服务端（持久、跨来源的存储）。不阻塞。
  void persistProjectToServer(next);
}

export function deleteProject(id: string): void {
  if (typeof localStorage === "undefined") return; // SSR guard
  const all = safeParse<CanvasProject[]>(
    localStorage.getItem(INDEX_KEY),
    [],
  ).filter((project) => project.id !== id);
  localStorage.setItem(INDEX_KEY, JSON.stringify(all));
  if (getActiveId() === id) localStorage.removeItem(ACTIVE_KEY);
  emitChanged();
  // 尽力在服务端也删掉。
  deleteProjectOnServer(id);
}

/* 拉取服务端的项目列表，并与 localStorage 对账：
 *   - 服务端项目的 `updatedAt` 比本地新时以服务端为准
 *    （覆盖「换端口 / 换设备后本地为空或是旧数据」的情形）。
 *   - 只存在于本地的项目（从未同步过）会被推上服务端，
 *     让本次修复上线后第一次访问时既有数据不丢。
 * 画布挂载时调一次，且在读取当前活动项目之前 ——
 * 于是画布加载的是合并后的索引。
 */
let hydrated = false;
export async function hydrateFromServer(): Promise<void> {
  if (typeof window === "undefined") return;
  if (hydrated) return;
  hydrated = true;
  try {
    const serverProjects = (await vanillaApi.project.list.query()) as Array<{
      id: string;
      name: string;
      updatedAt: string | Date; // Date via SuperJSON / ISO from REST
      nodes?: unknown;
      edges?: unknown;
    }>;
    const localAll = safeParse<CanvasProject[]>(
      localStorage.getItem(INDEX_KEY),
      [],
    );
    const byId = new Map(localAll.map((localAll) => [localAll.id, localAll]));
    let changed = false;
    for (const sp of serverProjects) {
      const serverTime = new Date(sp.updatedAt).getTime();
      const local = byId.get(sp.id);
      if (!local || serverTime >= local.updatedAt) {
        byId.set(sp.id, {
          id: sp.id,
          name: sp.name,
          updatedAt: serverTime,
          nodes: (sp.nodes as CanvasProject["nodes"]) ?? [],
          edges: (sp.edges as CanvasProject["edges"]) ?? [],
        });
        changed = true;
      }
    }
    // 把只存在于本地的项目推上去（迁移修复前的数据）。
    for (const lp of localAll) {
      if (!serverProjects.some((sp) => sp.id === lp.id)) {
        void persistProjectToServer(lp);
      }
    }
    if (changed || localAll.length > 0) {
      const merged = [...byId.values()].sort(
        (left, right) => right.updatedAt - left.updatedAt,
      );
      localStorage.setItem(INDEX_KEY, JSON.stringify(merged));
      emitChanged();
    }
  } catch {
    hydrated = false;
  }
}

/* 新建草稿项目的默认名。它同时是 `reapEmptyProject` 用的哨兵：
 * 只有当项目「零节点零连线**且**名字等于该字面量」时，
 * 才算是可安全回收的空草稿。
 * 用户自己命名的空项目（他确实有意保存了一个空画布）**不会**被回收。 */
export const EMPTY_DRAFT_NAMES = ["未命名"] as const;
export const EMPTY_DRAFT_NAME = EMPTY_DRAFT_NAMES[0];

/* 当且仅当 `name` 是空草稿哨兵名时为真。用它代替在每个回收判据里
 * 硬编码「未命名」，让默认名只有一处事实源、不会漂移。 */
export function isEmptyDraftName(name: string | undefined | null): boolean {
  if (!name) return false;
  return name === EMPTY_DRAFT_NAME;
}

/**
 * 返回索引里所有项目当前已占用的名字集合。调用方据此检查
 * `taken.has(name.trim())` 判断是否重名，或用 `findNextAvailableName(base)`
 * 取一个不冲突的变体。`excludeId` 会被排除，
 * 好让重命名场景能问「如果我用这个名字，会不会和别人撞」。
 */
export function getAllProjectNames(excludeId?: string): Set<string> {
  const all = listProjects();
  const set = new Set<string>();
  for (const p of all) if (p.id !== excludeId) set.add(p.name.trim());
  return set;
}

/* 便捷判据：这个名字是否已被别的项目占用？ */
export function isProjectNameTaken(name: string, excludeId?: string): boolean {
  const taken = getAllProjectNames(excludeId);
  return taken.has(name.trim());
}

/**
 * 返回 `base` 的下一个不冲突变体：
 *   - `base` 本身就空闲 → 直接返回 `base`。
 *   - 否则依次试 `base_2`、`base_3` … 直到找到空闲的。
 *   - 举例：当已占用的是「未命名」「未命名_2」，而 `base` 是「未命名」时，
 *     这里返回「未命名_3」。
 *   - `base` 为空或只有空白 → 回落到 `EMPTY_DRAFT_NAME`。
 *
 * 只看索引；在变更之前调用是安全的，
 * 因为 `commitRename` / `upsertProject` 里的 upsert 紧跟在它之后同步执行。
 */
export function findNextAvailableName(
  base: string,
  excludeId?: string,
): string {
  const baseClean = base.trim() || EMPTY_DRAFT_NAME;
  const taken = getAllProjectNames(excludeId);
  if (!taken.has(baseClean)) return baseClean;
  // 匹配候选后缀末尾的「_<数字>」，避免 base 本身以「_<n>」结尾时
  // 陷入死循环 —— 例如用户
  // already named a project "灵感_3" and we start from "灵感_3", we'd
  // 否则会一直与它相撞，而不是找到下一个空闲槽位。
  let suffix = 2;

  while (true) {
    const candidate = `${baseClean}_${suffix}`;
    if (!taken.has(candidate)) return candidate;
    suffix += 1;
    if (suffix > 9999) {
      // 病态情形：撞了 10000 次。直接粘一段时间戳切片。
      return `${baseClean}_${Date.now().toString(36).slice(-4)}`;
    }
  }
}

export function createProject(name?: string): CanvasProject {
  const p: CanvasProject = {
    id: `proj_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    name: findNextAvailableName(name?.trim() ?? EMPTY_DRAFT_NAME),
    updatedAt: Date.now(),
    nodes: [],
    edges: [],
  };
  upsertProject(p);
  setActive(p.id);
  return p;
}

/**
 * 创建一个**只存在于 active-id 状态**的项目 —— 它**不**写进项目索引。
 * 用户点「新建项目」落到一张全新画布时用它：这样只是打开画布又走开、
 * 什么都没做的话，不会用空草稿污染「最近项目」列表。
 *
 * 用户一旦做出真实改动（拖拽 / 添加 / 连线 / 重命名），它就会「转正」：
 * ProjectCanvas 的自动持久化副作用会发现
 * `nodes.length === 0 && edges.length === 0` 不成立，随即调用 `upsertProject`，
 * 真正落库并广播变更。
 *
 * 若用户离开时草稿仍是空的，`reapEmptyDraft` 会把它从 active id 里删掉
 *（它本来就不在索引里）。
 */
export function createDraftProject(name?: string): CanvasProject {
  const p: CanvasProject = {
    id: `proj_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    name: findNextAvailableName(name?.trim() ?? EMPTY_DRAFT_NAME),
    updatedAt: Date.now(),
    nodes: [],
    edges: [],
  };
  setActive(p.id);
  emitChanged(); // so homepage re-reads the (unchanged) index
  return p;
}

/**
 * 忘掉当前草稿项目的 id，但不动索引。
 * 用户离开一张从未写过内容的崭新画布时调用。
 */
export function clearActiveIfDraft(pid: string): void {
  if (typeof localStorage === "undefined") return;
  if (getActiveId() === pid) localStorage.removeItem(ACTIVE_KEY);
}

/**
 * 当且仅当该项目是「空 + 默认名」时（见 `EMPTY_DRAFT_NAME`）从索引里移除它。
 * 确实回收了才返回 true。已命名 / 非空的项目**从不**被回收 ——
 * 于是用户特意命名成「空白灵感板」的空画布能在清回收中活下来。
 */
export function reapEmptyProject(pid: string): boolean {
  if (typeof localStorage === "undefined") return false;
  const all = safeParse<CanvasProject[]>(localStorage.getItem(INDEX_KEY), []);
  const p = all.find((all) => all.id === pid);
  if (!p) return false;
  if (p.name !== EMPTY_DRAFT_NAME) return false;
  if ((p.nodes?.length ?? 0) > 0 || (p.edges?.length ?? 0) > 0) return false;
  deleteProject(pid);
  return true;
}

/**
 * 清扫项目索引里遗留的空草稿 —— 可能是旧版编辑器留下的，
 * 也可能是用户在本次修复前回访时留下的。返回移除的条数。
 * 画布挂载时调一次，首页挂载时再调一次。
 */
export function reapAllEmptyDrafts(): number {
  if (typeof localStorage === "undefined") return 0;
  const all = safeParse<CanvasProject[]>(localStorage.getItem(INDEX_KEY), []);
  const survivors = all.filter(
    (project) =>
      project.name !== EMPTY_DRAFT_NAME ||
      (project.nodes?.length ?? 0) > 0 ||
      (project.edges?.length ?? 0) > 0,
  );
  const removed = all.length - survivors.length;
  if (removed > 0) {
    localStorage.setItem(INDEX_KEY, JSON.stringify(survivors));
    if (
      getActiveId() &&
      !survivors.some((survivor) => survivor.id === getActiveId())
    ) {
      localStorage.removeItem(ACTIVE_KEY);
    }
    emitChanged();
  }
  return removed;
}

export function setActive(id: string): void {
  if (typeof localStorage === "undefined") return; // SSR guard
  localStorage.setItem(ACTIVE_KEY, id);
}

export function getActiveId(): string | null {
  if (typeof localStorage === "undefined") return null; // SSR guard
  return localStorage.getItem(ACTIVE_KEY);
}
