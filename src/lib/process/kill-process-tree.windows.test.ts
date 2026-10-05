/**
 * Windows 回收路径的**真跑**护栏（ISSUE #489）。
 *
 * 背景：`killProcessTree` 的 Windows 分支此前只被「命令字符串长什么样」断言过
 * （`expect(r.via).toContain("taskkill")`），而模块存在的唯一理由是「杀完整棵树
 * 不留孤儿」—— 只查构造正是历史上「进程组回收看着对、其实 ESRCH 落回单杀」
 * 漏过去的原因（见 kill-process-tree.ts 文件头）。
 *
 * Linux CI 上没法有真的 taskkill，但可以给出一个**同名可执行文件**：把
 * `COMFYAPP_TASKKILL` 指向它，就能在本机把 Windows 分支完整跑一遍 —— 参数
 * （`/PID <pid> /T /F`、`/IM <name> /T /F`）与「空 target 不猜测性击杀」两条
 * 都变成可失败断言，而不是读代码确认。
 *
 * 平台判据用的是 `isWindowsPlatform()`（可注入），因此这里连「在 Linux 上跑
 * Windows 分支」都不需要 mock 全局 —— 唯一的前提是那个可执行文件存在。
 *
 * 反向验证：把 `windowsKillArgs` 的 `/T` 去掉，本文件立刻失败。
 */
import {
  chmodSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
/* 平台切换改由 fixture 提供（`tests/helpers/platform-fixtures.ts`）：原来是本文件
 * 手写的 `withWindows()` + try/finally。fixture 的收益是**用例中途 throw 也照样
 * 恢复**，且「这条依赖哪个平台」在用例签名里看得见而不是散在包装函数里。 */
import {
  ON_WINDOWS,
  test as platformTest,
} from "../../../tests/helpers/platform-fixtures";

import {
  killProcessTreeByImage,
  killProcessTreeSync,
  killProcessTreeWith,
  spawnTaskkill,
  windowsKillArgs,
  windowsTaskkillPath,
} from "./kill-process-tree";

/** 造一个假 taskkill：把收到的参数写进文件，退出码可控。 */
function fakeTaskkill(
  dir: string,
  exitCode = 0,
): { exe: string; logFile: string } {
  const exe = join(
    dir,
    process.platform === "win32" ? "taskkill.cmd" : "taskkill",
  );
  const logFile = join(dir, "args.txt");
  if (process.platform === "win32") {
    writeFileSync(
      exe,
      `@echo off\r\necho %* > "${logFile}"\r\nexit /b ${exitCode}\r\n`,
    );
  } else {
    writeFileSync(
      exe,
      `#!/bin/sh\nprintf '%s' "$*" > "${logFile}"\nexit ${exitCode}\n`,
    );
    chmodSync(exe, 0o755);
  }
  return { exe, logFile };
}

const dirs: string[] = [];
function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "comfyapp-taskkill-"));
  dirs.push(dir);
  return dir;
}

afterEach(() => {
  delete process.env.COMFYAPP_TASKKILL;
  for (const dir of dirs.splice(0))
    rmSync(dir, { recursive: true, force: true });
});

/** 等假 taskkill 把参数写下来（异步派发，需要给一小段窗口）。 */
async function readArgs(logFile: string, timeoutMs = 3000): Promise<string> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      const text = readFileSync(logFile, "utf8").trim();
      if (text) return text;
    } catch {
      /* 还没写 */
    }
    if (Date.now() > deadline) return "";
    await new Promise((r) => setTimeout(r, 25));
  }
}

describe("Windows 回收命令构造（唯一出处）", () => {
  it("tree 模式是 /PID <pid> /T /F（杀整棵树，硬规则 3 的原始要求）", () => {
    expect(windowsKillArgs("4321", "tree")).toEqual([
      "/PID",
      "4321",
      "/T",
      "/F",
    ]);
  });

  it("image 模式是 /IM <name> /T /F（按映像名杀整棵树）", () => {
    expect(windowsKillArgs("ollama.exe", "image")).toEqual([
      "/IM",
      "ollama.exe",
      "/T",
      "/F",
    ]);
  });

  it("默认走系统自带 taskkill；COMFYAPP_TASKKILL 只作为显式注入口", () => {
    expect(windowsTaskkillPath()).toBe("taskkill");
    process.env.COMFYAPP_TASKKILL = "/tmp/x/taskkill";
    expect(windowsTaskkillPath()).toBe("/tmp/x/taskkill");
    // 空白串等于没给：spawn 一个空命令名会报出与「命令不存在」完全不同的错
    process.env.COMFYAPP_TASKKILL = "   ";
    expect(windowsTaskkillPath()).toBe("taskkill");
  });
});

