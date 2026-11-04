/**
 * tests/helpers/symlink-dir.ts — 测试夹具「把真目录链到临时仓库」的唯一写法：Windows 上
 * `"dir"` 需特权、必经 **EPERM**（同族见 §11.13），故用免特权的 `"junction"`（夹具场景语义等价，macOS/Linux 忽略 type，收成一处以免被改回）。
 * @module tests/helpers/symlink-dir — 免特权的目录链接（测试基建，不触碰 src 源码）
 */
import { symlinkSync } from "node:fs";

/** 把 `target`（绝对路径的目录）链到 `linkPath`，Windows 走 junction。 */
export function symlinkDir(target: string, linkPath: string): void {
  symlinkSync(target, linkPath, process.platform === "win32" ? "junction" : "dir");
}
