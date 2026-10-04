// 子进程「绑定 / 保活」拉起抽象的回归用例。
//
// 分成两组，各自判的是不同的东西：
//
//  1. **纯函数组**（`escapePwshSingle` / `buildStartProcessArgumentList` /
//     `decodePowerShellOutput`）—— 直接给输入输出，不需要任何假进程。
//  2. **判决面组**（`spawnManaged` / `waitForDetachMediator`）—— 判的是
//     「按 mode 与平台该发哪条命令、参数该怎么排、fd 该怎么关、失败该不该说话」。
//     这一组**不真起进程**而是把 `child_process.spawn` 收成一张调用登记表：
//     真起进程测不到「参数顺序」「`-ArgumentList` 必须是一个数组字面量」
//     「fd 用完即关」这类判据（真跑只会告诉你「起来了或没起来」），
//     而恰恰是这些细节决定了 Windows 上到底能不能保住活。
//     POSIX 那半边在本机（Windows）走不到，用 `Object.defineProperty` 把
//     `process.platform` 换成 `linux` 再判 —— 换的是**判据的输入**，
//     不是把真信号发给真进程。
//
// 台账 E7 记着这个文件曾经只有 17.9% 行被跑到：执行宿主那批代码进来时
// 只配了纯函数的用例。
import { EventEmitter } from "node:events";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { spawnMock, openSyncMock, closeSyncMock, warnMock, spawned } =
  vi.hoisted(() => ({
    spawnMock: vi.fn(),
    openSyncMock: vi.fn<(file: string, flags: string) => number>(() => 42),
    closeSyncMock: vi.fn<(fd: number) => void>(),
    warnMock: vi.fn<(message: string) => void>(),
    /** 每次 `spawn` 产出的假句柄，按调用顺序记录（用例从尾部拿）。 */
    spawned: [] as Array<EmitterChild>,
  }));

type EmitterChild = EventEmitter & {
  pid: number;
  unref: () => void;
  stdout: EventEmitter | null;
  stderr: EventEmitter | null;
};

vi.mock("child_process", () => ({ spawn: spawnMock }));
vi.mock("fs", () => ({ openSync: openSyncMock, closeSync: closeSyncMock }));
vi.mock("~/lib/core/logger", () => ({
  logger: { warn: warnMock, info: () => undefined },
}));

import {
  buildStartProcessArgumentList,
  decodePowerShellOutput,
  escapePwshSingle,
  spawnManaged,
  waitForDetachMediator,
  type ManagedSpawnOptions,
} from "./process-launch";

/**
 * 造一次「抛的不是 Error」的失败。
 *
 * 中间层（npm 的 wrapper、壳的 CLI）真的抛过纯字符串，而本模块的四条 catch 都写了
 * `e instanceof Error ? e.message : String(e)` —— 那一侧不判就等于没判。
 * 直接 `throw "字符串"` 会被 `only-throw-error` 拦下（它管的是写法），
 * 所以绕一个 `unknown`：lint 的约束照守，被测的形状照测。
 */
function hostileThrow(value: string): never {
  const notAnError: unknown = value;
  throw notAnError;
}

/** 一台假的子进程：能收事件、能被 `unref`，句柄一律由 `spawnMock` 发号。 */
function fakeChild(): EmitterChild {
  const child = Object.assign(new EventEmitter(), {
    pid: 4321,
    unref: vi.fn<() => void>(),
    stdout: new EventEmitter(),
    stderr: new EventEmitter(),
  });
  return child;
}

/** 最近一次 `spawn` 的三元参数（命令 / 参数 / 选项）。 */
function lastSpawn(): [string, string[], Record<string, unknown>] {
  const call = spawnMock.mock.calls.at(-1) as
    [string, string[], Record<string, unknown>] | undefined;
  if (!call) throw new Error("这一条用例没有调到 spawn —— 判据落空，先查分支");
  return call;
}

/** 调用方传进来的 env（用真的 `process.env` 之外的一个派生对象，判「原样透传」）。 */
const callerEnv: NodeJS.ProcessEnv = {
  ...process.env,
  COMFYAPP_TEST_PORT: "8188",
};

