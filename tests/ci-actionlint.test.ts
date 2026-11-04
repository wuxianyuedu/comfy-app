/** `scripts/ci-actionlint.mjs` 的用例（ISSUE #3063）：三态退码与「零网络取用」的措辞。 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  ACTIONLINT_PLAN,
  CODE,
  parseArgs,
  renderVerdict,
  runCiActionlint,
  seedBinary,
  sha256File,
  toolDir,
  verifyBinary,
  workflowFiles,
} from "../scripts/ci-actionlint.mjs";

/** 每一轮 `log()` 都打到这里（`runCiActionlint` 的正文全部走 stdout）。 */
function capture(fn: () => number): { code: number; text: string } {
  const chunks: Array<string> = [];
  const spy = vi
    .spyOn(process.stdout, "write")
    .mockImplementation((chunk: string | Uint8Array) => {
      chunks.push(String(chunk));
      return true;
    });
  try {
    const code = fn();
    return { code, text: chunks.join("") };
  } finally {
    spy.mockRestore();
  }
}

const tmpDirs: Array<string> = [];
function tmpDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ci-actionlint-"));
  tmpDirs.push(dir);
  return dir;
}

afterEach(() => {
  const dir = tmpDirs.pop();
  if (dir) {
    fs.rmSync(dir, { force: true, recursive: true });
  }
});

describe("落点与判的面", () => {
  it("常驻根里一个版本一个目录（升版本是多一份，不是覆盖旧的）", () => {
    const root = String.raw`D:\ci-tools\comfy-app-t3`;
    expect(toolDir(root)).toBe(path.join(root, "actionlint-1.7.7"));
  });

  it("只认 `.github/workflows/` 下的 yml / yaml，排过序", () => {
    expect(
      workflowFiles("ignored", () => ["pr-gate.yml", "notes.md", "daily.yaml", "sub-dir"]),
    ).toEqual([".github/workflows/daily.yaml", ".github/workflows/pr-gate.yml"]);
  });
});

describe("取用：缺件 / 哈希不符 / 可用，三种结论各有退码", () => {
  it("常驻根里没有这份 ⇒ 退 2（没判），措辞里带出口", () => {
    const result = verifyBinary({ exePath: path.join(tmpDir(), "actionlint.exe") });
    expect(result.code).toBe(CODE.NO_FACT);
    expect(result.reason).toContain("常驻根里没有 pin 的那一份");
  });

  it("在场但 sha256 对不上 ⇒ 退 1（事实是坏的，不是没判）", () => {
    const exe = path.join(tmpDir(), "actionlint.exe");
    fs.writeFileSync(exe, "not-the-pinned-binary");
    const result = verifyBinary({ exePath: exe, hashOf: () => "deadbeef" });
    expect(result.code).toBe(CODE.FAIL);
    expect(result.reason).toContain("镜像被换过或版本没同步");
  });

  it("pin 的那一份 ⇒ 退 0", () => {
    const exe = path.join(tmpDir(), "actionlint.exe");
    fs.writeFileSync(exe, "pinned");
    const result = verifyBinary({ exePath: exe, hashOf: () => ACTIONLINT_PLAN.exeSha256 });
    expect(result.code).toBe(CODE.OK);
    expect(result.reason).toBe("");
  });
});

describe("种进常驻根（--seed）：只拷、不下载", () => {
  it("源不在场 ⇒ 退 2", () => {
    const { code, text } = capture(() =>
      seedBinary({ hashOf: () => "x", source: path.join(tmpDir(), "nope.exe"), toolRoot: tmpDir() }),
    );
    expect(code).toBe(CODE.NO_FACT);
    expect(text).toContain("种失败：源不在场");
  });

  it("源哈希与 pin 不符 ⇒ 退 1，且一个字节都不写", () => {
    const source = path.join(tmpDir(), "actionlint.exe");
    fs.writeFileSync(source, "wrong");
    const copy = vi.fn();
    const { code } = capture(() =>
      seedBinary({ copy, hashOf: () => "other", source, toolRoot: tmpDir() }),
    );
    expect(code).toBe(CODE.FAIL);
    expect(copy).not.toHaveBeenCalled();
  });

  it("源哈希与 pin 相符 ⇒ 写进 `<根>/actionlint-<版本>/actionlint.exe`", () => {
    const source = path.join(tmpDir(), "actionlint.exe");
    fs.writeFileSync(source, "pinned");
    const implemented: Array<[string, string]> = [];
    const { code } = capture(() =>
      seedBinary({
        copy: (from, to) => implemented.push([from, to]),
        hashOf: () => ACTIONLINT_PLAN.exeSha256,
        source,
        toolRoot: String.raw`D:\ci-tools\comfy-app-t3`,
      }),
    );
    expect(code).toBe(CODE.OK);
    expect(implemented).toEqual([
      [source, path.join(toolDir(String.raw`D:\ci-tools\comfy-app-t3`), "actionlint.exe")],
    ]);
  });
});

