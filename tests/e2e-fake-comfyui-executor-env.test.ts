/**
 * 「假 comfy-cli 怎么被起」的跨平台判据（ISSUE #1767）。
 *
 * ## 立案现场
 *
 * `playwright.config.ts` 此前把 `COMFY_CLI_PYTHON` 指向一份 POSIX shim
 * （`e2e/support/fake-comfyui/python.sh`，内容是 `PYTHONPATH=… exec python3 "$@"`）。
 * 而本应用把 `comfyCliPython` 的值当**解释器路径**直接 spawn
 * （`spawn(py, ["-m", "comfy_cli", "run", …])`，见 `executor-cli.ts`）：
 * Linux / macOS 上内核认 shebang 于是能跑，**Windows 上必然起不来** —— Node 的
 * `spawn` 走 CreateProcess，只执行 `.exe` 与经 cmd.exe 的 `.cmd` / `.bat`
 * （本仓库自己的判据见 `src/lib/process/executable-resolve.ts` 文件头，
 * 硬规则 12 也据此禁 `.bat` / `.cmd`）。
 *
 * 症状是**两条 `@critical` 主链路用例在 Windows 开发机上必红**，而报错话术在说
 * 「执行器收口失败」—— 真因是这份替身根本没起来。
 *
 * ## 判据分三头
 *
 *   ① **候选顺序按平台**：Windows 先试 `python`/`py`、POSIX 先试 `python3`
 *      ——「找一个真能跑的 Python」这件事不许写死一个平台的名字；
 *   ② **拼出来的 env 是两个平台同一条形状**：`COMFY_CLI_PYTHON` 是**真解释器**、
 *      `PYTHONPATH` 指替身包目录（分隔符按平台），且 `PYTHONPATH` 是**前缀**不是
 *      覆盖（别人设过的不能被掐掉）；
 *   ③ **接线在位**：`playwright.config.ts` 走这个模块；替身目录下**不再有**
 *      需要 shebang 的 `.sh`/`.ps1` 形态的入口（有一份就说明有人把老路走回来了）。
 */
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  COMFY_CLI_PYTHON_KEY,
  FAKE_CLI_FAIL_SENTINEL_KEY,
  FAKE_CLI_FAIL_SENTINEL_VALUE,
  FAKE_CLI_MODULE_ROOT,
  fakeExecutorEnv,
  pythonCandidates,
  resolveFakeCliPython,
} from "../e2e/support/fake-comfyui-executor-env.mjs";

const ROOT = path.resolve(import.meta.dirname, "..");

function readText(rel: string): string {
  return readFileSync(path.join(ROOT, rel), "utf8");
}

/** 用例自己的 tmpdir：`whichCommand` 的候选判据要**真文件**（它读文件头判形态），
 *  所以这里造一份真的 bin 目录，而不是拿注入的探针伪造一个不存在的路径。 */
const tmpDirs: string[] = [];
afterEach(() => {
  while (tmpDirs.length) {
    const dir = tmpDirs.pop();
    if (dir) rmSync(dir, { recursive: true, force: true });
  }
});

/** 造一个 bin 目录，里面放**真**候选文件（内容按形态给，见 `executableKind`）。 */
function mkBin(files: Record<string, Buffer | string>) {
  const dir = mkdtempSync(path.join(os.tmpdir(), "fake-cli-python-"));
  tmpDirs.push(dir);
  for (const [name, content] of Object.entries(files)) {
    writeFileSync(path.join(dir, name), content);
  }
  return dir;
}

/** 恒「起得来」的探针：本判据要的是**选了谁**，不该真去执行候选。 */
const alwaysUsable = { access: () => undefined, spawn: () => null };
/** POSIX 的 `MZ` 头（Windows 可执行）；`executableKind` 按二进制判。 */
const BINARY = Buffer.from([0x4d, 0x5a, 0x90, 0x00, 0x03, 0x00, 0x00, 0x00]);