/** 两条 keepAlive 平台分支的**唯一判据**：注入给 `spawnManaged` 的 platform。
 *
 * 这里刻意不再用 `Object.defineProperty(process, "platform")` 改宿主平台：
 * 那个属性在 POSIX 上是 `writable:false` 的自有属性（实测 descriptor
 * `{writable:false, configurable:true}`），写进去之后**Windows 那组用例在
 * Linux/CI 上也只会走 POSIX 分支** —— 断言写 `powershell.exe`，实收
 * `{detached:true, stdio:全 ignore}`，五条恒红且看着像「代码坏了」。
 * 现在两端机器判同一份输入，两个分支在任何宿主上都有执行者。 */
const POSIX = "linux" as const;
const WINDOWS = "win32" as const;

beforeEach(() => {
  /* 登记表按用例清：`spawn` / `openSync` 的调用次数本身就是判据
   * （「一个都不开」「恰好一次警告」），留下上一轮的计数就等于让上一条用例
   * 替这一条作证。 */
  vi.clearAllMocks();
  spawned.length = 0;
  openSyncMock.mockImplementation(() => 42);
  spawnMock.mockImplementation(() => {
    const child = fakeChild();
    spawned.push(child);
    return child;
  });
});

afterEach(() => {
  delete process.env.COMFYAPP_SHELL_EXE;
  delete process.env.COMFYAPP_TASKKILL;
});

describe("escapePwshSingle", () => {
  it("普通路径原样包进单引号", () => {
    expect(escapePwshSingle("D:\\ComfyUI\\python.exe")).toBe(
      "'D:\\ComfyUI\\python.exe'",
    );
  });

  it("含单引号转义为双单引号（防注入）", () => {
    expect(escapePwshSingle("it's")).toBe("'it''s'");
  });

  it("含空格的路径不拆分（整体仍在一个单引号字符串内）", () => {
    const out = escapePwshSingle("C:/Program Files/Ollama/ollama.exe");
    expect(out).toContain(" ");
    expect(out.startsWith("'")).toBe(true);
    expect(out.endsWith("'")).toBe(true);
  });
});

describe("buildStartProcessArgumentList", () => {
  it("多参数整体写成一个 @() 数组字面量（裸排会被 PS5.1 当位置参数拒绝）", () => {
    expect(buildStartProcessArgumentList(["-s", "D:\\x\\main.py"])).toBe(
      `@('"-s"','"D:\\x\\main.py"')`,
    );
  });

  it("含空格的参数由元素自带双引号，拼接后不会被拆分", () => {
    const out = buildStartProcessArgumentList([
      "--input-directory",
      "D:/a b/input",
    ]);
    expect(out).toBe(`@('"--input-directory"','"D:/a b/input"')`);
    expect(out).toContain('"D:/a b/input"');
  });

  it("参数值里的双引号按 Windows 命令行约定转义", () => {
    expect(buildStartProcessArgumentList(['a"; rm -rf /'])).toBe(
      `@('"a\\"; rm -rf /"')`,
    );
  });

  it("空数组返回空数组字面量", () => {
    expect(buildStartProcessArgumentList([])).toBe("@()");
  });
});

describe("decodePowerShellOutput", () => {
  it("UTF-16LE 带 BOM 的输出解码为可读文本", () => {
    const utf16 = Buffer.concat([
      Buffer.from([0xff, 0xfe]),
      Buffer.from("hello 中文", "utf16le"),
    ]);
    expect(decodePowerShellOutput(utf16)).toBe("hello 中文");
  });

  it("普通 UTF-8 输出原样解码（不带 BOM、非宽字符）", () => {
    expect(decodePowerShellOutput(Buffer.from("hello utf8", "utf8"))).toBe(
      "hello utf8",
    );
  });

  it("无 BOM 但按字节交错为零的宽字符串也按 UTF-16LE 解（PowerShell 偶尔不写 BOM）", () => {
    /* "hi" 的 UTF-16LE 是 68 00 69 00 —— 偶数长度且奇数位多为零，
     * 按 utf8 读会得到夹 \x00 的乱码，这条判据把「交错」形状认出来。 */
    expect(decodePowerShellOutput(Buffer.from([0x68, 0x00, 0x69, 0x00]))).toBe(
      "hi",
    );
  });

  it("奇数长度的缓冲不走宽字符判定（宽字符一定成对）", () => {
    expect(decodePowerShellOutput(Buffer.from("abc", "utf8"))).toBe("abc");
  });

  it("空缓冲返回空串", () => {
    expect(decodePowerShellOutput(Buffer.alloc(0))).toBe("");
  });
});

