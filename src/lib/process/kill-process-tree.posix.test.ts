// POSIX 回收判决面的用例 —— **在任意平台上都跑**。
//
// 为什么单开一个文件：`kill-process-tree.test.ts` 那组判的是「真起一棵树、发完信号、
// 数残留」，它需要 `ps` 与真信号，于是整组 `describe.runIf(!isWindowsPlatform())` ——
// 在 Windows 开发机上这 8 条**一条都不跑**。而台账 E7 记的就是这个形状：
// `kill-process-tree.ts` 的 92–224 与 336–387 行（POSIX 的全部判据 + 同步版整张表）
// 在本机零执行者，占比 29.1%。
//
// 这里补的是另一半：**决策**。`ps` 报什么 PGID、自身 PGID 是多少、`process.kill`
// 接不接受这个目标 —— 三件事全部注入，于是这张表在 Windows / Linux / CI 上判的是
// 同一个结论。真跑组留在原文件里，两边不是重复：那边证明「信号真的能带走整棵树」，
// 这边证明「该发哪个信号、什么时候必须不发组」。
//
// 反向验证（每次改这张表都要重做）：
//   · 把「与调用者同组」判据去掉 → ③ 那两条红（应用把自己杀掉）；
//   · 把「自身 PGID 读不到时禁组」写反 → ④ 红（这是注释承诺的保守侧，代码此前没做）；
//   · 同步版与异步版分叉（只改一边）→ 对应那一条红（两侧共用同一个判据函数）。
import { EventEmitter } from "node:events";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { execFileMock, execFileSyncMock, spawnMock } = vi.hoisted(() => ({
  execFileMock:
    vi.fn<
      (
        cmd: string,
        args: string[],
        options: unknown,
        cb: (err: Error | null, stdout: string) => void,
      ) => void
    >(),
  execFileSyncMock:
    vi.fn<(cmd: string, args: string[], options: unknown) => string>(),
  spawnMock:
    vi.fn<
      (
        cmd: string,
        args: string[],
        options: unknown,
      ) => EventEmitter & { pid: number }
    >(),
}));

vi.mock("child_process", () => ({
  execFile: execFileMock,
  execFileSync: execFileSyncMock,
  spawn: spawnMock,
}));

import {
  killProcessTreeByImage,
  killProcessTreeSync,
  killProcessTreeWith,
  readPgid,
} from "./kill-process-tree";

/** `ps -o pgid= -p <pid>` 的回答表：键是 pid 的字符串形态，null = 读不到。 */
type PsMap = Record<string, number | null>;

/** 让异步读组（execFile）按这张表回答。 */
function installAsyncPs(map: PsMap): void {
  execFileMock.mockImplementation((_cmd, args, _options, cb) => {
    const pid = args.at(-1) ?? "";
    const value = map[pid];
    if (value === null || value === undefined) {
      cb(new Error(`ps: can't attach to PID ${pid}`), "");
      return;
    }
    cb(null, ` ${value}\n`);
  });
}

/** 让同步读组（execFileSync）按同一张表回答。 */
function installSyncPs(map: PsMap): void {
  execFileSyncMock.mockImplementation((_cmd, args) => {
    const pid = args.at(-1) ?? "";
    const value = map[pid];
    if (value === null || value === undefined) {
      throw new Error(`ps: can't attach to PID ${pid}`);
    }
    return ` ${value}\n`;
  });
}

/** 假信号发射器：记录每次 `process.kill(target, sig)`，并按 map 决定抛不抛。 */
type KillMap = Record<string, Error | null>;
let killCalls: Array<[number, string]> = [];
function installKillSpy(map: KillMap = {}): void {
  killCalls = [];
  vi.spyOn(process, "kill").mockImplementation(((
    target: number,
    sig?: string,
  ) => {
    const key = String(target);
    const error = map[key];
    if (error) throw error;
    killCalls.push([target, sig ?? "SIGTERM"]);
    return true;
  }) as unknown as typeof process.kill);
}

const originalPlatform = Object.getOwnPropertyDescriptor(process, "platform");

