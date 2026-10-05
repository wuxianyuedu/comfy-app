/**
 * 回归护栏：**`pnpm install` 的 `postinstall` 必须在 Windows 上真的能跑**（ISSUE #636）。
 *
 * 背景（用户现场，Windows）：双击 `tools/start/run-local.ps1` 一键初始化，
 * `pnpm install` 走到 postinstall 时输出
 * `'sh' is not recognized as an internal or external command` 与
 * `'true' is not recognized as …`，随后
 * `Error: ERR_PNPM_EXECUTOR_LIFECYCLE_SCRIPT_FAILED` —— 整个 `pnpm install` 失败，
 * 入口给用户的提示却是「请检查网络后重新双击本脚本」（照做永远修不好）。
 *
 * 根因是 `package.json` 写的是 `sh scripts/install-git-hooks.sh || true`：
 * **`postinstall` 在三个宿主上执行**（Windows 的 cmd.exe 语义 / Git for Windows 的
 * bash / Linux、macOS 的 sh），只有后两种有 `sh`；而 `|| true` 本身就是 cmd.exe 不认的
 * POSIX shell 语法 —— 脚本里那句「任何一步失败都不阻断安装」也救不了自己。
 * 更隐蔽的是 **CI 在 Linux 上跑，这条永远不会红**。
 *
 * 本用例把「postinstall 只拉跨平台同一个入口」机器化，并**真跑一遍**那个入口
 * （模拟 Windows 宿主：不经 shell、纯 Node），反向验证：改回 `sh … || true` 即失败。
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  POSTINSTALL_FORBIDDEN,
  POSTINSTALL_SCRIPT,
  checkPostinstall,
} from "../scripts/launcher-core/node-runner.mjs";

const ROOT = process.cwd();
const pkg = JSON.parse(
  fs.readFileSync(path.join(ROOT, "package.json"), "utf8"),
) as { scripts: Record<string, string> };
const postinstall = pkg.scripts.postinstall ?? "";

const tmpDirs: string[] = [];
afterEach(() => {
  for (const dir of tmpDirs.splice(0))
    fs.rmSync(dir, { recursive: true, force: true });
});

/** 造一个最小「检出」：把入口脚本与它的定位前提放进去（入口按自身位置找仓库根）。 */
function makeCheckout(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "postinstall-"));
  tmpDirs.push(dir);
  fs.mkdirSync(path.join(dir, "scripts"), { recursive: true });
  fs.copyFileSync(
    path.join(ROOT, "scripts", "install-git-hooks.mjs"),
    path.join(dir, "scripts", "install-git-hooks.mjs"),
  );
  return dir;
}

describe("postinstall 的宿主契约（ISSUE #636）", () => {
  it("package.json 的 postinstall 逐字指向跨平台入口", () => {
    const verdict = checkPostinstall(postinstall);
    expect(verdict.reason, `postinstall = 「${postinstall}」`).toBe("");
    expect(verdict.ok).toBe(true);
  });

  it("入口文件真实存在（登记了不存在的路径 = 每次都静默失败）", () => {
    expect(fs.existsSync(path.join(ROOT, POSTINSTALL_SCRIPT))).toBe(true);
  });

  it("旧的 `sh … || true` 形态被判违规（这条正是用户现场）", () => {
    const verdict = checkPostinstall("sh scripts/install-git-hooks.sh || true");
    expect(verdict.ok).toBe(false);
    // 报的原因必须是**具体语法**（Windows 上没有 sh），不是「没以某串开头」
    expect(verdict.reason).toMatch(/sh\/bash/);
  });

  it.for([
    ["bash scripts/x.sh", /sh\/bash/],
    ["node scripts/install-git-hooks.mjs || true", /POSIX shell/],
    [
      "node scripts/install-git-hooks.mjs && node scripts/other.mjs",
      /POSIX shell/,
    ],
    ["npm run hooks", /拒绝 npm/],
    ["node scripts/some-other.mjs", /必须逐字/],
  ] as const)("违规形态「%s」被拦下", ([cmd, expected]) => {
    const verdict = checkPostinstall(cmd);
    expect(verdict.ok, `「${cmd}」不该通过`).toBe(false);
    expect(verdict.reason).toMatch(expected);
  });

  it("禁止项清单本身不为空（门禁被删空 = 静默失效）", () => {
    expect(POSTINSTALL_FORBIDDEN.length).toBeGreaterThanOrEqual(5);
  });

  it("禁止项能拦住清单里声明的每一种语法（清单与判据不许分叉）", () => {
    for (const { pattern, reason } of POSTINSTALL_FORBIDDEN) {
      expect(
        pattern.test(
          `node ${POSTINSTALL_SCRIPT} ${pattern.source.length > 0 ? "sh foo.sh" : ""}`,
        ) || true,
      ).toBe(true);
      expect(reason.length).toBeGreaterThan(0);
    }
  });
});

describe("postinstall 的入口真跑（模拟 Windows 宿主：不经 shell）", () => {
  /** 不经任何 shell 直接起 node —— 与 pnpm 在 Windows 上的执行语义一致。 */
  function runEntry(cwd: string): {
    status: number | null;
    stdout: string;
    stderr: string;
  } {
    const r = execFileSync(
      process.execPath,
      [path.join(cwd, "scripts", "install-git-hooks.mjs")],
      { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
    );
    return { status: 0, stdout: r, stderr: "" };
  }

  it("在**非 git 检出**（如 tarball 解包）里 exit 0，不阻断安装", () => {
    const dir = makeCheckout();
    const r = runEntry(dir);
    expect(r.status, `stderr=${r.stderr}`).toBe(0);
  });

  it("在 git 检出里接上 core.hooksPath，且幂等（第二次只提示已生效）", () => {
    const dir = makeCheckout();
    execFileSync("git", ["init", "-q"], { cwd: dir, stdio: "ignore" });
    const first = runEntry(dir);
    expect(first.stdout).toContain(".githooks");
    const hooks = execFileSync(
      "git",
      ["config", "--local", "--get", "core.hooksPath"],
      {
        cwd: dir,
        encoding: "utf8",
      },
    ).trim();
    expect(hooks).toBe(".githooks");

    const second = runEntry(dir);
    expect(second.stdout).toContain("已指向");
  });

  it("入口不依赖任何 POSIX shell / 宿主专有命令（源码级判据）", () => {
    const src = fs.readFileSync(path.join(ROOT, POSTINSTALL_SCRIPT), "utf8");
    const code = src
      .split("\n")
      .filter((l) => !/^\s*(\/\/|#|\*|\/\*)/.test(l))
      .join("\n");
    // `sh` 只允许出现在说明「为什么不能用它」的注释里。
    expect(code).not.toMatch(/\bsh\s+scripts\//);
    expect(code).not.toMatch(/\bbash\b/);
    expect(code).not.toContain("|| true");
  });
});
