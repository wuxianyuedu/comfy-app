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

import { filterSpawnOutput } from "../scripts/affected-launch-spawn.mjs";
import {
  NOISE_PATTERN,
  filterNoiseText,
  isNoiseLine,
  resolveNoiseFilter,
} from "../scripts/affected-launch-noise-reporter.mjs";
import { spawnVitest } from "../scripts/affected-launch-spawn.mjs";

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

    const out: string[] = [];
    const err: string[] = [];
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
