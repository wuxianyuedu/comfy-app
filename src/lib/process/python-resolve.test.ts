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
import { findPython, resolvePython } from "./python-resolve";

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

  it("PATH 是空的时候也答 null（不是抛，也不是假装命中）", () => {
    expect(resolvePython({ env: { PATH: "" }, platform: "linux" })).toBeNull();
  });
});

describe("findPython：把「每个候选为什么没选中」一起交出去", () => {
  /* 为什么这半必须有（ISSUE #2316）：`resolvePython()` 答 null 时，调用方手上只有
   * 「试过哪些名字」这一份清单 —— 那说明不了「机器上没有解释器」还是「有一个同名的
   * 东西顶掉了它」，而两种的下一动作完全不同（去装 / 改探测）。 */
  it("命中时按顺序记下之前试过的候选，命中的那个不算「失败过」", () => {
    const dir = freshDir();
    writeCandidate(path.join(dir, "python"));
    const got = findPython({
      env: { PATH: dir },
      platform: "linux",
      candidates: ["python3", "python"],
      probe: probeOnly("python"),
    });
    expect(got.hit?.command).toBe("python");
    expect(got.missed.map((m) => m.command)).toEqual(["python3"]);
    expect(got.missed[0]?.failure.kind).toBe("spawn-error");
  });

  it("一个都不可用时 hit 为 null，而每个候选都留下一条「试过」", () => {
    const dir = freshDir();
    const got = findPython({
      env: { PATH: dir },
      platform: "linux",
      candidates: ["python3", "python"],
      probe: probeOnly(""),
    });
    expect(got.hit).toBeNull();
    expect(got.missed.map((m) => m.command)).toEqual(["python3", "python"]);
  });

  it("两个出口是同一份判据（`resolvePython` 就是 `findPython().hit`）", () => {
    const dir = freshDir();
    writeCandidate(path.join(dir, "python3"));
    const opts = {
      env: { PATH: dir },
      platform: /* SAFETY: 类型断言已复核 */ "linux" as const,
      probe: probeOnly("python3"),
    };
    expect(resolvePython(opts)).toEqual(findPython(opts).hit);
  });
});

describe("「没量到」≠ 「这个命令不存在」（ISSUE #1961）", () => {
  /* 现场：同一台自托管节点、同一次构建里，机器空着时「Python 可用性」答得出来
   * （`ok python --version → Python 3.12.10`），而排在 `单元测试`（723s）与
   * `生产构建` 之后的 `E2E 关键流程` **0.6 秒**就报「PATH 上没有可用的 Python」。
   *
   * 0.6s 走不到 10s 的探针超时，所以那一次不是超时，而是资源类失败：满载的节点上
   * `spawnSync` 直接给 `EAGAIN` / `EMFILE` / `ENOMEM` / libuv 认不出的 `UNKNOWN`。
   * 这些码说的是**机器当时的状态**，不是这个命令的属性 —— 而 `usableCommand` 原先
   * 照「非空 code 即失败」读，候选被跳过，全跳过 ⇒ `whichCommand()` 返回 `null` ⇒
   * 上层读成「这个命令不存在」。**拿不到测量被当成了测量结果。**
   *
   * 这一组把「起了一次、明确失败」（`ENOENT` / `EACCES` / `EINVAL` / `ENOEXEC`）与
   * 「这一次没量到」（超时 + 资源类）分开钉住：前者照旧算不可用，后者必须当可用
   * （否则一台满机上的判据会齐刷刷误报「工具没装」—— 让人去装一个本就装好的东西）。 */
  it.for(
    /* SAFETY: 类型断言已复核 */ [
      "ETIMEDOUT",
      "EAGAIN",
      "EMFILE",
      "ENOMEM",
      "UNKNOWN",
    ] as const,
  )("「没量到」的码（%s）按**可用**算，不再被跳过", (code) => {
    const dir = freshDir();
    writeCandidate(path.join(dir, "python3"));
    const hit = resolvePython({
      env: { PATH: dir },
      platform: "linux",
      probe: { access: () => undefined, spawn: () => code },
    });
    expect(hit?.command).toBe("python3");
  });

  it("同一条链上「明确起不来」照旧算不可用 —— 别把两件事混成一件", () => {
    const dir = freshDir();
    writeCandidate(path.join(dir, "python3"));
    const hit = resolvePython({
      env: { PATH: dir },
      platform: "linux",
      probe: { access: () => undefined, spawn: () => "ENOEXEC" },
    });
    expect(hit).toBeNull();
  });
});
