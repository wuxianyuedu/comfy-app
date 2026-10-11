/**
 * 「门禁自测别再手搓临时仓库样板」判据的自测（规范 §11.16.1）。
 *
 * 判据的价值全在**形状识别口径**上，所以这里跑的是**真脚本**（临时仓库 + 只放被测
 * 文件），断言「该拦的拦、不该误伤的放过」。六条口径各有执行者：
 *
 *   ① **手搓样板**（该拦）：`tmpdir()` + 自己写的 `run(args)`（`execFileSync` 从
 *      `workdir` 拉脚本）—— 本判据的立案形态。
 *   ② **用了共享夹具**（该放）：文件里出现 `helpers/gate-repo` 就整个跳过 ——
 *      契约的边界是「有没有走共享件」，不是「写得像不像」。
 *   ③ **只造临时目录、不拉脚本**（该放）：`test-db` / `symlink-dir` / 产物探针那一类
 *      正当写法 —— 只吃①这一刀会让判据误报一片（§11.18.4）。
 *   ④ **拉的是别的可执行文件**（该放）：`execFileSync(process.execPath, [PRETTIER, …])`
 *      这类没有 `join(workdir` 窗口的形态不在靶子里。
 *   ⑤ **棘轮**：当前 > 基线即阻断、`--update` 不许把数字往上涨，但**首次建基线允许**
 *      （那是记账起点，不是给新增放行）。
 *   ⑥ **夹具文件不进扫描面**（`FIXTURE_SKIP`）：本文件自己写着「手搓样板」的夹具字符串
 *      与真代码两种形态，判它等于判自己的量具（§11.18.3.1）。
 *
 * ⚠️ 本文件自己**不进扫描面**（`FIXTURE_SKIP`）。
 */
import { execFileSync } from "node:child_process";
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const SCRIPTS_DIR = path.resolve(__dirname, "../scripts");
const SCRIPT = path.join(SCRIPTS_DIR, "check-gate-repo-boilerplate.cjs");

/** 临时仓库列表，用例结束统一清掉。 */
const roots: string[] = [];
afterEach(() => {
  while (roots.length) {
    const r = roots.pop();
    if (r) rmSync(r, { recursive: true, force: true });
  }
});

/**
 * 在临时仓库里跑真脚本（cwd = 临时仓库根，只放被测文件）。
 *
 * @param files 相对路径 → 内容
 * @param baseline 基线的 `total` 与 `files`（不传则不写基线文件）
 * @param args 额外参数（`--update` / `--report`）
 */
function gate(
  files: Record<string, string>,
  baseline?: { total: number; files?: Record<string, boolean> },
  args: string[] = [],
): { ok: boolean; output: string } {
  const root = mkdtempSync(path.join(tmpdir(), "gate-repo-boilerplate-"));
  roots.push(root);
  mkdirSync(path.join(root, "scripts"), { recursive: true });
  copyFileSync(
    SCRIPT,
    path.join(root, "scripts", "check-gate-repo-boilerplate.cjs"),
  );
  /* 判据共用的扫描读取器（`gate-` 前缀，不是 `check-`）：少带时本判据在临时仓库里
   * 直接 MODULE_NOT_FOUND，用例读到的是「门禁坏了」而不是「夹具缺一块」。 */
  copyFileSync(
    path.join(SCRIPTS_DIR, "gate-scan-read.cjs"),
    path.join(root, "scripts", "gate-scan-read.cjs"),
  );
  if (baseline) {
    writeFileSync(
      path.join(root, "scripts", ".gate-repo-boilerplate-baseline.json"),
      `${JSON.stringify({ total: baseline.total, files: baseline.files ?? {} }, null, 2)}\n`,
    );
  }
  for (const [rel, content] of Object.entries(files)) {
    const abs = path.join(root, rel);
    mkdirSync(path.dirname(abs), { recursive: true });
    writeFileSync(abs, content);
  }
  const entry = path.join(root, "scripts", "check-gate-repo-boilerplate.cjs");
  try {
    return {
      ok: true,
      output: execFileSync(process.execPath, [entry, ...args], {
        cwd: root,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
      }),
    };
  } catch (error) {
    const e = error as { stdout?: string; stderr?: string };
    return { ok: false, output: `${e.stdout ?? ""}${e.stderr ?? ""}` };
  }
}

/** 手搓样板的被测形态（① 该拦）。 */
const HAND_ROLLED = `import { execFileSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
let workdir = "";
function run(args: string[] = []) {
  try {
    return { code: 0, output: execFileSync(process.execPath, [join(workdir, "check-x.cjs"), ...args]) };
  } catch (err) {
    return { code: 1, output: String(err) };
  }
}
it("x", () => {
  workdir = mkdtempSync(join(tmpdir(), "x-"));
  run();
});
`;

