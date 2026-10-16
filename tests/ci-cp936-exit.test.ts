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
 *
 * ## 「Linux 检出上判不到」不是「不用判」—— 两条靠**形状**判
 *
 * ISSUE #1977 的第一次上平台在这条链上连红两次、而本地全绿，两处都是
 * 「只有 Windows 会走到、Linux 一次都到不了」的语句：
 *
 *   · `spawnSync(…, {encoding: "buffer"})` —— `encoding` 要的是**值 `Buffer`**；
 *     字符串 `"buffer"` 是 `ERR_UNKNOWN_ENCODING`。它在 `writeCp936` 的 Windows 分支里，
 *     而那一句在 Linux 上**直接 return 之前就出不去**（本文件在 Linux 跑不了真 PS）。
 *     ⇒ 这里判**注入面收到的那个 `encoding` 值**（`runImpl` 是它的注入面）。
 *   · 抓输出那一跳 `String(buffer)` —— 在 Windows 上按**宿主代码页（CP936）**解，
 *     于是子进程的 UTF-8 在进 PowerShell **之前**就已经乱了一遍，后面的转码只是
 *     把乱码换个编码存下来。Linux 的 `process.stdout` 是 UTF-8，这个 bug 在本机
 *     **永远不会显形**。⇒ 这里判「有显式 `setEncoding("utf8")` 那一跳」这个形状
 *     （能在地板上真起子进程的那条路同样判，见「真起一条子进程」那一组）。
 *   · **「该不该问 PATH」与「怎么起」被混成了一件**：`node_modules/.bin/tsc` 是
 *     **相对路径**，拿它问 PATH 当然「找不到」（问错了对象）；而把它**原样**交
 *     `spawn` 在 Windows 上照样起不来 —— pnpm 给 `.bin/<工具>` 摆的三个垫片
 *     （`.cmd` / `.ps1` / 无扩展名 shim）Node 一个都起不了。两半都要判：
 *     路径**不问 PATH**，但**要过形态判据**（`.ps1` 回退）。
 *   · **注入面能盖住「实现写错了」，盖不住「接错线了」**：判定「解析口改对了」的
 *     用例全都注入 `resolve`，而注入面是「输入什么就交回什么」的假实现 ——
 *     「默认值写错 / 只覆盖了一半形状」这两类在它下面全看不出来。⇒ 这里有两组
 *     **不注入 `resolve`** 的判据（默认解析口真的接在编排上、路径真的过分态判据）。
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { commandInvocation } from "../src/lib/process/executable-resolve.ts";
import {
  CP936_CODE_PAGE,
  encodeCp936Plan,
  parseInvocation,
  resolveShellInvocation,
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

  it('`encoding` 要的是**编码名或 `null`** —— `"buffer"` 与 `Buffer` **两者都会被拒**', () => {
    /* 这条判据的根据是本仓第一次上平台的现场（`工具链自证` 直接红），报错原文：
     *
     *   `TypeError [ERR_UNKNOWN_ENCODING]: Unknown encoding: buffer`
     *   `    at Buffer.from (node:buffer:339:12)`
     *   `    at spawnSync (node:child_process:916:29)`
     *   `    at scripts/ci-cp936-exit.mjs:121`
     *
     * （这几行按判据 §12.4.6 的「错误原文保留英文」处置，用反引号包住 ——
     * `check-comment-language.cjs` 的启发式只把**反引号外的**英文成句算进来。）
     *
     * 这两笔是**同一个误解的两种写法**：想「拿到 Buffer」，于是写 `"buffer"`；
     * 被拒之后自然会改成 `Buffer` —— **同样被拒**。这个位置只认
     * 「编码名字符串」或 `null`（= 给我 Buffer），不认 `Buffer` 这个构造器。
     * 两种错法都是**运行时**才炸（`spawnSync` 拿到 `input` 才走
     * `Buffer.from(input, encoding)`），所以判据只能在「值传下去」这一层设。 */
    /* 两种写法都不是编码名 —— 查表就是查不到。 */
    expect(Buffer.isEncoding("buffer")).toBe(false);
    expect(Buffer.isEncoding(Buffer as never)).toBe(false);
    /* 而且**两条都在真 `spawnSync` 上炸**（子进程有输出时才走 `Buffer.from`，
     * 所以探针必须真的打一行字 —— 写 `-e "0"` 是炸不出来的）。 */
    for (const bad of ["buffer", Buffer]) {
      expect(() =>
        spawnSync(process.execPath, ["-e", 'process.stdout.write("hi")'], {
          input: "x",
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
      spawnImpl: ((cmd: string, _args: string[], opts: never) => {
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
  const passthroughResolve = (cmd: string, args: string[]) => ({
    command: cmd,
    args,
    resolved: true,
  });

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

  it("抓子进程输出的那一跳**显式钉 `utf8`**（Linux 上永远看不见的那个 bug）", async () => {
    /* `String(buffer)` 走 `buf.toString()`，默认编码取自 `process.stdout` 的
     * `writableEncoding` —— 在 Windows 上那是**宿主代码页（CP936）**。于是子进程的
     * UTF-8 字节在**进 PowerShell 之前**就被解错一遍，再按 936 编回去只是把乱码换个
     * 编码存下来：转码链「先解对、再编回」两段，第一段在这里断。
     *
     * Linux 的 `process.stdout` 是 UTF-8，所以这个 bug 在本机**永远不会显形** ——
     * 判据只能落在「这一跳有没有被显式钉住」这个形状上：真 `spawn` 出来的流有
     * `setEncoding`，判它被以 `"utf8"` 调过（`ci-console-encoding.mjs` 钉的是
     * 控制台那一半，这里钉的是抓子进程这一半）。 */
    const pinned: string[] = [];
    const mkStream = (out: string) => ({
      setEncoding(enc: string) {
        pinned.push(enc);
        return this;
      },
      on(ev: string, fn: (d: unknown) => void) {
        if (ev === "data") fn(out);
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

  it("**可执行形态走仓里那一份判据**：bare `pnpm` 交给解析口，起的是宿主形态", async () => {
    /* 这条是本外壳最容易踩的坑：它是「包着别的命令起进程」的那一层，而 Windows 上
     * `pnpm` 是 `.cmd` / `.ps1` 垫片 —— Node 直接 `spawn("pnpm")` 给 `EINVAL`
     * （`spawn("pnpm.cmd")` 同样，因为 `.cmd` 只有 cmd.exe 会解释）。§2.1.1 已经为
     * 这件事收了一个唯一出口，所以本外壳**必须**过它，而不是自己写一个
     * 「Windows 用 pnpm.cmd」——那正是第四次踩同一个坑。 */
    const seen: Array<{ cmd: string; args: string[] }> = [];
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
      spawnProc: ((cmd: string, args: string[]) => {
        seen.push({ cmd, args });
        queueMicrotask(() => child.emitClose());
        return child;
      }) as never,
      write: () => ({ ok: true }),
      out: () => undefined,
    });
    expect(seen[0]?.cmd).toBe("powershell.exe");
    /* 宿主前缀参数在前、原参数在后（顺序反了等于把 `pnpm.ps1` 当子命令传）。 */
    expect(seen[0]?.args.slice(0, 3)).toEqual([
      "-NoProfile",
      "-ExecutionPolicy",
      "Bypass",
    ]);
    expect(seen[0]?.args.slice(-2)).toEqual(["install", "--frozen-lockfile"]);
  });

  it("**解析口收的是「名字」，不是「候选路径」** —— 原样退回候选就是把裸名字扔给 spawn", async () => {
    /* 这是 `Install dependencies` 那一格真红的根因（ISSUE #1977 第三次上平台）：
     * `commandInvocation()` 的契约是「**候选** → spawn 形态」，解析不出来时它
     * **原样退回候选** —— 对一条盘上的路径是忠实的，对 `pnpm` 这种名字却等于
     * `spawn("pnpm")`，在 Windows 上是 `ENOENT`（现场：
     * `[cp936-exit] 起不了这条命令：pnpm`）。
     *
     * 正确的那一层是 `resolveCommandInvocation()`：收名字、交 `{command, args,
     * resolved}`。这条用例把那个口径钉住 —— 生产解析口必须是后者，注入面也必须
     * 交出这个形状。 */
    const seen: Array<{ cmd: string; args: string[] }> = [];
    const child = fakeChild("ok\n", 0);
    await runWithCp936Exit(["--", "some-thing", "x"], {
      platform: "win32",
      resolve: () => ({
        command: "C:\\tools\\some-thing.EXE",
        args: ["x"],
        resolved: true,
      }),
      spawnProc: ((cmd: string, args: string[]) => {
        seen.push({ cmd, args });
        queueMicrotask(() => child.emitClose());
        return child;
      }) as never,
      write: () => ({ ok: true }),
      out: () => undefined,
    });
    /* 起的是**解析出来的绝对路径**，不是调用方写的那个名字。 */
    expect(seen[0]).toEqual({ cmd: "C:\\tools\\some-thing.EXE", args: ["x"] });
  });

  it("**路径不进 PATH 查找**：`node_modules/.bin/tsc` 不是名字，别拿 PATH 去问它", () => {
    /* 这一格是外壳第二次上平台的现场（ISSUE #1977）：
     *
     *   [cp936-exit] PATH 上找不到这条命令：node_modules/.bin/tsc
     *
     * `.cnb.yml` 的 stage 里**两种都真实存在** —— `node_modules/.bin/tsc` /
     * `scripts/check-*.cjs` 是**路径**（相对检出根），`pnpm` / `node` 是**名字**。
     * 而 `resolveCommandInvocation()` 是**纯 PATH 查找**，对一条相对路径它当然报
     * `resolved: false` —— 那不是「找不到」，是「这条不该问 PATH」。把两者混作
     * 一谈，就会在类型检查那一格上**误红**（判据把该保守的方向用反了）。
     *
     * 两条判据：
     *   · 路径的命令**不产出**「PATH 上找不到」（`resolved` 恒真）；
     *   · 但它**仍要过形态判据** —— 「不问 PATH」只解决误报，命令本身在 Windows 上
     *     照样要落 `.ps1` 回退才起得来（下一个用例判那一半）。 */
    const resolved = resolveShellInvocation(
      path.join("node_modules", ".bin", "tsc"),
      ["--noEmit"],
    );
    expect(resolved.resolved).toBe(true);
    /* 绝对化过 —— 证明它走的是「形态」那条路，不是原样透传。 */
    expect(path.isAbsolute(resolved.command)).toBe(true);
    /* 参数原样转交，一个都不改写。 */
    expect(resolved.args).toEqual(["--noEmit"]);
  });

  it("Windows 的反斜杠路径同判「是路径」（两种分隔符都认）", () => {
    /* `.cnb.yml` 现在的写法是正斜杠，但 Windows 上两种分隔符都得认 ——
     * 只认 `/` 的判据在下一次有人写成 `\` 时就会把一条合法命令送去问 PATH。 */
    const resolved = resolveShellInvocation("node_modules\\.bin\\tsc", [
      "--noEmit",
    ]);
    expect(resolved.resolved).toBe(true);
    expect(path.isAbsolute(resolved.command)).toBe(true);
  });

  it("路径**仍要过形态判据**：Windows 上落同目录的 `.ps1`（`.bin/<工具>` 那一类垫片）", () => {
    /* 「不问 PATH」只解决**误报**，不解决**起不来** —— pnpm 在 Windows 上给
     * `node_modules/.bin/<工具>` 摆三个垫片（`.cmd` / `.ps1` / 无扩展名 shim），
     * Node 一个都起不了（`.cmd` 只有 cmd.exe 解释、shim 是 shebang）。所以路径这一支
     * 必须再走一次形态判据，让同目录的 `.ps1` 回退被找出来。
     *
     * 判据落在「落到了 PowerShell 宿主 + 同目录 `.ps1`」这个形状上，而不是「选中了
     * 哪个文件」（后者由 `executable-resolve.ts` 那一侧的用例守）。 */
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
        0x4d, 0x5a, 0x00, 0x03, 0x91, 0x00, 0x40, 0x00, 0x00, 0x01, 0x02, 0x03,
        0xff, 0xfe, 0xfd, 0xfc,
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
    const resolved = commandInvocation(
      path.resolve(path.join(dir, "tsc")),
      ["--version"],
      { platform: "win32", env, probe },
    );
    expect(resolved.command).toBe(host);
    expect(resolved.prefixArgs).toContain(path.join(dir, "tsc.ps1"));
  });

  it("**默认解析口真的接在编排上** —— 不注入 `resolve` 时裸名字也走 PATH 查找", async () => {
    /* 上面几条都注入 `resolve`，而注入面能盖住「实现写错了」，**盖不住「接错线了」**
     * —— 默认值写错、或压根没接上时，注入面自己把缺陷抹平、那几条照样绿。
     * 这一条因此**不注入 `resolve`**，判的就是那条线接上了没有。 */
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cp936-bin-"));
    fs.writeFileSync(path.join(dir, "pnpm"), "#!/bin/sh\necho 1\n", {
      mode: 0o755,
    });
    const seen: string[] = [];
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
    expect(path.basename(seen[0] ?? "")).toBe("pnpm");
  });

  it("PATH 上查无此命令 ⇒ **可读出口 + 127**，不是把裸名字丢给 spawn", async () => {
    /* `resolved: false` 是「找不到」，不是「再试一次」。裸名字丢给 spawn 只会拿回
     * 一句信息量很低的 ENOENT（那正是平台上那一格的形态），而用户需要知道的是
     * 「找过了、它不在盘上」。 */
    const printed: string[] = [];
    const child = fakeChild("", 0);
    let spawned = false;
    const code = await runWithCp936Exit(["--", "不存在的命令", "x"], {
      platform: "win32",
      resolve: () => ({
        command: "不存在的命令",
        args: ["x"],
        resolved: false,
      }),
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
