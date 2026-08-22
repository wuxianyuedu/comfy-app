/* ── Canvas project persistence (named, multiple projects) ──
 * Replaces the old single-draft localStorage key with a project index so the
 * user can keep several named canvases and switch between them safely.
 */

import type { Node, Edge } from "@xyflow/react";
import type { CanvasNodeData } from "./canvas-types";
import { vanillaApi } from "~/trpc/vanilla";

export interface CanvasProject {
  id: string;
  name: string;
  updatedAt: number;
  nodes: Node<CanvasNodeData>[];
  edges: Edge[];
}

const INDEX_KEY = "comfyapp.canvas.projects.v1";
const ACTIVE_KEY = "comfyapp.canvas.active.v1";
/** Event name fired on every canvas-store mutation (upsert/delete/create).
 *  Pages listening (e.g. workspace home) re-read the store to refresh
 *  dependent views (recent projects, switcher labels, etc.). */
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
  return all.sort((a, b) => b.updatedAt - a.updatedAt);
}

export function getProject(id: string): CanvasProject | null {
  if (typeof localStorage === "undefined") return null; // SSR guard
  const all = safeParse<CanvasProject[]>(localStorage.getItem(INDEX_KEY), []);
  return all.find((p) => p.id === id) ?? null;
}

/**
 * Write-through to the server.  Best-effort: failures are swallowed so a
 * flaky network / server never blocks the local-first UI.  Called from
 * `upsertProject` on every meaningful mutation, so the server copy stays
 * in sync across ports / devices (localStorage alone is per-origin and
 * silently loses data when you switch ports, e.g. 3000 → 3002).
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
    /* offline / server down — localStorage already has it */
  }
}

/**
 * Hard-delete on the server (best-effort).  Mirrors `deleteProject`.
 */
function deleteProjectOnServer(id: string): void {
  if (typeof window === "undefined") return;
  vanillaApi.project.delete.mutate({ projectId: id }).catch(() => {});
}

export function upsertProject(p: CanvasProject): void {
  if (typeof localStorage === "undefined") return; // SSR guard
  const all = safeParse<CanvasProject[]>(localStorage.getItem(INDEX_KEY), []);
  const idx = all.findIndex((x) => x.id === p.id);
  const next: CanvasProject = { ...p, updatedAt: Date.now() };
  if (idx >= 0) all[idx] = next;
  else all.push(next);
  localStorage.setItem(INDEX_KEY, JSON.stringify(all));
  emitChanged();
  // Mirror to the server (durable, cross-origin store). Non-blocking.
  void persistProjectToServer(next);
}

export function deleteProject(id: string): void {
  if (typeof localStorage === "undefined") return; // SSR guard
  const all = safeParse<CanvasProject[]>(localStorage.getItem(INDEX_KEY), []).filter(
    (p) => p.id !== id
  );
  localStorage.setItem(INDEX_KEY, JSON.stringify(all));
  if (getActiveId() === id) localStorage.removeItem(ACTIVE_KEY);
  emitChanged();
  // Best-effort mirror delete on the server.
  deleteProjectOnServer(id);
}

/**
 * Pull the server-side project list and reconcile with localStorage:
 *   - Server project wins when its `updatedAt` is newer than the local copy
 *     (covers switching ports / devices where localStorage was empty/stale).
 *   - Local-only projects (never synced) are pushed up to the server so the
 *     existing data isn't lost on the first visit after this fix ships.
 * Called once on canvas mount, before the active project is read, so the
 * merged index is what the canvas loads from.
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
      []
    );
    const byId = new Map(localAll.map((p) => [p.id, p]));
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
    // Push local-only projects up (migration of pre-fix data).
    for (const lp of localAll) {
      if (!serverProjects.some((sp) => sp.id === lp.id)) {
        void persistProjectToServer(lp);
      }
    }
    if (changed || localAll.length > 0) {
      const merged = [...byId.values()].sort(
        (a, b) => b.updatedAt - a.updatedAt
      );
      localStorage.setItem(INDEX_KEY, JSON.stringify(merged));
      emitChanged();
    }
  } catch {
    hydrated = false;
  }
}

/** Default name used for freshly-created draft projects.  Used as a
 *  sentinel by `reapEmptyProject`: a project is considered an empty
 *  draft (and safe to reap) iff it has zero nodes/edges AND its name
 *  matches one of these literals.  User-named empty projects (where the
 *  user intentionally saved an empty canvas) are NOT reaped.
 *
 *  Both "未命名" (current default) and "未命名项目" (legacy default) are
 *  treated as sentinel names so projects created by older versions still
 *  get reaped correctly on upgrade. */
export const EMPTY_DRAFT_NAMES = ["未命名", "未命名项目"] as const;
export const EMPTY_DRAFT_NAME = EMPTY_DRAFT_NAMES[0];

/** True iff `name` is one of the empty-draft sentinel names.  Use this
 *  instead of hard-coding `"未命名项目"` at every reap guard, so the
 *  R65 default-name change ("未命名") and the legacy sentinel ("未命名项目")
 *  stay in sync from a single source of truth. */
export function isEmptyDraftName(name: string | undefined | null): boolean {
  if (!name) return false;
  return (EMPTY_DRAFT_NAMES as readonly string[]).includes(name);
}

/**
 * Returns the set of all names currently in use by projects in the
 * index.  Caller can then check `taken.has(name.trim())` to detect a
 * name clash, and `findNextAvailableName(base)` to get a non-clashing
 * variant.  Excludes `excludeId` so a rename can probe "would I clash
 * with someone else if I used this name".
 */
export function getAllProjectNames(excludeId?: string): Set<string> {
  const all = listProjects();
  const set = new Set<string>();
  for (const p of all) if (p.id !== excludeId) set.add(p.name.trim());
  return set;
}

