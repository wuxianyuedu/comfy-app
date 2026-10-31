/**
 * `affected-launch-noise-reporter.mjs` 的判据 + `spawnVitest` 噪音过滤的端到端判据。
 *
 * 为什么要测：这条过滤一旦把「真红」也吞掉，CI 就退化成「绿 ≠ 跑过」—— 这正是本仓反复在
 * 收的那一族的反面形态。所以这里用**反向对照**钉死边界：给一组「已知良性噪音」与一组「真红 /
 * 真挂死 / 真超时」原文，前者一律 `isNoiseLine === true`、后者一律 `false`；再端到端验证
 * `spawnVitest` 真的把噪音行从 stdout/stderr 里抠掉、但把真红原文留下。
 */
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import { filterSpawnOutput, spawnVitest } from "../scripts/affected-launch-spawn.mjs";
import {
  FIXTURE_NOISE_PATTERN,
  NOISE_PATTERN,
  filterNoiseText,
  isNoiseLine,
  resolveNoiseFilter,
} from "../scripts/affected-launch-noise-reporter.mjs";

/** 用户 2026-10-31 报上来的、来自受影响用例门的真实噪音行（逐字取自 CI 日志）。 */
const BENIGN = [
  // ECONNREFUSED ::1 / 127.0.0.1 :3000（开发服务器没起，环境性连接拒绝）
  "    at internalConnectMultiple (node:net:1492:18)",
  "    at afterConnectMultiple (node:net:2161:7) {",
  "Error: connect ECONNREFUSED ::1:3000",
  "        at createConnectionError (node:net:2124:14)",
  "      errno: -4078,",
  "      address: '::1',",
  "Error: connect ECONNREFUSED 127.0.0.1:3000",
  // canvas-sync 重试日志（最吵的一族，每条用例一行 + 整串 node_modules 路径）
  "[canvas-sync] 这份画布没能存进服务端（暂时性，下一次自动保存会再试）： 这份画布没能存进服务端（暂时性，下一次自动保存会再试）：Stream closed before head was received TRPCClientError — Stream closed before head was received — TRPCClientError: Stream closed before head was received |     at TRPCClientError.from (file:///G:/ci-cache/...)",
  // a11y-axe-stories 故意渲染会抛错的 error-boundary / lazy-chunk 故事
  "Error: 渲染期炸了：这个子树的 props 不合法",
  "    at Boom (G:/runner/.../src/components/ui/error-boundary.stories.tsx:44:11)",
  "[ErrorBoundary] Error: 渲染期炸了：这个子树的 props 不合法",
  "The above error occurred in the <Boom> component.",
  "React will try to recreate this component tree from scratch using the error boundary you provided, ErrorBoundary.",
  "Error [ChunkLoadError]: Failed to load chunk /_next/static/chunks/src_abc123._.js from module [project]/src/components/workshop/ScriptGenerator.tsx",
  "    at chunkFailure (G:/runner/.../src/components/ui/use-lazy-chunk-fallback.stories.tsx:40:15)",
];

/** 真红 / 真挂死 / 真超时 —— 这些必须原样留下，绝不能当噪音删。 */
const REAL = [
  "AssertionError: expected 3 to be 4",
  "    at Object.<anonymous> (tests/foo.test.ts:12:3)",
  "Test timed out in 120000ms.",
  "Timeout waiting for the worker pool to be ready for new tests.",
  "Failed to start forks worker.",
  "Cannot find module 'x'",
  "Error: connect ECONNREFUSED 127.0.0.1:6379   # redis 没起是真红，端口不是 3000，必须留下",
  "AggregateError: 这俩 promise 都拒了（与 :3000 无关，必须留下）",
];

describe("isNoiseLine —— 良性 / 真红 边界", () => {
  for (const line of BENIGN) {
    it(`良性噪音应判 true：${line.slice(0, 48)}…`, () => {
      expect(isNoiseLine(line)).toBe(true);
    });
  }
  for (const line of REAL) {
    it(`真红 / 真挂死 / 真超时必须 false：${line.slice(0, 48)}…`, () => {
      expect(isNoiseLine(line)).toBe(false);
    });
  }
  it("空行 / 非字符串不崩", () => {
    expect(isNoiseLine("")).toBe(false);
    expect(isNoiseLine(undefined)).toBe(false);
    expect(isNoiseLine(null)).toBe(false);
  });
});