describe("spawnManaged —— bound（挂在应用进程树里）", () => {
  it("bound 是一次普通 spawn：stdio 留管道、退出时随整树被带走", () => {
    const opts: ManagedSpawnOptions = {
      command: "node",
      args: ["scripts/dev.mjs"],
      mode: "bound",
    };
    const res = spawnManaged(opts);
    expect(res.error).toBeUndefined();
    expect(res.child).toBeDefined();

    const [command, args, options] = lastSpawn();
    expect(command).toBe("node");
    expect(args).toEqual(["scripts/dev.mjs"]);
    /* 管道是 bound 的语义本体：调用方要读 stdout/stderr、要听 exit 事件。 */
    expect(options.stdio).toEqual(["ignore", "pipe", "pipe"]);
    expect(options.detached).toBeUndefined();
    expect(options.cwd).toBeUndefined();
    expect(options.env).toBeUndefined();
  });

  it("windowsHide 只在 bound 透传，缺省是 false", () => {
    spawnManaged({
      command: "node",
      args: [],
      mode: "bound",
      cwd: "C:/work",
      env: callerEnv,
    });
    const [, , first] = lastSpawn();
    expect(first.windowsHide).toBe(false);
    expect(first.cwd).toBe("C:/work");
    /* 同一份引用：调用方给什么就 spawn 什么（各服务生命周期都要在它上面叠
     * COMFYUI_* / PATH 一类的变量，这里若做一次复制或筛除就会丢）。 */
    expect(first.env).toBe(callerEnv);

    spawnManaged({
      command: "node",
      args: [],
      mode: "bound",
      windowsHide: true,
    });
    expect(lastSpawn()[2].windowsHide).toBe(true);
  });

  it("bound 下 spawn 同步抛错 → 收成 error 返回，不抛给调用方", () => {
    spawnMock.mockImplementationOnce(() => {
      throw new Error("spawn node ENOENT");
    });
    const res = spawnManaged({ command: "node", args: [], mode: "bound" });
    expect(res.child).toBeUndefined();
    expect(res.error).toBe("spawn node ENOENT");
  });

  it("抛的不是 Error 时也有一句话（不能回 undefined 让调用方无从可说）", () => {
    /* 四条拉起路径各有自己的 catch，而 spawn 的包装层（中介脚本 / 壳 CLI）
     * 抛过纯字符串 —— 每一格都要单独判，否则「这一路的失败有没有话可说」
     * 就只被其中一条测到。 */
    spawnMock.mockImplementationOnce(() => hostileThrow("纯字符串"));
    expect(spawnManaged({ command: "x", args: [], mode: "bound" }).error).toBe(
      "纯字符串",
    );
  });

  it("其余三条拉起路径同样把非 Error 的抛错收成一句话", () => {
    const paths: Array<{
      name: string;
      shellExe?: string;
      platform: NodeJS.Platform;
      run: () => string | undefined;
    }> = [
      {
        name: "POSIX keepAlive",
        platform: POSIX,
        run: () =>
          spawnManaged({
            command: "x",
            args: [],
            mode: "keepAlive",
            platform: POSIX,
          }).error,
      },
      {
        name: "Windows 壳 CLI 中介",
        shellExe: "C:/app/comfyapp.exe",
        platform: WINDOWS,
        run: () =>
          spawnManaged({
            command: "x",
            args: [],
            mode: "keepAlive",
            platform: WINDOWS,
          }).error,
      },
      {
        name: "Windows powershell 中介",
        platform: WINDOWS,
        run: () =>
          spawnManaged({
            command: "x",
            args: [],
            mode: "keepAlive",
            platform: WINDOWS,
          }).error,
      },
    ];
    for (const path of paths) {
      if (path.shellExe) process.env.COMFYAPP_SHELL_EXE = path.shellExe;
      else delete process.env.COMFYAPP_SHELL_EXE;
      spawnMock.mockImplementationOnce(() =>
        hostileThrow(`${path.name} 抛的字符串`),
      );
      expect(path.run(), path.name).toBe(`${path.name} 抛的字符串`);
    }
  });
});

/* 两组平台用例（POSIX / Windows）都由注入的 `platform` 分叉 —— 见文件头
 * `POSIX` / `WINDOWS` 那段的理由：改宿主平台那套写法在 POSIX 上是**无效**的，
 * 会让 Windows 那组在 Linux/CI 上悄悄跑 POSIX 分支。 */