describe("门禁自测样板门禁：该拦的形状（§11.16.1）", () => {
  it("① 手搓样板 + 基线外 → 阻断，并点名文件与 §11.16.1", () => {
    const r = gate({ "tests/x.test.ts": HAND_ROLLED }, { total: 0, files: {} });
    expect(r.ok).toBe(false);
    expect(r.output).toContain("上涨");
    expect(r.output).toContain("tests/x.test.ts");
    expect(r.output).toContain("§11.16.1");
  });

  it("⑤ 棘轮：当前 > 基线 → 阻断；--update 不许把数字往上涨", () => {
    const r = gate(
      { "tests/x.test.ts": HAND_ROLLED },
      { total: 0, files: {} },
      ["--update"],
    );
    expect(r.ok).toBe(false);
    expect(r.output).toContain("拒绝收紧");

    const blocked = gate(
      { "tests/x.test.ts": HAND_ROLLED },
      { total: 0, files: {} },
    );
    expect(blocked.ok).toBe(false);
    expect(blocked.output).toContain("0 → 1 份");
  });

  it("⑤ 首次建基线（文件不存在）→ --update 允许（记账起点，不是放行）", () => {
    const r = gate({ "tests/x.test.ts": HAND_ROLLED }, undefined, ["--update"]);
    expect(r.ok).toBe(true);
    expect(r.output).toContain("基线已收紧");
  });
});

describe("门禁自测样板门禁：该放的形状（§11.16.1）", () => {
  it("② 用了共享夹具 → 整个跳过（契约边界是「有没有走共享件」）", () => {
    const shared = `import { defineGateRepo } from "./helpers/gate-repo";
const { test } = defineGateRepo({ script: "check-x.cjs" });
test("x", ({ repo }) => {
  repo.run();
});
`;
    const r = gate({ "tests/x.test.ts": shared }, { total: 0, files: {} });
    expect(r.ok).toBe(true);
    expect(r.output).toContain("手搓样板 0 份");
  });

  it("③ 只造临时目录、不拉脚本 → 放行（test-db / symlink-dir 那一类正当写法）", () => {
    const onlyTmp = `import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
it("x", () => {
  const dir = mkdtempSync(join(tmpdir(), "files-"));
  writeFileSync(join(dir, "a.txt"), "a");
});
`;
    const r = gate({ "tests/x.test.ts": onlyTmp }, { total: 0, files: {} });
    expect(r.ok).toBe(true);
    expect(r.output).toContain("手搓样板 0 份");
  });

  it("④ 拉的是别的可执行文件（没有 workdir 窗口）→ 放行", () => {
    const otherEntry = `import { execFileSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
const PRETTIER = "/tmp/prettier.cjs";
it("x", () => {
  const dir = mkdtempSync(join(tmpdir(), "cfg-"));
  execFileSync(process.execPath, [PRETTIER, "--write", join(dir, "a.ts")]);
});
`;
    const r = gate({ "tests/x.test.ts": otherEntry }, { total: 0, files: {} });
    expect(r.ok).toBe(true);
    expect(r.output).toContain("手搓样板 0 份");
  });

  it("⑥ 判据自己的夹具文件不进扫描面（FIXTURE_SKIP）", () => {
    const r = gate(
      { "tests/gate-repo-boilerplate-gate.test.ts": HAND_ROLLED },
      { total: 0, files: {} },
    );
    expect(r.ok).toBe(true);
    expect(r.output).toContain("手搓样板 0 份");
  });

  it("--report 只出清单不判失败", () => {
    const r = gate(
      { "tests/x.test.ts": HAND_ROLLED },
      { total: 0, files: {} },
      ["--report"],
    );
    expect(r.ok).toBe(true);
    expect(r.output).toContain("盘点");
    expect(r.output).toContain("tests/x.test.ts");
  });
});

describe("真实仓库：存量与基线一致（§11.16.1）", () => {
  it("本仓库当前读数 == 基线（迁完一份就该 --update 把它降下来）", () => {
    const baseline = JSON.parse(
      readFileSync(
        path.join(SCRIPTS_DIR, ".gate-repo-boilerplate-baseline.json"),
        "utf8",
      ),
    ) as { total: number; files: Record<string, boolean> };
    const out = execFileSync(process.execPath, [SCRIPT, "--report"], {
      cwd: path.resolve(__dirname, ".."),
      encoding: "utf8",
    });
    expect(out).toContain(`手搓样板 ${baseline.total} 份`);
    // 基线里登记的每一份都该还在（迁走了就 --update 收紧）。
    for (const rel of Object.keys(baseline.files)) {
      expect(out).toContain(rel);
    }
  });
});