/** `killProcessTreeSync` / `killProcessTreeByImage` 读的是真实平台，只能换掉它。 */
function withLinux<T>(run: () => T): T {
  Object.defineProperty(process, "platform", {
    value: "linux",
    configurable: true,
    writable: true,
  });
  try {
    return run();
  } finally {
    if (originalPlatform) {
      Object.defineProperty(process, "platform", originalPlatform);
    }
  }
}

const OWN = String(process.pid);

beforeEach(() => {
  vi.clearAllMocks();
  installKillSpy();
});

afterEach(() => {
  vi.restoreAllMocks();
  if (originalPlatform) {
    Object.defineProperty(process, "platform", originalPlatform);
  }
});

describe("readPgid —— 组长归属由 OS 回答，不猜", () => {
  it("ps 正常回答时取第一个字段为 PGID（输出带表头空格与换行）", async () => {
    installAsyncPs({ "2866": 2838 });
    expect(await readPgid(2866)).toBe(2838);
  });

  it("ps 报错（目标已退 / 无权限 / 没装 ps）→ null，不抛", async () => {
    installAsyncPs({});
    expect(await readPgid(2866)).toBeNull();
  });

  it("输出解析不出数字 → null（宁可退回单杀，也不拿 NaN 去发信号）", async () => {
    execFileMock.mockImplementation((_cmd, _args, _options, cb) => {
      cb(null, "  \n");
    });
    expect(await readPgid(2866)).toBeNull();
  });

  it("0 与负数不是合法 PGID → null（`kill(0)` 会打到调用者的整组，绝不能当成一个组号）", async () => {
    installAsyncPs({ "2866": 0 });
    expect(await readPgid(2866)).toBeNull();
    installAsyncPs({ "2866": -1 });
    expect(await readPgid(2866)).toBeNull();
  });
});

describe("killProcessTree POSIX：谁该被发信号", () => {
  it("① 目标自成一组（PGID ≠ 自身）→ 向进程组发信号，整棵树一起走", async () => {
    installAsyncPs({ "2866": 2838, [OWN]: 9999 });
    const r = await killProcessTreeWith({ pid: 2866 }, { windows: false });
    expect(r.ok).toBe(true);
    expect(r.via).toContain("（进程组）");
    expect(killCalls).toEqual([[-2838, "SIGTERM"]]);
  });

  it("② force 只换信号名，不换目标（SIGKILL 也必须是发给组）", async () => {
    installAsyncPs({ "2866": 2838, [OWN]: 9999 });
    const r = await killProcessTreeWith(
      { pid: 2866, force: true },
      { windows: false },
    );
    expect(r.via).toContain("SIGKILL");
    expect(killCalls).toEqual([[-2838, "SIGKILL"]]);
  });

  it("③ 与调用者同组 → **绝不发组**，只单杀 leader，并在 via 里说明原因", async () => {
    /* bound 模式的子进程与调用者同组：发 -pgid 等于把应用自己杀掉。 */
    const own = 4242;
    installAsyncPs({ "2866": own, [OWN]: own });
    const r = await killProcessTreeWith({ pid: 2866 }, { windows: false });
    expect(r.via).toContain("禁杀组");
    expect(killCalls).toEqual([[2866, "SIGTERM"]]);
    expect(killCalls.some(([target]) => target < 0)).toBe(false);
  });

  it("④ 自身 PGID 读不到 → **视同为自身组**（注释承诺的保守侧：宁可单杀，不冒自杀风险）", async () => {
    /* 读不到自身组时无法证明「目标不在我们组里」，此时组路径是不安全的。
     * 这条以前是反的：ownPgid 为 null 让判据直接放行组信号。 */
    installAsyncPs({ "2866": 2838 });
    const r = await killProcessTreeWith({ pid: 2866 }, { windows: false });
    expect(r.via).toContain("禁杀组");
    expect(killCalls).toEqual([[2866, "SIGTERM"]]);
  });

  it("⑤ 组信号被拒（组已回收 / EPERM）→ 落到单杀，不静默失败", async () => {
    installAsyncPs({ "2866": 2838, [OWN]: 9999 });
    installKillSpy({ "-2838": new Error("ESRCH: no such process") });
    const r = await killProcessTreeWith({ pid: 2866 }, { windows: false });
    expect(r.ok).toBe(true);
    expect(r.via).toContain("单进程兜底");
    expect(killCalls).toEqual([[2866, "SIGTERM"]]);
  });

  it("⑥ ps 不可用但调用方声明 detached → 仍试一次按 pid 的组信号（末位补救，不是主判据）", async () => {
    installAsyncPs({ [OWN]: 9999 });
    const r = await killProcessTreeWith(
      { pid: 2866, detached: true },
      { windows: false },
    );
    expect(r.via).toContain("进程组·未探测");
    expect(killCalls).toEqual([[-2866, "SIGTERM"]]);
  });

  it("⑦ ps 不可用、也没声明 detached → 单杀 leader（不猜组长）", async () => {
    installAsyncPs({ [OWN]: 9999 });
    const r = await killProcessTreeWith({ pid: 2866 }, { windows: false });
    expect(r.via).toBe("kill -SIGTERM 2866（单进程兜底）");
    expect(killCalls).toEqual([[2866, "SIGTERM"]]);
  });

  it("⑧ 连单杀都失败（目标早已退出）→ ok=false 而不抛错", async () => {
    installAsyncPs({ [OWN]: 9999 });
    installKillSpy({ "2866": new Error("ESRCH") });
    const r = await killProcessTreeWith({ pid: 2866 }, { windows: false });
    expect(r.ok).toBe(false);
    expect(r.via).toContain("失败（目标可能已退出）");
  });

  it("⑨ 目标与自身同组时，即使声明 detached 也不许按 pid 猜组（旧实现留孤儿的入口）", async () => {
    const own = 4242;
    installAsyncPs({ "2866": own, [OWN]: own });
    await killProcessTreeWith(
      { pid: 2866, detached: true },
      { windows: false },
    );
    expect(killCalls).toEqual([[2866, "SIGTERM"]]);
  });
});

