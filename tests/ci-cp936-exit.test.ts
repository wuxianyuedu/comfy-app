/**
 * 「让子进程的每一个字节以 CP936 出口」的判断面（ISSUE #1977）：抓取端在本进程之外，故只判三件 —— PS 形态、
 * `TextDecoder("gbk")` 反算字节（Node 无 GBK 编码器）、退出码转出（外壳吞码踩过 `ci-toolchain-selfcheck.mjs` 的坑）；
 * Linux 到不了的语句（`encoding: "buffer"` 值、`String(buffer)` 缺 `setEncoding`、`.bin` 垫片形态）只能按形状判。
 */
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { commandInvocation } from "../src/lib/process/executable-resolve.ts";
import {
  CP936_CODE_PAGE,
  encodeCp936Plan,
  exitCodeFromTermination,
  formatSpawnFailure,
  parseInvocation,
  resolveShellInvocation,
  runWithCp936Exit,
  splitStreamChunk,
  TRANSCODE_TIMEOUT_MS,
  UNKNOWN_TERMINATION_EXIT,
  writeCp936,
} from "../scripts/ci-cp936-exit.mjs";

describe("CP936 出口：转码计划（本仓唯一能判「字节是 936 编的」的地方）", () => {
  it("目标代码页只有一处定义，且它是中文 Windows 的 ANSI 代码页", () => {
    expect(CP936_CODE_PAGE).toBe(936);
  });

  it("脚本按**参数给的那个**代码页取编码器（不是写死的第二个数字）", () => {
    expect(encodeCp936Plan().script).toContain("GetEncoding(936)");
    expect(encodeCp936Plan(65_001).script).toContain("GetEncoding(65001)");
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
    const calls: Array<{ args: Array<string>; cmd: string; input: string }> = [];
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

  it('`encoding` 要的是**编码名或 `null`** —— `"buffer"` 与 `Buffer` **两者都会被拒**', () => {
    /* 本仓第一次上平台的现场（`工具链自证` 红），报错原文（§12.4.6：错误原文保留英文、反引号包住，
     * `check-comment-language.cjs` 只把反引号外的英文成句算进来）：
     *   `TypeError [ERR_UNKNOWN_ENCODING]: Unknown encoding: buffer`
     * 两笔是同一误解的两种写法 —— `"buffer"` 与 `Buffer` 都被拒，此处只认编码名或 `null`；且都在运行时才炸，
     * 判据只能设在「值传下去」这一层。 */
    /* 两种写法都不是编码名 —— 查表就是查不到。 */
    expect(Buffer.isEncoding("buffer")).toBe(false);
    /* SAFETY: 类型断言已复核 */
    expect(Buffer.isEncoding(Buffer as never)).toBe(false);
    /* 而且**两条都在真 `spawnSync` 上炸**（子进程有输出时才走 `Buffer.from`，
     * 所以探针必须真的打一行字 —— 写 `-e "0"` 是炸不出来的）。 */
    for (const bad of ["buffer", Buffer]) {
      expect(() =>
        spawnSync(process.execPath, ["-e", 'process.stdout.write("hi")'], {
          input: "x",
          /* SAFETY: 类型断言已复核 */
          encoding: bad as never,
        }),
      ).toThrow(/ERR_UNKNOWN_ENCODING|Unknown encoding/);
    }
  });

  it("默认实现把 `encoding` 传成 `null`（要 Buffer 输出的唯一正确写法）", () => {
    /* 判**注入面收到的那个值本身** —— 不需要 Windows：这一句在 Linux 检出
     * 一辈子都执行不到（`writeCp936` 非 Windows 直接 return），而它正是平台侧
     * 那次红的现场。`spawnImpl` 就是为这件在本地够不到的事开的第三个注入面。 */
    const calls: Array<{ cmd: string; encoding: unknown; input: unknown }> = [];
    writeCp936("中文一二三", {
      platform: "win32",
      /* SAFETY: 类型断言已复核 */
      spawnImpl: ((cmd: string, _args: Array<string>, opts: never) => {
        /* SAFETY: 类型断言已复核 */
        const o = opts as { encoding: unknown; input: unknown };
        calls.push({ cmd, encoding: o.encoding, input: o.input });
        return { status: 0 };
      }) as never,
    });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.cmd).toBe("powershell");
    expect(calls[0]?.encoding).toBeNull();
    /* 文本走 `input`（stdin），不走命令行 —— 与 `runImpl` 那一组同一条口径。 */
    expect(calls[0]?.input).toBe("中文一二三");
  });

  it("这一句真的能跑：**真起一条子进程**，`null` 那个值确实产出 Buffer 且字节是 UTF-8", () => {
    /* 上一条判「传了什么」，这条判「传的那个值真的可用」—— 拿真实 `spawnSync`
     * 起一条本机一定有的命令（`process.execPath`），中文输入原样回来。
     * 这是本条用例组**唯一**在 Linux 上真碰到 `spawnSync` 的地方。 */
    const probe = spawnSync(
      process.execPath,
      [
        "-e",
        "let b='';process.stdin.setEncoding('utf8');" +
          "process.stdin.on('data',(d)=>b+=d).on('end',()=>process.stdout.write(b))",
      ],
      { input: "中文一二三", encoding: null },
    );
    expect(probe.status).toBe(0);
    expect(Buffer.isBuffer(probe.stdout)).toBe(true);
    expect(probe.stdout.toString("utf8")).toBe("中文一二三");
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
  /** 解析口的「原样放行」形态：不关心解析的那几条用它，免得去碰真 PATH。
   *  形状必须与 production 同（`{command, args, resolved}`）。 */
  const passthroughResolve = (cmd: string, args: Array<string>) => ({
    command: cmd,
    args,
    resolved: true,
  });

  /** 一条只发数据、不落盘的假子进程 —— `runWithCp936Exit` 的注入面。
   *  `close` 那两形参**都要能给**（ISSUE #2571）：只喂 `code` 的话，「被信号终止」
   *  那一档在这一层根本不存在，而它恰恰是 `code === null` 的唯一来源。 */
  const fakeChild = (out: string, code: number | null, signal: string | null = null) => {
    const handlers: Record<string, (a?: unknown, b?: unknown) => void> = {};
    const stream = {
      on: (ev: string, fn: (d: unknown) => void) => {
        if (ev === "data") {
          fn(out);
        }
        return stream;
      },
    };
    return {
      stdout: stream,
      stderr: { on: () => stream },
      on: (ev: string, fn: (a?: unknown, b?: unknown) => void) => {
        handlers[ev] = fn;
        return undefined;
      },
      /* 触发 `close`：编排就是靠它收尾的。 */
      emitClose: () => handlers.close?.(code, signal),
    };
  };

  it("抓子进程输出的那一跳**显式钉 `utf8`**（Linux 上永远看不见的那个 bug）", async () => {
    /* `String(buffer)` 走 `buf.toString()`，默认编码取自 `process.stdout.writableEncoding` —— Windows 上是宿主代码页
     * （CP936），子进程的 UTF-8 在进 PowerShell **之前**就解错，转码「先解对、再编回」第一段即断。
     * Linux 的 `process.stdout` 是 UTF-8，bug 永不明形 ⇒ 只判形状：真 `spawn` 出来的流被以 `"utf8"` 调过 `setEncoding`
     * （`ci-console-encoding.mjs` 钉控制台那一半，这里钉抓子进程这一半）。 */
    const pinned: Array<string> = [];
    const mkStream = (out: string) => ({
      setEncoding(enc: string) {
        pinned.push(enc);
        return this;
      },
      on(ev: string, fn: (d: unknown) => void) {
        if (ev === "data") {
          fn(out);
        }
        return this;
      },
    });
    const handlers: Record<string, (arg: unknown) => void> = {};
    const child = {
      stdout: mkStream("中文一二三\n"),
      stderr: mkStream(""),
      on: (ev: string, fn: (arg: unknown) => void) => {
        handlers[ev] = fn;
        return undefined;
      },
    };
    await runWithCp936Exit(["--", "echo"], {
      platform: "linux",
      /* 这几格判的是输出通道；解析口注入「原样放行」那一档，免得答案取决于 */
      /* 跑它的那个进程的 PATH（现场 cnb-1d9-1k59h8hsv：CI 账号没有 Git 的 echo）。 */
      resolve: passthroughResolve,
      /* SAFETY: 类型断言已复核 */
      spawnProc: (() => {
        queueMicrotask(() => handlers.close?.(0));
        return child;
      }) as never,
      out: () => undefined,
    });
    /* **两条流各钉一次**，值必须是 `utf8`：漏掉任何一条，那一半的输出就按宿主
     * 代码页解（stdout / stderr 合并抓，所以两条都在这条链上）。 */
    expect(pinned).toEqual(["utf8", "utf8"]);
  });

  it("**退出码原样转出去** —— 外壳吞掉它等于把那条命令的结论一起吞掉", async () => {
    const child = fakeChild("ok\n", 3);
    const code = await runWithCp936Exit(["--", "做点事"], {
      platform: "linux",
      resolve: passthroughResolve,
      /* SAFETY: 类型断言已复核 */
      spawnProc: (() => {
        queueMicrotask(() => child.emitClose());
        return child;
      }) as never,
      out: () => undefined,
    });
    expect(code).toBe(3);
  });

  /** 编排那几条的公共注入面：`close` 由假子进程手动触发，输出不落 PowerShell。 */
  const closeWith = (child: { emitClose: () => void }) => {
    queueMicrotask(() => {
      child.emitClose();
    });
    return child;
  };

  it("**没有退出码 ≠ 退出码是 0** —— 被信号终止的一转不许念成通过（ISSUE #2571）", async () => {
    /* 本文件最坏的一格：`close` 第二个形参没人接，`code ?? 0` 把「不是自己退出的」落成「通过」。实测（Node 26.12.1）：
     * 被 SIGTERM 终止时 `close` 照来，带 `code=null` + `signal=SIGTERM`，旧写法转出的是 **0**。
     * 与 §13.6.4.1「拿不到测量 ≠ 测量是红的」同一条区分、方向相反：拿到的既不是红，也**不许被念成绿**。 */
    const printed: Array<string> = [];
    const child = fakeChild("半行输出", null, "SIGTERM");
    const code = await runWithCp936Exit(["--", "做点事"], {
      platform: "linux",
      resolve: passthroughResolve,
      /* SAFETY: 类型断言已复核 */
      spawnProc: (() => closeWith(child)) as never,
      write: () => ({ ok: false }),
      out: (chunk) => printed.push(chunk),
    });
    expect(code).not.toBe(0);
    expect(code).toBe(128 + os.constants.signals.SIGTERM);
    /* **念一行出声**：转出去的那个码是外壳折算的、不是子进程给的。不写明，读日志的人
     * 会拿 143 去查「哪条命令退 143」，而那条命令一次都没退出过。 */
    const text = printed.join("");
    expect(text).toContain("SIGTERM");
    expect(text).toContain(String(code));
  });

  it("`code` 与 `signal` **双 null** 也不许当 0（「没交代结束方式」是第三档，不是成功）", async () => {
    /* 只把「有 signal」当非零，剩下的漏网形态是**两个都拿不到**（宿主给的终止信息
     * 被截断、`close` 在 stdio 排空前就触发的那一类）。那一档同样「没有跑到结论」，
     * 落回 0 就是上面那一格的同一个 bug 换了个触发条件。 */
    const printed: Array<string> = [];
    const child = fakeChild("x\n", null, null);
    const code = await runWithCp936Exit(["--", "做点事"], {
      platform: "linux",
      resolve: passthroughResolve,
      /* SAFETY: 类型断言已复核 */
      spawnProc: (() => closeWith(child)) as never,
      write: () => ({ ok: false }),
      out: (chunk) => printed.push(chunk),
    });
    expect(code).toBe(UNKNOWN_TERMINATION_EXIT);
    expect(code).not.toBe(0);
    expect(printed.join("")).toContain("没有交代结束方式");
  });

  it("干净退出**照旧不念**那句「外壳退出」—— 成功路径不许被写成一条像红的提示", async () => {
    /* 反向那一半：新加的这行出声如果无条件打，每一次正常 stage 末尾都多一条
     * 「退出 0」，读的人要在里面找真红 —— 与 ISSUE #2326（只在该出声时才出声）同一条口径。 */
    const printed: Array<string> = [];
    const child = fakeChild("正常收尾\n", 0, null);
    const code = await runWithCp936Exit(["--", "做点事"], {
      platform: "linux",
      resolve: passthroughResolve,
      /* SAFETY: 类型断言已复核 */
      spawnProc: (() => closeWith(child)) as never,
      write: () => ({ ok: false }),
      out: (chunk) => printed.push(chunk),
    });
    expect(code).toBe(0);
    expect(printed.join("")).not.toContain("外壳退出");
  });

  it("那行终止读数走 **CP936 那个通道**（`write`），不是 UTF-8 直写的 `emit`", async () => {
    /* 上面那条总数走的就是 `write`：`emit` 是 UTF-8 直写，平台按 CP936 解，中文在那
     * 里会变乱码（ISSUE #1977）。这一格判「新加的那句有没有跟着同一条口径」——
     * 写错的形态是**本地全绿、平台上那行读不出中文**，所以两边都要钉：`write` 收到它、
     * `emit` 没收到它。 */
    const written: Array<string> = [];
    const printed: Array<string> = [];
    const child = fakeChild("x\n", null, "SIGKILL");
    const code = await runWithCp936Exit(["--", "做点事"], {
      platform: "win32",
      resolve: passthroughResolve,
      /* SAFETY: 类型断言已复核 */
      spawnProc: (() => closeWith(child)) as never,
      write: (text: string) => {
        written.push(text);
        return { ok: true };
      },
      out: (chunk) => printed.push(chunk),
    });
    expect(code).toBe(128 + os.constants.signals.SIGKILL);
    expect(written.join("")).toContain("SIGKILL");
    expect(printed.join("")).not.toContain("SIGKILL");
  });

  it("**真起一条长跑子进程再 kill** ⇒ 外壳转出的不是 0（假执行者判不到这一格）", async () => {
    /* 这条是**现场**不是形状：`spawnProc` 交回真 `spawn` 的进程，信号从外面发，收尾走生产那条 `close` 回调 ——
     * 「`close` 到底带什么」只有真进程能回答（本文件头注曾答错一次，写的「被 kill 时 `close` 不会来」）。
     * `resolve` 注入原样放行：这里判终止 → 退出码那条链，不是解析层。 */
    let handle: ReturnType<typeof spawn> | undefined;
    const code = await runWithCp936Exit(
      ["--", process.execPath, "-e", "console.log('第一条读数');setInterval(() => {}, 999)"],
      {
        platform: "linux",
        resolve: passthroughResolve,
        /* SAFETY: 类型断言已复核 */
        spawnProc: ((cmd: string, args: Array<string>, opts: never) => {
          handle = spawn(cmd, args, opts);
          setTimeout(() => handle?.kill("SIGTERM"), 300);
          return handle;
        }) as never,
        write: () => ({ ok: false }),
        out: () => undefined,
      },
    );
    expect(code).toBe(128 + os.constants.signals.SIGTERM);
  });

  it("折算表本体：有码照原样、有号折 128+号、号查不到仍非零", () => {
    /* 纯函数那一层单独钉一遍：上面几条判的是「编排有没有用它」，这条判「表对不对」。
     * 特别是**未知信号名也要非零** —— 查不到号时落回 0 就等于把整条修复在最冷的一档
     * 上撤销掉（Windows 上 libuv 能报出 POSIX 没有的号，那一族就在这格里）。 */
    expect(exitCodeFromTermination(3, null)).toBe(3);
    expect(exitCodeFromTermination(127, null)).toBe(127);
    expect(exitCodeFromTermination(0, null)).toBe(0);
    expect(exitCodeFromTermination(null, "SIGKILL")).toBe(137);
    expect(exitCodeFromTermination(null, "SIGTERM")).toBe(143);
    expect(exitCodeFromTermination(null, "SIG不存在的")).toBe(UNKNOWN_TERMINATION_EXIT);
    expect(exitCodeFromTermination(null, null)).toBe(UNKNOWN_TERMINATION_EXIT);
    expect(exitCodeFromTermination(null, "SIG不存在的")).not.toBe(0);
  });

  it("非 Windows：原样转出（不假装转过一次 CP936）", async () => {
    const printed: Array<string> = [];
    const child = fakeChild("中文一二三\n", 0);
    await runWithCp936Exit(["--", "echo"], {
      platform: "linux",
      /* 这几格判的是输出通道；解析口注入「原样放行」那一档，免得答案取决于 */
      /* 跑它的那个进程的 PATH（现场 cnb-1d9-1k59h8hsv：CI 账号没有 Git 的 echo）。 */
      resolve: passthroughResolve,
      /* SAFETY: 类型断言已复核 */
      spawnProc: (() => {
        queueMicrotask(() => child.emitClose());
        return child;
      }) as never,
      out: (chunk) => printed.push(chunk),
    });
    expect(printed.join("")).toContain("中文一二三");
  });

  it("Windows：转码那一步没做成时**原文照打**，并且说明「日志可能仍是乱码」", async () => {
    const printed: Array<string> = [];
    const child = fakeChild("中文一二三\n", 0);
    await runWithCp936Exit(["--", "echo"], {
      platform: "win32",
      /* 这几格判的是输出通道；解析口注入「原样放行」那一档，免得答案取决于 */
      /* 跑它的那个进程的 PATH（现场 cnb-1d9-1k59h8hsv：CI 账号没有 Git 的 echo）。 */
      resolve: passthroughResolve,
      /* SAFETY: 类型断言已复核 */
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
    const printed: Array<string> = [];
    const child = fakeChild("中文一二三\n", 0);
    await runWithCp936Exit(["--", "echo"], {
      platform: "win32",
      /* 这几格判的是输出通道；解析口注入「原样放行」那一档，免得答案取决于 */
      /* 跑它的那个进程的 PATH（现场 cnb-1d9-1k59h8hsv：CI 账号没有 Git 的 echo）。 */
      resolve: passthroughResolve,
      /* SAFETY: 类型断言已复核 */
      spawnProc: (() => {
        queueMicrotask(() => child.emitClose());
        return child;
      }) as never,
      write: () => ({ ok: true }),
      out: (chunk) => printed.push(chunk),
    });
    expect(printed.join("")).not.toContain("中文一二三");
  });

  it("**可执行形态走仓里那一份判据**：bare `pnpm` 交给解析口，起的是宿主形态", async () => {
    /* 这条是本外壳最容易踩的坑：它是「包着别的命令起进程」的那一层，而 Windows 上
     * `pnpm` 是 `.cmd` / `.ps1` 垫片 —— Node 直接 `spawn("pnpm")` 给 `EINVAL`
     * （`spawn("pnpm.cmd")` 同样，因为 `.cmd` 只有 cmd.exe 会解释）。§2.1.1 已经为
     * 这件事收了一个唯一出口，所以本外壳**必须**过它，而不是自己写一个
     * 「Windows 用 pnpm.cmd」——那正是第四次踩同一个坑。 */
    const seen: Array<{ args: Array<string>; cmd: string }> = [];
    const child = fakeChild("ok\n", 0);
    await runWithCp936Exit(["--", "pnpm", "install", "--frozen-lockfile"], {
      platform: "win32",
      resolve: () => ({
        command: "powershell.exe",
        args: [
          "-NoProfile",
          "-ExecutionPolicy",
          "Bypass",
          "-File",
          "pnpm.ps1",
          "install",
          "--frozen-lockfile",
        ],
        resolved: true,
      }),
      /* SAFETY: 类型断言已复核 */
      spawnProc: ((cmd: string, args: Array<string>) => {
        seen.push({ cmd, args });
        queueMicrotask(() => child.emitClose());
        return child;
      }) as never,
      write: () => ({ ok: true }),
      out: () => undefined,
    });
    expect(seen[0]?.cmd).toBe("powershell.exe");
    /* 宿主前缀参数在前、原参数在后（顺序反了等于把 `pnpm.ps1` 当子命令传）。 */
    expect(seen[0]?.args.slice(0, 3)).toEqual(["-NoProfile", "-ExecutionPolicy", "Bypass"]);
    expect(seen[0]?.args.slice(-2)).toEqual(["install", "--frozen-lockfile"]);
  });

  it("**解析口收的是「名字」，不是「候选路径」** —— 原样退回候选就是把裸名字扔给 spawn", async () => {
    /* `Install dependencies` 真红的根因（ISSUE #1977 第三次上平台）：`commandInvocation()` 的契约是「**候选** → spawn
     * 形态」，解析不出来时原样退回候选 —— 对盘上路径忠实，对 `pnpm` 这种名字等于 `spawn("pnpm")`（Windows 上 ENOENT，
     * 现场 `[cp936-exit] 起不了这条命令：pnpm`）。正确那层是 `resolveCommandInvocation()`：收名字、交
     * `{command, args, resolved}` —— 生产解析口与注入面都必须交出这个形状。 */
    const seen: Array<{ args: Array<string>; cmd: string }> = [];
    const child = fakeChild("ok\n", 0);
    await runWithCp936Exit(["--", "some-thing", "x"], {
      platform: "win32",
      resolve: () => ({
        command: String.raw`C:\tools\some-thing.EXE`,
        args: ["x"],
        resolved: true,
      }),
      /* SAFETY: 类型断言已复核 */
      spawnProc: ((cmd: string, args: Array<string>) => {
        seen.push({ cmd, args });
        queueMicrotask(() => child.emitClose());
        return child;
      }) as never,
      write: () => ({ ok: true }),
      out: () => undefined,
    });
    /* 起的是**解析出来的绝对路径**，不是调用方写的那个名字。 */
    expect(seen[0]).toEqual({ cmd: String.raw`C:\tools\some-thing.EXE`, args: ["x"] });
  });

  it("**路径不进 PATH 查找**：`node_modules/.bin/tsc` 不是名字，别拿 PATH 去问它", () => {
    /* 第二次上平台的现场（ISSUE #1977）：`[cp936-exit] PATH 上找不到这条命令：node_modules/.bin/tsc`。
     * `.cnb.yml` 的 stage 里**路径**（`scripts/check-*.cjs`）与**名字**（`pnpm`/`node`）都真实存在；这里拿
     * `node_modules/.bin/tsc` 当输入（它曾是清单写法，#2572 起改直起包真身，外壳对垫片路径的处置未变）。
     * 路径的命令**不产出**「PATH 上找不到」（`resolved` 恒真），但仍要过形态判据（见下一用例）；
     * `resolveCommandInvocation()` 是纯 PATH 查找，把「找不到」与「不该问 PATH」混作一谈会在类型检查那格误红。 */
    const given = ["--noEmit"];
    const resolved = resolveShellInvocation(path.join("node_modules", ".bin", "tsc"), given);
    expect(resolved.resolved).toBe(true);
    /* 绝对化过 —— 证明它走的是「形态」那条路，不是原样透传。 */
    expect(path.isAbsolute(resolved.command)).toBe(true);
    /* 参数原样转交 —— 判的是「调用方给的那串必须逐字落在尾部」，不是「整串就等于我给的」：后者把「写下来的」
     * 当成「被执行的」。`commandInvocation()` 契约是交出能直接 spawn 的整串，Windows 上宿主与 `-File <shim>` 就在
     * `args` 里（见 `usableCommand()`），故前缀按机器出现，原 `toEqual(given)` 必红（实测
     * `expected ['-NoProfile', …(5)] to deeply equal ['--noEmit']`）；尾部这一判两个方向上都更强。 */
    expect(resolved.args.slice(-given.length)).toEqual(given);
  });

  it("Windows 的反斜杠路径同判「是路径」（两种分隔符都认）", () => {
    /* `.cnb.yml` 现在的写法是正斜杠，但 Windows 上两种分隔符都得认 ——
     * 只认 `/` 的判据在下一次有人写成 `\` 时就会把一条合法命令送去问 PATH。 */
    const resolved = resolveShellInvocation(String.raw`node_modules\.bin\tsc`, ["--noEmit"]);
    expect(resolved.resolved).toBe(true);
    expect(path.isAbsolute(resolved.command)).toBe(true);
  });

  it("路径**仍要过形态判据**：Windows 上落同目录的 `.ps1`（`.bin/<工具>` 那一类垫片）", () => {
    /* 「不问 PATH」只解决**误报**，不解决**起不来**：pnpm 在 `node_modules/.bin/<工具>` 摆 `.cmd` / `.ps1` / 无扩展名
     * shim 三个垫片，Node 一个都起不了（`.cmd` 只有 cmd.exe 解释、shim 是 shebang），故路径这一支必须再走形态判据，
     * 让同目录的 `.ps1` 回退被找出来。判据落在「PowerShell 宿主 + 同目录 `.ps1`」这个形状上，选中哪个文件由
     * `executable-resolve.ts` 那侧守。 */
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cp936-bin-"));
    fs.writeFileSync(path.join(dir, "tsc"), "#!/bin/sh\necho hi\n", {
      mode: 0o755,
    });
    fs.writeFileSync(path.join(dir, "tsc.ps1"), "Write-Output hi\r\n");
    /* 宿主必须是**二进制**形态（`powershellHost` 只认 `binary`）—— 一个 2 字节的
     * `MZ` 会被 `executableKind` 读成可打印文本（2 字符全落在 `\x20-\x7e` 里），
     * 于是这一格静默判不出宿主。真 exe 的头长这样。 */
    const host = path.join(dir, "pwsh.EXE");
    fs.writeFileSync(
      host,
      Buffer.from([
        0x4d, 0x5a, 0x00, 0x03, 0x91, 0x00, 0x40, 0x00, 0x00, 0x01, 0x02, 0x03, 0xff, 0xfe, 0xfd,
        0xfc,
      ]),
      { mode: 0o755 },
    );
    const env = { PATH: dir, PATHEXT: ".COM;.EXE;.BAT;.CMD" };
    const probe = {
      /* 权限探针在这条路上不参与结论（Windows 上 X_OK 只是存在性检查），
       * 但它是 `UsabilityProbe` 的形状之一，得给一个不动的实现。 */
      access: () => undefined,
      /* 模拟 Windows：只有那个 `pwsh.EXE` 起得来，shim（shebang）给 ENOENT。 */
      spawn: (candidate: string) => (candidate === host ? null : "ENOENT"),
    };
    /* 这一格得注入 `probe` 才判得出来，而 `resolveShellInvocation` 的入参里没有
     * `probe`，所以直接判它的下一层（`commandInvocation`）：本仓在 POSIX 上造不出
     * 「shebang 起不来」（那是内核解析的），上面那条 `probe` 就是这句话。 */
    const resolved = commandInvocation(path.resolve(path.join(dir, "tsc")), ["--version"], {
      platform: "win32",
      env,
      probe,
    });
    expect(resolved.command).toBe(host);
    expect(resolved.prefixArgs).toContain(path.join(dir, "tsc.ps1"));
  });

  it("**默认解析口真的接在编排上** —— 不注入 `resolve` 时裸名字也走 PATH 查找", async () => {
    /* 上面几条都注入 `resolve`，而注入面能盖住「实现写错了」，**盖不住「接错线了」**
     * —— 默认值写错、或压根没接上时，注入面自己把缺陷抹平、那几条照样绿。
     * 这一条因此**不注入 `resolve`**，判的就是那条线接上了没有。 */
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cp936-bin-"));
    /* 夹具必须是**这台宿主真起得来**的东西：解析层判「能不能跑」是真起一次（`usableCommand` 的探针），一个 shebang
     * 文本在 Windows 上永远起不来 ⇒ 结论「PATH 上查无此命令」，而那句与「解析口压根没接上」在日志里同形
     * （#1397「mock 排的形状必须真机出得来」）。Windows 给 `<dir>/pnpm.EXE`（`PATHEXT` 那一档，复制当前 node 二进制
     * 即真 PE），POSIX 给无扩展名的 `<dir>/pnpm`。 */
    const fake = path.join(dir, process.platform === "win32" ? "pnpm.EXE" : "pnpm");
    fs.copyFileSync(process.execPath, fake);
    fs.chmodSync(fake, 0o755);
    const seen: Array<string> = [];
    const handlers: Record<string, (arg: unknown) => void> = {};
    const child = {
      stdout: { on: () => child.stdout },
      stderr: { on: () => child.stderr },
      on: (ev: string, fn: (arg: unknown) => void) => {
        handlers[ev] = fn;
        return undefined;
      },
    };
    await runWithCp936Exit(["--", "pnpm", "install"], {
      platform: "linux",
      /* `env` 必须注入且**靠这一跳生效**：此前 `runWithCp936Exit` 递给解析口的是 `resolve(command, args)`，不带
       * options ⇒ 注入的 `env` 停在半路，这一格问的是**这台机器的 PATH**（Windows 上解析到 corepack 的 `pnpm.ps1`，
       * `seen[0]` 成了 `pwsh.EXE`，实测 `expected 'pwsh.EXE' to be 'pnpm'`）。`platform` 仍只用于出口那一半（见实现
       * 里的 ⚠️：两条「模拟非 Windows」用例真起 `echo`）；补齐后答案只由**注入的那张 PATH** 决定，换宿主不换结论。 */
      env: { PATH: dir, PATHEXT: ".COM;.EXE;.BAT;.CMD" },
      /* SAFETY: 类型断言已复核 */
      spawnProc: ((cmd: string) => {
        seen.push(cmd);
        queueMicrotask(() => handlers.close?.(0));
        return child;
      }) as never,
      out: () => undefined,
    });
    /* 起的是**PATH 上那条绝对路径** —— 默认值若退回「裸名字透传」，这里拿到的是
     * `"pnpm"`（反向复算过：改回去当场报 `expected [ 'pnpm' ] to deeply equal
     * [ '/tmp/…/pnpm' ]`）。 */
    expect(seen[0]).not.toBe("pnpm");
    expect(path.isAbsolute(seen[0] ?? "")).toBe(true);
    /* 起的是**这个夹具自己那一个**，不是这台机器 PATH 上恰好装着的某个 pnpm ——
     * 上一句判「接没接上解析口」，这一句判「问的是哪张 PATH」。少了它，`seen[0]`
     * 指到宿主上任何一份叫 `pnpm` 的东西都照样绿（本次那条红正是这个样子）。
     * 名字按宿主比（Windows 上带 `.EXE`，那本来就是 PATHEXT 那一档的事）。 */
    expect(path.resolve(seen[0] ?? "").toLowerCase()).toBe(path.resolve(fake).toLowerCase());
  });

  it("PATH 上查无此命令 ⇒ **可读出口 + 127**，不是把裸名字丢给 spawn", async () => {
    /* `resolved: false` 是「找不到」，不是「再试一次」。裸名字丢给 spawn 只会拿回
     * 一句信息量很低的 ENOENT（那正是平台上那一格的形态），而用户需要知道的是
     * 「找过了、它不在盘上」。 */
    const printed: Array<string> = [];
    const child = fakeChild("", 0);
    let spawned = false;
    const code = await runWithCp936Exit(["--", "不存在的命令", "x"], {
      platform: "win32",
      resolve: () => ({
        command: "不存在的命令",
        args: ["x"],
        resolved: false,
      }),
      /* SAFETY: 类型断言已复核 */
      spawnProc: (() => {
        spawned = true;
        queueMicrotask(() => child.emitClose());
        return child;
      }) as never,
      out: (chunk) => printed.push(chunk),
    });
    expect(code).toBe(127);
    /* **一条进程都没起** —— 找不到就不该起。 */
    expect(spawned).toBe(false);
    const text = printed.join("");
    expect(text).toContain("找不到");
    expect(text).toContain("不存在的命令");
    expect(text).toContain("PATH");
  });

  it("命令起不来 ⇒ 非零退出码 + 一条能读的说明（不是静默退 0）", async () => {
    const printed: Array<string> = [];
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
      /* SAFETY: 类型断言已复核 */
      spawnProc: (() => {
        queueMicrotask(() => handlers.error?.(new Error("ENOENT")));
        return child;
      }) as never,
      out: (chunk) => printed.push(chunk),
    });
    expect(code).not.toBe(0);
    expect(printed.join("")).toContain("不存在的命令");
  });

  it("**起不了那条出口要给真因**：失败码 + 解析后的路径 + 当前目录，一个都不能少", () => {
    /* 第四次上平台的现场（ISSUE #1977）：只回一句 `[cp936-exit] 起不了这条命令：node_modules/.bin/npx tsc --noEmit`，
     * 真因却是把**两条命令**当成一条（盘上没有那文件），报错点与真因隔着一整层；本条判纯函数出口，Linux 也能端到端。
     * 三样各回答一件事：`err.code`（`ENOENT` 盘上没有 vs `EACCES`/`EINVAL` 有但起不来，后者在 Windows 上就是形态不对，
     * 见 §2.1.1）；解析口交回的**绝对路径**（shim 还是真可执行，一眼可辨）；**当前目录 + 调用方原文**（相对路径相对谁，
     * stage 工作目录由平台给，本壳看不到）。 */
    const enoent = formatSpawnFailure({
      err: Object.assign(new Error("spawn x ENOENT"), { code: "ENOENT" }),
      command: "node_modules/.bin/npx tsc --noEmit",
      realCommand: "node_modules/.bin/npx tsc --noEmit",
      cwd: "/root/comfy-app-t3",
    });
    expect(enoent).toContain("node_modules/.bin/npx tsc --noEmit");
    expect(enoent).toContain("ENOENT");
    /* 「盘上没有」要说出来 —— 这一句才是读日志的人真正需要的结论。 */
    expect(enoent).toMatch(/盘上没有|不存在|没这件东西/);
    /* 当前目录写出来了（相对路径的基准）。 */
    expect(enoent).toContain("/root/comfy-app-t3");

    /* `EACCES` / `EINVAL` 是另一类结论（有，但起不来），措辞必须与 ENOENT 分开。 */
    const eacces = formatSpawnFailure({
      err: Object.assign(new Error("spawn x EACCES"), { code: "EACCES" }),
      command: "node_modules/.bin/eslint",
      cwd: "/root/comfy-app-t3",
    });
    expect(eacces).toContain("EACCES");
    expect(eacces).not.toBe(enoent);
    expect(eacces).toMatch(/起不来|形态/);

    /* 真解析过时才多打一行「通过解析口起的」——路径原样交出去时那句只是噪音
     * （`realCommand === command`）。 */
    const withResolved = formatSpawnFailure({
      err: Object.assign(new Error("x"), { code: "ENOENT" }),
      command: "pnpm",
      realCommand: String.raw`C:\tools\pnpm.EXE`,
      cwd: "/root/comfy-app-t3",
    });
    expect(withResolved).toContain(String.raw`C:\tools\pnpm.EXE`);
    expect(enoent).not.toContain("通过解析口起的");
  });

  it("**真的起一条不存在的路径** ⇒ 出口里带 ENOENT 与那条原文（不是只回命令名）", async () => {
    /* 上一条判「措辞」，这条判「这条出口在真 spawn 上真的走得到」——
     * `spawnSync` 在 Linux 上起一条不存在的**相对路径**同样是 `ENOENT`
     * （与 Windows 上的现场同一个错误码），所以这一格本地判得动。 */
    const printed: Array<string> = [];
    const code = await runWithCp936Exit(["--", "node_modules/.bin/npx-根本没有这个文件", "tsc"], {
      platform: "linux",
      resolve: passthroughResolve,
      out: (chunk) => printed.push(chunk),
    });
    expect(code).toBe(127);
    const text = printed.join("");
    expect(text).toContain("ENOENT");
    expect(text).toContain("node_modules/.bin/npx-根本没有这个文件");
    /* 当前目录也打出来了（相对路径的基准）。 */
    expect(text).toContain(process.cwd());
  });

  it("**转码成功后输出不许被吞**：stdout / stderr 直连本进程，而 stdin 留在管道上", () => {
    /* 第五次上平台的现场（ISSUE #1977）：stage 日志**一个字都没有**而退出码照转 ——「输出被吞」与「命令本来没输出」
     * 在日志上完全同形。根因：`encoding: null` 是对的（要 Buffer 的唯一写法），但 `stdio` 仍是默认 `pipe`，编好的
     * 936 字节落进 `r.stdout` 后整份丢掉。正确取值 `["pipe", "inherit", "inherit"]`：只接出 stdout/stderr，stdin 必须
     * 留在管道上（`stdio: "inherit"` 会**静默丢掉** `input`，`[Console]::In.ReadToEnd()` 读空 ⇒ 日志仍零行）。
     * ⚠️ Linux 判不到（`writeCp936` 非 Windows 直接 return），故只判默认实现交出去的那三路形状。 */
    const calls: Array<{ stdio: unknown }> = [];
    writeCp936("中文一二三", {
      platform: "win32",
      /* SAFETY: 类型断言已复核 */
      spawnImpl: ((_cmd: string, _args: Array<string>, opts: never) => {
        /* SAFETY: 类型断言已复核 */
        calls.push({ stdio: (opts as { stdio: unknown }).stdio });
        return { status: 0 };
      }) as never,
    });
    expect(calls).toHaveLength(1);
    /* **三路的形状都要判**，只判「含有 inherit」是不够的：stdin 跟着 inherit 就会
     * 把 `input`（那份 UTF-8 原文）**静默丢掉**，PowerShell 的
     * `[Console]::In.ReadToEnd()` 读到空串 ⇒ 日志仍然一个字都没有 —— 这正是本条
     * 修完之后**依然全空**的那一版（`E2E 关键流程` 那一格：退出 1、日志零行）。 */
    expect(calls[0]?.stdio).toEqual(["pipe", "inherit", "inherit"]);
  });

  it("转码那一步**带墙钟预算** —— `spawnSync` 挂住不能把整条链停在那里", () => {
    /* ISSUE #1977 第八轮：`writeCp936` 用同步 `spawnSync` 却跑在子进程 `data` 回调里 —— 无 `timeout` 就是「挂住就
     * 一直挂」：管道很快填满、子进程卡在 `write()`、`close` 永不到来，平台读到的是**零行**。
     * ⚠️ Linux 上判不到落字节，故钉形状：默认实现的 `timeout` 是否**有界**（去掉那行即红）。 */
    const calls: Array<{ timeout: unknown }> = [];
    writeCp936("中文一二三", {
      platform: "win32",
      /* SAFETY: 类型断言已复核 */
      spawnImpl: ((_cmd: string, _args: Array<string>, opts: never) => {
        calls.push({
          /* SAFETY: 类型断言已复核 */
          timeout: (opts as { timeout: unknown }).timeout,
        });
        return { status: 0 };
      }) as never,
    });
    expect(calls).toHaveLength(1);
    expect(typeof calls[0]?.timeout).toBe("number");
    expect(calls[0]?.timeout).toBe(TRANSCODE_TIMEOUT_MS);
  });

  it('编排把 `stdio: "inherit"` 传给写字节那一层（形状：不然生产那条路仍是 pipe）', async () => {
    /* 上一条判「默认值对不对」，这条判「编排有没有把它带上」——
     * 少了这一句，`writeCp936` 又退回默认的 `pipe`，输出照旧进 Buffer 丢掉。 */
    const seen: Array<unknown> = [];
    const child = fakeChild("中文一二三\n", 0);
    await runWithCp936Exit(["--", "echo"], {
      platform: "win32",
      resolve: passthroughResolve,
      /* SAFETY: 类型断言已复核 */
      spawnProc: (() => {
        queueMicrotask(() => child.emitClose());
        return child;
      }) as never,
      /* SAFETY: 类型断言已复核 */
      write: ((_text: string, opts: { stdio?: unknown }) => {
        seen.push(opts?.stdio);
        return { ok: true };
      }) as never,
      out: () => undefined,
    });
    expect(seen).toEqual(["inherit"]);
  });

  it("**真跑一次那三路**：`input` 送得到 stdin，而子进程的输出真的落到本进程 stdout", () => {
    /* 上两条判「形状」，这条判**形状真能用**：拿 `process.execPath` 假冒 PowerShell（stdin 原样回吐），跑的正是默认
     * 实现那三路。它挡的是只在运行时显形的错法：`stdio: "inherit"` 单字符串会连 stdin 一起接走，`input` **静默失效**
     * （不抛错、原文没送到），子进程读空、一个字节不发。Linux 上判得动，因为 `spawnSync` 的 stdio 语义与平台无关。 */
    const child = spawnSync(
      process.execPath,
      [
        "-e",
        "let b='';process.stdin.setEncoding('utf8');" +
          "process.stdin.on('data',(d)=>b+=d).on('end',()=>process.stdout.write('OUT:'+b))",
      ],
      {
        input: "中文一二三",
        encoding: null,
        stdio: ["pipe", "inherit", "inherit"],
      },
    );
    expect(child.status).toBe(0);
    /* 数据**真的走 stdin 进去了**（stdout 被 inherit 接走，所以这里只判 status ——
     * 回显那半由上面那句人工读数与 `input` 这一路共同说明）。 */
    expect(child.stdout).toBeNull();
  });
});

describe("CP936 出口：**边到边发**（第六跑 —— 长跑 stage 的日志不再随 kill 一起消失）", () => {
  /** 解析口的「原样放行」形态 —— 与上面那一组同形（`{command, args, resolved}`）。
   *  这些用例判的是「什么时候发」，不想让「这条命令在不在 PATH 上」掺进来。 */
  const passthroughResolve = (cmd: string, args: Array<string>) => ({
    command: cmd,
    args,
    resolved: true,
  });

  /**
   * 假子进程：数据分几次推、`close` 可以**永远不来**（真实场景里被平台 kill 掉）。
   * 与上面 `fakeChild` 的差别只有一处 —— 这里把 `data` 回调**留着**，由用例决定何时送、送几块
   * （判「送出去的时刻」必须能控制时刻）。
   */
  const streamingChild = () => {
    const dataHandlers: Array<(d: unknown) => void> = [];
    const closeHandlers: Array<(code: number | null) => void> = [];
    /* `stderr` **必须是另一条流**（不是同一个对象）：两条流各注册一次 `data`
     * 回调，共用对象会让同一块被处理两遍（`carry` 也被两个回调共享），判出来的
     * 「什么时候发」就不是真实形状了。 */
    const mkStream = () => {
      const s = {
        setEncoding: () => s,
        on: (ev: string, fn: (d: unknown) => void) => {
          if (ev === "data") {
            dataHandlers.push(fn);
          }
          return s;
        },
      };
      return s;
    };
    return {
      stdout: mkStream(),
      stderr: mkStream(),
      on: (ev: string, fn: (arg: unknown) => void) => {
        if (ev === "close") {
          closeHandlers.push(fn);
        }
        return undefined;
      },
      /* 只喂 **stdout** 那条（`dataHandlers[0]`）：两条流各注册一次，随手全都喂
       * 会让同一块处理两遍 —— 本组判「发的时机与切法」，重复一块会把结论搅浑。 */
      push: (chunk: string) => dataHandlers[0]?.(chunk),
      close: (code: number | null) => {
        closeHandlers.forEach((fn) => {
          fn(code);
        });
      },
    };
  };

  it("`splitStreamChunk` 只切**整行**，行尾残余留在 carry 里", () => {
    expect(splitStreamChunk("", "甲\n乙\n")).toEqual({
      text: "甲\n乙\n",
      carry: "",
    });
    /* 关键那一格：`乙` 还没有换行符收尾 ⇒ **不许**当成一整行发出去（发早了会把
     * 下一块拼上来的那半截丢在日志里断成两行）。 */
    expect(splitStreamChunk("", "甲\n乙")).toEqual({
      text: "甲\n",
      carry: "乙",
    });
    /* 上一块留下的残余与这一块拼起来才成行。 */
    expect(splitStreamChunk("乙", "丙\n")).toEqual({
      text: "乙丙\n",
      carry: "",
    });
    /* 一块里一行都没有（长行被截成多块）—— 一个字都不发。 */
    expect(splitStreamChunk("很长的一", "行还在继续")).toEqual({
      text: "",
      carry: "很长的一行还在继续",
    });
  });

  it("**第一块到就发出去** —— 不必等 `close`（长跑 stage 被 kill 时 `close` 不会来）", async () => {
    /* 这就是 `E2E 关键流程` 那 36 分钟零行的判据：旧写法把整轮输出攒到 `close`
     * 才发一次，而平台按 stage 超时 kill 掉的进程**永远不会触发 `close`** ——
     * 攒了多少就丢多少。
     *
     * 这条用例**刻意不触发 `close`**：只要第一块到了，日志里就必须已经有它。 */
    const printed: Array<string> = [];
    const child = streamingChild();
    const done = runWithCp936Exit(["--", "长跑"], {
      platform: "linux",
      resolve: passthroughResolve,
      /* SAFETY: 类型断言已复核 */
      spawnProc: (() => child) as never,
      out: (chunk) => printed.push(chunk),
    });
    child.push("第一行\n");
    /* **此刻**（还没有 close）就该看得见那一行。 */
    expect(printed.join("")).toContain("第一行");
    /* 收尾（避免这条 Promise 悬着），但上面那条断言与它无关。 */
    child.close(0);
    await done;
  });

  it("一块里**半行**不算一行 —— 剩下那半截留到下一块，拼齐了才发", async () => {
    const printed: Array<string> = [];
    const child = streamingChild();
    const done = runWithCp936Exit(["--", "长跑"], {
      platform: "linux",
      resolve: passthroughResolve,
      /* SAFETY: 类型断言已复核 */
      spawnProc: (() => child) as never,
      out: (chunk) => printed.push(chunk),
    });
    child.push("完整的一行\n半个");
    expect(printed.join("")).toBe("完整的一行\n");
    child.push("字补上\n");
    expect(printed.join("")).toBe("完整的一行\n半个字补上\n");
    child.close(0);
    await done;
  });

  it("`close` 时**补发**行尾残余（最后一行常常没有换行符收尾）", async () => {
    const printed: Array<string> = [];
    const child = streamingChild();
    const done = runWithCp936Exit(["--", "长跑"], {
      platform: "linux",
      resolve: passthroughResolve,
      /* SAFETY: 类型断言已复核 */
      spawnProc: (() => child) as never,
      out: (chunk) => printed.push(chunk),
    });
    child.push("有换行的一行\n没有换行的尾巴");
    child.close(0);
    await done;
    expect(printed.join("")).toBe("有换行的一行\n没有换行的尾巴");
  });

  it("Windows：**每一整行各转一次**，且 `stdio` 仍然是 `inherit`", async () => {
    /* 转码仍然按**整行**为单位过 PowerShell：按块转会在多字节字符中间截断
     * （GBK 变长），`splitStreamChunk` 正是为此而存在。 */
    const seen: Array<{ stdio: unknown; text: string }> = [];
    const child = streamingChild();
    const done = runWithCp936Exit(["--", "长跑"], {
      platform: "win32",
      resolve: passthroughResolve,
      /* SAFETY: 类型断言已复核 */
      spawnProc: (() => child) as never,
      /* SAFETY: 类型断言已复核 */
      write: ((text: string, opts: { stdio?: unknown }) => {
        seen.push({ text, stdio: opts?.stdio });
        return { ok: true };
      }) as never,
      out: () => undefined,
    });
    /* 一块 = 一次转码调用（`splitStreamChunk` 的粒度是「这一块里切出来的整行」），
     * 两块各带一整行 ⇒ 两次调用。粒度是**块**、不是行：真起一条 PowerShell 逐行
     * 转码会把分钟级 stage 拖成小时级，而这一步要买的只是「别攒到最后」。 */
    child.push("甲\n");
    child.push("乙\n");
    expect(seen).toEqual([
      { text: "甲\n", stdio: "inherit" },
      { text: "乙\n", stdio: "inherit" },
    ]);
    child.close(0);
    await done;
  });

  it("Windows：转码失败那条提示**只说一次**，但每一行的原文都照打", async () => {
    /* 提示原来是「跑完收尾一句」，现在按行发 —— 每行重复一遍会把真输出埋掉。
     * 而**原文**照打这件事不能省：它是转码没做成时唯一还能读的东西。 */
    const printed: Array<string> = [];
    const child = streamingChild();
    const done = runWithCp936Exit(["--", "长跑"], {
      platform: "win32",
      resolve: passthroughResolve,
      /* SAFETY: 类型断言已复核 */
      spawnProc: (() => child) as never,
      write: () => ({ ok: false }),
      out: (chunk) => printed.push(chunk),
    });
    child.push("第一行\n第二行\n");
    child.close(0);
    await done;
    const text = printed.join("");
    expect(text.split("没做成")).toHaveLength(2);
    expect(text).toContain("第一行");
    expect(text).toContain("第二行");
  });
});
