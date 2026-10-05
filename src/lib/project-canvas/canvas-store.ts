/* ── 画布项目持久化（可命名、可多个） ──
 * 用一套「项目索引」取代旧的单草稿 localStorage 键，
 * 让用户可以保留多个命名画布并安全切换。
 */

import { emitAppEvent } from "~/lib/app-events";
import type { Edge } from "@xyflow/react";
import { fireAndForget } from "~/lib/async-action";
import type { CanvasNodeType } from "~/lib/project-canvas/canvas-types";
import {
  clearSyncFailure,
  logSyncIssue,
  reportMirrorFailure,
} from "~/lib/project-canvas/sync-notice";
import {
  readStorageItem,
  readStorageJson,
  removeStorageItem,
  writeStorageItem,
  writeStorageJson,
} from "~/lib/browser-storage";
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
function emitChanged() {
  emitAppEvent("comfyapp:canvas-store-changed");
}

/** 读项目索引（坏数据 / 没存过一律空表）。「能不能用 storage」与「坏数据怎么办」
 *  收在 `~/lib/browser-storage`（§16.2.4.28）—— 此前本文件 12 处各写一遍
 *  `typeof localStorage === "undefined"`，另有自己的 `safeParse`。 */
function readIndex(): CanvasProject[] {
  return readStorageJson<CanvasProject[]>(INDEX_KEY, [], (raw) => {
    const parsed = JSON.parse(raw) as CanvasProject[];
    return Array.isArray(parsed) ? parsed : [];
  });
}

/** 写回项目索引（写失败静默 —— 与 `writeStorageJson` 同口径）。 */
function writeIndex(all: CanvasProject[]): void {
  writeStorageJson(INDEX_KEY, all);
}

export function listProjects(): CanvasProject[] {
  const all = readIndex();
  return all.sort((left, right) => right.updatedAt - left.updatedAt);
}

export function getProject(id: string): CanvasProject | null {
  const all = readIndex();
  return all.find((all) => all.id === id) ?? null;
}

/* 直写到服务端。尽力而为，但**不是「无声」**：失败按「重试有没有用」分两档处置
 *（判据与原因在 `~/lib/project-canvas/sync-notice`）—— 暂时拿不到只留日志、
 * 下一轮自动保存还会再试；服务端明确不收这一份则登记成一个可查的状态，
 * 由视图层给用户一条看得懂的提示。此前这里是 `catch {}`，于是「画布 id 属于
 * 别人」（A3 装上归属闸之后的新后果）与「dev server 正在重启」压成同一种静默，
 * 用户界面显示已保存、换端口一看是空的，且毫无线索。
 * 每次有意义的变更都会从 `upsertProject` 调它，于是服务端副本在换端口 / 换设备时
 * 也保持同步（单靠 localStorage 是按来源隔离的，换端口时数据会静默丢失，
 * 例如从 3100 换到 3102）。
 */
function persistProjectToServer(p: CanvasProject): void {
  if (typeof window === "undefined") return;
  /* 走 `fireAndForget` 而不是 `void fn()`：那条地基的语义就是「不 await、不抛、
   * 失败必须落到一个显式 onError」，`onError` 没有默认值 —— 通道恰恰是这里
   * 最不该被悄悄通用掉的东西（见 `~/lib/async-action`）。 */
  fireAndForget(
    vanillaApi.project.upsert
      .mutate({
        id: p.id,
        name: p.name,
        nodes: p.nodes ?? [],
        edges: p.edges ?? [],
      })
      /* 成功要把之前的拒收记录撤掉：用户照着提示把名字改对之后，
       * 旧提示继续留在界面上等于制造第二条假故障。 */
      .then(() => {
        clearSyncFailure(p.id);
      }),
    (e) => {
      reportMirrorFailure("这份画布没能存进服务端", p, e);
    },
  );
}

/* 在服务端硬删除（尽力而为）。与 `deleteProject` 对应，失败处置与上面同一档判据：
 * 「本机已经删了、服务端没删掉」是有后果的（换端口 / 换设备时它会再冒出来），
 * 所以也不能只是 `.catch(() => undefined)`。
 */
function deleteProjectOnServer(p: CanvasProject): void {
  if (typeof window === "undefined") return;
  fireAndForget(
    vanillaApi.project.delete.mutate({ projectId: p.id }).then(() => {
      clearSyncFailure(p.id);
    }),
    (e) => {
      reportMirrorFailure("这份画布没能从服务端删掉", p, e);
    },
  );
}

export function upsertProject(p: CanvasProject): void {
  const all = readIndex();
  const idx = all.findIndex((item) => item.id === p.id);
  const next: CanvasProject = { ...p, updatedAt: Date.now() };
  if (idx >= 0) all[idx] = next;
  else all.push(next);
  writeIndex(all);
  emitChanged();
  // 同步到服务端（持久、跨来源的存储）。不阻塞。
  persistProjectToServer(next);
}

