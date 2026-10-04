// ── 应用内控制台的**执行面**（纯 Node 宿主：不加 server-only、不加 .server.ts）──
//
// 这个模块只做一件事：把一行已解析的 `file + args` 起成一个子进程，并把它的
// stdout / stderr / 退出码变成**有序的事件流**交给调用方（路由把它翻成 SSE）。
//
// ## §18.4 三选一：本模块走第三类（纯 Node 宿主），登记在
// `tests/lib-node-only-declarations.test.ts` 的 `PURE_NODE_HOSTS`。
//
// 为什么不加 `server-only`：它的消费方**只有** `/api/console/run` 这一条
// Next 路由，看起来像第一类 —— 但 `spawn` 的平台判据、进程组、回收语义全部
// 走 `~/lib/process/kill-process-tree`，而那个模块是第三类（由
// `scripts/reap-process.mjs` 在纯 Node 里动态加载）。把本模块标成 server-only
// 不会让 launch 链崩（它不引本模块），但会把「本模块与回收地基同族」这件事
// 说反；更实在的理由是**它必须能被单测直接喂真进程**（起 `node -e` 断言流、
// 断言退出码），而带 server-only 的模块在 vitest 里要靠 `vi.mock("server-only")`
// 才加载得动 —— 那正是 §18.4 判定反模式里点名过的那种「仪式化声明」。
//
// ## 硬规则 3：进程树
//
// 拉起一律 `spawn({ detached: POSIX })`（见下），回收一律交给
// `killProcessTree()` —— 本模块**不写任何** `taskkill` / `process.kill` /
// 平台判据。这不是形式：控制台会跑 `pnpm test`、`drizzle-kit studio` 这类
// **自身带子进程**的命令（pnpm 起 node、drizzle 起 esbuild），单杀 leader
// 的结果是端口与日志文件被孤儿占着，而用户看到的是「命令已经结束」。
//
// ## 只有一条命令在跑（单槽）
//
// 与 ComfyUI 执行链的 `MAX_CONCURRENCY = 1` 同一口气，理由更硬：仓库里的
// 预设命令大多会写同一批资源（`db:push` 写库、`test` 起 vitest 的 fork、
// `format:write` 改同一批文件）。两条同时跑不会更快，只会把「谁的失败算谁的」
// 变成一团乱麻。所以 `ConsoleRunner` 是**有状态的单槽**：忙时直接拒绝新命令
// （给出「哪条命令在跑、跑了多久」），而不是排队（排队会让用户以为点了没反应）。

import { spawn } from "node:child_process";

import { errorText } from "~/lib/error-message";
import { fireAndForget } from "~/lib/async-action";
import { killProcessTree } from "~/lib/process/kill-process-tree";
import { resolveCommandInvocation } from "~/lib/process/executable-resolve";
import { MAX_OUTPUT_CHARS } from "./console-limits";

/** 一条命令的执行事件（路由按顺序翻成 SSE 的 `data:` 行）。 */
export type ConsoleEvent =
  | {
      type: "start";
      runId: string;
      /** 回显的命令行（已规范化，可能与用户输入的空格不同）。 */
      command: string;
      /** 实际可执行文件与参数（排障时「到底跑的是谁」的唯一答案）。 */
      file: string;
      args: string[];
      /** 工作目录（项目根）。 */
      cwd: string;
      startedAt: number;
    }
  | { type: "out"; stream: "stdout" | "stderr"; text: string }
  | {
      type: "exit";
      code: number | null;
      signal: string | null;
      /** 是否被看门狗 / 用户主动取消掐掉（比 code 更能说明「为什么没跑完」）。 */
      killed: boolean;
      /** 被截断的说明；null = 输出完整。 */
      truncatedNote: string | null;
      durationMs: number;
    }
  | { type: "error"; message: string };

