"use client";

/* ── activeTask.ts · R-ardot118 (2026-08-18) ────────────────────────────────
 * Tracks the "currently interesting" taskId for the global step-log panel.
 *
 * The picture-node body still owns the run button + status (its SSE
 * subscription drives `d.status`), but the *separate* global log panel
 * (GlobalStepLogPanel) needs to know which task to show.  When a run
 * starts, the node panel calls `setActiveTaskId(taskId)`; the global
 * panel reads it via `useActiveTaskId()` and subscribes its own SSE to
 * that task.  Module-level + useSyncExternalStore so the panel reacts
 * live without prop-drilling through the React Flow boundary.
 * ───────────────────────────────────────────────────────────────────────── */

import { useSyncExternalStore } from "react";

const listeners = new Set<() => void>();
let activeTaskId: string | null = null;

export function setActiveTaskId(id: string | null): void {
  if (activeTaskId === id) return;
  activeTaskId = id;
  for (const l of listeners) l();
}

export function getActiveTaskId(): string | null {
  return activeTaskId;
}

function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

function getSnapshot(): string | null {
  return activeTaskId;
}

export function useActiveTaskId(): string | null {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
