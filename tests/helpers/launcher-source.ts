/**
 * 「启动编排链路的源码」—— 把 `dev-launcher.mjs` 与它拆出的 `launcher-core/**`
 * 拼成一份可断言的文本。
 *
 * 为什么需要它：编排器按 R5 拆过一刀（ISSUE #1811 第四刀，PR #1823，1540 → 953 行），
 * 预检 / 端口回收 / 下游 / 壳产物名 / 杂项各自成模块。于是「读 `dev-launcher.mjs`
 * 再 `indexOf` + `slice` 断言」这类用例**静默失效**了 —— 断言的那段搬进了别的文件，
 * `indexOf` 落空给 -1、`slice` 拿到空串，而 `not.toContain` / `not.toMatch` 对着空串
 * **恒真**，于是它们从「钉住契约」变成「永远绿」。字面上它们是红的（`toContain`
 * 那几条会报 `expected '' to contain …`），但这个失效方向本身是无声的。
 *
 * 两个口径：
 *   · **只拼只读**：拼的是给人读的源码文本，判据（`scripts/check-*.cjs`）不参与 ——
 *     谁住在哪个文件是**实现位置**，不是契约；契约是「编排链路上有没有这个形状」。
 *   · **清单不抄第二份**：链路由 `dev-launcher.mjs` 自己的顶层静态 import 现算，
 *     新增一份内部分件不必回来改这里（抄一份清单的代价是「下次拆文件又忘一处」，
 *     那正是这条 helper 要终结的形状）。
 */
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "../..");
const SCRIPTS = path.join(ROOT, "scripts");
const ENTRY = "dev-launcher.mjs";

/**
 * 从一份源码里现算它**顶层静态 import/export** 的同目录相对依赖（`./x.mjs` 形态）。
 *
 * 只认顶层静态：动态 `await import()` 是惰性的、不在加载期解析，两件事不能混。
 * `dev-launcher.mjs` 里那几处 `await import` 的落点
 * （`src/lib/process/kill-process-tree.ts` 等）也不在这条 `scripts/**` 链路上。
 *
 * 认的形状是 `from "./…"` —— 编排器这一层的相对引用全是这一种（与
 * `gate-repo.ts::copyGateDeps` 的口径同源，只是那边收 `.cjs`、这边收 `.mjs`）。
 */
function relativeDeps(src: string): Array<string> {
  const found = new Set<string>();
  for (const m of src.matchAll(/^\s*(?:import|export)\b[^;]*?from\s+"(\.\/[\w./-]+)"/gm)) {
    found.add(m[1]!.replace(/^\.\//, ""));
  }
  return [...found];
}

/**
 * 从入口出发、按顶层静态 import **递归**收全 `scripts/**` 这条链路上的模块。
 *
 * 为什么是递归：`launcher-core/shell-ops.mjs` 自己还 import
 * `launcher-core/splash-assets.mjs`（副本名的唯一出口），只走一层会漏掉它 ——
 * 而漏掉的表现正是这条 helper 想终结的那种：`indexOf` 落空、断言静默变空转。
 *
 * 返回**固定顺序**（`ENTRY` 打头、其余按字典序）而不是遍历顺序：同一份输入必须
 * 给出同一份输出，否则「断言在某一段」会随遍历顺序漂。
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
