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
 *   ⑤ **硬闸**：命中即退 1；`--update` / `--allow-new` 两条放宽通道已经删掉，
 *      再传它们**不会写出任何 JSON**（ISSUE #1811 收尾：基线归零后翻硬闸）。
 *   ⑥ **夹具文件不进扫描面**（`FIXTURE_SKIP`）：本文件自己写着「手搓样板」的夹具字符串
 *      与真代码两种形态，判它等于判自己的量具（§11.18.3.1）。
 *
 * ⚠️ 本文件自己**不进扫描面**（`FIXTURE_SKIP`）。
 */
import { execFileSync } from "node:child_process";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
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
 * @param args 额外参数（`--report`，以及断头用例故意传的旧旗标）
 */
function gate(
  files: Record<string, string>,
  args: string[] = [],
): { ok: boolean; output: string; root: string } {
  const root = mkdtempSync(path.join(tmpdir(), "gate-repo-boilerplate-"));
  roots.push(root);
  mkdirSync(path.join(root, "scripts"), { recursive: true });
  copyFileSync(SCRIPT, path.join(root, "scripts", "check-gate-repo-boilerplate.cjs"));
  /* 判据共用的扫描读取器（`gate-` 前缀，不是 `check-`）：少带时本判据在临时仓库里
   * 直接 MODULE_NOT_FOUND，用例读到的是「门禁坏了」而不是「夹具缺一块」。 */
  copyFileSync(
    path.join(SCRIPTS_DIR, "gate-scan-read.cjs"),
    path.join(root, "scripts", "gate-scan-read.cjs"),
  );
  for (const [rel, content] of Object.entries(files)) {
    const abs = path.join(root, rel);
    mkdirSync(path.dirname(abs), { recursive: true });
    writeFileSync(abs, content);
  }
  const entry = path.join(root, "scripts", "check-gate-repo-boilerplate.cjs");
  try {
    return {
      ok: true,
      root,
      output: execFileSync(process.execPath, [entry, ...args], {
        cwd: root,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
      }),
    };
  } catch (error) {
    const e = /* SAFETY: 类型断言已复核 */ error as { stdout?: string; stderr?: string };
    return { ok: false, root, output: `${e.stdout ?? ""}${e.stderr ?? ""}` };
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

describe("门禁自测样板门禁：该拦的形状（硬闸，§11.16.1）", () => {
  it("① 一份手搓样板 → 阻断，并点名文件与 §11.16.1", () => {
    const r = gate({ "tests/x.test.ts": HAND_ROLLED });
    expect(r.ok).toBe(false);
    expect(r.output).toContain("手搓临时仓库样板：1 份");
    expect(r.output).toContain("tests/x.test.ts");
    expect(r.output).toContain("§11.16.1");
  });

  it("① 两份手搓样板 → 两条都点名（读数与清单一起给）", () => {
    const r = gate({
      "tests/x.test.ts": HAND_ROLLED,
      "tests/y.test.ts": HAND_ROLLED,
    });
    expect(r.ok).toBe(false);
    expect(r.output).toContain("手搓临时仓库样板：2 份");
    expect(r.output).toContain("tests/x.test.ts");
    expect(r.output).toContain("tests/y.test.ts");
  });

  /* 断头用例（§13.5.12 那一族）：旗标被删了，但**没人再传**它这件事本身要有机器痕迹。
   * 这两条断言「传旧旗标也什么都不写、照旧按硬闸判」，于是「加回落盘通道」在任何
   * 一种拼法上都会当场红 —— 而不是靠人记得去 grep。 */
  it("⑤ 旧旗标 `--update` 不再是放宽通道：不落盘任何 JSON，且照旧阻断", () => {
    const r = gate({ "tests/x.test.ts": HAND_ROLLED }, ["--update"]);
    expect(r.ok, "--update 不该让手搓样板通过").toBe(false);
    expect(
      existsSync(path.join(r.root, "scripts", ".gate-repo-boilerplate-baseline.json")),
      "--update 被删了，不该再写出任何基线文件",
    ).toBe(false);
  });

  it("⑤ 旧旗标 `--allow-new` 同判：不落盘、不放过", () => {
    const r = gate({ "tests/x.test.ts": HAND_ROLLED }, ["--update", "--allow-new"]);
    expect(r.ok).toBe(false);
    expect(existsSync(path.join(r.root, "scripts", ".gate-repo-boilerplate-baseline.json"))).toBe(
      false,
    );
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
    const r = gate({ "tests/x.test.ts": shared });
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
    const r = gate({ "tests/x.test.ts": onlyTmp });
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
    const r = gate({ "tests/x.test.ts": otherEntry });
    expect(r.ok).toBe(true);
    expect(r.output).toContain("手搓样板 0 份");
  });

  it("⑥ 判据自己的夹具文件不进扫描面（FIXTURE_SKIP）", () => {
    const r = gate({ "tests/gate-repo-boilerplate-gate.test.ts": HAND_ROLLED });
    expect(r.ok).toBe(true);
    expect(r.output).toContain("手搓样板 0 份");
  });

  it("--report 只出清单不判失败", () => {
    const r = gate({ "tests/x.test.ts": HAND_ROLLED }, ["--report"]);
    expect(r.ok).toBe(true);
    expect(r.output).toContain("盘点");
    expect(r.output).toContain("tests/x.test.ts");
  });
});

describe("真实仓库：这条硬闸今天为 0（§11.16.1）", () => {
  /* 存量归零之后翻硬闸，于是「本仓库原样通过」这件事本身就是一条判据 ——
   * 它防的是「某天又有人手搓一份样板」。同时把**读数非空**钉住：一个永远数出 0 份的
   * 扫描器会让这里全绿，而那正是这条判据要防的静默失效。 */
  it("本仓库原样跑判据 → 退 0，且扫描面里确实有共享夹具的用例", () => {
    const out = execFileSync(process.execPath, [SCRIPT], {
      cwd: path.resolve(__dirname, ".."),
      encoding: "utf8",
    });
    expect(out).toContain("手搓样板 0 份");
    // 扫描面非空的自证：仓库里用了共享夹具的用例文件必须存在（否则「0 份」可能只是没搜到）。
    const users = readdirSync(path.resolve(__dirname), {
      withFileTypes: true,
    }).filter(
      (e) =>
        e.isFile() &&
        readFileSync(path.join(__dirname, e.name), "utf8").includes("/helpers/gate-repo"),
    );
    expect(
      users.length,
      "扫描面空转：仓库里一份用共享夹具的用例都找不到（判据什么都没在看）",
    ).toBeGreaterThan(10);
  });
});