describe("spawnManaged —— keepAlive / POSIX（detached + unref）", () => {
  it("detached:true 后立刻 unref，且默认 stdio 全 ignore（没有可读管道这回事）", () => {
    {
      const res = spawnManaged({
        command: "node",
        args: ["server.js"],
        mode: "keepAlive",
        cwd: "/srv",
        env: callerEnv,
        platform: POSIX,
      });
      expect(res.error).toBeUndefined();
      const [command, args, options] = lastSpawn();
      expect(command).toBe("node");
      expect(args).toEqual(["server.js"]);
      expect(options.detached).toBe(true);
      expect(options.stdio).toEqual(["ignore", "ignore", "ignore"]);
      expect(options.cwd).toBe("/srv");
      expect(options.env).toBe(callerEnv);
      /* unref 与 detached 是一对：只 detached 不 unref，父进程会被它吊住不退。 */
      expect(spawned.at(-1)?.unref).toHaveBeenCalledTimes(1);
    }
  });

  it("给了成对的重定向文件 → fd 交给 stdio，**父侧副本用完即关**（两个都关）", () => {
    {
      spawnManaged({
        command: "node",
        args: [],
        mode: "keepAlive",
        redirectStdoutFile: "/log/out.txt",
        redirectStderrFile: "/log/err.txt",
        platform: POSIX,
      });
      expect(openSyncMock.mock.calls).toEqual([
        ["/log/out.txt", "w"],
        ["/log/err.txt", "w"],
      ]);
      const [, , options] = lastSpawn();
      expect(options.stdio).toEqual(["ignore", 42, 42]);
      /* 泄漏的 fd 在 Windows 上等于把日志文件锁住（轮转删不掉），
       * 在两端都是白占一个描述符 —— 子进程已经拿到它了，父侧没有理由留。 */
      expect(closeSyncMock.mock.calls.map((call) => call[0])).toEqual([42, 42]);
    }
  });

  it("只给一个文件时**一个都不开**：半套重定向会把 undefined 塞进 stdio", () => {
    spawnManaged({
      command: "node",
      args: [],
      mode: "keepAlive",
      redirectStdoutFile: "/log/out.txt",
      platform: POSIX,
    });
    expect(openSyncMock).not.toHaveBeenCalled();
    expect(lastSpawn()[2].stdio).toEqual(["ignore", "ignore", "ignore"]);
  });

  it("第二个文件开失败时，已经开出来的第一个 fd 也要关掉（不留半个句柄）", () => {
    openSyncMock.mockImplementationOnce(() => 7);
    openSyncMock.mockImplementationOnce(() => {
      throw new Error("EACCES /log/err.txt");
    });
    {
      const res = spawnManaged({
        command: "node",
        args: [],
        mode: "keepAlive",
        redirectStdoutFile: "/log/out.txt",
        redirectStderrFile: "/log/err.txt",
        platform: POSIX,
      });
      expect(res.error).toContain("EACCES");
      expect(spawnMock).not.toHaveBeenCalled();
      expect(closeSyncMock.mock.calls.map((call) => call[0])).toEqual([7]);
    }
  });

  it("POSIX 下 spawn 抛错 → error，且不开任何 fd", () => {
    spawnMock.mockImplementationOnce(() => {
      throw new Error("fork failed");
    });
    {
      const res = spawnManaged({
        command: "x",
        args: [],
        mode: "keepAlive",
        platform: POSIX,
      });
      expect(res.error).toBe("fork failed");
      expect(openSyncMock).not.toHaveBeenCalled();
    }
  });

  it("两个文件都开成了、spawn 却抛错 → 两个 fd 都要关（失败路径同样不许留句柄）", () => {
    spawnMock.mockImplementationOnce(() => {
      throw new Error("fork failed");
    });
    {
      const res = spawnManaged({
        command: "x",
        args: [],
        mode: "keepAlive",
        redirectStdoutFile: "/log/out.txt",
        redirectStderrFile: "/log/err.txt",
        platform: POSIX,
      });
      expect(res.error).toBe("fork failed");
      expect(closeSyncMock.mock.calls.map((call) => call[0])).toEqual([42, 42]);
    }
  });
});

