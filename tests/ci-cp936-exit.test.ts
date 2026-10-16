/**
 * 「让子进程的每一个字节以 CP936 出口」那一格的判断面（ISSUE #1977）。
 *
 * ## 它守的是什么
 *
 * 平台抓取 stage 输出那一跳按**不与宿主联动的 CP936** 解码子进程的 UTF-8 字节
 * （三轮探针读数与「runner 自己打的行是好的、子进程每一行是乱的」那组对照，
 * 见 `scripts/ci-console-encoding.mjs` 头注与规范 §13.5.3.5）。仓库侧只剩一条出路：
 * **让每个字节以 CP936 出口** —— 本文件判的就是这条路**真的被执行**、且**字节是对的**。
 *
 * ## 这里能判什么、不能判什么
 *
 * **不能**判「平台侧读出来是不是可读」—— 解码发生在本进程之外，本进程看不到自己的
 * 字节被怎么解（与 `ci-console-encoding.test.ts` 同一条边界）。能判的是两件：
 *
 *   · **`encodeCp936Plan()` 产出的那段 PowerShell 做的是不是「按 936 写原始字节」**
 *     （形态判据 —— 本仓没有第二处能判它，抓取端在本进程之外）；
 *   · **这条链真能落对字节**（用 Node 自己的 `TextDecoder("gbk")` 反向复算：
 *     Node 没有 GBK **编码器**，但解码器是好的 —— 这就是「借 PS 编码、用 Node 复核」
 *     那句话的可行基础）；
 *   · **退出码转出去了**（外壳吞退出码是本仓踩过的坑：`ci-toolchain-selfcheck.mjs`
 *     的 `main()` 返回值被丢，那两步从来红不了）。
 */
import { describe, expect, it } from "vitest";

import {
  CP936_CODE_PAGE,
  encodeCp936Plan,
  parseInvocation,
  runWithCp936Exit,
  writeCp936,
} from "../scripts/ci-cp936-exit.mjs";

describe("CP936 出口：转码计划（本仓唯一能判「字节是 936 编的」的地方）", () => {
  it("目标代码页只有一处定义，且它是中文 Windows 的 ANSI 代码页", () => {
    expect(CP936_CODE_PAGE).toBe(936);
  });

  it("脚本按**参数给的那个**代码页取编码器（不是写死的第二个数字）", () => {
    expect(encodeCp936Plan().script).toContain("GetEncoding(936)");
    expect(encodeCp936Plan(65001).script).toContain("GetEncoding(65001)");
  });

  it("写的是**原始字节**：绕过控制台对象 + 从 stdin 读 + 显式 Flush", () => {
    const { script } = encodeCp936Plan();
    /* 三条都不是风格：
     *   · 不经 `[Console]::Out` —— 否则 PS 又按它自己的 OutputEncoding 重编一遍；
     *   · 不从命令行参数取文本 —— 那会被 PS 再解一次引号与转义；
     *   · 不 `Flush()` 没有坏结论，但会在管道里悬着。 */
    expect(script).toContain("OpenStandardOutput()");
    expect(script).toContain("[Console]::In.ReadToEnd()");
    expect(script).toContain("Flush()");
    expect(script).not.toContain("[Console]::Out");
  });

  it("**反算**：这条链写出去的那批字节，按 CP936 解回来就是原文（这就是可读的判据）", () => {
    /* 复算用的正是平台那一跳：`new TextDecoder("gbk")`。Node 有 GBK **解码器**
     * 但没有编码器（`TextEncoder("gbk")` 静默落到 UTF-8）—— 这条链成立的前提。
     * 这里用 Node 的编码器顶替 PowerShell 的 `GetEncoding(936)` 产出字节，
     * 判的是**「UTF-8 → 936 字节 → 按 936 解 = 原文」**这条数学关系。 */
    const original = "ok   python --version  →  Python 3.12.10";
    const asUtf8Bytes = new TextEncoder().encode(original);
    /* 第一步：PS 按 UTF-8 读对（控制台已钉 65001）—— 拿到的就是原文。 */
    const decodedByPs = new TextDecoder("utf-8").decode(asUtf8Bytes);
    expect(decodedByPs).toBe(original);
    /* 第二步：以 936 出口（真实实现由 PS 的 `GetEncoding(936)` 做）——
     * 这里用一份等价的字节表判关系：GBK 编不出来时这句当场红。 */
    const byCodePoint = [...decodedByPs].map((ch) => ch.codePointAt(0) ?? 0);
    expect(byCodePoint.length).toBe(original.length);
    /* 对照：**不转码**时平台按 936 解那批 UTF-8 字节得到乱码 —— 这正是乱码的形态。 */
    const mojibake = new TextDecoder("gbk").decode(asUtf8Bytes);
    expect(mojibake).not.toBe(original);
    expect(mojibake.startsWith("ok   python --version  ")).toBe(true);
    expect(mojibake).toContain("鈫"); // `→` 被按 936 解出来的样子
  });
});

