#!/usr/bin/env node
// @ts-nocheck -- build-time script: runs outside the Next module graph
/**
 * 清掉**陈旧**的 `.next/types`（ISSUE #4109）。
 *
 * `tsconfig.json` 把 `.next/types/**\/*.ts` 纳入类型检查面：Next 在 dev / build 时
 * 按当时的路由表生成 `validator.ts`，之后源码里删掉某个路由（实测是 `src/app/login/page.tsx`），
 * 旧 validator 仍 import 它 —— `tsc --noEmit` 报 TS2307 / TS2344，看起来像源码坏了，
 * 其实是**生成物比源码旧**。重装依赖（`pnpm install`）不会动 `.next`：配置指纹没变时
 * `launcher-core/worktree.mjs::syncNextCache` 刻意保留缓存，于是这一档会一直红到
 * 有人手动删生成目录。
 *
 * 本脚本只删**类型生成物**那一层，保留 webpack / turbopack 的编译缓存 —— 下次
 * `pnpm dev` / `next build` 会按当前路由表重建，而全清 `.next` 带来的重编译代价不必付。
 * 由 `pnpm deps:sync` 串在 `pnpm install` 之后调用；单独跑也安全（没有目录就直接退出 0）。
 *
 * 用法：node scripts/next-types-clean.mjs [root]
 */
import fs from "node:fs";
import path from "node:path";
import process from "node:process";

/** 生成物那一层的仓库相对路径（唯一出处，日志与测试都读它）。 */
export const NEXT_TYPES_REL = path.join(".next", "types");

/**
 * 删掉目标检出下陈旧的 Next 类型生成物。
 * @param {string} root 仓库根（测试里传临时目录，不依赖 cwd）
 * @returns {{removed: boolean, path: string}} 是否真的删了东西 + 目标路径
 */
export function cleanStaleNextTypes(root) {
  const target = path.join(root, NEXT_TYPES_REL);
  if (!fs.existsSync(target)) {
    return { removed: false, path: target };
  }
  fs.rmSync(target, { recursive: true, force: true });
  return { removed: true, path: target };
}

if (process.argv[1] && path.resolve(process.argv[1]) === import.meta.filename) {
  const root = process.argv[2]
    ? path.resolve(process.argv[2])
    : path.resolve(import.meta.dirname, "..");
  const result = cleanStaleNextTypes(root);
  console.log(
    result.removed
      ? `[next-types-clean] 已清掉陈旧的 ${NEXT_TYPES_REL}（下次 dev / build 按当前路由重建）。`
      : `[next-types-clean] 没有 ${NEXT_TYPES_REL}，无需清理。`,
  );
}
