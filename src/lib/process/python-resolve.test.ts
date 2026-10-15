/**
 * 「哪个 Python 真能跑」的单测。
 *
 * 起点是 ISSUE #1959 第二轮的首跑现场：流水线的「工具链自证」写成裸的一行
 * `python -V`，而门禁 `check-app-port-vectors.cjs` 探的是 `["python3","python"]`
 * —— 自托管节点上官方安装器落的是 `python.exe` / `py.exe`，于是这一步在第 8 秒
 * 红掉、排在后面的 27 个 stage 一个没跑，而红的理由与它要回答的问题无关。
 *
 * 判据分两层，本文件两层都钉：候选名与顺序（纯函数）、在候选里挑出第一个
 * **真起得来**的（用真临时文件 + 注入探针，两个平台的顺序在本机都能判）。
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import {
  clearWhichCommandCache,
  type UsabilityProbe,
} from "./executable-resolve";
import { pythonCandidates, pythonProbeArgs } from "./python-candidates";
import { resolvePython } from "./python-resolve";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "python-resolve-"));
let seq = 0;
/** 每个用例一个独立目录：同名文件被覆写重造会让 `whichCommand` 的记忆化缓存说谎。 */
function freshDir(): string {
  const dir = path.join(tmp, `case-${seq++}`);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

beforeEach(() => {
  clearWhichCommandCache();
});

afterAll(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

/** 造一个「形态上能被 Node 起」的候选（POSIX 要执行位；Windows 上 X_OK 恒通过）。 */
function writeCandidate(file: string) {
  fs.writeFileSync(file, "#!/bin/sh\nexit 0\n");
  fs.chmodSync(file, 0o755);
}

/**
 * 探针：只认 `wanted` 这一个候选跑得起来，其余一律 `ENOEXEC`。
 *
 * 为什么必须注入而不是真起进程：本文件要判的是「**两个平台**的候选顺序」，
 * 而 Windows 开发机上造不出另一套 PATH 布局。真起进程那一档由
 * `executable-resolve.test.ts` 与它在平台 fixture 下的用例覆盖。
 */
function probeOnly(wanted: string): UsabilityProbe {
  return {
    access: () => undefined,
    spawn: (candidate) =>
      (candidate.split(/[\\/]/).pop() ?? "") === wanted ? null : "ENOEXEC",
  };
}

describe("pythonCandidates：候选名与顺序即判据", () => {
  it("Windows 先试 python，再 py，最后 python3", () => {
    // 官方安装器落 python.exe；装了 Store 版时常常只有 py；python3 多半只是个别名。
    expect(pythonCandidates("win32")).toEqual(["python", "py", "python3"]);
  });

  it("POSIX 反过来：python3 才是规范名", () => {
    expect(pythonCandidates("linux")).toEqual(["python3", "python"]);
    expect(pythonCandidates("darwin")).toEqual(["python3", "python"]);
  });

  it("`py` 必须带 `-3`（裸 `py` 是「列出已装版本」并退非零）", () => {
    expect(pythonProbeArgs("py")).toEqual(["-3"]);
    expect(pythonProbeArgs("py", ["--version"])).toEqual(["-3", "--version"]);
    expect(pythonProbeArgs("python", ["--version"])).toEqual(["--version"]);
  });
});

describe("resolvePython：在候选里挑出第一个真能跑的", () => {
  it("POSIX 上命中 python3，且不带宿主参数", () => {
    const dir = freshDir();
    writeCandidate(path.join(dir, "python3"));
    const hit = resolvePython({
      env: { PATH: dir },
      platform: "linux",
      probe: probeOnly("python3"),
    });
    expect(hit?.command).toBe("python3");
    expect(hit?.path).toBe(path.join(dir, "python3"));
    expect(hit?.args).toEqual([]);
  });

  it("Windows 上只有 py 时命中它，并把 `-3` 一起交出来", () => {
    const dir = freshDir();
    writeCandidate(path.join(dir, "py.EXE"));
    const hit = resolvePython({
      env: { PATH: dir, PATHEXT: ".COM;.EXE;.BAT;.CMD" },
      platform: "win32",
      probe: probeOnly("py.EXE"),
    });
    expect(hit?.command).toBe("py");
    // 「选中了 py」与「怎么起它」是同一件事的两半，必须一起给出。
    expect(hit?.args).toEqual(["-3"]);
  });

  it("`py` 的**探测参数**也带 `-3`（不带的话 `py` 根本选不中，ISSUE #1961）", () => {
    /* 这一格是上一版漏掉的：`resolvePython` 把 `probeArgs` 硬编码成 `["--version"]`，
     * 于是 `whichCommand` 用**裸 `py --version`** 去判「这个候选可用吗」—— 而裸 `py`
     * 是「列出已装版本」并退非零，`py` 当场被判成不可用、继续往后找，最后答「没有
     * Python」。同一台节点上流水线的「工具链自证」用的是正确的 `py -3 --version`，
     * 于是**两条探针在同一次构建里互相矛盾**（实测：自证 597ms 绿、E2E 前置
     * 562ms 报 `PATH 上没有可用的 Python`）—— 与 #1959 第二轮「两处各判一次没有」
     * 是同一个病。
     *
     * 上一版的用例为什么没照出来：那个探针只看**文件名**、把 `args` 整个丢掉了，
     * 所以「选中了 py」这一条恒真。判据必须**记下真收到了什么参数**。 */
    const dir = freshDir();
    writeCandidate(path.join(dir, "py.EXE"));
    /** 真收参数的那一档：只有拿到 `-3` 才算「这个候选可用」。 */
    const seen: string[][] = [];
    const hit = resolvePython({
      env: { PATH: dir, PATHEXT: ".COM;.EXE;.BAT;.CMD" },
      platform: "win32",
      probe: {
        access: () => undefined,
        spawn: (candidate, args) => {
          if ((candidate.split(/[\\/]/).pop() ?? "") !== "py.EXE")
            return "ENOEXEC";
          seen.push(args);
          // 只有带 `-3` 的探针才「起得来」—— 裸 `py` 的形态如实报非零。
          return args.includes("-3") ? null : "ENOEXEC";
        },
      },
    });
    expect(
      seen.some((args) => args.includes("-3")),
      "`resolvePython` 探 `py` 时没带 `-3` —— 那等于用裸 `py` 判它可不可用，`py` 永远选不中",
    ).toBe(true);
    expect(hit?.command).toBe("py");
  });

  it("在盘上但起不来的候选不算命中，继续往后找", () => {
    const dir = freshDir();
    // 形态正是 Microsoft Store 的占位别名 python.exe：文件在、起一次就退非零。
    writeCandidate(path.join(dir, "python"));
    writeCandidate(path.join(dir, "py"));
    const hit = resolvePython({
      env: { PATH: dir },
      platform: "linux",
      // linux 的候选是 python3 / python —— 这里把顺序改成 python 打头，
      // 断言「先把 python 试掉，起不来就落到下一个」而不是当场认输。
      candidates: ["python", "py"],
      probe: probeOnly("py"),
    });
    expect(hit?.command).toBe("py");
  });

  it("一个都没有时返回 null，并把试过的候选一并说清", () => {
    const dir = freshDir();
    expect(
      resolvePython({
        env: { PATH: dir },
        platform: "linux",
        probe: probeOnly(""),
      }),
    ).toBeNull();
  });

  it("PATH 是空、且这台机器也认不出这个名字时答 null", () => {
    /* 两个注入口都写上 —— **空 PATH 不等于「这台机器没有 Python」**：
     * `resolvePython` 落地第二层之后（ISSUE #1961：PATH 扫不到时拿裸名字再问
     * 操作系统一次），不注入就等于在问宿主的真机器，同一条用例在装了 Python 的
     * 机器上红、在没装的机器上绿 —— 判据被环境污染，正是第二层当初要修的那一格。 */
    expect(
      resolvePython({
        env: { PATH: "" },
        platform: "linux",
        probe: probeOnly(""),
        bareSpawn: () => "ENOENT",
      }),
    ).toBeNull();
  });
});
