/**
 * **跨宿主 `import` 的扩展名形态**（ISSUE #1961，实测红在平台侧 E2E）：Node 的 ESM 解析器不补扩展名，TS 侧惯例省略，
 * 故 `.mjs` 静态 import 一份 `.ts` 时必须写 `.ts`；写错侧本地能跑 —— `tsc` / `vitest` / `eslint` 各有解析规则，都看不见。
 * 判据两件缺一不可：① `CROSS_HOST_MODULES` 的地基层模块按源码形状判依赖闭包自封；② 每个 `.mjs` 宿主 `import()` 一次 —
 * 唯一能照出 `ERR_MODULE_NOT_FOUND` 的判据（宿主带顶层副作用只加载不调导出）。不写「正则判全仓带 `.ts`」：TS 侧正当省略数千处。 */
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = path.resolve(import.meta.dirname, "..");

/**
 * 「一个 `.mjs` 会直接或间接走到」的地基层模块（相对仓库根）。
 * 具名清单而非扫全目录：它是这条**边界**的清单，只在这几处存在（谁被 `.mjs` 引用就登记谁）。
 * 新增跨宿主 `.mjs` 时同步这里 —— 判据②会拿它去真加载，漏登记的那条链就没人验。
 */
const CROSS_HOST_MODULES = [
  "src/lib/process/platform.ts",
  "src/lib/process/executable-resolve.ts",
  "src/lib/process/python-candidates.ts",
  "src/lib/process/python-resolve.ts",
  "src/lib/process/probe-exe.ts",
  "src/lib/process/kill-process-tree.ts",
  /* `executable-resolve.ts` 拆出来的两块（它越过文件长度硬闸时按职责切的）：
   * 它们同样只依赖 `platform.ts` 与 node 内建，所以仍然是**叶子** —— 但必须登记
   * 在这里，否则判据 ① 会把它俩读成「清单外的依赖」。 */
  "src/lib/process/pnpm-resolve.ts",
  "src/lib/process/version-compare.ts",
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
function relativeSpecifiers(src: string): Array<string> {
  return [...src.matchAll(/from "(\.[^"]*)"/g)]
    .map((m) => m[1])
    .filter((v): v is string => v !== undefined);
}

describe("跨宿主 import 的扩展名形态（ISSUE #1961）", () => {
  it("每个跨宿主地基层模块都是**叶子**（只 import 同一批里的东西）", () => {
    const allowed = new Set(CROSS_HOST_MODULES);
    const offenders: Array<string> = [];
    for (const rel of CROSS_HOST_MODULES) {
      const src = readFileSync(path.join(ROOT, rel), "utf8");
      for (const spec of relativeSpecifiers(src)) {
        if (!spec.endsWith(".ts")) {
          offenders.push(`${rel} → ${spec}（跨宿主说明符必须带 .ts）`);
          continue;
        }
        const resolved = path.posix.normalize(path.posix.join(path.posix.dirname(rel), spec));
        if (!allowed.has(resolved)) {
          offenders.push(`${rel} → ${spec}（指向了清单外的模块）`);
        }
      }
    }
    expect(
      offenders,
      `跨宿主的那条链上出现了「清单外的依赖」或「不带 .ts 的说明符」——\n` +
        `前者会让 \`.mjs\` 宿主加载到一半 \`ERR_MODULE_NOT_FOUND\`（tsc / vitest 都照不出来），\n` +
        `后者在 Node 的 ESM 解析器下必然找不到文件（它不补扩展名）：\n${offenders
          .map((o) => `  ✗ ${o}`)
          .join("\n")}`,
    ).toEqual([]);
  });

  it("清单不是空转：每个模块都在盘上，且真的被某个 `.mjs` 引用", () => {
    for (const rel of CROSS_HOST_MODULES) {
      readFileSync(path.join(ROOT, rel), "utf8"); // 不存在就抛
    }
    const referenced = MJS_HOSTS.filter((h) =>
      relativeSpecifiers(readFileSync(path.join(ROOT, h), "utf8")).some((spec) =>
        spec.includes("src/lib/process/"),
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
