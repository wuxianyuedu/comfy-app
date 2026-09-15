/**
 * 回归护栏：**跨平台动作对照表与单点定义**（规范 launch-and-build.md §9.5）。
 *
 * 背景：Windows 入口一律 `.ps1`（规范 §8），而 Linux / macOS / CI 上跑不了 `.ps1`。
 * 于是同一个动作在两侧各有一份实现 —— 这正是启动编排踩过的坑：Windows 一条 `.ps1`
 * 链、POSIX 一条 `.mjs` 链各自演进，最终 Windows 侧的端口口径、端口占用回收、
 * 就绪等待与收尾命名四项都与 POSIX 侧不同，而「记得同步另一侧」全靠自觉。
 *
 * 本条把`新增动作必须两侧都在`机器化，另加一条：会「静默失效」的清单标记
 * （`KNOWN_FAILED_FILES`）不许各写一份 —— 此前它定义在 `quality-gate.ps1` 里、
 * 由 `run-tests.ps1` 正则解析 `.ps1` 源码，改一次写法就静默返回空数组，
 * 而「排除项悄悄为空」看起来就像「本来就没有基线失败」（红/绿不再可归因）。
 *
 * 两种验证都做：正向（真仓库通过）+ 反向（临时仓库改坏后必失败）。
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const GUARD = path.join(process.cwd(), "scripts", "check-ps1-consistency.mjs");
const SPEC = path.join("docs", "standards", "launch-and-build.md");

/** 在临时仓库里跑门禁（只需要被它读的那几个文件）。 */
function runGuard(overrides: Record<string, string | null>): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ps1-consistency-"));
  cleanup.push(dir);

  // 真实文件先整体拷过去，再按 overrides 覆盖 / 删除。
  const files = [
    SPEC,
    path.join("scripts", "quality-gate-shared.mjs"),
    path.join("scripts", "quality-gate.ps1"),
    path.join("scripts", "run-tests.ps1"),
  ];
  for (const rel of files) {
    const src = path.join(process.cwd(), rel);
    const dst = path.join(dir, rel);
    fs.mkdirSync(path.dirname(dst), { recursive: true });
    fs.copyFileSync(src, dst);
  }
  fs.mkdirSync(path.join(dir, "scripts"), { recursive: true });
  fs.copyFileSync(GUARD, path.join(dir, "scripts", "check-ps1-consistency.mjs"));
  // 对照表里登记的两侧脚本都要真实存在（门禁会核对存在性）。
  for (const rel of [
    "scripts/dev-launcher.ps1",
    "scripts/dev-launcher.mjs",
    "scripts/quality-gate.ps1",
    "scripts/quality-gate.mjs",
    "scripts/run-tests.ps1",
    "scripts/run-tests.mjs",
    "scripts/generate-docs.ps1",
    "scripts/generate-docs.mjs",
    "scripts/check-app-port-vectors.ps1",
    "scripts/check-app-port-vectors.cjs",
    "scripts/prepare-local-run.ps1",
    "scripts/env-init.mjs",
    "scripts/db-push.mjs",
  ]) {
    const dst = path.join(dir, rel);
    if (fs.existsSync(dst)) continue;
    fs.mkdirSync(path.dirname(dst), { recursive: true });
    fs.writeFileSync(dst, "");
  }

  for (const [rel, content] of Object.entries(overrides)) {
    const dst = path.join(dir, rel);
    if (content === null) fs.rmSync(dst, { force: true });
    else {
      fs.mkdirSync(path.dirname(dst), { recursive: true });
      fs.writeFileSync(dst, content);
    }
  }

  try {
    execFileSync(process.execPath, [path.join(dir, "scripts", "check-ps1-consistency.mjs")], {
      cwd: dir,
      encoding: "utf8",
      stdio: "pipe",
    });
    return "CODE=0";
  } catch (e: unknown) {
    const err = e as { stdout?: string; stderr?: string; status?: number };
    return `CODE=${err.status ?? 1}\n${err.stdout ?? ""}${err.stderr ?? ""}`;
  }
}