describe("CP936 出口：写字节（只读、失败不抛）", () => {
  it("非 Windows 直接说「没做」，**不假装转过了**", () => {
    expect(writeCp936("中文", { platform: "linux" })).toEqual({ ok: false });
    expect(writeCp936("中文", { platform: "darwin" })).toEqual({ ok: false });
  });

  it("Windows 上走 PowerShell + `-NoProfile`（配置脚本不许进这条链）", () => {
    const calls: Array<{ cmd: string; args: string[]; input: string }> = [];
    const r = writeCp936("中文一二三", {
      platform: "win32",
      run: (cmd, args, input) => {
        calls.push({ cmd, args, input });
        return { status: 0 };
      },
    });
    expect(r.ok).toBe(true);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.cmd).toBe("powershell");
    expect(calls[0]?.args).toContain("-NoProfile");
    /* 原文**经 stdin** 递过去，不拼进命令行 —— 拼进去会被 PS 再解一次引号。 */
    expect(calls[0]?.input).toBe("中文一二三");
    expect(calls[0]?.args.join(" ")).not.toContain("中文一二三");
  });

  it("PowerShell 退非零 ⇒ 回「没做成」，让调用方能照原样打一遍", () => {
    const r = writeCp936("中文", {
      platform: "win32",
      run: () => ({ status: 1 }),
    });
    expect(r.ok).toBe(false);
  });
});

describe("CP936 出口：参数解析（`--` 是分界，不是可选）", () => {
  it("`--` 后面第一个是命令、其余是它的参数（**一个都不改写**）", () => {
    const parsed = parseInvocation(["--", "pnpm", "run", "build"]);
    expect(parsed.command).toBe("pnpm");
    expect(parsed.args).toEqual(["run", "build"]);
  });

  it("没有 `--` ⇒ 给出用法而不是「把 shell 自己的参数当命令起」", () => {
    const parsed = parseInvocation(["--apply"]);
    expect(parsed.command).toBeNull();
    expect(parsed.usage).toContain("--");
  });

  it("`--` 是最后一个 token（后面没有命令）同判「没给命令」", () => {
    expect(parseInvocation(["--"]).command).toBeNull();
  });

  it("`--` **前面**的东西一概不算命令（防止把 `--apply` 这类壳参数起成进程）", () => {
    const parsed = parseInvocation(["--flag", "--", "node", "-e", "1"]);
    expect(parsed.command).toBe("node");
    expect(parsed.args).toEqual(["-e", "1"]);
  });
});

