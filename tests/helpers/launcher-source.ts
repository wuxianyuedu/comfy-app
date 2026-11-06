/**
 * 「启动编排链路的源码」—— 把 `dev-launcher.mjs` 与拆出的 `launcher-core/**` 拼成一份可断言的文本。
 * 为什么：编排器按 R5 拆过一刀（ISSUE #1811 第四刀，PR #1823，1540 → 953 行），「读入口再 indexOf+slice」的用例会静默失效：
 * 段落搬走、indexOf 落空、not.toContain 对着空串恒真，从钉契约变成永远绿。口径：只拼只读（谁住哪个文件是实现位置，不是契约），清单不抄第二份 —— 链路由顶层静态 import 现算。
 */
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "../..");
const SCRIPTS = path.join(ROOT, "scripts");
const ENTRY = "dev-launcher.mjs";

/**
 * 从一份源码里现算它**顶层静态 import/export** 的同目录相对依赖（`./x.mjs` 形态）。
 * 只认顶层静态：动态 `await import()` 惰性、不在加载期解析；那几处落点（`kill-process-tree.ts` 等）也不在
 * 这条 `scripts/**` 链路上。形状是 `from "./…"`，与 `gate-repo.ts::copyGateDeps` 同源（那边收 `.cjs`）。
 */
function relativeDeps(src: string): Array<string> {
  const found = new Set<string>();
  for (const m of src.matchAll(/^\s*(?:import|export)\b[^;]*?from\s+"(?<dep>\.\/[\w./-]+)"/gm)) {
    found.add((m.groups?.dep ?? "").replace(/^\.\//, ""));
  }
  return [...found];
}

/**
 * 从入口出发、按顶层静态 import **递归**收全 `scripts/**` 链路上的模块。
 * 为什么递归：`shell-ops.mjs` 还 import `splash-assets.mjs`（副本名唯一出口），只走一层会漏 —— 漏的表现
 * 正是 `indexOf` 落空、断言静默空转。返回**固定顺序**（`ENTRY` 打头、其余字典序），否则断言会随遍历顺序漂。
 */
function chainModules(): Array<string> {
  const seen = new Set<string>([ENTRY]);
  const queue = [ENTRY];
  while (queue.length > 0) {
    const rel = queue.shift()!;
    const abs = path.join(SCRIPTS, rel);
    if (!fs.existsSync(abs)) {
      throw new Error(
        `编排链路上登记的 ${rel} 不在 scripts/ 下 —— ` +
          "要么 import 写错了，要么这份文件被搬走而入口没跟着改",
      );
    }
    /* 说明符是**相对引用它的那一份**解析的（`./log.mjs` 写在
     * `launcher-core/preflight.mjs` 里指的是 `launcher-core/log.mjs`）——
     * 按入口目录去拼会在拆分之后给出「找不到 log.mjs」这种指不到病灶的报错。 */
    const baseDir = path.posix.dirname(rel);
    for (const dep of relativeDeps(fs.readFileSync(abs, "utf8"))) {
      /* 只收 `scripts/**` 内的形态。跨层引用（`../src/**`）不在 `scripts/` 里，
       * 它们是运行期兜底 `await import` 的落点，不属于这条链路的源码面。 */
      const resolved = path.posix.normalize(path.posix.join(baseDir, dep));
      if (resolved.startsWith("..") || seen.has(resolved)) {
        continue;
      }
      seen.add(resolved);
      queue.push(resolved);
    }
  }
  return [ENTRY, ...[...seen].filter((r) => r !== ENTRY).sort()];
}

/** `dev-launcher.mjs` 与它顶层静态 import 闭包里的每一份 `scripts/**`，拼成一份源码。 */
export function launcherChainSource(): string {
  return chainModules()
    .map((rel) => fs.readFileSync(path.join(SCRIPTS, rel), "utf8"))
    .join("\n");
}

/** 链路里**真的**存在这个片段吗（给「先确认夹具不是空转」那一步用）。 */
export function launcherChainHas(fragment: string): boolean {
  return launcherChainSource().includes(fragment);
}

/** 链路里包含片段的那份源码（找不到时给空串，调用点自己判）。 */
export function launcherChainWith(fragment: string): string {
  const src = launcherChainSource();
  return src.includes(fragment) ? src : "";
}
