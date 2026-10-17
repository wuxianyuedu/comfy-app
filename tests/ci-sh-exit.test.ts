/**
 * POSIX 侧的外壳（`scripts/ci-sh-exit.mjs`，ISSUE #1993）。
 *
 * ── 这条判据守的是什么 ──────────────────────────────────────────────────
 *
 * Linux 那条链路（`.cnb.yml` 的 `linux:` 分支键）里每个 stage 都包在它外面，
 * 所以它一旦坏了，**整条链路的每一步都会以一种看不懂的方式坏**。三类失效都不会自己说话：
 *
 *   ① **退出码被吞**（`settle(code ?? 0)` 那种写法）：子进程被信号打死时 `code` 是
 *      `null`，当成 0 = **「没跑完」被报成「通过了」**，而且没有任何东西会说。
 *      所以这里的判据是「`null` 要折成 `128 + 信号号`」，并且**拿不到信号号时退非零**
 *      （拿不到测量 ≠ 测量结果是绿的，§13.6.4.1 同一句）。
 *   ② **输出攒到 `close` 才发**：分钟级 stage 被平台按超时 kill 时 `close` 永不到来，
 *      整轮日志零行（`ci-cp936-exit.mjs` 第六次上平台就是这么红的 —— 那件事与编码
 *      无关，POSIX 上同样成立）。所以这里必须**边到边发**。
 *   ③ **CP936 被「顺手」加进来**：POSIX 上转码会把 UTF-8 变成乱码，两件事反着做。
 *      判据是「本文件里不出现 CP936 / OutputEncoding」—— 它不该长回 Windows 那半件。
 *
 * ── 为什么不与 `tests/ci-cp936-exit.test.ts` 合成一份 ────────────────────
 *
 * 两者是**两个文件、两种宿主行为**，不是同一件事的两份拷贝：那边判「字节以 936 出口」，
 * 这边判「退出码与信号、以及不转码」。硬合成一份会让「哪一半在哪个宿主上成立」变糊。
 * 但**解析口是同一份**（`resolveCommandInvocation`），这一条在下面单独钉住 ——
 * 自己写一个「POSIX 上直接 spawn 就行」就是把那条唯一出口抄了第二遍（§2.1.1 / §12.18）。
 */
import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  NOT_FOUND_EXIT,
  UNKNOWN_SIGNAL_EXIT,
  exitCodeFrom,
  parseInvocation,
  runWithShExit,
  splitLines,
} from "../scripts/ci-sh-exit.mjs";

/** 假流的最小结构（见 `makeFakeSpawn`）：外壳只用得到 `on("data")` 与 `setEncoding`。 */
type FakeStream = {
  setEncoding: () => void;
  on: (event: string, cb: (d: string) => void) => undefined;
  feed: (d: string) => void;
};

/** 假子进程的最小结构：外壳只用得到 `stdout` / `stderr` 与 `on("close")`。 */
type FakeChild = {
  stdout: FakeStream;
  stderr: FakeStream;
  on: (
    event: string,
    cb: (code: number | null, signal: string | null) => void,
  ) => undefined;
};

/** 假的 `spawn` 本身。 */
type FakeSpawn = (command: string, args: string[]) => FakeChild;

/**
 * 把假 `spawn` 交给注入面 —— 它只覆盖外壳真正用到的那三个成员，形状与
 * `ChildProcess` 不同，所以是显式断言而不是「差不多就行」的隐式转换。
 *
 * @param fake 假的 spawn
 * @returns 注入面接受的那一份
 */
function asSpawn(fake: FakeSpawn) {
  return fake as unknown as NonNullable<
    NonNullable<Parameters<typeof runWithShExit>[1]>["spawnProc"]
  >;
}

const SOURCE = readFileSync(
  path.resolve(import.meta.dirname, "..", "scripts", "ci-sh-exit.mjs"),
  "utf8",
);

