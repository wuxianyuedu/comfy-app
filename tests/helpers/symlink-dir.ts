/**
 * tests/helpers/symlink-dir.ts — 测试夹具里「把一棵真目录链到临时仓库」的唯一写法。
 *
 * 为什么需要这薄薄一层：Windows 上 `fs.symlinkSync(a, b, "dir")` 需要开发者模式或
 * 管理员权限，普通开发者跑到这里 **100% EPERM** —— 门禁本体完全能跑，红的只是
 * 「测试夹具搭不起来」的环境噪声（同一族还有 sqlite 句柄锁不住临时目录那类，
 * 见规范 §11.13）。`"junction"` 是 NTFS 内建的目录链接形式，不需要特权，在测试夹具
 * 的场景里（不跨机、不跨卷、进程内创建与删除）语义等价；macOS / Linux 忽略 type 参数，
 * 行为与 `"dir"` 一致。
 *
 * 收成一处而不是在各测试文件里各写一份的判断：这条「为什么要分平台」的理由是
 * 判据本身的一部分，抄三遍迟早有一遍被改成 `"dir"` 而没人知道为什么。
 *
 * @module tests/helpers/symlink-dir — 免特权的目录链接（测试基建，不触碰 src 源码）
 */
import { symlinkSync } from "node:fs";

/** 把 `target`（绝对路径的目录）链到 `linkPath`，Windows 走 junction。 */
export function symlinkDir(target: string, linkPath: string): void {
  symlinkSync(
    target,
    linkPath,
    process.platform === "win32" ? "junction" : "dir",
  );
}