describe("spawnManaged —— keepAlive / Windows（两条中介形态）", () => {
  /** Windows 分支的入口判据是这两个环境变量，用例逐个给出。 */
  function windowsOptions(
    overrides: Partial<ManagedSpawnOptions> = {},
  ): ManagedSpawnOptions {
    return {
      command: "C:/ComfyUI/python.exe",
      args: ["main.py", "--port 8188"],
      mode: "keepAlive",
      platform: WINDOWS,
      ...overrides,
    };
  }

  it("拿到 COMFYAPP_SHELL_EXE → 走壳的 CLI 形态，参数逐段拼对（唯一能逃 Job 的通道）", () => {
    process.env.COMFYAPP_SHELL_EXE = "C:/app/comfyapp.exe";
    const res = spawnManaged(
      windowsOptions({
        cwd: "C:/work dir",
        redirectStdoutFile: "C:/log/o.txt",
        redirectStderrFile: "C:/log/e.txt",
      }),
    );
    expect(res.error).toBeUndefined();
    const [exe, cliArgs, options] = lastSpawn();
    expect(exe).toBe("C:/app/comfyapp.exe");
    expect(cliArgs).toEqual([
      "--spawn-detached",
      "--cmd",
      "C:/ComfyUI/python.exe",
      "--arg",
      "main.py",
      "--arg",
      "--port 8188",
      "--cwd",
      "C:/work dir",
      "--out",
      "C:/log/o.txt",
      "--err",
      "C:/log/e.txt",
    ]);
    /* 中介自己不是目标，父侧不持有它的 stdio：unref 是「立即退出也不拖住我们」，
     * pipe 是「被拒时 stderr 里那句原因要能读回来」（见 waitForDetachMediator）。 */
    expect(options.stdio).toEqual(["ignore", "ignore", "pipe"]);
    expect(options.windowsHide).toBe(true);
    expect(spawned.at(-1)?.unref).toHaveBeenCalledTimes(1);
    /* 重定向由壳负责开，父进程**不许**自己 openSync —— 那会让日志文件被两端同时持有。 */
    expect(openSyncMock).not.toHaveBeenCalled();
  });

  it("没给 cwd / 没给重定向文件时，对应的段**整段不出现**（空 --cwd 会让壳拒收）", () => {
    process.env.COMFYAPP_SHELL_EXE = "C:/app/comfyapp.exe";
    spawnManaged(windowsOptions());
    const [, cliArgs] = lastSpawn();
    expect(cliArgs).not.toContain("--cwd");
    expect(cliArgs).not.toContain("--out");
    expect(cliArgs).not.toContain("--err");
  });

  it("COMFYAPP_SHELL_EXE 是空白串 = 没给（spawn 空命令名的错与「命令不存在」完全不同）", () => {
    process.env.COMFYAPP_SHELL_EXE = "   ";
    spawnManaged(windowsOptions());
    expect(lastSpawn()[0]).toBe("powershell.exe");
  });

  it("拿不到壳路径 → 退回 powershell 中介，且**必须留下一条警告**（保活不保证跨退出）", () => {
    const res = spawnManaged(windowsOptions());
    expect(res.error).toBeUndefined();
    expect(warnMock).toHaveBeenCalledTimes(1);
    expect(warnMock.mock.calls[0]?.[0]).toContain("COMFYAPP_SHELL_EXE");

    const [exe, args, options] = lastSpawn();
    expect(exe).toBe("powershell.exe");
    expect(options.stdio).toEqual(["ignore", "ignore", "pipe"]);
    expect(options.windowsHide).toBe(true);
    expect(spawned.at(-1)?.unref).toHaveBeenCalledTimes(1);
    /* 整段脚本走 `-Command` 的**一个** argv：拆成多个 argv 时 PowerShell 会把
     * 后面的当成额外位置参数，实测表现是 Start-Process 完全不执行。 */
    expect(args).toHaveLength(4);
    expect(args.slice(0, 3)).toEqual([
      "-NoProfile",
      "-NonInteractive",
      "-Command",
    ]);
  });

  it("中介脚本的整串形状（FilePath / ArgumentList 数组 / Hidden / Redirect / WorkingDirectory / exit）", () => {
    spawnManaged(
      windowsOptions({
        cwd: "C:/work dir",
        redirectStdoutFile: "C:/log/o.txt",
        redirectStderrFile: "C:/log/e.txt",
      }),
    );
    expect(lastSpawn()[1][3]).toBe(
      "Start-Process -FilePath 'C:/ComfyUI/python.exe'" +
        " -ArgumentList @('\"main.py\"','\"--port 8188\"')" +
        " -WindowStyle Hidden" +
        " -RedirectStandardOutput 'C:/log/o.txt'" +
        " -RedirectStandardError 'C:/log/e.txt'" +
        " -WorkingDirectory 'C:/work dir'; exit",
    );
  });

  it("命令名里的单引号被转义成两个单引号（不让它提前闭合字符串逃出引号保护）", () => {
    spawnManaged(windowsOptions({ command: "C:/it's/python.exe" }));
    const script = String(lastSpawn()[1][3]);
    expect(script).toContain("-FilePath 'C:/it''s/python.exe'");
    /* 收尾的 `; exit` 也必须在 —— 中介靠「立即退出」把目标变成孤儿。 */
    expect(script.endsWith("; exit")).toBe(true);
  });

  it("中介 spawn 抛错 → error（调用方随后要给用户可见出口，不是静默）", () => {
    spawnMock.mockImplementationOnce(() => {
      throw new Error("spawn powershell.exe ENOENT");
    });
    expect(spawnManaged(windowsOptions()).error).toBe(
      "spawn powershell.exe ENOENT",
    );
  });

  it("壳 CLI 形态 spawn 抛错时同样收成 error，且不带出 child", () => {
    process.env.COMFYAPP_SHELL_EXE = "C:/app/comfyapp.exe";
    spawnMock.mockImplementationOnce(() => {
      throw new Error("EACCES comfyapp.exe");
    });
    const res = spawnManaged(windowsOptions());
    expect(res.child).toBeUndefined();
    expect(res.error).toBe("EACCES comfyapp.exe");
  });
});

