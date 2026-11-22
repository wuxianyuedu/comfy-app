/**
 * custom-nodes 解析 / 探测的 Python 子进程管理（自 route.ts 拆出）：
 * 「按预算收集一次输出」（spawnCapture）与「流式子进程的看门狗 + 断开回收」
 * （createStreamChildGuard）都在这里，route.ts 只保留 ndjson 协议与编排。
 * 拆分原因有二：文件长度硬闸（route.ts 曾超 900 行）；这一层是纯 Node 进程
 * 管理，与流协议无关。
 */
import { type ChildProcess, spawn } from "node:child_process";
import { killProcessTree } from "~/lib/process/kill-process-tree";
import { withTimeoutResult } from "~/lib/with-timeout";

/**
 * spawnCapture 的预算：目录大时能到分钟级 —— 但再久也不能让请求挂到客户端超时，
 * 超时即放弃（resolve 成 null，调用方换下一个解释器 / 返回空列表）。
 */
export const DISCOVER_TIMEOUT_MS = 60_000;

/** 探测输出累积上限（对齐 #4339 的 cnb-cli 判据）：探测/解析只需要结构化
 * 结果，不需要全量输出——窗口内解释器行为异常狂刷输出时内存有界（#4380）。 */
const MAX_OUTPUT_CHARS = 256 * 1024;

/** 流式解析 / 探测子进程的看门狗预算：都是「扫整棵 custom_nodes 树」的重活，
 *  给足量级但必须有界（#4004：此前这两条 spawn 链没有任何超时，卡住即永久挂着）。 */
export const STREAM_CHILD_TIMEOUT_MS = 600_000;

/** 流式解析 / 探测子进程的看门狗 + 断开回收（#4004）。
 *
 *  超时或客户端断开（`req.signal` abort / 流被取消）任一触发，都按硬规则 3 杀整棵树，
 *  并回调 `onGiveUp` 收尾（发错误帧 + 关流）；解释器退避链会连起多个子进程，
 *  句柄用 `track` 逐个登记，正常收尾调 `settle` 拆表。 */
export function createStreamChildGuard(opts: {
  label: string;
  onGiveUp: (reason: string) => void;
  signal?: AbortSignal;
  timeoutMs?: number;
}): {
  killNow: (why: string) => void;
  settle: () => void;
  track: (cp: ChildProcess) => void;
} {
  const timeoutMs = opts.timeoutMs ?? STREAM_CHILD_TIMEOUT_MS;
  let current: ChildProcess | null = null;
  let settled = false;
  const giveUp = (why: string): void => {
    if (settled) {
      return;
    }
    settled = true;
    const pid = current?.pid;
    if (typeof pid === "number" && pid > 0) {
      /* 硬规则 3：回收走统一出口杀整棵树，不单杀。 */
      void killProcessTree({ pid, force: true }).catch(() => undefined);
    }
    opts.onGiveUp(why);
  };
  const timer = setTimeout(() => {
    giveUp(`${opts.label}超过 ${Math.round(timeoutMs / 1000)}s 未结束，已强制回收子进程`);
  }, timeoutMs);
  const onAbort = (): void => {
    giveUp(`${opts.label}因客户端断开被回收`);
  };
  opts.signal?.addEventListener("abort", onAbort, { once: true });
  return {
    killNow(why: string): void {
      giveUp(why);
    },
    settle(): void {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      opts.signal?.removeEventListener("abort", onAbort);
    },
    track(cp: ChildProcess): void {
      current = cp;
    },
  };
}

/** 异步跑一次解析器并收集 stdout。
 *
 *  **不用 `spawnSync`**：它是同步的，会把整个 Node 事件循环连同所有并发请求
 *  一起堵住 —— 而这一步正是本路由最慢的一段。启动失败 / 非零退出 / 超时一律
 *  resolve 成 `null`，由调用方决定换解释器还是放弃。 */
export function spawnCapture(
  command: string,
  args: Array<string>,
  opts: { timeoutMs?: number } = {},
): Promise<string | null> {
  let killChild: (() => void) | undefined;

  /* 起进程并收集 stdout：启动失败 / 非零退出 / 空输出都 resolve 成 null
   *（调用方据此换下一个解释器）。 */
  const collect = new Promise<string | null>((resolve) => {
    let child: ReturnType<typeof spawn>;
    try {
      child = spawn(command, args, { cwd: process.cwd(), env: process.env });
    } catch {
      // 解释器根本不存在
      resolve(null);
      return;
    }

    /* 超时由 `withTimeoutResult` 判：它赢下赛跑后经 `onTimeout` 把进程杀掉 ——
     * 否则放弃等待之后进程还在后台占着 CPU 扫目录。 */
    killChild = () => {
      /* 硬规则 3：回收走统一出口杀整棵树，不单杀（与同文件流式路径的
       * createStreamChildGuard 同口径，#4727）——解析器若再起孙进程也一并回收。 */
      const pid = child.pid;
      if (typeof pid === "number" && pid > 0) {
        void killProcessTree({ pid, force: true }).catch(() => undefined);
      } else {
        child.kill();
      }
    };

    let stdout = "";
    child.stdout?.setEncoding("utf8");
    child.stdout?.on("data", (chunk: string) => {
      // 超限即停累积（#4380）：超限后的输出不参与判读。
      if (stdout.length < MAX_OUTPUT_CHARS) {
        stdout += chunk;
      }
    });
    child.on("error", () => {
      resolve(null);
    });
    child.on("close", (code) => {
      resolve(code === 0 && stdout.length > 0 ? stdout : null);
    });
  });

  return withTimeoutResult(collect, opts.timeoutMs ?? DISCOVER_TIMEOUT_MS, null, {
    onTimeout: () => killChild?.(),
  });
}

/* 校验外部进程参数：拒绝 flag 形态（前缀 -）、空/超长、含 shell/元字符，
 * 防客户端把 `--out=...` 之类伪装成包名注入到 spawn argv。 */
export function safeSpawnArg(token: unknown): string | null {
  if (typeof token !== "string") {
    return null;
  }
  if (token.length === 0 || token.length > 8192) {
    return null;
  }
  if (token.startsWith("-")) {
    return null;
  }
  if (/[\0'"$;`&|<>(){}=]/.test(token)) {
    return null;
  }
  return token;
}
