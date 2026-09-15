/** render-lock-diff.mjs 的类型声明（实现是 .mjs）。 */
import type { LockDiff } from "./lock-diff.mjs";

export function shortVersion(v: string | undefined): string;
export function renderLockDiff(diff: LockDiff, opts?: { maxPerSection?: number }): string[];
export function renderDriftReport(diff: LockDiff, opts?: { maxPerSection?: number }): string[];
