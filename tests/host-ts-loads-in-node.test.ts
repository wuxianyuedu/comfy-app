/**
 * 跨宿主地基层模块在**真 Node 进程**里必须加载得起来（ISSUE #1961 / #1959 第七跑）。与 `esm-cross-host-imports.test.ts` 的分工：它判不到
 * 「说明符指得着、模块自己加载不起来」（目标文件改名照样绿，`node scripts/e2e-run.mjs` 仍退 1）。本判据只判这一格：误标 server-only
 * （入口即 throw）、顶层副作用抛错、依赖缺失；故起子进程而非 vitest 内 `import()`（立案前提正是两者不同路），复现跑 e2e 那一跳。
 */
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";

const ROOT = path.resolve(import.meta.dirname, "..");

/**
 * 这份清单**不重抄** `esm-cross-host-imports.test.ts` 的 `CROSS_HOST_MODULES`：
 * 从那份文件里读出来（它是这条边界的唯一出处）。抄一遍会立刻被 §12.12 的孪生判据
 * 盯上，且两份必然漂。
 */
function crossHostModules(): Array<string> {
  const source = readFileSync(path.join(ROOT, "tests", "esm-cross-host-imports.test.ts"), "utf8");
  const block = /const CROSS_HOST_MODULES\s*=\s*\[([\s\S]*?)\]/.exec(source)?.[1];
  if (block === undefined) {
    throw new Error(
      "读不出 `esm-cross-host-imports.test.ts` 的 `CROSS_HOST_MODULES` —— " +
        "那条边界的清单搬家了就先更新本判据，别让它静默判空。",
    );
  }
  return [...block.matchAll(/"([^"]+)"/g)].map((m) => m[1]!);
}

/** 在**真 Node 进程**里加载一个模块（不注册任何 loader）。 */
function loadInRealNode(absPath: string): { message: string; ok: boolean } {
  const r = spawnSync(
    process.execPath,
    [
      "--no-warnings",
      "-e",
      `import(${JSON.stringify(pathToFileURL(absPath).href)}).catch((e) => { console.error(e.code + "\\n" + e.message); process.exit(1); })`,
    ],
    { encoding: "utf8", cwd: ROOT, env: { ...process.env, NODE_ENV: "test" } },
  );
  if (r.status === 0) {
    return { ok: true, message: "" };
  }
  // oxlint-disable-next-line typescript/no-unnecessary-condition -- spawnSync 起不来时 stdout/stderr 实测为 undefined，@types/node 按非空标，空串兜底保留
  const message = `${r.stderr ?? ""}${r.stdout ?? ""}`.trim();
  return { ok: false, message: message || `(无输出，退出码 ${r.status})` };
}

describe("跨宿主地基层模块在真 Node 里加载得起来", () => {
  it("清单读得到（否则下面的判据会静默判空）", () => {
    const mods = crossHostModules();
    expect(
      mods.length,
      "边界清单是空的 —— 本判据会「全绿」而它其实什么都没判。" +
        "`esm-cross-host-imports.test.ts` 的 `CROSS_HOST_MODULES` 改名 / 改形状了？",
    ).toBeGreaterThan(0);
  });

  it("每个跨宿主地基层模块都能被真 Node 直接加载", () => {
    const failures: Array<string> = [];
    for (const rel of crossHostModules()) {
      const r = loadInRealNode(path.join(ROOT, rel));
      if (r.ok) {
        continue;
      }
      failures.push(
        `${rel}\n${r.message
          .split("\n")
          .slice(0, 3)
          .map((l) => `      ${l}`)
          .join("\n")}\n      ⇒ 它由 .mjs 宿主直接加载（平台侧 \`node scripts/e2e-run.mjs\`），` +
          `这一跳崩在「E2E 关键流程」的加载期；\n` +
          `        常见成因：误加了 \`import "server-only"\`（入口就是一句 throw）、` +
          `顶层读库未过 \`isSchemaReady()\`、\n` +
          `        或 import 了一个没装的包。`,
      );
    }
    expect(failures, `\n${failures.join("\n\n")}\n`).toEqual([]);
  }, 120_000);

  it("判据自己会红：喂不存在的路径必须判成加载失败", () => {
    // 反向自证：上面那条一旦把 `spawnSync` 的退出码读错（或判据悄悄退化成恒绿），
    // 只有这一格看得出来。两个方向都钉 —— 只判「不存在的必须红」会让「全都红」
    // 也满足；只判「存在的必须绿」会让恒绿满足。
    const missing = path.join(ROOT, "src", "lib", "process", "__no-such-module__.ts");
    expect(loadInRealNode(missing).ok).toBe(false);
    // 反方向用清单里第一个真模块（它必然在盘上：上一条用例刚加载过）。
    expect(loadInRealNode(path.join(ROOT, crossHostModules()[0]!))).toEqual({
      ok: true,
      message: "",
    });
  }, 60_000);
});
