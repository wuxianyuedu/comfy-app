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

/** 服务端 `project` 表的一行（`project.list` 的出口形状）。 */
export interface ServerProjectRow {
  id: string;
  name: string;
  /** tRPC 走 SuperJSON 给 Date，REST 那路给 ISO 串 */
  updatedAt: string | Date;
  nodes?: unknown;
  edges?: unknown;
}

/**
 * 读服务端的项目列表（按用户，`project.list`）。
 *
 * 单独抽出来是因为它有**两个读侧**：`hydrateFromServer` 的对账，与「所有项目」
 * 那一屏的并集（`listProjectsWithServer`）。此前只有前者，于是服务端独有行
 * 除了「被对账搬进索引」以外没有任何界面可见路径 —— 那一屏读的是索引，
 * 看不出两侧的差集（ISSUE #1522）。
 *
 * 归一收在这里：服务端两路（tRPC 的 SuperJSON Date / REST 的 ISO 串）进来的是
 * 同一列的两个形状，调用方要的只是一个能比较的毫秒数。
 */
export async function fetchServerProjects(): Promise<ServerProjectRow[]> {
  const rows = (await vanillaApi.project.list.query()) as ServerProjectRow[];
  return Array.isArray(rows) ? rows : [];
}

/** 把一行服务端记录归一成本地索引用的 `CanvasProject`。 */
function toCanvasProject(row: ServerProjectRow): CanvasProject {
  return {
    id: row.id,
    name: row.name,
    updatedAt: new Date(row.updatedAt).getTime(),
    nodes: (row.nodes as CanvasProject["nodes"]) ?? [],
    edges: (row.edges as CanvasProject["edges"]) ?? [],
  };
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
    const serverProjects = await fetchServerProjects();
    const localAll = readIndex();
    const byId = new Map(localAll.map((localAll) => [localAll.id, localAll]));
    let changed = false;
    for (const sp of serverProjects) {
      const local = byId.get(sp.id);
      const serverCopy = toCanvasProject(sp);
      if (!local || serverCopy.updatedAt >= local.updatedAt) {
        byId.set(sp.id, serverCopy);
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

/* ── 「所有项目」那一屏的事实源（ISSUE #1522）─────────────────────────────
 *
 * 服务端为准 + 并集：这一屏此前只读客户端索引（`listProjects()`），而索引是
 * `hydrateFromServer` 对账**之后**的本地副本 —— 于是「服务端有一行、索引里没有」
 * 的分叉一旦出现，那一行在界面上**彻底不可见，也没有任何删除入口**。
 * 实测现场就是 `project` 表里那几行 `未命名*`：`reapAllEmptyDrafts` 早期版本
 * 只清索引、不清服务端（ISSUE #1501 修的是这半边），留下的一批行既进不了列表、
 * 又删不掉。
 *
 * 现在改读**两侧的并集**，并给每一行标出处：
 *   · `server` —— 只存在于服务端（索引里没有它）。界面因此看得见、也能删。
 *   · `local`  —— 只存在于本地索引（刚建、还没推上去，或推送被拒）。仍然显示，
 *                 否则「刚建好的画布」会在这一屏消失（`persistProjectToServer`
 *                 是 fire-and-forget，落定之前必然会有一段这样的窗口）。
 *   · `both`   —— 两侧都有（正常行）。
 *
 * 为什么不干脆只读服务端：本地索引是**离线时唯一有的那一份**，而这一屏有一条
 * 明确的承诺「本地 · 可继续编辑」（见 `WorksGallery`）。只读服务端会让 dev
 * server 未起 / 拉取失败时这一屏直接清空，把「看不见」换成「全都看不见」。
 * 并集 + 标注是信息最全的那一支，代价（两套语义）由 `origin` 这一个字段承担。
 */

/** 一行在「所有项目」屏里的出处。 */
export type ProjectOrigin = "server" | "local" | "both";

export interface ProjectListEntry {
  id: string;
  name: string;
  /** 毫秒时间戳（本地索引与 `fetchServerProjects` 归一后的同一口径）。 */
  updatedAt: number;
  nodes: CanvasProject["nodes"];
  edges: CanvasProject["edges"];
  origin: ProjectOrigin;
}

/**
 * 这一屏要显示的**全部**项目行：本地索引 ∪ 服务端，按 `updatedAt` 倒序。
 *
 * 同名 id 以 `updatedAt` 较新的一侧为准（与 `hydrateFromServer` 的对账口径一致）
 * —— 不这样的话，同一份画布会在列表里出现两行。
 *
 * 拉取失败返回 `ok: false` + 本地索引那一份：视图据此照常列出本地项目，
 * 并给一句「服务端那份没拉到」的说法（不是把一个空列表端上去）。
 */
export async function listProjectsWithServer(): Promise<{
  entries: ProjectListEntry[];
  ok: boolean;
}> {
  const localAll = readIndex();
  const byId = new Map<string, ProjectListEntry>();
  for (const project of localAll) {
    byId.set(project.id, {
      ...project,
      nodes: project.nodes ?? [],
      edges: project.edges ?? [],
      origin: "local",
    });
  }
  try {
    const serverProjects = await fetchServerProjects();
    for (const row of serverProjects) {
      const serverCopy = toCanvasProject(row);
      const local = byId.get(row.id);
      if (!local) {
        byId.set(row.id, { ...serverCopy, origin: "server" });
        continue;
      }
      const newer =
        serverCopy.updatedAt >= local.updatedAt ? serverCopy : local;
      byId.set(row.id, { ...newer, origin: "both" });
    }
    return { entries: sortByUpdated(byId), ok: true };
  } catch (e) {
    /* 「服务端那份没拉到」与「服务端确实没有这一行」是两件事，读侧要能分辨
     * （`ok: false` ⇒ 界面别把「看不到」说成「不存在」）。日志照旧走
     * `sync-notice` 那一条诊断口 —— 本文件不许自己写 console。 */
    logSyncIssue("读取服务端项目列表失败，本屏只列出本地项目", e);
    return { entries: sortByUpdated(byId), ok: false };
  }
}

function sortByUpdated(
  byId: Map<string, ProjectListEntry>,
): ProjectListEntry[] {
  return [...byId.values()].sort(
    (left, right) => right.updatedAt - left.updatedAt,
  );
}

/**
 * 删**任何一行**（含索引里没有、只在服务端的那一种）。
 *
 * 与 `deleteProject` 的分工是判据而不是便利：`deleteProject` 的名字要在
 * **索引里**找，找不到就只剩「本机无操作」—— 服务端那一行留在原地、界面上
 * 也没有别的入口（这正是 ISSUE #1522 问的那个口子）。这里反过来以 `id` 为准：
 * 本机有就一并清（连带 active-id），服务端那份则照旧走
 * `deleteProjectOnServer` 那一条出口（失败按「重试有没有用」分两档处置）。
 *
 * `name` 由调用方给：索引里有就取索引的，索引里没有的那一行只有服务端给的
 * 名字可作提示文案（`SyncNotice.projectName` 要的是用户认得出的那个词）。
 */
export function deleteProjectEverywhere(id: string, name?: string): void {
  const local = readIndex().find((project) => project.id === id);
  if (local) {
    /* 索引里有 → 交给原有出口：它已经实现「清索引 + 清 active-id + 删服务端」
     * 这三件事，不在这里重抄一遍（§12.12）。 */
    deleteProject(id);
    return;
  }
  /* 索引里没有这行：本机无状态可清，只删服务端那一份。active-id 指向它的
   * 概率极低（索引都没有它），但真指向了就得一起清 —— 否则上层以为「我有
   * 一个项目」，六个项目页签点进去全落空（与 `reapAllEmptyDrafts` 尾部
   * 那条悬空 active 的处理同一口径）。 */
  if (getActiveId() === id) removeStorageItem(ACTIVE_KEY);
  deleteProjectOnServer({
    id,
    name: name ?? "",
    updatedAt: Date.now(),
    nodes: [],
    edges: [],
  });
  emitChanged();
}