const cleanup: string[] = [];
afterEach(() => {
  for (const dir of cleanup.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

describe("跨平台动作对照表（规范 §9.5）", () => {
  it("真仓库通过（对照表两侧齐全、脚本都存在、清单单点定义）", () => {
    const out = execFileSync(process.execPath, [GUARD], {
      cwd: process.cwd(),
      encoding: "utf8",
    });
    expect(out).toContain("OK");
  });

  it("对照表里登记不存在的脚本 → 失败（登记漂移会被发现）", () => {
    const spec = fs.readFileSync(path.join(process.cwd(), SPEC), "utf8");
    const broken = spec.replace("scripts/generate-docs.mjs", "scripts/does-not-exist.mjs");
    expect(broken).not.toBe(spec);
    const out = runGuard({ [SPEC]: broken });
    expect(out).toContain("CODE=1");
    expect(out).toContain("does-not-exist.mjs");
  });

  it("某一行动作只登记了一侧（只有 .ps1 / 只有 .mjs）→ 失败", () => {
    const spec = fs.readFileSync(path.join(process.cwd(), SPEC), "utf8");
    // 把某一行两侧的跨平台实现都摘掉，只留 .ps1
    const broken = spec.replace(
      "| 端口推导跨语言自检 | `scripts/check-app-port-vectors.ps1` | `scripts/check-app-port-vectors.cjs` |",
      "| 端口推导跨语言自检 | `scripts/check-app-port-vectors.ps1` | — |",
    );
    expect(broken).not.toBe(spec);
    const out = runGuard({ [SPEC]: broken });
    expect(out).toContain("CODE=1");
    expect(out).toContain("只登记了一侧");
  });

  it("对照表被整体删除 → 失败（门禁不许静默失效）", () => {
    const spec = fs.readFileSync(path.join(process.cwd(), SPEC), "utf8");
    const broken = spec.replace("<!-- cross-platform-pairs -->", "<!-- pairs-marker-removed -->");
    const out = runGuard({ [SPEC]: broken });
    expect(out).toContain("CODE=1");
  });
});

describe("KNOWN_FAILED_FILES 的单点定义（规范 §9.5）", () => {
  it("共享模块导出该常量（单点定义存在）", () => {
    const shared = fs.readFileSync(
      path.join(process.cwd(), "scripts", "quality-gate-shared.mjs"),
      "utf8",
    );
    expect(shared).toMatch(/export\s+const\s+KNOWN_FAILED_FILES\s*=/);
  });

  it("两侧的门禁脚本只是**读取**它，不各自再定义一份", () => {
    for (const rel of ["scripts/quality-gate.ps1", "scripts/run-tests.ps1"]) {
      const text = fs.readFileSync(path.join(process.cwd(), rel), "utf8");
      // 读取形态：从共享模块解析（不写死清单字面量）
      expect(text).toContain("quality-gate-shared.mjs");
      // 不许出现「赋一个字面量清单」
      expect(text).not.toMatch(/\$KNOWN_FAILED_FILES\s*=\s*@\(\s*["']/);
    }
  });

  it("在 .ps1 里再定义一份字面量清单 → 失败（漏改一处就红/绿不可归因）", () => {
    const gate = fs.readFileSync(
      path.join(process.cwd(), "scripts", "quality-gate.ps1"),
      "utf8",
    );
    const broken = `${gate}\n$KNOWN_FAILED_FILES = @("src/lib/media.test.ts")\n`;
    const out = runGuard({ [path.join("scripts", "quality-gate.ps1")]: broken });
    expect(out).toContain("CODE=1");
    expect(out).toContain("又定义了一份 KNOWN_FAILED_FILES");
  });

  it("Node 侧门禁与共享模块读同一份清单（不许各写一套排除项）", () => {
    const mjs = fs.readFileSync(
      path.join(process.cwd(), "scripts", "quality-gate.mjs"),
      "utf8",
    );
    expect(mjs).toContain('from "./quality-gate-shared.mjs"');
    const runner = fs.readFileSync(
      path.join(process.cwd(), "scripts", "run-tests.mjs"),
      "utf8",
    );
    expect(runner).toContain('from "./quality-gate-shared.mjs"');
  });
});

describe("跨平台动作的实现契约", () => {
  it("Node 侧门禁只用 Node 内建与本仓库模块（不引第三方依赖）", () => {
    for (const rel of ["scripts/quality-gate.mjs", "scripts/run-tests.mjs", "scripts/generate-docs.mjs"]) {
      const text = fs.readFileSync(path.join(process.cwd(), rel), "utf8");
      // 只允许 node: 内建与相对路径（本仓库模块）—— 门禁要在「装好依赖之前」
      // 也能跑，引第三方包会让它在干净检出上直接失败。
      for (const m of text.matchAll(/from\s+"([^"]+)"/g)) {
        const spec = m[1] ?? "";
        expect(
          spec.startsWith("node:") || spec.startsWith("./") || spec.startsWith("../"),
          `${rel} 引入了非内建依赖：${spec}`,
        ).toBe(true);
      }
    }
  });

  it("质量门禁的三项与 .ps1 侧同命令（两侧不许各写一套门禁清单）", () => {
    const ps1 = fs.readFileSync(path.join(process.cwd(), "scripts", "quality-gate.ps1"), "utf8");
    const mjs = fs.readFileSync(path.join(process.cwd(), "scripts", "quality-gate.mjs"), "utf8");
    const squash = (t: string) => t.replace(/\s+/g, " ");
    for (const needle of ["typecheck", "eslint", "--max-warnings", "vitest"]) {
      expect(squash(ps1), `quality-gate.ps1 缺 ${needle}`).toContain(needle);
      expect(squash(mjs), `quality-gate.mjs 缺 ${needle}`).toContain(needle);
    }
    // 两侧的三项门禁名必须一致（增减门禁时只改一侧 = 两个平台给出不同结论）
    for (const key of ["typecheck", "lint", "test"]) {
      expect(mjs).toContain(`${key}:`);
      expect(ps1).toContain(`Name = "${key}"`);
    }
  });
});