describe("killProcessTreeSync 与异步版同判据（两侧不许分叉）", () => {
  it("自成一组 → 发组", () => {
    installSyncPs({ "2866": 2838, [OWN]: 9999 });
    const r = withLinux(() => killProcessTreeSync({ pid: 2866 }));
    expect(r.via).toContain("（进程组）");
    expect(killCalls).toEqual([[-2838, "SIGTERM"]]);
  });

  it("与调用者同组 → 单杀 + 禁杀组", () => {
    const own = 4242;
    installSyncPs({ "2866": own, [OWN]: own });
    const r = withLinux(() => killProcessTreeSync({ pid: 2866 }));
    expect(r.via).toContain("禁杀组");
    expect(killCalls).toEqual([[2866, "SIGTERM"]]);
  });

  it("自身 PGID 读不到 → 同样保守禁组（同步版不许比异步版胆大）", () => {
    installSyncPs({ "2866": 2838 });
    const r = withLinux(() => killProcessTreeSync({ pid: 2866 }));
    expect(r.via).toContain("禁杀组");
    expect(killCalls).toEqual([[2866, "SIGTERM"]]);
  });

  it("组信号被拒 → 落单杀；force 换成 SIGKILL", () => {
    installSyncPs({ "2866": 2838, [OWN]: 9999 });
    installKillSpy({ "-2838": new Error("EPERM") });
    const r = withLinux(() => killProcessTreeSync({ pid: 2866, force: true }));
    expect(r.via).toBe("kill -SIGKILL 2866（单进程兜底）");
  });

  it("ps 完全不可用 + detached → 进程组·未探测；都不行 → ok=false", () => {
    installSyncPs({ [OWN]: 9999 });
    const tried = withLinux(() =>
      killProcessTreeSync({ pid: 2866, detached: true }),
    );
    expect(tried.via).toContain("进程组·未探测");

    installKillSpy({ "-2866": new Error("ESRCH"), "2866": new Error("ESRCH") });
    const failed = withLinux(() => killProcessTreeSync({ pid: 2866 }));
    expect(failed.ok).toBe(false);
  });

  it("非法 PID 直接跳过，不发任何信号", () => {
    expect(killProcessTreeSync({ pid: 0 }).ok).toBe(false);
    expect(killProcessTreeSync({ pid: -3 }).ok).toBe(false);
    expect(killCalls).toEqual([]);
  });

  it("ps 报 0 时不把 0 当组号（`kill(-0)` 打的正是调用者自己的整组）", () => {
    installSyncPs({ "2866": 0, [OWN]: 9999 });
    const r = withLinux(() => killProcessTreeSync({ pid: 2866 }));
    expect(r.via).toContain("单进程兜底");
    expect(killCalls).toEqual([[2866, "SIGTERM"]]);
    /* 单独钉这一格：0 一旦被当成组号，信号就打回发信号的那个进程组自己。 */
    expect(killCalls.map(([target]) => target)).not.toContain(0);
  });

  it("mode:image 在同步入口上**拒绝而不是凑一条命令**（这张签名里没有映像名）", () => {
    /* 照字面走下去会得到 `/IM 4321 /T /F` —— 去杀一个名字恰好叫「4321」的映像；
     * POSIX 侧则静默退化成单杀。两边都不是调用方要的那件事，所以宁可回一句话。 */
    installSyncPs({ "4321": 2838, [OWN]: 9999 });
    const r = withLinux(() =>
      killProcessTreeSync({ pid: 4321, mode: "image" }),
    );
    expect(r.ok).toBe(false);
    expect(r.via).toContain("killProcessTreeByImage");
    expect(killCalls).toEqual([]);

    const onWindows = killProcessTreeSync({ pid: 4321, mode: "image" });
    expect(onWindows.ok).toBe(false);
    expect(spawnMock).not.toHaveBeenCalled();
  });
});

