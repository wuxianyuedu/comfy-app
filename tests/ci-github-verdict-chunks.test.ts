/** `ci-print-log-chunk.mjs` / `ci-github-verdict-decide.mjs` 用例（「日志分块」与「判决判定」两格）。
 *
 * 这两格是 `.cnb.yml` 里**不许红**的那几格：读不到清单 / 这一块不存在 / 块文件缺失都只念一行、
 * 退 0；判决格反过来 —— 读不到判定文件就退 2（fail-closed）。用例把这两条边界都钉住。 */
import { describe, expect, it } from "vitest";
import path from "node:path";
import {
  LOG_CHUNKS_DIR_REL,
  LOG_CHUNK_STATIC_STAGES,
  LOG_MANIFEST_FILE_NAME,
} from "../scripts/ci-github-verdict-logs.mjs";
import { normalizeDecision, decide, parseArgs } from "../scripts/ci-github-verdict-decide.mjs";
import {
  normalizeManifest,
  parseIndex,
  renderChunk,
  renderChunkFromDisk,
} from "../scripts/ci-print-log-chunk.mjs";

const MANIFEST = {
  base64Bytes: 157_836,
  chunkCount: 2,
  gzipBytes: 118_375,
  printedChunks: 2,
  rawBytes: 616_395,
  sha256: "a".repeat(64),
};

/** 假盘：按路径给文本（其余一律抛 ENOENT，模拟「没落盘」）。路径先归一，跨平台同一套键。 */
const fakeDisk = (files: Record<string, string>) => (file: string) => {
  const key = path.normalize(file).replace(/\\/gu, "/");
  const hit = files[key];
  if (hit === undefined) {
    throw new Error(`ENOENT: ${key}`);
  }
  return hit;
};

const manifestPath = `/repo/${LOG_CHUNKS_DIR_REL}/${LOG_MANIFEST_FILE_NAME}`;
const chunkPath = (i: number) => `/repo/${LOG_CHUNKS_DIR_REL}/chunk-${String(i)}.b64`;

describe("ci-print-log-chunk：三种「没有正文」各说各的，且都不是红的理由", () => {
  it("读不到清单 ⇒ 一行「没有分块」、退 0", () => {
    const out = renderChunkFromDisk(1, { readFile: fakeDisk({}), root: "/repo" });
    expect(out.exitCode).toBe(0);
    expect(out.text).toContain("没有日志分块");
    expect(out.text).toContain("判决由「GitHub 判决判定」");
  });

  it("块数少于静态格数 ⇒ 「这一块不存在」、退 0（静态三格里多余的格就是这一形）", () => {
    const files = { [manifestPath]: JSON.stringify(MANIFEST) };
    const out = renderChunkFromDisk(3, { readFile: fakeDisk(files), root: "/repo" });
    expect(out.exitCode).toBe(0);
    expect(out.text).toContain("这一块不存在");
    expect(out.text).toContain("只有 2 块");
  });

  it("清单说有的块盘上没有 ⇒ 「块文件缺失」、退 0（判决不由这一格负责）", () => {
    const files = { [manifestPath]: JSON.stringify(MANIFEST) };
    const out = renderChunkFromDisk(2, { readFile: fakeDisk(files), root: "/repo" });
    expect(out.exitCode).toBe(0);
    expect(out.text).toContain("块文件缺失");
  });

  it("正常块 ⇒ 首部念 块号 / 块数 / 整包 sha256 / 尺寸 / 拼回命令，正文原样在场", () => {
    const files = {
      [manifestPath]: JSON.stringify(MANIFEST),
      [chunkPath(1)]: "QUJD\nREVG",
    };
    const out = renderChunkFromDisk(1, { readFile: fakeDisk(files), root: "/repo" });
    expect(out.exitCode).toBe(0);
    expect(out.text).toContain("[chunk 1/2]");
    expect(out.text).toContain(`sha256=${"a".repeat(64)}`);
    expect(out.text).toContain("gzip 118375 字节 / 原文 616395 字节");
    expect(out.text).toContain("gunzip");
    expect(out.text).toContain("QUJD\nREVG");
  });

  it("清单形状不对（缺 sha256 / 块数不是数）⇒ 按「没有分块」处置（不抛）", () => {
    expect(normalizeManifest({ chunkCount: "x", sha256: "y" })).toBeNull();
    expect(normalizeManifest({ chunkCount: 2, printedChunks: 2, gzipBytes: 1, rawBytes: 1 })).toBeNull();
    expect(normalizeManifest(null)).toBeNull();
    expect(normalizeManifest(MANIFEST)?.chunkCount).toBe(2);
  });

  it("参数：i 从 1 起；缺参 / 0 / 非整数 ⇒ 0（调用方退 2，配置 bug 不许静默）", () => {
    expect(parseIndex(["1"]).index).toBe(1);
    expect(parseIndex([]).index).toBe(0);
    expect(parseIndex(["0"]).index).toBe(0);
    expect(parseIndex(["1.5"]).index).toBe(0);
    expect(parseIndex(["x"]).usage).toContain("ci-print-log-chunk");
  });

  it("静态格数与渲染口径自洽：块号在 1..静态格数 时都不退非 0", () => {
    const files = { [manifestPath]: JSON.stringify(MANIFEST) };
    for (let i = 1; i <= LOG_CHUNK_STATIC_STAGES; i += 1) {
      expect(renderChunkFromDisk(i, { readFile: fakeDisk(files), root: "/repo" }).exitCode).toBe(0);
    }
    expect(renderChunk({ index: 1, manifest: normalizeManifest(MANIFEST) }).length).toBeGreaterThan(0);
  });
});

