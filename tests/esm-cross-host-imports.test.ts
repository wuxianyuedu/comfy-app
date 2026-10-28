/**
 * **跨宿主 `import` 的扩展名形态**（ISSUE #1961，实测红在平台侧 E2E 上）。
 *
 * ## 立案现场
 *
 * ```
 * 报的那句是：`ERR_MODULE_NOT_FOUND` —— 找不到模块
 * `…/src/lib/process/executable-resolve`，而它由 `python-candidates.ts` import。
 * ```
 *
 * 红在 `E2E 关键流程`（1 秒退），而**前面 30 个 stage 全绿** —— 也就是说这条链只在
 * 「`.mjs` 静态 import 一份 `.ts`」的那条路上成立，`tsc` / `vitest` / `eslint` 一个
 * 都看不见它（它们各自有自己的解析规则：`tsc` 与 Vite 会替你补扩展名，Node 不会）。
 *
 * 机制一句话：**Node 的 ESM 解析器不补扩展名**。本仓 TS 侧的惯例是省略
 * （`from "./executable-resolve"`），而 `.mjs` 静态 import 一份 `.ts` 时说明符
 * **必须**是 `from "./executable-resolve.ts"`。于是「同一个模块被两侧 import」时，
 * 只有一种写法在运行时成立 —— 而写错的那一侧在本地能跑（开发机上要么走了别的宿主、
 * 要么根本没走到那条链）。
 *
 * ## 判据怎么判（不去猜，去真加载）
 *
 * 判两件事，缺一件这条链就又一次静默断掉：
 *
 *   ① **叶子性**：能被 `.mjs` 直接加载的那几个地基层模块（`platform.ts` /
 *      `executable-resolve.ts` / `python-candidates.ts` / `python-resolve.ts` /
 *      `kill-process-tree.ts`）**不许**从 `src/lib` 里 import 别的东西 —— 只要它们
 *      的依赖闭包封闭在自己的目录内、且每一层都用 `.ts` 后缀，链就不会断。
 *      这条按**源码形状**判（为什么不用真加载判：`kill-process-tree.ts` 那条链要
 *      起真进程，代价与判它是不是叶子不成比例）。
 *   ② **`.mjs` 侧真加载一次**：把每个 `.mjs` 宿主（`e2e/support/*.mjs` +
 *      `scripts/launcher-core/*.mjs`）`import()` 一遍 —— 这是**唯一**能照出上面那个
 *      `ERR_MODULE_NOT_FOUND` 的判据（`tsc` / `vitest` 都照不出来，实测）。
 *      宿主里有的带顶层副作用（起子进程 / 读环境），所以**只加载、不调用导出**。
 *
 * 为什么不是「写一条正则判所有说明符都带 `.ts`」：本仓 TS 侧**正当地**省略扩展名
 * （几千处），把惯例反过来是另一个决定、不在本笔范围内。这条判据管的是
 * **能跨到 `.mjs` 的那条边界**。
 */
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = path.resolve(import.meta.dirname, "..");

/**
 * 「一个 `.mjs` 会直接或间接走到」的地基层模块（相对仓库根）。
 *
 * 收成具名清单而不是扫全目录：它是**这条边界的清单**，而边界只在这几处存在
 * （谁被 `.mjs` 引用就登记谁）。新增一个跨宿主的 `.mjs` 时同步这里 —— 判据 ② 会
 * 拿它去真加载，漏登记的那条链就没有人验。
 */
const CROSS_HOST_MODULES = [
  "src/lib/process/platform.ts",
  "src/lib/process/executable-resolve.ts",
  "src/lib/process/python-candidates.ts",
  "src/lib/process/python-resolve.ts",
  "src/lib/process/probe-exe.ts",
  "src/lib/process/kill-process-tree.ts",
];

/** `.mjs` 侧的宿主：直接 `import` 上面那些模块的那些文件。 */
const MJS_HOSTS = [
  "e2e/support/preflight-python.mjs",
  "e2e/support/fake-comfyui-executor-env.mjs",
  "scripts/launcher-core/shell.mjs",
  "scripts/launcher-core/downstream.mjs",
  "scripts/launcher-core/preflight.mjs",
];

/** 一份 TS 里的相对 import 说明符。 */
function relativeSpecifiers(src: string): string[] {
  return [...src.matchAll(/from "(\.[^"]*)"/g)]
    .map((m) => m[1])
    .filter((v): v is string => v !== undefined);
}

describe("跨宿主 import 的扩展名形态（ISSUE #1961）", () => {
  it("每个跨宿主地基层模块都是**叶子**（只 import 同一批里的东西）", () => {
    const allowed = new Set(CROSS_HOST_MODULES);
    const offenders: string[] = [];
    for (const rel of CROSS_HOST_MODULES) {
      const src = readFileSync(path.join(ROOT, rel), "utf8");
      for (const spec of relativeSpecifiers(src)) {
        if (!spec.endsWith(".ts")) {
          offenders.push(`${rel} → ${spec}（跨宿主说明符必须带 .ts）`);
          continue;
        }
        const resolved = path.posix.normalize(
          path.posix.join(path.posix.dirname(rel), spec),
        );
        if (!allowed.has(resolved)) {
          offenders.push(`${rel} → ${spec}（指向了清单外的模块）`);
        }
      }
    }
    expect(
      offenders,
      "跨宿主的那条链上出现了「清单外的依赖」或「不带 .ts 的说明符」——\n" +
        "前者会让 `.mjs` 宿主加载到一半 `ERR_MODULE_NOT_FOUND`（tsc / vitest 都照不出来），\n" +
        "后者在 Node 的 ESM 解析器下必然找不到文件（它不补扩展名）：\n" +
        offenders.map((o) => `  ✗ ${o}`).join("\n"),
    ).toEqual([]);
  });

  it("清单不是空转：每个模块都在盘上，且真的被某个 `.mjs` 引用", () => {
    for (const rel of CROSS_HOST_MODULES) {
      readFileSync(path.join(ROOT, rel), "utf8"); // 不存在就抛
    }
    const referenced = MJS_HOSTS.filter((h) =>
      relativeSpecifiers(readFileSync(path.join(ROOT, h), "utf8")).some(
        (spec) => spec.includes("src/lib/process/"),
      ),
    );
    expect(
      referenced.length,
      "没有任何 `.mjs` 宿主引用 `src/lib/process/*` —— 清单指的是一条不存在的边界",
    ).toBeGreaterThan(0);
  });

  it("`.mjs` 宿主真加载得起来（本地唯一能照出 ERR_MODULE_NOT_FOUND 的判据）", async () => {
    for (const host of MJS_HOSTS) {
      /* 只 `import()`，**不调用任何导出** —— 这些宿主里有带顶层副作用的
       * （读环境 / 建缓存），调用它们不是本判据的事。 */
      await expect(
        import(path.join(ROOT, host)),
        `${host} 静态 import 链上有 Node 的 ESM 解析器找不到的说明符` +
          `（实测形态：ERR_MODULE_NOT_FOUND，而 tsc / vitest 全绿）`,
      ).resolves.toBeTruthy();
    }
  });

  it("`.mjs` 宿主确实来自 `e2e/` 与 `scripts/launcher-core/`（扫的是真的那几个目录）", () => {
    for (const dir of ["e2e/support", "scripts/launcher-core"]) {
      const files = readdirSync(path.join(ROOT, dir));
      expect(files.some((f) => f.endsWith(".mjs"))).toBe(true);
    }
    for (const host of MJS_HOSTS) {
      expect(host.endsWith(".mjs")).toBe(true);
    }
  });
});