describe("killProcessTreeByImage 的 POSIX 侧（pkill -x，按名字回收）", () => {
  /** 拿到 spawn 交回来的假句柄，让用例自己决定它怎么结束。 */
  function pkillChild(): EventEmitter & { pid: number } {
    const child = Object.assign(new EventEmitter(), { pid: 777 });
    spawnMock.mockReturnValue(child);
    return child;
  }

  it("exit=0 → ok；exit=1（没有匹配的进程）同样算 ok", async () => {
    const child = pkillChild();
    const pending = withLinux(() => killProcessTreeByImage("ollama"));
    expect(spawnMock.mock.calls[0]?.slice(0, 2)).toEqual([
      "pkill",
      ["-x", "ollama"],
    ]);
    child.emit("close", 1);
    expect((await pending).ok).toBe(true);

    const zero = pkillChild();
    const pending0 = withLinux(() => killProcessTreeByImage("ollama"));
    zero.emit("close", 0);
    expect((await pending0).ok).toBe(true);
  });

  it("其它退出码（权限 / pkill 缺失）→ ok=false，via 里带上退出码", async () => {
    const child = pkillChild();
    const pending = withLinux(() => killProcessTreeByImage("ollama"));
    child.emit("close", 2);
    const r = await pending;
    expect(r.ok).toBe(false);
    expect(r.via).toContain("exit=2");
  });

  it("pkill 起不来 → ok=false 并把原因写进 via（不抛给调用方）", async () => {
    const child = pkillChild();
    const pending = withLinux(() => killProcessTreeByImage("ollama"));
    child.emit("error", new Error("spawn pkill ENOENT"));
    const r = await pending;
    expect(r.ok).toBe(false);
    expect(r.via).toContain("spawn pkill ENOENT");
  });

  it("空映像名 → 直接跳过，不派发命令（给了空名字还照发就是全机器匹配）", async () => {
    const r = await killProcessTreeByImage("   ");
    expect(r.ok).toBe(false);
    expect(spawnMock).not.toHaveBeenCalled();
  });
});