describe("filterNoiseText —— 按行抠掉噪音", () => {
  it("把噪音行删掉、其余逐字保留（连空行也保留）", () => {
    const text = ["前面一句真信息", ...BENIGN, "后面一句真信息", ...REAL].join("\n");
    const out = filterNoiseText(text).split("\n");
    expect(out).toContain("前面一句真信息");
    expect(out).toContain("后面一句真信息");
    for (const noisy of REAL) expect(out).toContain(noisy);
    for (const noisy of BENIGN) expect(out).not.toContain(noisy);
  });
});

describe("resolveNoiseFilter —— 只认 1 / true", () => {
  it("'1' 开屏", () => {
    const got = resolveNoiseFilter("1");
    expect(got.enabled).toBe(true);
    expect(typeof got.note).toBe("string");
  });
  it("'true' 开屏", () => {
    expect(resolveNoiseFilter("true").enabled).toBe(true);
  });
  it("空 / '0' / 其他 一律关", () => {
    expect(resolveNoiseFilter(undefined).enabled).toBe(false);
    expect(resolveNoiseFilter("0").enabled).toBe(false);
    expect(resolveNoiseFilter("on").enabled).toBe(false);
    expect(resolveNoiseFilter("").enabled).toBe(false);
  });
});

describe("spawnVitest end-to-end —— 真起 node 验证过滤写入", () => {
  let dir: string | undefined;
  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
    dir = undefined;
    vi.restoreAllMocks();
  });

  it("回吐的 stdout/stderr 里噪音行被抠掉、真红原文留下", async () => {
    dir = mkdtempSync(path.join(tmpdir(), "noise-"));
    const entry = path.join(dir, "emit.mjs");
    writeFileSync(
      entry,
      [
        `process.stdout.write(${JSON.stringify(BENIGN[6] + "\n")});`,
        `process.stdout.write(${JSON.stringify(REAL[0] + "\n")});`,
        `process.stderr.write(${JSON.stringify(BENIGN[8] + "\n")});`,
        `process.stderr.write(${JSON.stringify(REAL[3] + "\n")});`,
      ].join("\n"),
    );

    const out: Array<string> = [];
    const err: Array<string> = [];
    vi.spyOn(process.stdout, "write").mockImplementation((c) => {
      out.push(String(c));
      return true;
    });
    vi.spyOn(process.stderr, "write").mockImplementation((c) => {
      err.push(String(c));
      return true;
    });

    spawnVitest(entry, [], { filterLine: isNoiseLine });

    const outStr = out.join("");
    const errStr = err.join("");
    expect(outStr).not.toContain(BENIGN[6]); // 噪音行（:3000）被抠掉
    expect(outStr).toContain(REAL[0]); // 真断言错误留下
    expect(errStr).not.toContain(BENIGN[8]); // canvas-sync 噪音被抠掉
    expect(errStr).toContain(REAL[3]); // 真超时指纹留下
  });
});

describe("filterSpawnOutput 纯函数（超时 / 装载指纹不被吞）", () => {
  it("不过滤时逐字拼接", () => {
    expect(filterSpawnOutput("a", "b")).toBe("ab");
    expect(filterSpawnOutput("a", "b", undefined)).toBe("ab");
  });
  it("过滤后噪音指纹（真超时）仍在、噪音行被删", () => {
    const stdout = ["real line", "::1:3000 refused"].join("\n");
    const stderr = ["Test timed out in 120000ms.", "127.0.0.1:3000 refused"].join("\n");
    const out = filterSpawnOutput(stdout, stderr, isNoiseLine);
    expect(out).toContain("real line");
    expect(out).toContain("Test timed out in 120000ms."); // 真超时指纹保留
    expect(out).not.toContain("::1:3000");
    expect(out).not.toContain("127.0.0.1:3000");
  });
});

// 顺手锁一下 NOISE_PATTERN 是合法正则（避免误写字符类把整张清单判成空、噪音被读成干净）。
it("NOISE_PATTERN 是合法正则", () => {
  expect(() => new RegExp(NOISE_PATTERN)).not.toThrow();
});