export function deleteProject(id: string): void {
  const before = readIndex();
  /* 名字要在过滤**之前**取：拒收提示要落在用户认得出的那条画布上，
   * 而删掉之后索引里已经没有这一条了。 */
  const removed = before.find((project) => project.id === id);
  writeIndex(before.filter((project) => project.id !== id));
  if (getActiveId() === id) removeStorageItem(ACTIVE_KEY);
  emitChanged();
  // 尽力在服务端也删掉。
  if (removed) deleteProjectOnServer(removed);
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
    const localAll = readIndex();
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
        persistProjectToServer(lp);
      }
    }
    if (changed || localAll.length > 0) {
      const merged = [...byId.values()].sort(
        (left, right) => right.updatedAt - left.updatedAt,
      );
      writeIndex(merged);
      emitChanged();
    }
  } catch (e) {
    /* 拉不到服务端列表 ⇒ 这一轮只用本地索引（local-first 的承诺），并把
     * `hydrated` 退回 false 让下一次挂载再试。但「静默重试」不等于「静默」：
     * 这一行日志是「我的画布为什么没出现在列表里」唯一的可查出口（硬规则 4），
     * 而它走的是 `sync-notice` 那一条诊断口 —— 本文件不许自己写 console。 */
    logSyncIssue("读取服务端画布列表失败，本轮只用本地索引", e);
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
  if (getActiveId() === pid) removeStorageItem(ACTIVE_KEY);
}

/* 「这条能不能回收」的唯一判据，「回收一条」与「清扫一批」共用它 ——
 * 两份各写一遍时它们已经漂过一次（一处比名字与内容，另一处还多比一项），
 * 而这里的每一项都是「删掉用户东西」的必要条件（§12.12：抽共享内核，
 * 两边只留差异）。
 *
 * `pid` 是**当前活跃项目**时一律不可回收：用户此刻正站在里面。
 * 这条是 ISSUE #1501 的根因 —— 首页「新建画布项目」走的 `createProject`
 * 会立刻落一行「零节点零连线 + 名字 = 未命名」的索引，于是它**正好命中**
 * 空草稿哨兵，刷新时被这里清掉、连带清掉 active-id，六个项目页签随之消失
 *（`openableViews` 只在 active 非空时列它们）。而沉淀在 `project` 表里的
 * 那几行 `未命名*` 也是同一件事的另一半：本机删了索引、服务端那份没人删。
 *
 * 注意区分两种「空」：`createDraftProject` 造的是**从不进索引**的草稿
 *（这里根本没它），而 `createProject` 造的是**真的进了索引**的行 ——
 * 清扫要对后者负责，但不能对「用户正在用的那一行」负责。 */
function isReapableEmptyDraft(
  project: CanvasProject,
  activeId: string | null,
): boolean {
  if (project.id === activeId) return false;
  if (project.name !== EMPTY_DRAFT_NAME) return false;
  return (
    (project.nodes?.length ?? 0) === 0 && (project.edges?.length ?? 0) === 0
  );
}

/**
 * 当且仅当该项目是「空 + 默认名」且**不是当前活跃项目**时从索引里移除它
 *（见 `EMPTY_DRAFT_NAME`）。确实回收了才返回 true。
 * 已命名 / 非空的项目**从不**被回收 —— 于是用户特意命名成「空白灵感板」
 * 的空画布能在清回收中活下来。
 */
export function reapEmptyProject(pid: string): boolean {
  const all = readIndex();
  const p = all.find((all) => all.id === pid);
  if (!p) return false;
  if (!isReapableEmptyDraft(p, getActiveId())) return false;
  deleteProject(pid);
  return true;
}

/**
 * 清扫项目索引里遗留的空草稿 —— 可能是旧版编辑器留下的，
 * 也可能是用户在本次修复前回访时留下的。返回移除的条数。
 * 画布挂载时调一次，首页挂载时再调一次。
 *
 * **当前活跃项目不在清扫范围内**（判据见 `isReapableEmptyDraft`）：
 * 它是不是「空草稿」与「能不能删」是两件事 —— 用户刚从首页进来、
 * 还什么都没做的那个项目确实是空的，但把它删掉等于把用户踢出上下文，
 * 而 active-id 也就跟着没了（ISSUE #1501）。
 */
export function reapAllEmptyDrafts(): number {
  const all = readIndex();
  const activeId = getActiveId();
  /* 先按当前索引定下要清哪些（判据只算一次，避免边删边看时判据对象变了），
   * 再**逐条走 `deleteProject`** —— 那是「本机删了、服务端那份也要删」的唯一
   * 出口（`deleteProjectOnServer`）。此前这里直接 `writeIndex(survivors)` 就算
   * 完事，于是**每一条被清扫的空草稿都在服务端留下永久的一行**：界面再也指不
   * 回它（索引里没有它了），而 `project` 表里那几个 `未命名` / `未命名_2` /
   * `未命名_3` 就是这么攒出来的（ISSUE #1501）。
   * 逐条删的代价可以忽略：这是挂载时的一次性清扫，且删到最后就是空转。 */
  const doomed = all.filter((project) =>
    isReapableEmptyDraft(project, activeId),
  );
  if (doomed.length === 0) return 0;
  for (const project of doomed) deleteProject(project.id);
  /* 活跃项目本身不在 `doomed` 里，所以走到这里它没被删。但 active-id 可能指向
   * 一条**索引里根本没有的行**（它本来就是个 draft、或索引被外部清过）——
   * 那种悬空 active 指向谁都不存在，留着只会让上层以为「我有项目」而六个
   * 项目页签点进去全落空。是活跃项目就保留，否则清掉。 */
  const survivors = readIndex();
  if (activeId && !survivors.some((survivor) => survivor.id === activeId)) {
    removeStorageItem(ACTIVE_KEY);
  }
  return doomed.length;
}

export function setActive(id: string): void {
  writeStorageItem(ACTIVE_KEY, id);
}

export function getActiveId(): string | null {
  return readStorageItem(ACTIVE_KEY);
}