/** 一次执行的收尾事实（供运行日志与界面共用）。 */
export interface ConsoleRunResult {
  runId: string;
  command: string;
  exitCode: number | null;
  killed: boolean;
  durationMs: number;
}

export interface StartRunOptions {
  runId: string;
  command: string;
  file: string;
  args: string[];
  cwd: string;
  /** 看门狗上限（毫秒）。超时走 `killProcessTree` 掐整棵树。 */
  timeoutMs: number;
}

/** 控制台执行器的对外形状（单槽 + 取消）。 */
export interface ConsoleRunner {
  /** 当前是否有命令在跑；忙时回「是谁、跑了多久」（界面据此禁用输入）。 */
  busy: () => { runId: string; command: string; startedAt: number } | null;
  /** 起一条命令，逐事件推给 `onEvent`。返回收尾事实。 */
  run: (
    opts: StartRunOptions,
    onEvent: (event: ConsoleEvent) => void,
  ) => Promise<ConsoleRunResult>;
  /** 取消当前命令（杀整棵树）。没有在跑的命令时返回 false。 */
  cancel: () => Promise<boolean>;
}

/**
 * 「这条命令没起来」的**可读出口**（硬规则 4：失败路径要有人看得懂的那句话）。
 *
 * 分两种现场，因为用户要做的事不一样：
 *   · `resolved: false`（PATH 上查无此命令）—— 说清「找过 PATH 但没有」，
 *     并点名原始的可执行名（用户敲的 `pnpm` / `git`），再给出下一步；
 *     **不能**只把 `spawn pnpm ENOENT` 甩出去 —— 它看着像参数写错，实际是
 *     「这台机器上没这个命令」或「编辑器/壳的 PATH 里没有它」。
 *   · `resolved: true`（解析过、真的起不来）—— 把**绝对路径**也报出来，
 *     这才是排障要的那条信息（裸名字看不出起的是哪一份）。
 */
function startFailureMessage(
  file: string,
  invocation: { command: string; resolved: boolean },
  error: unknown,
): string {
  const detail = errorText(error, "无法启动命令", "命令执行失败");
  if (!invocation.resolved) {
    return (
      `找不到命令 ${file}（已在 PATH 上查找，没有可用形态）。` +
      `检查它是否已安装、以及这个应用进程的 PATH 是否包含它所在的目录。` +
      `（底层：${detail}）`
    );
  }
  return `无法启动 ${invocation.command}：${detail}`;
}

/**
 * 构造一个执行器。默认单槽 + 看门狗 + 输出上限。
 *
 * 刻意做成工厂（而不是模块级单例）：路由在 dev 热编译下会被多次加载，
 * 模块级单例会出现「旧实例的命令还占着槽、新实例看不见」——而**用户看到的
 * 是「没有命令在跑但点了没反应」**。单例挂在路由模块的 globalThis 上，
 * 由调用方决定生命周期（见 `/api/console/run` 的 `consoleRunner()`）。
 */
