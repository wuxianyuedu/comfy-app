#!/usr/bin/env node
// @ts-nocheck -- build-time script: runs outside the Next module graph
/**
 * 清掉**陈旧**的 Next 类型生成物（`.next/types` 与 `.next/dev/types`）。
 *
 * `tsconfig.json` 把 Next 生成的路由类型清单纳入类型检查面：Next 在 dev / build 时
 * 按当时的路由表生成 `validator.ts`，之后源码里删掉某个路由，旧 validator 仍 import
 * 它 —— `tsc --noEmit` 报 TS2307 / TS2344，看起来像源码坏了，其实是**生成物比源码旧**。
 * 两侧落点与清理策略不同：
 *
 *   · `.next/types`（build 侧，ISSUE #4109）：重装依赖（`pnpm install`）不会动 `.next`，
 *     配置指纹没变时 `launcher-core/worktree.mjs::syncNextCache` 刻意保留缓存，于是这一档
 *     会一直红到有人手动删生成目录。由 `pnpm deps:sync` 串在 `pnpm install` 之后调用，
 *     **无条件**清掉这一层（编译缓存保留，下次 build 按当前路由表重建）。
 *   · `.next/dev/types`（dev 侧，ISSUE #5025）：dev server 的类型清单，删路由后同样要等
 *     下一次 dev 编译才重生。由 `pnpm typecheck` 前置调用，**按需清理**：清单里只要出现
 *     「指向 src/** 已不存在路由」的引用才动手 —— typecheck 高频运行，无脑删会打扰常驻的
 *     dev server，且没有必要（清单与磁盘一致时 tsc 本来就安静）。缺失时 tsc 对这条链路
 *     保持沉默（next-env 那侧是 .d.ts，被 skipLibCheck 跳过；validator 是普通 .ts，才是
 *     唯一会报错的那一格），下次 dev/build 会重新生成一份新鲜的。
 *
 * 单独跑也安全（没有目录就直接退出 0）。
 *
 * 用法：node scripts/next-types-clean.mjs [root]   （deps:sync 与 pnpm typecheck 前置自动跑）
 */
import fs from "node:fs";
import path from "node:path";
import process from "node:process";

/** build 侧生成物的仓库相对路径（唯一出处，日志与测试都读它）。 */
export const NEXT_TYPES_REL = path.join(".next", "types");
/** dev 侧生成物的仓库相对路径（唯一出处，日志与测试都读它）。 */
export const DEV_TYPES_REL = path.join(".next", "dev", "types");

/**
 * 删掉目标检出下 build 侧的陈旧类型生成物（无条件；#4109）。
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

/**
 * 从 validator 文本里找出「指向 src/** 但磁盘上已不存在」的路由引用（#5025）。
 *
 * Next 生成形态：`typeof import("../../../src/app/(main)/models/page.js")` ——
 * 说明符相对 typesDir、以 `.js` 结尾但磁盘上是 `.ts` / `.tsx`，存在性按三种后缀
 * 候选判；只认解析后落在 `src/` 之内的引用（`./routes.js` 这类清单内部引用与
 * node_modules 一律不管）。
 *
 * @param {string} validatorText validator.ts 的原文
 * @param {string} typesDir 生成类型目录的绝对路径（说明符的解析基准）
 * @param {string} root 仓库根（绝对路径）
 * @returns {string[]} 磁盘上已找不到目标的路由引用说明符（保持出现顺序）
 */
export function findMissingRouteRefs(validatorText, typesDir, root) {
  const srcRoot = path.join(root, "src");
  /** @type {string[]} */
  const missing = [];
  const seen = new Set();
  const re = /import\(\s*(?<quote>["'])(?<spec>[^"']+)\k<quote>\s*\)/g;
  for (const match of validatorText.matchAll(re)) {
    const spec = match.groups?.spec ?? "";
    if (!spec.startsWith(".") || seen.has(spec)) continue;
    seen.add(spec);
    const resolved = path.resolve(typesDir, spec);
    if (!resolved.startsWith(srcRoot + path.sep)) continue;
    const candidates = [
      resolved,
      resolved.replace(/\.js$/, ".ts"),
      resolved.replace(/\.js$/, ".tsx"),
    ];
    if (!candidates.some((candidate) => fs.existsSync(candidate))) {
      missing.push(spec);
    }
  }
  return missing;
}

/**
 * 按需清掉 dev 侧的陈旧类型生成物（#5025）：validator 里出现「指向已删路由」的
 * 引用才整目录删 `.next/dev/types`；读不动 / 删不动都不抛（best-effort 前置，
 * 不挡 typecheck —— tsc 随后会照常报出真实错误）。
 *
 * @param {string} root 仓库根（测试里传临时目录，不依赖 cwd）
 * @returns {{ status: "noop" | "skip" | "clean" | "pruned", missing: string[] }}
 *   noop = 没有生成物可查；skip = 读不动 / 删不动；clean = 清单与磁盘一致；
 *   pruned = 已清掉陈旧 `.next/dev/types`。
 */
export function pruneStaleDevRouteTypes(root) {
  const typesDir = path.join(root, DEV_TYPES_REL);
  const validator = path.join(typesDir, "validator.ts");
  if (!fs.existsSync(validator)) {
    return { status: "noop", missing: [] };
  }

  let text;
  try {
    text = fs.readFileSync(validator, "utf8");
  } catch {
    console.error(`[next-types-clean] [ERROR] cannot read ${validator} — leaving it alone`);
    return { status: "skip", missing: [] };
  }
  const missing = findMissingRouteRefs(text, typesDir, root);
  if (missing.length === 0) {
    return { status: "clean", missing };
  }
  try {
    fs.rmSync(typesDir, { recursive: true, force: true });
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    console.error(`[next-types-clean] [ERROR] failed to prune ${typesDir}: ${detail}`);
    return { status: "skip", missing };
  }
  return { status: "pruned", missing };
}

if (process.argv[1] && path.resolve(process.argv[1]) === import.meta.filename) {
  const root = process.argv[2]
    ? path.resolve(process.argv[2])
    : path.resolve(import.meta.dirname, "..");
  const build = cleanStaleNextTypes(root);
  console.log(
    build.removed
      ? `[next-types-clean] 已清掉陈旧的 ${NEXT_TYPES_REL}（下次 dev / build 按当前路由重建）。`
      : `[next-types-clean] 没有 ${NEXT_TYPES_REL}，无需清理。`,
  );
  const dev = pruneStaleDevRouteTypes(root);
  if (dev.status === "pruned") {
    console.log(
      `[next-types-clean] 已清掉陈旧的 ${DEV_TYPES_REL}（${dev.missing.length} 条路由引用已不在磁盘，如 ${dev.missing[0]}）—— 下次 dev 按当前路由重建。`,
    );
  }
}
