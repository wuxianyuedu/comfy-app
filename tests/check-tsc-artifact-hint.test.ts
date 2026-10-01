/**
 * `check-tsc-artifact-hint.cjs` 的判据（ISSUE #1182 的方案 3）。
 *
 * 这条判据的价值全在**不误报**上：组 A 也会因别的原因红（真类型错、OOM、参数错），
 * 那时还给「删掉 .next 重跑」就是把人往错方向带 —— 哭一次狼，之后这条提示就没人信了。
 * 所以正反两向都要有用例，且正向用**真实的 tsc 输出**：
 * ① 现场原文（#1182 的两行，含 Windows 反斜杠形态）；
 * ② 本地复演读数 —— 把 `.next/dev/types/validator.ts` 复制一份、在第 79 行的
 *    `type __IsExpected<Specific extends AppPageConfig` 处截断，`pnpm exec tsc --noEmit
 *    --incremental false` 给出的是单行 `.next/dev/types/validator.ts(79,51): error
 *    TS1005: '>' expected.`（exit 1）。
 *
 * 顺带把提示里那条处置命令的前提也钉住：整目录删除**不会**引出新的红 —— 同一份截断件
 * 在 `.next/dev/types` 整目录不存在时 tsc 为 exit 0，`next-env.d.ts` 虽然 import 了
 * 同目录的 `routes.d.ts`，缺生成目录并不报错（所以脚本才敢把 `rm -rf` 印给用户）。
 */
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// 判据脚本是 CJS（与 scripts/check-*.cjs 同族，`@ts-nocheck` 后经 require 进来是 any），
// 按仓库惯例给 mod 显式标注返回形状。
// eslint-disable-next-line @typescript-eslint/no-require-imports
const mod = require("../scripts/check-tsc-artifact-hint.cjs") as {
  classifyTscErrors: (text: string) => {
    total: number;
    files: string[];
    artifactFiles: string[];
    codeFiles: string[];
    artifactOnly: boolean;
  };
  buildHint: (v: unknown) => string;
  isNextArtifact: (filePath: string) => boolean;
};

const { classifyTscErrors, buildHint, isNextArtifact } = mod;

/** #1182 现场原文（POSIX 形态）：两条都落在生成物上。 */
const REAL_ARTIFACT_OUTPUT = [
  "── 组 A：tsc --noEmit",
  ".next/dev/types/validator.ts(80,46): error TS1005: '?' expected.",
  ".next/dev/types/validator.ts(85,1): error TS1128: Declaration or statement expected.",
  "",
].join("\n");

/** 同一现场的 Windows 形态（tsc 给反斜杠；漏了这条就等于在本机没测）。 */
const REAL_ARTIFACT_OUTPUT_WIN =
  ".next\\dev\\types\\validator.ts(80,46): error TS1005: '?' expected.\r\n" +
  ".next\\dev\\types\\validator.ts(85,1): error TS1128: Declaration or statement expected.\r\n";