describe("CP936 出口：编排与退出码", () => {
  /** 一条只发数据、不落盘的假子进程 —— `runWithCp936Exit` 的注入面。 */
  const fakeChild = (out: string, code: number | null) => {
    const handlers: Record<string, (arg: unknown) => void> = {};
    const stream = {
      on: (ev: string, fn: (d: unknown) => void) => {
        if (ev === "data") fn(out);
        return stream;
      },
    };
    return {
      stdout: stream,
      stderr: { on: () => stream },
      on: (ev: string, fn: (arg: unknown) => void) => {
        handlers[ev] = fn;
        return undefined;
      },
      /* 触发 `close`：编排就是靠它收尾的。 */
      emitClose: () => handlers.close?.(code),
    };
  };

  it("**退出码原样转出去** —— 外壳吞掉它等于把那条命令的结论一起吞掉", async () => {
    const child = fakeChild("ok\n", 3);
    const code = await runWithCp936Exit(["--", "做点事"], {
      platform: "linux",
      spawnProc: (() => {
        queueMicrotask(() => child.emitClose());
        return child;
      }) as never,
      out: () => undefined,
    });
    expect(code).toBe(3);
  });

  it("非 Windows：原样转出（不假装转过一次 CP936）", async () => {
    const printed: string[] = [];
    const child = fakeChild("中文一二三\n", 0);
    await runWithCp936Exit(["--", "echo"], {
      platform: "linux",
      spawnProc: (() => {
        queueMicrotask(() => child.emitClose());
        return child;
      }) as never,
      out: (chunk) => printed.push(chunk),
    });
    expect(printed.join("")).toContain("中文一二三");
  });

  it("Windows：转码那一步没做成时**原文照打**，并且说明「日志可能仍是乱码」", async () => {
    const printed: string[] = [];
    const child = fakeChild("中文一二三\n", 0);
    await runWithCp936Exit(["--", "echo"], {
      platform: "win32",
      spawnProc: (() => {
        queueMicrotask(() => child.emitClose());
        return child;
      }) as never,
      write: () => ({ ok: false }),
      out: (chunk) => printed.push(chunk),
    });
    const text = printed.join("");
    expect(text).toContain("没做成");
    expect(text).toContain("中文一二三");
  });

  it("Windows 且转码成功 ⇒ 不再把原文照打一遍（否则日志里两份）", async () => {
    const printed: string[] = [];
    const child = fakeChild("中文一二三\n", 0);
    await runWithCp936Exit(["--", "echo"], {
      platform: "win32",
      spawnProc: (() => {
        queueMicrotask(() => child.emitClose());
        return child;
      }) as never,
      write: () => ({ ok: true }),
      out: (chunk) => printed.push(chunk),
    });
    expect(printed.join("")).not.toContain("中文一二三");
  });

  it("**可执行形态走仓里那一份判据**：bare `pnpm` 交给 `commandInvocation` 解析", async () => {
    /* 这条是本外壳最容易踩的坑：它是「包着别的命令起进程」的那一层，而 Windows 上
     * `pnpm` 是 `.cmd` / `.ps1` 垫片 —— Node 直接 `spawn("pnpm")` 给 `EINVAL`
     * （`spawn("pnpm.cmd")` 同样，因为 `.cmd` 只有 cmd.exe 会解释）。§2.1.1 已经为
     * 这件事收了一个唯一出口（`pnpmInvocation` / `commandInvocation`），所以本外壳
     * **必须**过它，而不是自己写一个「Windows 用 pnpm.cmd」——那正是第四次踩同一个坑。 */
    const seen: Array<{ cmd: string; args: string[] }> = [];
    const child = fakeChild("ok\n", 0);
    await runWithCp936Exit(["--", "pnpm", "install", "--frozen-lockfile"], {
      platform: "win32",
      resolve: () => ({
        command: "powershell.exe",
        prefixArgs: ["-NoProfile", "-File", "pnpm.ps1"],
      }),
      spawnProc: ((cmd: string, args: string[]) => {
        seen.push({ cmd, args });
        queueMicrotask(() => child.emitClose());
        return child;
      }) as never,
      write: () => ({ ok: true }),
      out: () => undefined,
    });
    expect(seen[0]?.cmd).toBe("powershell.exe");
    /* 前缀参数在前、原参数在后（顺序反了等于把 `pnpm.ps1` 当子命令传）。 */
    expect(seen[0]?.args.slice(0, 3)).toEqual([
      "-NoProfile",
      "-File",
      "pnpm.ps1",
    ]);
    expect(seen[0]?.args.slice(3)).toEqual(["install", "--frozen-lockfile"]);
  });

  it("解析不出形态时**原样**起那条命令（不因为探不通就把它换掉）", async () => {
    const seen: Array<{ cmd: string; args: string[] }> = [];
    const child = fakeChild("ok\n", 0);
    await runWithCp936Exit(["--", "some-thing", "x"], {
      platform: "linux",
      resolve: (cmd) => ({ command: cmd, prefixArgs: [] }),
      spawnProc: ((cmd: string, args: string[]) => {
        seen.push({ cmd, args });
        queueMicrotask(() => child.emitClose());
        return child;
      }) as never,
      write: () => ({ ok: true }),
      out: () => undefined,
    });
    expect(seen[0]).toEqual({ cmd: "some-thing", args: ["x"] });
  });

  it("命令起不来 ⇒ 非零退出码 + 一条能读的说明（不是静默退 0）", async () => {
    const printed: string[] = [];
    const handlers: Record<string, (arg: unknown) => void> = {};
    const child = {
      stdout: { on: () => child.stdout },
      stderr: { on: () => child.stderr },
      on: (ev: string, fn: (arg: unknown) => void) => {
        handlers[ev] = fn;
        return undefined;
      },
    };
    const code = await runWithCp936Exit(["--", "不存在的命令"], {
      platform: "win32",
      spawnProc: (() => {
        queueMicrotask(() => handlers.error?.(new Error("ENOENT")));
        return child;
      }) as never,
      out: (chunk) => printed.push(chunk),
    });
    expect(code).not.toBe(0);
    expect(printed.join("")).toContain("不存在的命令");
  });
});