/** Convenience predicate: is `name` already taken by another project? */
export function isProjectNameTaken(
  name: string,
  excludeId?: string
): boolean {
  const taken = getAllProjectNames(excludeId);
  return taken.has(name.trim());
}

/**
 * Return the next non-clashing variant of `base`:
 *   - If `base` itself is free, returns `base`.
 *   - Otherwise tries `base_2`, `base_3`, … until it finds a free one.
 *   - Example: with `taken = {"未命名", "未命名_2"}` and `base = "未命名"`
 *     this returns `"未命名_3"`.
 *   - Empty / whitespace-only base falls back to `EMPTY_DRAFT_NAME`.
 *
 *  Uses the index alone; safe to call before mutation because the upsert
 *  in `commitRename` / `upsertProject` runs synchronously after this.
 */
export function findNextAvailableName(
  base: string,
  excludeId?: string
): string {
  const baseClean = base.trim() || EMPTY_DRAFT_NAME;
  const taken = getAllProjectNames(excludeId);
  if (!taken.has(baseClean)) return baseClean;
  // Match a trailing "_<digits>" on the candidate suffix to avoid an
  // endless loop if the base itself ends with "_<n>" — e.g. if the user
  // already named a project "灵感_3" and we start from "灵感_3", we'd
  // otherwise collide with it instead of finding the next free slot.
  let suffix = 2;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const candidate = `${baseClean}_${suffix}`;
    if (!taken.has(candidate)) return candidate;
    suffix += 1;
    if (suffix > 9999) {
      // Pathological: 10000 collisions.  Just append a timestamp slice.
      return `${baseClean}_${Date.now().toString(36).slice(-4)}`;
    }
  }
}

export function createProject(name?: string): CanvasProject {
  const p: CanvasProject = {
    id: `proj_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    name: findNextAvailableName(name?.trim() || EMPTY_DRAFT_NAME),
    updatedAt: Date.now(),
    nodes: [],
    edges: [],
  };
  upsertProject(p);
  setActive(p.id);
  return p;
}

/**
 * Create a project that ONLY lives in active-id state — it is NOT written
 * to the project index.  Use this when the user lands on a fresh canvas
 * ("新建项目"), so visiting the canvas and walking away without doing
 * anything doesn't pollute the recent-projects list with empty drafts.
 *
 * The project becomes "real" the moment the user makes a real change
 * (drag/add/connect/rename): the auto-persist effect in ProjectCanvas will
 * detect `nodes.length === 0 && edges.length === 0 === false` and call
 * `commitDraftProject`, which performs the actual upsert + emitChanged.
 *
 * If the user leaves the canvas with the draft still empty,
 * `reapEmptyDraft` deletes it from the active id (it was never in the
 * index in the first place).
 */
export function createDraftProject(name?: string): CanvasProject {
  const p: CanvasProject = {
    id: `proj_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    name: findNextAvailableName(name?.trim() || EMPTY_DRAFT_NAME),
    updatedAt: Date.now(),
    nodes: [],
    edges: [],
  };
  setActive(p.id);
  emitChanged(); // so homepage re-reads the (unchanged) index
  return p;
}

/**
 * Persist a draft (or already-existing) project to the index.  Equivalent
 * to `upsertProject` semantically — they share the same emission path —
 * but named explicitly to signal "this is the FIRST time a draft is
 * becoming real".  Pair with `createDraftProject`.
 */
export function commitDraftProject(p: CanvasProject): void {
  upsertProject(p);
}

/**
 * Forget the active draft project id without touching the index.  Call
 * when the user walks away from a fresh canvas they never wrote to.
 */
export function clearActiveIfDraft(pid: string): void {
  if (typeof localStorage === "undefined") return;
  if (getActiveId() === pid) localStorage.removeItem(ACTIVE_KEY);
}

/**
 * Remove a project from the index iff it is an empty default-named
 * project (see `EMPTY_DRAFT_NAME`).  Returns true when something was
 * reaped.  Already-named / non-empty projects are NEVER reaped, so an
 * intentional blank canvas the user named "空白灵感板" survives a reap
 * pass.
 */
export function reapEmptyProject(pid: string): boolean {
  if (typeof localStorage === "undefined") return false;
  const all = safeParse<CanvasProject[]>(localStorage.getItem(INDEX_KEY), []);
  const p = all.find((x) => x.id === pid);
  if (!p) return false;
  // Recognize both current ("未命名") and legacy ("未命名项目") sentinels
  if (!(EMPTY_DRAFT_NAMES as readonly string[]).includes(p.name)) return false;
  if ((p.nodes?.length ?? 0) > 0 || (p.edges?.length ?? 0) > 0) return false;
  deleteProject(pid);
  return true;
}

/**
 * Sweep the project index for stale empty drafts that earlier versions
 * of the editor (or users who came back from a previous session before
 * this fix) may have left behind.  Returns the number of entries removed.
 * Call once on canvas mount and once on homepage mount.
 */
export function reapAllEmptyDrafts(): number {
  if (typeof localStorage === "undefined") return 0;
  const all = safeParse<CanvasProject[]>(localStorage.getItem(INDEX_KEY), []);
  const survivors = all.filter(
    (p) =>
      !(EMPTY_DRAFT_NAMES as readonly string[]).includes(p.name) ||
      (p.nodes?.length ?? 0) > 0 ||
      (p.edges?.length ?? 0) > 0
  );
  const removed = all.length - survivors.length;
  if (removed > 0) {
    localStorage.setItem(INDEX_KEY, JSON.stringify(survivors));
    if (getActiveId() && !survivors.some((p) => p.id === getActiveId())) {
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
