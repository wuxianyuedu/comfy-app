/**
 * 提交门槛 C 组的**启动那一步**的判据。
 *
 * ## 事故形状（这条判据不是预防性的，是补的）
 *
 * C 组原本是 `pnpm exec vitest run --maxWorkers=4 $files`。清单是位置参数，长度随
 * 改动面线性增长；而 `pnpm exec <bin>` 在 Windows 上经 `.cmd` shim，那条链的命令行
 * 上限是 cmd.exe 的 **8191 字符**。一次改了 22 个文件的提交，清单实测 10840 字符
 * —— vitest 根本没启动，stdout 只有一行 GBK 乱码（「文件名或扩展名太长」），
 * 钩子的表现是「组 C 失败」而看不见任何用例名。
 *
 * 危害不在「提交被拦」，而在**它长得像任何别的东西**：判据在场、跑的是 0 个用例、
 * 退出码非零但原因读不出。改动面越大的批次越容易撞上，也就是治理线自己的批次
 * 最先撞 —— 这与本仓库反复在收的那一族同源：「绿 ≠ 跑过」的反面形态「红 ≠ 跑过」。
 *
 * ## 判的四件事
 *
 * 1. 分块**不丢不重**（并集等于输入且顺序保持）—— 丢用例的形态就是「绿但没跑」；
 * 2. 每一块都在命令行长预算之内，且单个路径超预算时**点名红**而不是静默跳过；
 * 3. 启动器不经 shell 层（`spawnSync(process.execPath, …)`，没有 `shell: true`），
 *    钩子也不再直接拼 `pnpm exec vitest run $files`；
 * 4. 空清单必须被阻断，绝不让 `vitest run` 不带位置参数跑成全量。
 */
import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import {
  planLaunches,
  resolveVitestEntry,
  SAFE_ARGV_BUDGET,
} from "../scripts/run-affected-tests.mjs";

const HOOK_PATH = ".githooks/pre-commit";
const LAUNCHER_PATH = "scripts/run-affected-tests.mjs";

/** 造一份「n 个用例」的合成清单，单条长度接近真实值（约 60 字符）。 */
function syntheticFiles(count: number): string[] {
  return Array.from(
    { length: count },
    (_, i) =>
      `src/components/studio/feature-${Math.floor(i / 100)}/hooks/use-thing-${i}.test.ts`,
  );
}

/**
 * C 组的**实调用体**：`run_group C "…" sh -c '<body>'` 里那段 shell，剔掉行首是 `#` 的行。
 *
 * 为什么解析而不是 `hook.toContain("scripts/run-affected-tests.mjs")`：本文件上方那段
 * 机制说明里就写着这个文件名，`toContain` 会**在注释上命中** —— 有人把那一行注掉，
 * 判据照样绿。同一条教训由刚落地的 `tests/doc-check-hook-wiring.test.ts` 给出
 * （「在场判据要解析、不要 toContain」，规范 §13.5.8）。
 */
function cGroupBody(hookText: string): string {
  const block = /run_group C\s+"[^"]*"\s+sh\s+-c\s+'([\s\S]*?)'/.exec(hookText);
  const raw = block?.[1];
  if (raw === undefined) return "";
  return raw
    .split("\n")
    .filter((line) => !/^\s*#/.test(line))
    .join("\n");
}