describe("Windows 分支真跑（注入同名可执行文件）", () => {
  /* 下面三条的依赖是**真宿主**（一个能被 Node 直接 spawn 的 shebang 脚本），不是
   * 「平台」—— 假 taskkill 在 Windows 上只能是 `.cmd`，而 Node 自 CVE-2024-27980
   * 起不能直接 spawn 批处理（EINVAL，必须经 cmd.exe）。所以在 Windows 上没有
   * 等价的可注入形态（要真编一个 exe），这三条在 Linux CI 上真跑、Windows 本地跳过。
   *
   * 依赖用 fixture 表达（`platformTest(..., { onWindows })`）：**跳过是显式的**，
   * 而不是靠一个散在用例里的裸 `process.platform === "win32"`。参数构造本身不依赖
   * 平台，由上面「命令构造」用例在两端守着。
   *
   * ⚠️ 跳过的那几条在本机**就是零执行者**（台账 E7 记的形状）。这里不动它们，
   * 是因为它们问的是「命令真的被 spawn 出去了吗」——那件事没有注入形态；
   * 而「该构造什么命令」这一半已经由上面的纯函数用例在两端判过。 */
  platformTest.skipIf(ON_WINDOWS)(
    "真的以 /PID <pid> /T /F 调起 taskkill",
    async () => {
      const dir = tempDir();
      const { exe, logFile } = fakeTaskkill(dir);
      process.env.COMFYAPP_TASKKILL = exe;
      const result = await killProcessTreeWith(
        { pid: 4321 },
        { windows: true },
      );
      expect(result.ok).toBe(true);
      expect(result.via).toContain("/PID 4321 /T /F");
      expect(await readArgs(logFile)).toBe("/PID 4321 /T /F");
    },
  );

  platformTest.skipIf(ON_WINDOWS)(
    "image 模式真的以 /IM <name> /T /F 调起 taskkill（Ollama 走这条）",
    async () => {
      const dir = tempDir();
      const { exe, logFile } = fakeTaskkill(dir);
      process.env.COMFYAPP_TASKKILL = exe;
      const result = await killProcessTreeWith(
        { pid: 1, mode: "image" },
        { windows: true, image: "ollama.exe" },
      );
      expect(result.via).toContain("/IM ollama.exe /T /F");
      expect(await readArgs(logFile)).toBe("/IM ollama.exe /T /F");
    },
  );

  it("空 target 直接返回 ok=false，不调 taskkill（禁止猜测性击杀）", async () => {
    const dir = tempDir();
    const { exe, logFile } = fakeTaskkill(dir);
    process.env.COMFYAPP_TASKKILL = exe;
    expect((await killProcessTreeWith({ pid: 0 }, { windows: true })).ok).toBe(
      false,
    );
    expect(await readArgs(logFile, 300)).toBe("");
  });
});

/**
 * 上面那组要真 spawn 得起来，所以在 Windows 上被跳过了（`.cmd` 不能直接起）。
 * 但**命令本身**的判据不该跟着一起缺席 —— 这一组只看 `via` 里的命令行，
 * 用 `node` 自己当命令名（它起得来、也立刻退出，只是参数不合它的口味）。
 */
describe("Windows 命令行在两端都判得到", () => {
  it("mode:image 用的是调用方给的映像名，**不许把 pid 塞进 /IM**", async () => {
    process.env.COMFYAPP_TASKKILL = process.execPath;
    const result = await killProcessTreeWith(
      { pid: 1, mode: "image" },
      { windows: true, image: "ollama.exe" },
    );
    /* `/IM 1` 会去杀一个名字恰好叫「1」的映像：静默杀不到、也可能杀错。 */
    expect(result.via).toContain("/IM ollama.exe /T /F");
    expect(result.via).not.toContain("/IM 1");
  });

  it("命令以 0 退出时回调收到 true（派发成功与失败不许混成一句话）", async () => {
    process.env.COMFYAPP_TASKKILL = process.execPath;
    const outcomes: boolean[] = [];
    const via = spawnTaskkill(["--version"], (ok) => outcomes.push(ok));
    await expect
      .poll(() => outcomes, { message: "taskkill 退出回调收到的成败序列" })
      .toEqual([true]);
    expect(via).toContain("--version");
  });
});