export function createConsoleRunner(): ConsoleRunner {
  let current: {
    runId: string;
    command: string;
    startedAt: number;
    child: ReturnType<typeof spawn>;
    /** 用户 / 看门狗是否已经判它「该死了」（用于 exit 事件里区分「失败」与「掐掉」）。 */
    killed: boolean;
  } | null = null;

  const busy = () =>
    current
      ? {
          runId: current.runId,
          command: current.command,
          startedAt: current.startedAt,
        }
      : null;

  async function run(
    opts: StartRunOptions,
    onEvent: (event: ConsoleEvent) => void,
  ): Promise<ConsoleRunResult> {
    const startedAt = Date.now();

    /* 起之前先问一次「这台机器上这个命令怎么起」（判据实现在
     * `~/lib/process/executable-resolve`，与启动编排同一份）—— **不解析就是
     * 那条 `spawn pnpm ENOENT`**（ISSUE #1327 的现场）：
     *   · Windows 上 Node 的 `spawn` 不认 PATHEXT，`pnpm` 在 PATH 上是
     *     `pnpm` / `pnpm.cmd` / `pnpm.ps1` 三个形态，裸名字一个都起不来；
     *   · 而 `pnpm.cmd` 又是 Node 起不了的（只有 cmd.exe 会解释批处理），
     *     真能起的是 `pnpm.ps1` 经 PowerShell —— 这层判据只在那一处。
     * PATH 上查无此命令时**不改写** `file`（`resolved: false`），仍交给 spawn
     * 报它那句 ENOENT，但我们把它翻成用户看得懂的一句话（见下面的 error 事件）。 */
    const invocation = resolveCommandInvocation(opts.file, opts.args);

    onEvent({
      type: "start",
      runId: opts.runId,
      command: opts.command,
      /* `file` / `args` 报**真正要起的那一份**：`.ps1` 形态时它是 PowerShell 宿主
       * 加 `-File` 参数，而不是用户敲的那个名字 —— 这是「到底跑的是谁」的唯一答案，
       * 排障时才能看出「为什么多了一层」。 */
      file: invocation.command,
      args: invocation.args,
      cwd: opts.cwd,
      startedAt,
    });

    let child: ReturnType<typeof spawn>;
    try {
      child = spawn(invocation.command, invocation.args, {
        cwd: opts.cwd,
        /* POSIX 自建进程组（硬规则 3 的前提）：`killProcessTree` 才能按 PGID
         * 把整组收走。Windows 上 `detached` 会另开控制台窗口，所以必须按平台
         * 取 —— 判据用 `process.platform` 而不是本模块自己发明一套。 */
        detached: process.platform !== "win32",
        windowsHide: true,
        stdio: ["ignore", "pipe", "pipe"],
        env: {
          ...process.env,
          /* 子进程也吃 UTF-8：中文 Windows 的 ANSI 代码页是 GBK，`tsc` /
           * `drizzle-kit` 的中文输出会先被编码成 GBK 再被我们按 utf-8 解 ——
           * 用户看到的是乱码，且看不出是编码问题（与 `executor-cli.ts` 给
           * Python 那两个变量同源的口径）。 */
          PYTHONIOENCODING: "utf-8",
          PYTHONUTF8: "1",
        },
      });
    } catch (e) {
      onEvent({
        type: "error",
        message: startFailureMessage(opts.file, invocation, e),
      });
      return {
        runId: opts.runId,
        command: opts.command,
        exitCode: null,
        killed: false,
        durationMs: Date.now() - startedAt,
      };
    }

    current = {
      runId: opts.runId,
      command: opts.command,
      startedAt,
      child,
      killed: false,
    };

    /* 输出累积到上限后停止转发，但**不掐进程**：命令自己跑完比看日志更重要
     * （`pnpm test` 的尾部才是结论）。上限只保护界面与日志不被打爆
     * （同「硬规则 4：日志要有上限」的口气）。 */
    let emitted = 0;
    let truncated = false;
    const forward =
      (stream: "stdout" | "stderr") => (chunk: Buffer | string) => {
        const text = String(chunk);
        if (truncated) return;
        const remaining = MAX_OUTPUT_CHARS - emitted;
        if (remaining <= 0) {
          truncated = true;
          onEvent({
            type: "out",
            stream: "stderr",
            text: `\n… 输出已达 ${MAX_OUTPUT_CHARS} 字符上限，后续内容不再转发（命令仍在运行，可在下方「完整输出」文件里看尾部）\n`,
          });
          return;
        }
        if (text.length > remaining) {
          onEvent({ type: "out", stream, text: text.slice(0, remaining) });
          emitted += remaining;
          truncated = true;
          /* 单个 chunk 就撞上限时必须补一句说明：否则用户看到的是「输出到一半
           * 戛然而止」，而 exit 帧那句 `truncatedNote` 只有界面读得懂字段名的人
           * 才看得见（硬规则 4：失败/降级路径要有**用户可见**的出口）。 */
          onEvent({
            type: "out",
            stream: "stderr",
            text: `\n… 输出已达 ${MAX_OUTPUT_CHARS} 字符上限，后续内容不再转发（命令仍在运行）\n`,
          });
          return;
        }
        emitted += text.length;
        onEvent({ type: "out", stream, text });
      };

    child.stdout?.on("data", forward("stdout"));
    child.stderr?.on("data", forward("stderr"));

    const guard = setTimeout(
      () => {
        if (current?.runId !== opts.runId) return;
        current.killed = true;
        onEvent({
          type: "out",
          stream: "stderr",
          text: `\n… 命令超过 ${Math.round(opts.timeoutMs / 1000)}s 上限，正在回收整棵进程树\n`,
        });
        fireAndForget(terminate(child), (e) => {
          /* 回收失败不改变「已经判它超时」这个事实，但必须留痕：孤儿进程会
           * 继续占着端口与日志文件，而用户以为命令已经结束（硬规则 3）。 */
          onEvent({
            type: "out",
            stream: "stderr",
            text: `\n… 回收超时命令的进程树失败：${errorText(e, "回收失败", "未知错误")}\n`,
          });
        });
      },
      Math.max(1000, opts.timeoutMs),
    );

    /* `spawn` 起不来（ENOENT 等）**不会**在调用处抛，而是异步发 `error` 事件
     * —— 必须在这里接住并转成 `error` 帧：否则用户看到的是一条「start 之后就
     * 没了下文」的空控制台，退出帧还会显示成一个没头没脑的 `code=null`
     * （硬规则 4：失败路径要有日志 + 用户可见出口）。 */
    const exit = await new Promise<{
      code: number | null;
      signal: NodeJS.Signals | null;
    }>((resolve) => {
      child.once("error", (e) => {
        onEvent({
          type: "error",
          message: startFailureMessage(opts.file, invocation, e),
        });
        resolve({ code: null, signal: null });
      });
      child.once("close", (code, signal) => resolve({ code, signal }));
    });
    clearTimeout(guard);
    const killed = current?.killed ?? false;
    current = null;

    const durationMs = Date.now() - startedAt;
    onEvent({
      type: "exit",
      code: exit.code,
      signal: exit.signal,
      killed,
      truncatedNote: truncated
        ? `输出超过 ${MAX_OUTPUT_CHARS} 字符已截断`
        : null,
      durationMs,
    });
    return {
      runId: opts.runId,
      command: opts.command,
      exitCode: exit.code,
      killed,
      durationMs,
    };
  }

  async function cancel(): Promise<boolean> {
    if (!current) return false;
    current.killed = true;
    const child = current.child;
    // 不在这里 `current = null`：`run()` 的 close 回调还要读 `killed` 才能把
    // 「掐掉」与「自己失败」分开——提前清掉会让用户看到 `exit 1` 而不知道是谁掐的。
    await terminate(child);
    return true;
  }

  return { busy, run, cancel };
}

/**
 * 回收一条命令的整棵树。
 *
 * 走 `killProcessTree`（硬规则 3 的唯一入口）而不是 `child.kill()`：控制台跑的
 * 是 `pnpm` / `drizzle-kit` 这类**自己还有子进程**的命令，单杀 leader 会把
 * vitest 的 fork、esbuild 的服务留在后台。
 *
 * `detached` 传 `process.platform !== "win32"`，与拉起时同一表达式：POSIX 上
 * 子进程是独立进程组（组长），`killProcessTree` 才能读 PGID 向组发信号。
 */
async function terminate(child: ReturnType<typeof spawn>): Promise<void> {
  const pid = child.pid;
  if (!pid) return;
  await killProcessTree({
    pid,
    detached: process.platform !== "win32",
    force: true,
  });
}
