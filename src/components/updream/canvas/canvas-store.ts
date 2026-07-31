/* ── Canvas project persistence (named, multiple projects) ──
 * Replaces the old single-draft localStorage key with a project index so the
 * user can keep several named canvases and switch between them safely.
 */

import type { Node, Edge } from "@xyflow/react";
import type { CanvasNodeData } from "./canvas-types";

export interface CanvasProject {
  id: string;
  name: string;
  updatedAt: number;
  nodes: Node<CanvasNodeData>[];
  edges: Edge[];
}

const INDEX_KEY = "comfyapp.canvas.projects.v1";
const ACTIVE_KEY = "comfyapp.canvas.active.v1";

function safeParse<T>(raw: string | null, fallback: T): T {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

export function listProjects(): CanvasProject[] {
  const all = safeParse<CanvasProject[]>(localStorage.getItem(INDEX_KEY), []);
  return all.sort((a, b) => b.updatedAt - a.updatedAt);
}

export function getProject(id: string): CanvasProject | null {
  const all = safeParse<CanvasProject[]>(localStorage.getItem(INDEX_KEY), []);
  return all.find((p) => p.id === id) ?? null;
}

export function upsertProject(p: CanvasProject): void {
  const all = safeParse<CanvasProject[]>(localStorage.getItem(INDEX_KEY), []);
  const idx = all.findIndex((x) => x.id === p.id);
  const next: CanvasProject = { ...p, updatedAt: Date.now() };
  if (idx >= 0) all[idx] = next;
  else all.push(next);
  localStorage.setItem(INDEX_KEY, JSON.stringify(all));
}

export function deleteProject(id: string): void {
  const all = safeParse<CanvasProject[]>(localStorage.getItem(INDEX_KEY), []).filter(
    (p) => p.id !== id
  );
  localStorage.setItem(INDEX_KEY, JSON.stringify(all));
  if (getActiveId() === id) localStorage.removeItem(ACTIVE_KEY);
}

export function createProject(name?: string): CanvasProject {
  const p: CanvasProject = {
    id: `proj_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    name: name?.trim() || "未命名项目",
    updatedAt: Date.now(),
    nodes: [],
    edges: [],
  };
  upsertProject(p);
  setActive(p.id);
  return p;
}

export function setActive(id: string): void {
  localStorage.setItem(ACTIVE_KEY, id);
}

export function getActiveId(): string | null {
  return localStorage.getItem(ACTIVE_KEY);
}