describe("tsc 生成物报错的点破（#1182）", () => {
  it("报错全在 .next 生成物上 → 认定 artifactOnly 并给出处置命令", () => {
    const v = classifyTscErrors(REAL_ARTIFACT_OUTPUT);
    expect(v.total).toBe(2);
    expect(v.artifactOnly).toBe(true);
    expect(v.codeFiles).toEqual([]);

    const hint = buildHint(v);
    expect(hint).toContain(".next/dev/types/validator.ts");
    // 最小动作（只删报错那个文件）排在整目录删除前面。
    expect(hint).toContain("rm -f .next/dev/types/validator.ts");
    expect(hint).toContain("rm -rf .next/dev/types");
    expect(hint).toContain("ISSUE #1182");
    // 不许把这条说成「已解决」：它只做定性，共写还在（另两条候选已按实测判死，见下面那条用例）。
    expect(hint).toContain("本提示只做定性");
  });

  it("防复发不许再建议「给第二实例换 distDir」（实测会把共写搬到受版本控制的文件上）", () => {
    const hint = buildHint(classifyTscErrors(REAL_ARTIFACT_OUTPUT));
    // 这条用例钉的是**一句不该再出现的话**：#1311 那版写着「起第二实例时给它独立的 `.next`
    // （`distDir` 按端口/实例分叉）」，而实测（Next 16.3.5，真起一个 `distDir=.next-probe-1182`
    // 的第二实例）是 Next 自己往 `tsconfig.json` 的 `include` 追加两条实例目录、并把
    // `next-env.d.ts` 的 import 改写成指向它 —— 那个实例的半截 validator.ts 照样进组 A，
    // 共写没消除，还多脏了一个受版本控制的文件。照旧建议等于把下一个人推向更糟的形态。
    expect(hint).not.toMatch(/distDir 按端口|给它独立的/);
    expect(hint).toContain("别在同一目录双开");
    expect(hint).toContain("git worktree");
  });

  it("Windows 反斜杠形态同样认得（本机就是这个形态）", () => {
    const v = classifyTscErrors(REAL_ARTIFACT_OUTPUT_WIN);
    expect(v.total).toBe(2);
    expect(v.artifactOnly).toBe(true);
    expect([
      ...new Set(v.artifactFiles.map((f) => f.replace(/\\/g, "/"))),
    ]).toEqual([".next/dev/types/validator.ts"]);
  });

  it("本地复演的真 tsc 读数（单行 TS1005）也点破 —— 不要求凑够两条", () => {
    const v = classifyTscErrors(
      ".next/dev/types/validator.ts(79,51): error TS1005: '>' expected.\n",
    );
    expect(v.total).toBe(1);
    expect(v.artifactOnly).toBe(true);
  });

  it("掺了一个真实源码文件的错 → **不**给生成物提示（不能让人忽略真错）", () => {
    const v = classifyTscErrors(
      REAL_ARTIFACT_OUTPUT +
        "src/lib/comfyui/executor-ws.ts(12,3): error TS2304: Cannot find name 'foo'.\n",
    );
    expect(v.total).toBe(3);
    expect(v.artifactOnly).toBe(false);
    expect(v.codeFiles).toEqual(["src/lib/comfyui/executor-ws.ts"]);
  });

  it("组 A 因别的原因红（一条 error 都没有）→ 完全沉默，不哭狼", () => {
    for (const text of [
      "",
      "Command failed: pnpm exec tsc --noEmit\nFATAL ERROR: Reached heap limit\n",
      "error TS5083: Cannot read file 'tsconfig.json'.\n",
      "── 组 A：tsc --noEmit\n",
    ]) {
      const v = classifyTscErrors(text);
      expect(v.artifactOnly, JSON.stringify(text.slice(0, 40))).toBe(false);
    }
  });

  it("绝对路径里带 /.next/ 也算生成物（tsc 有时给全路径）", () => {
    expect(isNextArtifact("/home/u/proj/.next/dev/types/routes.d.ts")).toBe(
      true,
    );
    expect(isNextArtifact("F:\\proj\\.next\\dev\\types\\validator.ts")).toBe(
      true,
    );
    // `.nextify/` 这种目录名不算 —— 判据认的是那一个目录段。
    expect(isNextArtifact("src/.nextify/thinger.ts")).toBe(false);
    expect(isNextArtifact("src/app/page.ts")).toBe(false);
  });

  it("CLI 读到不可读的日志时安静退出（附属信息不该制造第二种失败）", () => {
    const r = spawnSync(
      process.execPath,
      ["scripts/check-tsc-artifact-hint.cjs", "--file", "does-not-exist.log"],
      { encoding: "utf8" },
    );
    expect(r.status).toBe(0);
    expect(r.stdout.trim()).toBe("");
  });
});

/**
 * 判据自己被挂进门槛：钩子失败分支里要有这一跳，且**不许**改动退出码口径
 * （`|| true` 是关键 —— 少写它，这条提示脚本自己崩了会把「组 A 红」变成「门槛崩」）。
 */
describe("门槛接线", () => {
  const hook = readFileSync(".githooks/pre-commit", "utf8");

  it("组 A 失败时调用点破脚本，并兜住它自己的失败", () => {
    expect(hook).toContain("check-tsc-artifact-hint.cjs");
    expect(hook).toMatch(
      /if \[ "\$id" = "A" \]; then[\s\S]*?\|\| true\s*\n\s*fi/,
    );
  });
});