/* ── 第二批（ISSUE #2844）：夹具 spawn 的 git / 探针 / 设计内失败 / storybook 警告块 ──
 * 逐字取自 build cnb-hkh-1k68d3ms7（2026-10-31 15:20）的平台日志 —— 与第一批不同源：
 * 这批走 stdout（夹具自己 spawn 的子进程与探针抬头），不是被测源码的 stderr 错误。 */
describe("FIXTURE_NOISE_PATTERN —— 夹具 / 探针输出的良性形态", () => {
  const FIXTURE_BENIGN = [
    // git autocrlf 传输警告（夹具 spawn git 必漏）
    "warning: in the working copy of 'src/a.ts', LF will be replaced by CRLF the next time Git touches it",
    "warning: in the working copy of 'scripts/x.mjs', LF will be replaced by CRLF the next time Git touches it",
    // `git worktree add` 的进度行
    "Preparing worktree (detached HEAD 33d47fe)",
    // 负向用例按设计造的 git 失败（junit 保全量，见判据文件头的交换说明）
    "fatal: not a git repository (or any of the parent directories): .git",
    // e2e-run 设计内失败抬头 + 它的箭头注解
    String.raw`[e2e-run/test] × 起不了 Playwright（G:\runner\…\no-such-playwright-runner）：失败码 ENOENT —— 盘上没有 / 起不来的形态见 resolveCommandInvocation（§2.1.1）`,
    "          ↑ 这条是**判据按设计造的失败**（负向用例要的正是这个出口），不是这一跑起不来。",
    // ci-env-probe 的裸段名抬头（×6；只收裸行，带内容的行是真读数）
    "[ports]",
    "[python]",
    "[schema]",
    "[browser]",
    // ci-install-deps 判据被夹具 exercise 时的原话
    "[ci-install-deps] 安装：node_modules 不在或不完整（全新 clone / 被清过 —— 平台侧每一次都是这种形态）",
    "[ci-install-deps] √ 跳过安装：依赖面（pnpm-lock.yaml / package.json / pnpm-workspace.yaml / next.config.js）一项都没碰，且 node_modules 就是照这一份装的",
    "[ci-install-deps] 安装：依赖面被碰过：pnpm-lock.yaml",
    // storybook extensionless 警告块（触发行 / 框线行 / 超链接包装）
    "▲  One or more extensionless imports detected: \"./app-origin-defaults\" in",
    "│  file",
    String.raw`│  "G:\runner\…\.storybook\main.ts".`,
    "│  For more information on how to resolve the issue:",
    "]8;;https://storybook.js.org/docs/faq#extensionless-imports-in-storybookmaints-and-required-ts-extensionshttps://storybook.js.org/docs/faq#extensionless-imports-in-st...]8;;",
    // 孤立 x 行（两次构建都在场、源未定位 —— 按观察形态收，见判据文件头）
    "x",
  ];

  it("第二批良性形态一律判 true（逐字对照两次实构建）", () => {
    for (const line of FIXTURE_BENIGN) {
      expect(isNoiseLine(line), `这一行应判噪音：${line.slice(0, 60)}`).toBe(true);
    }
  });

  it("反向：带内容的探针行是真读数，不因段名前缀被误删（裸行限定）", () => {
    for (const real of [
      "[ports] :3000 已被占用（pid 1234）—— 真读数，必须留下",
      "[python] CPython 3.12.1 —— 真读数，必须留下",
      "xx",
      "AssertionError: expected 3 to be 4",
    ]) {
      expect(isNoiseLine(real), `这一行必须留下：${real.slice(0, 50)}`).toBe(false);
    }
  });

  it("FIXTURE_NOISE_PATTERN 是合法正则", () => {
    expect(() => new RegExp(FIXTURE_NOISE_PATTERN)).not.toThrow();
  });

  it("两张清单合流：isNoiseLine 对两族各认各的", () => {
    expect(isNoiseLine("Error: connect ECONNREFUSED ::1:3000")).toBe(true); // 第一批
    expect(isNoiseLine("[ports]")).toBe(true); // 第二批
  });
});