/**
 * 造一个假的 `spawn`：可控地「发一块输出」与「要不要 close」。
 *
 * 只用得到 `stdout` / `stderr` 的 `data` 事件与 `close` 事件，所以这里的形状就是
 * 那三个成员的**最小结构** —— 不 `any`（`no-unsafe-*` 那一族会当场红一片，
 * 而那正是本仓 ESLint 零警告的要求），也不去造一个真 `ChildProcess`
 * （stdin / stdio / 另外十几个成员，与这条判据要验的事毫无关系）。
 *
 * @param {Array<{command: string, args: string[]}>} calls 每次调用都记一笔
 * @param {string | null} chunk 非空时发一块输出；`null` 时直接 `close(0)`
 * @returns {FakeSpawn}
 */
function makeFakeSpawn(
  calls: Array<{ command: string; args: string[] }>,
  chunk: string | null,
): FakeSpawn {
  /**
   * @param {string} command
   * @param {string[]} args
   * @returns {FakeChild}
   */
  const fake = (command: string, args: string[]): FakeChild => {
    calls.push({ command, args });
    /** 极简的可观察流：`on` 记下回调，`setEncoding` 是外壳会调一次的空操作。 */
    const makeStream = () => {
      const handlers: Array<(d: string) => void> = [];
      return {
        setEncoding: () => {
          /* 外壳钉 utf8；这里什么都不必做（不转码，按字符给就是对的）。 */
        },
        on: (event: string, cb: (d: string) => void) => {
          if (event === "data") handlers.push(cb);
          return undefined;
        },
        /** 把一块输出喂给注册过的回调（判据用它造出「第一块已到」）。 */
        feed: (d: string) => {
          for (const h of handlers) h(d);
        },
      };
    };
    const closeHandlers: Array<
      (code: number | null, signal: string | null) => void
    > = [];
    const child = {
      stdout: makeStream(),
      stderr: makeStream(),
      on: (event: string, cb: (code: number | null, signal: string | null) => void) => {
        if (event === "close") closeHandlers.push(cb);
        return undefined;
      },
    };
    setImmediate(() => {
      if (chunk === null) for (const h of closeHandlers) h(0, null);
      else child.stdout.feed(chunk);
    });
    return child;
  };
  return fake;
}

