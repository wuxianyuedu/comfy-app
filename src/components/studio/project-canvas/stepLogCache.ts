"use client";

/* ── stepLogCache.ts · ──────────────────────────────
 * Cross-unmount cache for the CanvasNode step-log panel state.
 *
 * Why this exists
 * ────────────────
 * The picture-node body renders the log panel via `{selected && <ImageGenerationPanel/>}`
 * (CanvasNode.tsx:1234).  When the user clicks away → React unmounts the
 * panel → React tears down its `useState` slots for `stepLogs` and
 * `validationErrors`.  Clicking back re-mounts the panel → fresh empty
 * arrays → the SSE EventSource reconnects from scratch → the user sees
 * a duplicate "📡 已订阅…" line, a "fresh QUEUED (0%)" status, and the
 * 20s stuck warning counter resets — even though the same task is
 * still running on the backend.
 *
 * Backend logs live in `Task.logs` (Prisma) and are replayed on SSE
 * connect, so the *content* reappears within ~1 round-trip — but
 * (a) the in-flight warning timer (20s no-activity) is gone for ~20s
 * of new silence, (b) the UI feels like it dropped its memory of the
 * run, and (c) the console noise makes the user think there's a
 * duplication bug.
 *
 * Fix:  hold the panel's transient state in a module-level Map keyed
 *       by `taskId`, so unmount/remount within a session is invisible
 *       to the user.  Bounded by `MAX_ENTRIES` (LRU) so a long-running
 *       tab doesn't leak memory.
 *
 * Scope
 * ─────
 * This is *intra-tab* persistence only.  Surviving a full browser
 * reload would need localStorage, which is intentional non-goal for
 * v1 — task-level state belongs in Prisma + SSE replay, not in
 * per-tab scratch state.
 *
 * ───────────────────────────────────────────────────────────────────── */

import type { ValidationError } from "@/lib/comfyui/validation";

/* StepLogEntry is re-exported from this module so ImageGenerationPanel
 * can import both the type and the cache helpers without creating a
 * circular import (panel ↔ cache).  The shape mirrors runner.ts
 * LogEntry (TaskEvent union "log" entry payload) with one
 * UI-only extension: `client?: boolean` flags entries that the
 * browser itself pushed (subscription state, stuck-detection
 * warning…) so they can render with a muted italic style. */
export interface StepLogEntry {
  t: number;
  level: "info" | "progress" | "warn" | "error" | "success";
  msg: string;
  client?: boolean;
  /** caller source ("file:line") mirrored from
   *  the server LogEntry, rendered only when the debug toggle is on. */
  src?: string;
}

export interface StepLogPanelState {
  /** All log entries pushed since this taskId's panel was first opened. */
  logs: StepLogEntry[];
  /** Last structured failure seen (from pollTask via `d.validationErrors`
   *  or from the SSE `state` event).  Null when the task is still
   *  running or has never been marked failed. */
  validationErrors: ValidationError[] | null;
  /* per-task metadata so the task-switcher
   *  dropdown can show "工作流名 · 状态" instead of a truncated id.
   *  Populated by GlobalStepLogPanel on every SSE `state` event. */
  workflowName?: string;
  status?: string;
  /** 触发该任务的画布节点 id，用于日志面板按 #1/#2… 短序号筛选。 */
  nodeId?: string;
}

const MAX_ENTRIES = 256;

const cache = new Map<string, StepLogPanelState>();

/** Touch (move to end of insertion order) + clamp size.  LRU. */
function touch(id: string, next: StepLogPanelState) {
  cache.set(id, next);
  if (cache.size > MAX_ENTRIES) {
    const oldest = cache.keys().next().value;
    if (oldest) cache.delete(oldest);
  }
}

/** Load the persisted state for a taskId, or null if none. */
export function loadStepLogPanelState(taskId: string | null | undefined): StepLogPanelState | null {
  if (!taskId) return null;
  return cache.get(taskId) ?? null;
}

/** Overwrite the persisted state for a taskId.  Useful for tests and
 *  for cases where the panel wants to reset (e.g. user picks a new
 *  workflow — there is no such flow today, but keep the escape hatch). */
export function saveStepLogPanelState(taskId: string, next: StepLogPanelState): void {
  if (!taskId) return;
  touch(taskId, next);
}

/** Drop the entry for a taskId.  Used when the task truly finishes and
 *  the user doesn't want stale UI state to come back next time they
 *  click the same node — we don't yet, but the API is here. */
export function clearStepLogPanelState(taskId: string | null | undefined): void {
  if (!taskId) return;
  cache.delete(taskId);
}

/** Append a single log entry to the cached state, creating the entry
 *  if needed.  Returns the updated state (same reference if a no-op). */
export function appendStepLog(taskId: string | null | undefined, entry: StepLogEntry): StepLogPanelState | null {
  if (!taskId) return null;
  const prev = cache.get(taskId) ?? { logs: [] as StepLogEntry[], validationErrors: null };
  // Dedupe on (t, msg) — mirrors the SSE dedupe in ImageGenerationPanel.
  if (prev.logs.some((log) => log.t === entry.t && log.msg === entry.msg)) {
    return prev;
  }
  const next: StepLogPanelState = {
    logs: [...prev.logs, entry],
    validationErrors: prev.validationErrors,
  };
  touch(taskId, next);
  return next;
}

/** Update the cached `validationErrors` for a taskId (creating the
 *  entry if missing). */
export function setStepLogValidationErrors(
  taskId: string | null | undefined,
  errs: ValidationError[] | null
): void {
  if (!taskId) return;
  const prev = cache.get(taskId) ?? { logs: [] as StepLogEntry[], validationErrors: null };
  touch(taskId, { logs: prev.logs, validationErrors: errs });
}

/* merge workflowName + status into the
 *  cache entry so the task-switcher dropdown can label each id
 *  with the workflow name (e.g. "image_Z-Anime-Workflow-v1 · FAILED")
 *  instead of forcing the user to read a truncated 14-char id. */
export function patchStepLogMeta(
  taskId: string | null | undefined,
  meta: { workflowName?: string; status?: string; nodeId?: string }
): void {
  if (!taskId) return;
  const prev = cache.get(taskId) ?? { logs: [] as StepLogEntry[], validationErrors: null };
  touch(taskId, {
    logs: prev.logs,
    validationErrors: prev.validationErrors,
    workflowName: meta.workflowName ?? prev.workflowName,
    status: meta.status ?? prev.status,
    nodeId: meta.nodeId ?? prev.nodeId,
  });
}

/** Test/admin helper: how many tasks are tracked right now. */
export function stepLogCacheSize(): number {
  return cache.size;
}

/** Return the taskIds currently held in the cache, most-recently-touched
 *  first.  Used by the global log panel's task selector so the user can
 *  flip between past runs without re-running them. */
export function listCachedTaskIds(): string[] {
  return Array.from(cache.keys());
}

/** Test/admin helper: drop all cached state. */
export function clearAllStepLogPanels(): void {
  cache.clear();
}