describe("pythonCandidates：按平台给候选，顺序即判据", () => {
  it("Windows 先 python / py，POSIX 先 python3", () => {
    expect(pythonCandidates("win32")).toEqual(["python", "py", "python3"]);
    expect(pythonCandidates("linux")).toEqual(["python3", "python"]);
    expect(pythonCandidates("darwin")).toEqual(["python3", "python"]);
  });
});

describe("resolveFakeCliPython：挑第一个真能跑的", () => {
  it("Windows PATH 上只有 python.exe 时选中它（python3 不存在是常态）", () => {
    /* 文件名按 PATHEXT 的大写拼（`.EXE`）——本判据跑在大小写敏感的 POSIX FS 上，
     * 用小写会命不中，那是**测试夹具**与真实 Windows 的差异，不是判据的差异。 */
    const bin = mkBin({ "python.EXE": BINARY });
    const found = resolveFakeCliPython({
      platform: "win32",
      env: { PATH: bin, PATHEXT: ".EXE" },
      probe: alwaysUsable,
    });
    expect(found).toBe(path.join(bin, "python.EXE"));
  });

  it("Windows 只有 py.exe（Store 版安装的常见形态）时退到它", () => {
    const bin = mkBin({ "py.EXE": BINARY });
    const found = resolveFakeCliPython({
      platform: "win32",
      env: { PATH: bin, PATHEXT: ".EXE" },
      probe: alwaysUsable,
    });
    expect(found).toBe(path.join(bin, "py.EXE"));
  });

  it("POSIX 上只有 python3 时选中它", () => {
    const bin = mkBin({ python3: "#!/bin/sh\nexit 0\n" });
    const found = resolveFakeCliPython({
      platform: "linux",
      env: { PATH: bin },
      probe: alwaysUsable,
    });
    expect(found).toBe(path.join(bin, "python3"));
  });

  it("一个都没有时返回 null（由调用方说清后果，不在这里造一个假路径）", () => {
    const bin = mkBin({ README: "nothing here\n" });
    expect(
      resolveFakeCliPython({
        platform: "win32",
        env: { PATH: bin },
        probe: alwaysUsable,
      }),
    ).toBeNull();
  });
});