describe("ci-github-verdict-decide：只有明确 exit 0 才放行（fail-closed）", () => {
  it("判定文件读不到 ⇒ exit 2 并念出一个理由（判不了就拦合）", () => {
    const out = decide("/repo/.comfy-ci/tmp/github-verdict-logs/decision.json", {
      readFile: fakeDisk({}),
      root: "/repo",
    });
    expect(out.exitCode).toBe(2);
    expect(out.text).toContain("fail-closed");
  });

  it("判定文件不是合法 JSON / 形状不对 ⇒ exit 2（不许被读成通过）", () => {
    for (const body of ["{not json", JSON.stringify({ exitCode: "0" }), JSON.stringify({ exitCode: 7 })]) {
      const out = decide("decision.json", {
        readFile: fakeDisk({ "/repo/decision.json": body }),
        root: "/repo",
      });
      expect(out.exitCode).toBe(2);
    }
  });

  it("判定写 exit 1 ⇒ 退 1 并带上回读那条结论；写 exit 0 ⇒ 退 0", () => {
    const red = decide("decision.json", {
      readFile: fakeDisk({
        "/repo/decision.json": JSON.stringify({ exitCode: 1, line: "[verdict] 结论：exit 1 —— 红" }),
      }),
      root: "/repo",
    });
    expect(red.exitCode).toBe(1);
    expect(red.text).toContain("结论：exit 1");
    const green = decide("decision.json", {
      readFile: fakeDisk({ "/repo/decision.json": JSON.stringify({ exitCode: 0, line: "" }) }),
      root: "/repo",
    });
    expect(green.exitCode).toBe(0);
    expect(green.text).toContain("exit 0");
  });

  it("normalizeDecision：只认 0 / 1 / 2 这三个退码", () => {
    expect(normalizeDecision({ exitCode: 0 })).toEqual({ exitCode: 0, line: "" });
    expect(normalizeDecision({ exitCode: 2 })).toEqual({ exitCode: 2, line: "" });
    expect(normalizeDecision({ exitCode: 3 })).toBeNull();
    expect(normalizeDecision("nope")).toBeNull();
  });

  it("参数缺省走 `.comfy-ci/tmp/github-verdict-logs/decision.json`（与 `--decision-out` 同源）", () => {
    expect(parseArgs([])).toEqual({ file: ".comfy-ci/tmp/github-verdict-logs/decision.json" });
    expect(parseArgs(["x.json"])).toEqual({ file: "x.json" });
  });
});