describe("另外两个 Windows 落点（映像名回收 / 同步入口）", () => {
  /* 这里不数「参数真的送达」—— Windows 上假 taskkill 只能是 `.cmd`，而 Node 自
   * CVE-2024-27980 起不能直接 spawn 批处理（上面那组已按此分平台）。用 `node` 自己
   * 当命令名是为了让**命令行构造**这一步在两端都判得到：它立刻以非 0 退出，
   * 而参数就在 via 里。 */
  /* 这三条要的是「Windows 分支被走到」，而 `killProcessTreeByImage` /
   * `killProcessTreeSync` 读的是真实 `process.platform`（它们没有
   * `killProcessTreeWith` 那样的平台注入参数）—— 所以把平台切成 win32 跑一段。
   * 收尾由 fixture 负责：用例中途 throw 也照样恢复。 */
  platformTest(
    "按映像名回收发的是 /IM <name> /T /F（不是 /PID，也不能漏掉 /T）",
    async ({ asPlatform }) => {
      asPlatform("win32");
      process.env.COMFYAPP_TASKKILL = process.execPath;
      const result = await killProcessTreeByImage("ollama.exe");
      expect(result.ok).toBe(true);
      expect(result.via).toBe(`${process.execPath} /IM ollama.exe /T /F`);
    },
  );

  platformTest(
    "同步入口在 Windows 上同样是 /PID <pid> /T /F，且不等命令结束",
    ({ asPlatform }) => {
      asPlatform("win32");
      process.env.COMFYAPP_TASKKILL = process.execPath;
      const result = killProcessTreeSync({ pid: 4321 });
      expect(result.ok).toBe(true);
      expect(result.via).toBe(`${process.execPath} /PID 4321 /T /F`);
    },
  );

  platformTest(
    "映像名回收在 Windows 上也拒绝空名字（`/IM ` 加空格名会杀到整台机器）",
    async ({ asPlatform }) => {
      asPlatform("win32");
      process.env.COMFYAPP_TASKKILL = process.execPath;
      const result = await killProcessTreeByImage("  ");
      expect(result.ok).toBe(false);
      expect(result.via).toContain("无映像名");
    },
  );
});

describe("回收命令的派发与等待（`wait`）", () => {
  /**
   * 「派发完就退出」的调用方（命令行入口 `scripts/reap-process.mjs`）必须等命令结束：
   * Windows 上 taskkill 是独立进程，父进程立刻 exit 会把它一起带走 —— 现象是
   * **打印了命令、退出码 0、目标进程却还在**（实测过：不等时目标存活，等 3s 后消失）。
   * 这里用一个「一定跑得起来、但参数不合法」的真可执行文件（node 自己）当 taskkill：
   * 它会立刻以非 0 退出，因此既验证「确实等到了结束」，也验证退出码进了 via。
   */
  it("wait=true 时等到命令结束，并把退出码写进 via", async () => {
    process.env.COMFYAPP_TASKKILL = process.execPath;
    const result = await killProcessTreeWith(
      { pid: 4321, wait: true },
      { windows: true },
    );
    expect(result.via).toContain("/PID 4321 /T /F");
    expect(result.via).toContain("非 0");
    expect(result.ok).toBe(false);
  });

  it("wait=false（默认）只派发，不等结果", async () => {
    process.env.COMFYAPP_TASKKILL = process.execPath;
    const result = await killProcessTreeWith({ pid: 4321 }, { windows: true });
    expect(result.via).toBe(`${process.execPath} /PID 4321 /T /F`);
  });

  it("命令起不来时返回 ok=false，不抛错（回收失败不打断调用方）", async () => {
    process.env.COMFYAPP_TASKKILL = join(tempDir(), "not-a-taskkill");
    const result = await killProcessTreeWith(
      { pid: 4321, wait: true },
      { windows: true },
    );
    expect(result.ok).toBe(false);
    expect(result.via).toContain("not-a-taskkill /PID 4321 /T /F");
  });

  it("spawn **同步抛错**那一形态也收成失败（Windows 上 .cmd 走的就是这条）", async () => {
    /* 两条失败形态不一样：路径不存在 / 不可执行 → `error` 事件（异步）；而 Windows 上
     * 直接 spawn 一个批处理是 **EINVAL 同步抛**（Node 自 CVE-2024-27980 起禁止）。
     * 本模块对外承诺「回收失败不抛错」，两端的结论必须落在同一个 ok=false ——
     * 漏掉同步那条的表现是 taskkill 起不来时**整个收尾调用链被异常打断**。
     * 同步这条只有 Windows 造得出来（Linux 上同一个文件给的是异步 EACCES），
     * 所以这里是「两端各测一条形态、共享同一条断言」。 */
    const dir = tempDir();
    const exe = join(dir, "taskkill.cmd");
    /* 故意**不** chmod：让它存在但不可执行。 */
    writeFileSync(exe, "@echo off\r\nexit /b 0\r\n");
    process.env.COMFYAPP_TASKKILL = exe;
    const result = await killProcessTreeWith(
      { pid: 4321, wait: true },
      { windows: true },
    );
    expect(result.ok).toBe(false);
    expect(result.via).toContain("非 0");
  });
});