describe("受影响用例的启动器", () => {
  it("分块不丢不重，且顺序与输入一致", () => {
    const files = syntheticFiles(400);
    /* 用一个**故意小**的预算来逼出多块：判据要的是「分块策略不丢用例」这条性质，
     * 而不是「400 条恰好会超真实的 24000」那种会随模板长度腐烂的算术。 */
    const chunks = planLaunches(files, 4_000);
    const flattened = chunks.flat();
    expect(flattened).toEqual(files);
    expect(flattened).toHaveLength(files.length);
    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) {
      expect(chunk.join(" ").length).toBeLessThanOrEqual(4_000);
    }
  });

  it("每一块的命令行都不超预算（预算放大到真实值也一样）", () => {
    const files = syntheticFiles(1200);
    for (const chunk of planLaunches(files, SAFE_ARGV_BUDGET)) {
      expect(chunk.join(" ").length).toBeLessThanOrEqual(SAFE_ARGV_BUDGET);
    }
    expect(planLaunches(files, SAFE_ARGV_BUDGET).flat()).toHaveLength(1200);
  });

  it("实测那份清单的长度在预算内 —— 只起一次（钩子把三次冷启合成一次的那笔账不能倒退）", () => {
    /* 真实值：一次改 22 个文件的提交算出 229 个用例 / 10840 字符，正是它顶穿了
     * cmd.exe 的 8191 却仍在 node 直起的预算内。按同样的规模合成一份，必须是一整块。 */
    const files = syntheticFiles(229);
    const joined = files.join(" ");
    expect(joined.length).toBeGreaterThan(8_191);
    expect(joined.length).toBeLessThanOrEqual(SAFE_ARGV_BUDGET);
    expect(planLaunches(files, SAFE_ARGV_BUDGET)).toHaveLength(1);
  });

  it("单条路径就超预算时点名红，不静默丢掉它", () => {
    const tooLong = ["src/" + "a".repeat(SAFE_ARGV_BUDGET) + ".test.ts"];
    expect(() => planLaunches(tooLong, SAFE_ARGV_BUDGET)).toThrow(
      /单个路径就超过命令行长预算/,
    );
  });

  it("空清单不产出任何一块 —— 阻断由调用方负责（否则 vitest 会跑成全量）", () => {
    expect(planLaunches([])).toEqual([]);
  });

  it("vitest 的 ESM 入口在本机解析得到（写死 node_modules 路径会指到空气上）", () => {
    const entry = resolveVitestEntry();
    expect(entry.endsWith("vitest.mjs")).toBe(true);
    // pnpm 布局下真身在 `.pnpm/vitest@<ver>…/node_modules/vitest/`，顶层是链接。
    expect(entry.replace(/\\/g, "/")).toContain("/vitest/");
  });

  it("启动器不经 shell 层：spawn 的是 node 自己，且没有 shell:true", () => {
    const src = readFileSync(LAUNCHER_PATH, "utf8");
    expect(src).toContain("spawnSync(");
    expect(src).toContain("process.execPath");
    expect(src).not.toMatch(/shell:\s*true/);
    // 反向：不许退回「把清单交给 pnpm/exec 的 cmd shim」那一条链。
    expect(src).not.toMatch(/pnpm\s+exec\s+vitest/);
    expect(src).not.toMatch(/npx\s+vitest/);
  });

  it("钩子的 C 组走这个入口，且不再把清单直接拼成 `pnpm exec vitest run $files`", () => {
    const hook = readFileSync(HOOK_PATH, "utf8");
    // 扫描面非空：C 组整块被改名时「零命中」会长得像「都接好了」。
    expect(hook).toContain("run_group C");
    const body = cGroupBody(hook);
    expect(body).not.toBe("");
    expect(body).toMatch(/node\s+scripts\/run-affected-tests\.mjs/);
    expect(body).not.toMatch(/pnpm\s+exec\s+vitest/);
    expect(body).not.toMatch(/\$files/);
  });

  it("反向证明：注掉那一行、或退回旧拼法，都必须被照出来", () => {
    /* 这一条专防「判据在注释上命中」：本文件上方的机制说明里也写着那个文件名，
     * 只看整份文本的 toContain 分不出「在执行」与「已被静音」。教训来自落地的
     * `tests/doc-check-hook-wiring.test.ts`（规范 §13.5.8「在场判据要解析」）。 */
    const muted = [
      'run_group C "结构守护测试" sh -c \'',
      "  # node scripts/run-affected-tests.mjs",
      "'",
    ].join("\n");
    expect(cGroupBody(muted)).toBe("");

    const oldShape = [
      'run_group C "结构守护测试" sh -c \'',
      "  files=$(node scripts/affected-tests.mjs) || exit 1",
      "  pnpm exec vitest run --maxWorkers=4 $files'",
    ].join("\n");
    const oldBody = cGroupBody(oldShape);
    expect(oldBody).toMatch(/pnpm\s+exec\s+vitest/);
    expect(oldBody).not.toMatch(/node\s+scripts\/run-affected-tests\.mjs/);
  });
});