describe("waitForDetachMediator —— 中介的退出码与 stderr", () => {
  it("中介退出：带出退出码，并把收到的 stderr 按 PowerShell 的编码解成人话", async () => {
    const child = fakeChild();
    const p = waitForDetachMediator(child, 1000);
    /* Windows PowerShell 5.1 的 `-RedirectStandardError` 写出的是 UTF-16LE **带 BOM**，
     * 按 utf8 直读会得到每个字符夹 \x00 的乱码 —— 这句话是「为什么要专门给一个解码出口」
     * 的全部理由，所以这里用真实形状而不是 ASCII。 */
    child.stderr?.emit(
      "data",
      Buffer.concat([
        Buffer.from([0xff, 0xfe]),
        Buffer.from("拉起被拒", "utf16le"),
      ]),
    );
    child.emit("exit", 1);
    await expect(p).resolves.toEqual({
      code: 1,
      stderr: "拉起被拒",
    });
  });

  it("分多段到达的 stderr 会被拼起来（一次 emit 一段是常态）", async () => {
    const child = fakeChild();
    const p = waitForDetachMediator(child, 1000);
    child.stderr?.emit("data", Buffer.from("A", "utf8"));
    child.stderr?.emit("data", Buffer.from("B", "utf8"));
    child.emit("exit", 0);
    expect((await p).stderr).toBe("AB");
  });

  it("被信号终止（code=null）时记 -1，不是 null —— 调用方按「中介失败了」处理", async () => {
    const child = fakeChild();
    const p = waitForDetachMediator(child, 1000);
    child.emit("exit", null);
    expect((await p).code).toBe(-1);
  });

  it("超时不是失败而是「未知」：回哨兵 code=null，且已经收到的 stderr 不丢", async () => {
    const child = fakeChild();
    const p = waitForDetachMediator(child, 20);
    child.stderr?.emit("data", Buffer.from("还在等", "utf8"));
    /* 不 emit exit：让超时赢这一轮赛跑。 */
    const outcome = await p;
    expect(outcome.code).toBeNull();
    expect(outcome.stderr).toBe("还在等");
  });

  it("没有 stderr 管道（stdio 全 ignore）时不崩，照样回退出码", async () => {
    const bare = Object.assign(new EventEmitter(), {
      pid: 1,
      unref: vi.fn<() => void>(),
      stdout: null,
      stderr: null,
    });
    const p = waitForDetachMediator(bare, 1000);
    bare.emit("exit", 3);
    await expect(p).resolves.toEqual({ code: 3, stderr: "" });
  });
});