describe("fakeExecutorEnv：两个平台同一条形状", () => {
  it("拼出解释器 + PYTHONPATH + 哨兵；PYTHONPATH 指替身包所在目录", () => {
    const bin = mkBin({ python3: "#!/bin/sh\nexit 0\n" });
    const result = fakeExecutorEnv({
      platform: "linux",
      env: { PATH: bin },
      probe: alwaysUsable,
      moduleRoot: "/fake/fake-comfyui",
      exists: (p) => p === "/fake/fake-comfyui/comfy_cli/__main__.py",
    });
    expect(result.reason).toBeNull();
    expect(result.python).toContain("python3");
    expect(result.env[COMFY_CLI_PYTHON_KEY]).toBe(result.python);
    expect(result.env.PYTHONPATH).toBe("/fake/fake-comfyui");
    expect(result.env[FAKE_CLI_FAIL_SENTINEL_KEY]).toBe(
      FAKE_CLI_FAIL_SENTINEL_VALUE,
    );
  });

  it("PYTHONPATH 是**前缀**不是覆盖：调用方已有的路径必须留着", () => {
    const bin = mkBin({ python3: "#!/bin/sh\nexit 0\n" });
    const result = fakeExecutorEnv({
      platform: "linux",
      env: { PATH: bin, PYTHONPATH: "/someone/else" },
      probe: alwaysUsable,
      moduleRoot: "/fake/fake-comfyui",
      exists: () => true,
    });
    /* 分隔符跟着「这条 env 是为**哪个平台**的 Python 拼的」走，不跟宿主 —— 与实现同口径
     * （真实调用时 `platform` 缺省 = `process.platform`，两者相等，生产形态逐字不变）。
     * 上一版这里用宿主 `path.delimiter`，而同一个 describe 的形状判据注入的是
     * `platform: "linux"` 并按 POSIX 路径比对 —— 两条用例对「分隔符归谁管」的要求相反，
     * 于是在 Windows 开发机上**必然恰好红一条**、在 POSIX 上全绿：这批形状判据
     * 其实从没在非 POSIX 宿主上自证过（ISSUE #1767 的跨平台那一半）。 */
    expect(result.env.PYTHONPATH).toBe("/fake/fake-comfyui:/someone/else");
  });

  it("替身包不在 / PATH 上没有 Python：给空 env + reason，不抛", () => {
    const missingPkg = fakeExecutorEnv({
      platform: "win32",
      env: { PATH: "/fake/bin" },
      probe: alwaysUsable,
      moduleRoot: "/fake/fake-comfyui",
      exists: () => false,
    });
    expect(missingPkg.env).toEqual({});
    expect(missingPkg.reason).toContain("假 comfy-cli 包不在");

    const bin = mkBin({ README: "nothing\n" });
    const missingPython = fakeExecutorEnv({
      platform: "win32",
      env: { PATH: bin },
      probe: alwaysUsable,
      moduleRoot: "/fake/fake-comfyui",
      exists: () => true,
    });
    expect(missingPython.env).toEqual({});
    expect(missingPython.reason).toContain("Python");
  });

  it("在本机真跑一次：确实能解析出一个解释器与真实的替身目录", () => {
    /* env 里**只摘掉宿主的 PYTHONPATH**：`PYTHONPATH` 按前缀语义拼进结果
     * （上面那条纯断言守着它），于是「精确等于替身目录」只在宿主 shell 干净时
     * 成立 —— CodeBuddy 宿主的 agent shell 就把它设成了自己的 `vendor\shim`，
     * 本机不摘的话这一条必红，而红在「宿主机被压满」这件事上、不在判据上。
     * PATH 必须留着：解释器是**真从 PATH 上解析**的（这正是「真跑一次」的意思）。 */
    const env = { ...process.env };
    delete env.PYTHONPATH;
    const result = fakeExecutorEnv({ env });
    /* 开发机 / CI 上应当都有 Python（本仓库的 e2e 前提就是它）。
     * 真没有时这一条会红，那是**该红**的：主链路用例同样会红。 */
    expect(result.reason).toBeNull();
    expect(result.python).toBeTruthy();
    expect(existsSync(path.join(FAKE_CLI_MODULE_ROOT, "comfy_cli", "__main__.py"))).toBe(
      true,
    );
    expect(result.env.PYTHONPATH).toBe(FAKE_CLI_MODULE_ROOT);
  });
});

describe("接线在位", () => {
  it("playwright.config 走本模块，不再指向 python.sh", () => {
    const config = readText("playwright.config.ts");
    expect(config).toContain("fakeExecutorEnv()");
    expect(config).toContain("executorEnv");
    /* 指到老那份 shim 的**代码**必须没有（注释里那句「它此前是一份 python.sh
     * shim」是刻意留的沿革说明，不在此判）。 */
    expect(config).not.toMatch(/fake-comfyui\/python\.sh/);
  });

  it("替身目录下不再有需要 shebang 才能起的入口（.sh / .ps1）", () => {
    /* 这是本 ISSUE 的形态本身：解释器入口必须是**真的可执行文件**或一个真
     * 解释器，不能是脚本。留一份 `.sh` 回来 = 把 Windows 那条路又走断一次。 */
    const entries = readdirSync(FAKE_CLI_MODULE_ROOT, { withFileTypes: true })
      .filter((e) => e.isFile())
      .map((e) => e.name);
    expect(entries.filter((n) => /\.(sh|ps1|cmd|bat)$/.test(n))).toEqual([]);
  });
});