describe("POSIX 外壳：退出码、信号与「不转码」（ISSUE #1993）", () => {
  it("正常退出：退出码原样转出去", () => {
    expect(exitCodeFrom({ code: 0, signal: null })).toBe(0);
    expect(exitCodeFrom({ code: 7, signal: null })).toBe(7);
  });

  it("被信号打死：折成 `128 + 信号号`（**不是 0**）", () => {
    /* 这一格是「没跑完被读成通过了」的唯一防线：被 kill 时 `close` 给的 `code` 是 `null`，
     * 而 `null ?? 0` 是多少份外壳里真实写着的 bug。 */
    expect(exitCodeFrom({ code: null, signal: "SIGTERM" })).toBe(143);
    expect(exitCodeFrom({ code: null, signal: "SIGKILL" })).toBe(137);
    expect(exitCodeFrom({ code: null, signal: "SIGINT" })).toBe(130);
  });

  it("拿不到信号号时退**非零**（拿不到测量 ≠ 测量结果是绿的）", () => {
    expect(exitCodeFrom({ code: null, signal: null })).toBe(UNKNOWN_SIGNAL_EXIT);
    expect(UNKNOWN_SIGNAL_EXIT).not.toBe(0);
    // 平台不认识的信号名同样退非零，不许落到 128 + 0 = 128 之外的「看着像成功」。
    expect(exitCodeFrom({ code: null, signal: "SIGWEIRD" })).not.toBe(0);
  });

  it("按行切流：整行立刻发出，行尾残余留到下一块", () => {
    expect(splitLines("", "a\nb\n")).toEqual({ text: "a\nb\n", carry: "" });
    expect(splitLines("", "abc")).toEqual({ text: "", carry: "abc" });
    expect(splitLines("abc", "def\n")).toEqual({ text: "abcdef\n", carry: "" });
    expect(splitLines("tail", "1\ntail2")).toEqual({
      text: "tail1\n",
      carry: "tail2",
    });
  });

  it("参数形态：`--` 之后才是命令；没有 `--` 就给出用法", () => {
    expect(parseInvocation(["--", "node", "x.cjs"])).toMatchObject({
      command: "node",
      args: ["x.cjs"],
    });
    const usage = parseInvocation(["node", "x.cjs"]);
    expect(usage.command).toBe("");
    expect(usage.usage).toContain("用法");
    // `--` 是最后一个 token 同判「没给命令」。
    expect(parseInvocation(["--"]).command).toBe("");
  });

  it("找不到命令 ⇒ 127（不是 1，也不是 0）", async () => {
    const sink: string[] = [];
    const code = Number(await runWithShExit(["--", "某个不存在的命令"], {
      resolve: (cmd: string, args: string[]) => ({
        command: cmd,
        args,
        resolved: false,
      }),
      out: (s: string) => sink.push(s),
    }));
    expect(code).toBe(NOT_FOUND_EXIT);
  });

  it("起的命令是解析口交回来的那一份（不自己拼 POSIX 形态）", async () => {
    /* 这条钉的是「唯一出口」：`pnpm` / `node_modules/.bin/tsc` 在 POSIX 上分别是
     * PATH 上的名字与符号链接，两者都要落到同一份判据上。自己写一个
     * 「POSIX 上直接 spawn 就行」就是第三次踩 §2.1.1 那个坑。
     * 断言：真起进程时拿到的是解析口交回的 `command` 与 `args`，**逐字**。 */
    const calls: Array<{ command: string; args: string[] }> = [];
    const fakeSpawn = makeFakeSpawn(calls, null);
    const silent: string[] = [];
    const code = Number(await runWithShExit(["--", "pnpm", "run", "build"], {
      resolve: (cmd: string, args: string[]) => ({
        command: `/resolved/${cmd}`,
        args: ["--injected", ...args],
        resolved: true,
      }),
      /* 外层只用 `stdout` / `stderr` / `close`（见 `makeFakeSpawn` 的说明）。 */
      spawnProc: asSpawn(fakeSpawn),
      out: (s: string) => silent.push(s),
    }));
    expect(code).toBe(0);
    expect(silent).toEqual([]);
    expect(calls).toEqual([
      { command: "/resolved/pnpm", args: ["--injected", "run", "build"] },
    ]);
  });

  it("输出**边到边发**：第一块到的时候就已经写出去了（不等 close）", async () => {
    /* 「攒到 `close` 再发」在秒级 stage 上完全看不出来，在分钟级 + 被 kill 的 stage 上
     * 代价是**整轮日志**（`ci-cp936-exit.mjs` 第六次上平台的形态）。这里用一个
     * 永不 `close` 的子进程把那个时刻造出来 —— 判据能看见的正是它。 */
    const chunks: string[] = [];
    /* 只发一块、**永不 close**：那正是「被平台按超时 kill 的 stage」那一刻。 */
    const fakeSpawn = makeFakeSpawn([], "第一块\n");
    void runWithShExit(["--", "长跑的命令"], {
      resolve: () => ({ command: "长跑的命令", args: [], resolved: true }),
      spawnProc: asSpawn(fakeSpawn),
      out: (s: string) => chunks.push(s),
    });
    /* 等的是**条件**而不是时间：`close` 永远不会来，日志却必须已经到。
     * 写 `setTimeout(20)` 是赌时间（§11.14 那一条硬闸当场拦下过这个写法）。 */
    await expect.poll(() => chunks.join("")).toContain("第一块");
  });

  it("本文件里**没有** CP936 那一半件（POSIX 上转码是把 UTF-8 变乱码）", () => {
    for (const banned of ["GetEncoding(936)", "[Console]::OutputEncoding"]) {
      expect(
        SOURCE,
        `\`ci-sh-exit.mjs\` 里出现了 ${banned} —— 那是 Windows 侧那半件，` +
          "在 POSIX 上它会把 UTF-8 转成乱码，两件事反着做",
      ).not.toContain(banned);
    }
  });

  it("判据入口是**同一份**解析口（不许自己写 POSIX 专有的解析）", () => {
    expect(SOURCE).toContain("resolveCommandInvocation");
    // 反面：自己拼一个「POSIX 上直接用名字起」。
    expect(SOURCE).not.toMatch(/spawn\(\s*command\s*,/);
  });

  it("清点：三条判据的常量都在、且互不相同", () => {
    expect(NOT_FOUND_EXIT).not.toBe(UNKNOWN_SIGNAL_EXIT);
  });
});