describe("结论行：绿 / 红 / 没判，且必须落在最后一行", () => {
  it("绿：份数与「.cnb.yml 走 check:ci-yaml」", () => {
    expect(renderVerdict({ code: CODE.OK, files: ["a.yml"] })).toContain("结论：绿");
    expect(renderVerdict({ code: CODE.OK, files: ["a.yml"] })).toContain("check:ci-yaml");
  });

  it("红：带上第一处与判的面", () => {
    const line = renderVerdict({
      code: CODE.FAIL,
      files: [".github/workflows/pr-gate.yml"],
      firstLine: "pr-gate.yml:12:9: unexpected key \"permisions\"",
    });
    expect(line).toContain("结论：红");
    expect(line).toContain("permisions");
    expect(line).toContain("pr-gate.yml");
  });

  it("没判：带上原因", () => {
    expect(renderVerdict({ code: CODE.NO_FACT, files: [], reason: "spawn 没拿到退码" })).toContain(
      "spawn 没拿到退码",
    );
  });
});

describe("runCiActionlint：三态端到端（注入面，不起真二进制还真网络）", () => {
  const ENV_ROOT = `ENV_ROOT`;

  it("缺件 ⇒ 退 2，末行是「没判」并念出出口", () => {
    const { code, text } = capture(() =>
      runCiActionlint({
        env: { COMFY_CI_TOOLS_ROOT: ENV_ROOT },
        hashOf: () => ACTIONLINT_PLAN.exeSha256,
        runStore: () => ({ status: 1 }),
      }),
    );
    expect(code).toBe(CODE.NO_FACT);
    expect(text).toContain("常驻根里没有 pin 的那一份");
    expect(text).toContain("--seed");
  });

  it("actionlint 报错 ⇒ 退 1，正文是原文、末行是结论", () => {
    const root = tmpDir();
    const dir = toolDir(root);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, ACTIONLINT_PLAN.exeName), "pinned");
    const { code, text } = capture(() =>
      runCiActionlint({
        env: { COMFY_CI_TOOLS_ROOT: root },
        hashOf: () => ACTIONLINT_PLAN.exeSha256,
        runStore: () => ({ status: 0 }),
        readDir: () => ["pr-gate.yml"],
        spawn: () => ({
          status: 1,
          stderr: 'pr-gate.yml:12:9: unexpected key "permisions" [syntax-check]',
          stdout: "",
        }),
      }),
    );
    expect(code).toBe(CODE.FAIL);
    expect(text).toContain("permisions");
    const lastLine = text.trimEnd().split("\n").at(-1);
    expect(lastLine).toContain("结论：红");
    expect(lastLine).toContain("第一处");
  });

  it("actionlint 起不来（spawn 没退码）⇒ 退 2，不冒充绿", () => {
    const root = tmpDir();
    const dir = toolDir(root);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, ACTIONLINT_PLAN.exeName), "pinned");
    const { code } = capture(() =>
      runCiActionlint({
        env: { COMFY_CI_TOOLS_ROOT: root },
        hashOf: () => ACTIONLINT_PLAN.exeSha256,
        runStore: () => ({ status: 0 }),
        readDir: () => ["pr-gate.yml"],
        spawn: () => ({ status: null, stderr: "", stdout: "" }),
      }),
    );
    expect(code).toBe(CODE.NO_FACT);
  });
});

describe("命令行", () => {
  it("只认 --seed / --dry-run / --help", () => {
    expect(parseArgs([])).toEqual({ dryRun: false, help: false, seed: null });
    expect(parseArgs(["--dry-run"]).dryRun).toBe(true);
    expect(parseArgs(["--seed", "x.exe"]).seed).toBe("x.exe");
    expect(parseArgs(["--seed"]).seed).toBe(null);
  });

  it("sha256File 与 Node 自带实现一致（pin 的校验面靠它）", () => {
    const file = path.join(tmpDir(), "f.txt");
    fs.writeFileSync(file, "abc");
    expect(sha256File(file)).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
  });
});
