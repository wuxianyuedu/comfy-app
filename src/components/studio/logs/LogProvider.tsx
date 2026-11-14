"use client";

import React, { useCallback, useEffect, useRef } from "react";

import { useInterval } from "~/components/ui/use-interval";
import { useHotkey } from "~/components/ui/use-hotkey";
import { isRecord } from "~/lib/is-record";
import { fetchFileLogSlice } from "~/lib/log/log-file-client";
import { clampLogTime } from "~/lib/log/log-session-scope";
import { isDesktopShell } from "~/lib/shell/desktop-shell-client";

import {
  type LogLevel,
  type LogStoreState,
  captureLocation,
  isNextDevNoise,
  isNoisyFrameworkLog,
  isReactQueryLog,
  isRoutineRpcTimingLog,
  parseFileLogs,
  serialize,
  useLogStore,
} from "./log-store";

export type { LogEntry, LogFilter, LogLevel, LogOriginFilter } from "./log-store";

/**
 * 订阅日志 store 的指定字段（规范 07 §7.4：组件只订阅自己需要的字段，
 * 避免高频日志更新导致所有消费组件 re-render）。
 */
export function useLogPanel<T>(selector: (state: LogStoreState) => T): T {
  return useLogStore(selector);
}

/* ── 全局未捕获错误进面板（规范 07：操作出问题在日志里要能看到）──────────
 * window.onerror / unhandledrejection 此前没有任何钩子：页面级异常（如设置页 tRPC 拿到 HTML 报
 * "Unexpected token '<'"）只出现在 devtools，用户反馈时面板一片空白。这里统一捕获进面板
 * （source: "system"），与 console 拦截、Tauri 事件并列；监听器只调 addEntry，自身零副作用。 */

/** unknown 抛值 → 可读文本（Error 带堆栈；对象取 message；其余 JSON/String 兜底）。 */
export function describeGlobalError(reason: unknown): string {
  if (reason instanceof Error) {
    return `${reason.name}: ${reason.message}\n${reason.stack ?? ""}`;
  }
  if (typeof reason === "string") {
    return reason;
  }
  if (isRecord(reason) && "message" in reason && typeof reason.message === "string") {
    return reason.message;
  }
  try {
    return JSON.stringify(reason, null, 2) ?? String(reason);
  } catch {
    return String(reason);
  }
}

/** unhandledrejection 的 reason → 可读文本；字符串场景补一句说明（纯 reject("x") 无堆栈可查）。 */
export function describeUnhandledRejection(reason: unknown): string {
  if (typeof reason === "string") {
    return `${reason}（未提供错误对象，仅有此信息）`;
  }
  return describeGlobalError(reason);
}

/**
 * 面板轮询的日志来源与顺序。顺序即请求顺序，也决定同一批轮询的入库先后：`dev` / `launcher` 是启动链路（dev-launcher.log 及其 stderr）；`shell-launch` / `shell` 是壳侧启动链路（双击启动最早的现场只在这两份里）。
 * `app` 是应用服务自身输出（Next dev server 转录，首屏编译错误 / Turbopack FATAL / 未捕获的服务端异常，ISSUE #360）；`app-runtime` 是运行期业务操作。
 * 各行都带写入时刻，合并后由 `mergeTimeline` 按时刻排序，到达顺序不影响时间序（ISSUE #262）。 */
/* SAFETY: 类型断言已复核 */
const POLL_SOURCES = ["launcher", "shell-launch", "shell", "dev", "app", "app-runtime"] as const;
type PollSource = (typeof POLL_SOURCES)[number];

/** 轮询间隔：日志「实时感」与请求量的折中（对齐规范 07 §7.8 的增量轮询）。 */
const POLL_MS = 2000;
/** 面板关闭时的放宽间隔：无人看时间线，5s 足够（新数据仍会进缓冲与计数徽标）。 */
const POLL_IDLE_MS = 5000;

export function LogProvider({ children }: { children: React.ReactNode }) {
  const addEntry = useLogStore((s) => s.addEntry);
  const appendFileLogs = useLogStore((s) => s.appendFileLogs);
  const toggleOpen = useLogStore((s) => s.toggleOpen);
  const isOpen = useLogStore((s) => s.isOpen);

  // ── 拦截 console.*，好让日志出现在面板里 ──
  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    /* SAFETY: 类型断言已复核 */
    const originals = {
      log: console.log,
      info: console.info,
      warn: console.warn,
      error: console.error,
      debug: console.debug,
    } as const;

    const makeLogger =
      (level: LogLevel) =>
      (...args: Array<unknown>) => {
        /* 已识别的框架噪声（React Query / tRPC 往返日志等）不写日志面板。
         * 它们通常由库打到 console.error，即便被过滤也会触发 Next dev
         * overlay 的「Console Error」浮层（看似崩溃实为噪声），因此连带
         * 把输出级别降级为 debug——devtools 的 Verbose 仍可见，便于排查。 */
        if (
          isReactQueryLog(args) ||
          isRoutineRpcTimingLog(args) ||
          isNoisyFrameworkLog(args) ||
          isNextDevNoise(args)
        ) {
          originals.debug(...args);
          return;
        }
        const original = originals[level];
        if (typeof original === "function") {
          original(...args);
        }
        const location = captureLocation();
        const message = serialize(args);
        queueMicrotask(() => {
          addEntry({
            level,
            message,
            source: "console",
            location,
          });
        });
      };

    console.log = makeLogger("info");
    console.info = makeLogger("info");
    console.warn = makeLogger("warn");
    console.error = makeLogger("error");
    console.debug = makeLogger("debug");

    return () => {
      console.log = originals.log;
      console.info = originals.info;
      console.warn = originals.warn;
      console.error = originals.error;
      console.debug = originals.debug;
    };
  }, [addEntry]);

  // ── 监听 Tauri 后端日志事件（可选；浏览器里是空操作） ──
  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    let cancelled = false;
    let unlisten: (() => void) | undefined;

    const setup = async () => {
      try {
        const { listen } = await import("@tauri-apps/api/event");
        /* StrictMode 双挂载（ISSUE #3834）：第一次的 cleanup 跑在 `import()`
         * 完成之前，那时 `unlisten` 还没到手、`unlisten?.()` 是空操作 —— 第一条
         * 监听器就此泄漏、壳日志被处理两次。用 `cancelled` 标志让「清理先于
         * 注册完成」的那次订阅在到手后立刻退订。 */
        const off = await listen<{ level: string; message: string }>("log:emit", (event) => {
          const lv = event.payload?.level ?? "info";
          const message = event.payload?.message ?? "";
          if (!message) {
            return;
          }
          const level: LogLevel =
            lv === "error" ? "error" : lv === "warn" ? "warn" : lv === "debug" ? "debug" : "info";
          addEntry({ level, message, source: "tauri" });
        });
        if (cancelled) {
          off();
          return;
        }
        unlisten = off;
      } catch (error) {
        /* 不在 Tauri 里运行是**正常形态**（浏览器 / 纯 web），静默即可。但「在壳里却监听失败」不是正常
           形态：最常见是 CSP 的 connect-src 漏了 `ipc: http://ipc.localhost`（事件监听走 fetch 到 ipc://
           通道，invoke 走 postMessage 不受影响），表现为「命令能调通、壳日志却进不了面板」且控制台只有
           一条 CSP 报错。因此把失败**落进面板**，排查时不必再翻控制台。 */
        if (isDesktopShell()) {
          addEntry({
            level: "warn",
            message: `未能订阅壳日志（log:emit）：${String(error)}`,
            source: "system",
          });
        }
      }
    };

    void setup();
    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, [addEntry]);

  // ── 全局未捕获错误与未处理 rejection → 面板（来源："system"） ──
  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    const onError = (event: ErrorEvent) => {
      const message = describeGlobalError(event.error ?? event.message);
      addEntry({ level: "error", message, source: "system" });
    };
    const onRejection = (event: PromiseRejectionEvent) => {
      const message = describeUnhandledRejection(event.reason);
      addEntry({ level: "error", message, source: "system" });
    };

    window.addEventListener("error", onError);
    window.addEventListener("unhandledrejection", onRejection);
    return () => {
      window.removeEventListener("error", onError);
      window.removeEventListener("unhandledrejection", onRejection);
    };
  }, [addEntry]);

  // ── 加载启动器日志文件：启动日志 + 持续的 dev-server 输出 ──
  // 增量读取靠服务端回传的字节游标（`data.size`）。此前把「本轮新增」错当游标，而服务端在文件超出
  // 首屏窗口时会把 offset 归零并要求重读整文件，于是每轮都在重读整段、重复行反复入库（ISSUE #262）。
  // 现在 `offset` 是「本段在文件里的起点」，游标只推进到 `size`，回退重读由 mergeTimeline 去重兜底。
  // 面板只显示本次运行：`dev` 每次覆盖重建、`app-runtime` 追加不轮转，服务端带回会话起点、按行时刻裁掉。
  const offsetsRef = useRef<Partial<Record<PollSource, number>>>({
    dev: 0,
    launcher: 0,
    app: 0,
    "app-runtime": 0,
  });
  const setSessionStart = useLogStore((s) => s.setSessionStart);
  const setBootId = useLogStore((s) => s.setBootId);
  /* 上一轮看到的服务端进程标识：带上它再问，服务端才能在「换个进程回答」时
   * 回报真实重启（见 /api/logs/current 的 bootId/mismatch）。 */
  const bootIdRef = useRef<string>("");
  /* 拉不到日志 = 应用服务本身不可达（接口 5xx / 网络层失败）。这不是「本次
   * 运行没有日志」，而是「面板的数据源断了」——必须说出来，否则用户看到空白
   * 面板会以为「日志里什么也没有」，正是 ISSUE #360 里最难排查的那种空白。
   * 只在**状态翻转**时写一条（不刷屏），恢复后再翻转回正常。 */
  const unreachableRef = useRef(false);
  /* 背压闸：上一轮六路来源还没跑完时跳过这一拍。理由见本轮拉取处的说明
   * （一轮六路并行的突发会占满浏览器的同源连接预算）。`false` = 空闲。 */
  const roundBusyRef = useRef(false);
  /* 卸载守卫：`useInterval` 卸载即停间隔，但**已发出的那次请求仍可能回来**
   * 并在组件消失后 `setState` —— 所以 `mountedRef` 保留（规范 16 §16.2.4.15）。 */
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const poll = useCallback(async () => {
    if (typeof window === "undefined") {
      return;
    }

    const pollSource = async (source: PollSource) => {
      try {
        const offset = offsetsRef.current[source] ?? 0;
        const data = await fetchFileLogSlice(source, offset, bootIdRef.current);
        if (!data || !mountedRef.current) {
          return;
        }

        /* 服务端进程换过了（真重启 / 另一实例接管端口）：时间线里已有的行属于
         * 上一个进程，与本次会话没有可比性。清空时间线、重置全部游标，本轮从
         * 头读——否则两个进程的输出会混成一条线，用户看到的「重启后什么都没
         * 有」正是这种污染的另一种表现（ISSUE #360）。 */
        let forceReread = false;
        if (typeof data.bootId === "string" && data.bootId !== "") {
          if (bootIdRef.current !== "" && data.bootId !== bootIdRef.current) {
            forceReread = true;
            for (const key of POLL_SOURCES) {
              offsetsRef.current[key] = 0;
            }
          }
          bootIdRef.current = data.bootId;
          setBootId(data.bootId);
        }
        if (data.mismatch === true) {
          forceReread = true;
        }
        if (forceReread) {
          offsetsRef.current[source] = 0;
        }

        /* 裸文本行（读不到时间戳）按解析当时的时刻落板；钳到本地当前时刻，
         * 保证面板时间线不会被未来的时间戳顶穿。 */
        const entries = parseFileLogs(data.content).map((entry) => ({
          ...entry,
          time: clampLogTime(entry.time, Date.now()),
          origin: source,
        }));
        /* 时间线截断的判据要比首帧条目先就位，否则历史行会先落板再被清掉，
         * 用户能观察到一次闪现。 */
        if (typeof data.sessionStart === "number") {
          setSessionStart(data.sessionStart);
        }
        if (entries.length > 0) {
          appendFileLogs(entries);
        }
        /* 游标只能推进到服务端报告的文件末尾：`data.size` 是文件总字节数，
         * 下一轮从它之后继续读。`data.offset === 0`（服务端要求重读整文件）
         * 时同样落到 size，避免下一轮再从头读一遍。 */
        offsetsRef.current[source] = data.size;
        if (unreachableRef.current) {
          unreachableRef.current = false;
          addEntry({
            level: "info",
            message: `日志面板已恢复与「应用服务」的连接，继续接收 ${POLL_SOURCES.length} 路日志。`,
            source: "system",
          });
        }
      } catch {
        /* 网络层失败：应用服务不可达（还在编译 / 已退出 / 端口被别人占用）。
         * 只记一次，避免每 2s 轮询刷屏；恢复时上面再记一条。 */
        if (!unreachableRef.current) {
          unreachableRef.current = true;
          addEntry({
            level: "warn",
            message:
              "日志面板暂时读不到日志：应用服务（Next dev server）当前不可达。" +
              "常见原因：还在首屏编译、进程已退出、或端口被别的实例占用。" +
              "请先确认应用能正常打开；启动相关的日志见「启动器」来源与 log/current/launcher/。",
            source: "system",
          });
        }
      }
    };

    /* 六路来源**串行**拉取（此前 `Promise.all` 并行）。浏览器对同源 HTTP/1.1 只有 **6 条**连接预算，
     * 六路并行一轮就占满——叠加 server-id 探活、comfy 长轮询 / SSE、tRPC 与按需编译分块，网络栈当场
     * 报 `net::ERR_INSUFFICIENT_RESOURCES`（本机 3885 实测，连按需设置的 `import()` 都失败并触发整页刷新）。
     * 串行把「任何时刻至多 1 条在途日志请求」变成不变量，一轮耗时仍远小于 `POLL_MS`；单源 try/catch
     * 不中断整轮，`roundBusyRef` 另给背压闸（超间隔时跳过一拍，不再叠第二轮）。 */
    if (roundBusyRef.current) {
      return;
    }
    roundBusyRef.current = true;
    try {
      for (const source of POLL_SOURCES) {
        /* 卸载即停：剩下的来源不必再问（已发出的那一发由 pollSource 自查
         * `mountedRef`）。 */
        if (!mountedRef.current) {
          return;
        }
        // oxlint-disable-next-line no-await-in-loop -- 顺序依赖：后一步要用前一步的结果（既有串行路径）
        await pollSource(source);
      }
    } finally {
      roundBusyRef.current = false;
    }
  }, [addEntry, appendFileLogs, setSessionStart, setBootId]);

  /* 每 `POLL_MS` 拉一次；挂载即先拉一次（`immediate`），切后台暂停
   * （规范 16 §16.2.4.15）。面板关闭时放宽到 `POLL_IDLE_MS`，减少无人观察时
   * 的后台往返；`ms` 变化会让 useInterval 重挂并按当前可见性立即补跑一次。 */
  useInterval(poll, { ms: isOpen ? POLL_MS : POLL_IDLE_MS });

  /* 键盘快捷键：⌘/Ctrl+Shift+L —— 收在 `useHotkey` 里（`mod` 同时覆盖 ⌘ 与
   * Ctrl，此前只判 `ctrlKey`，macOS 上按 ⌘ 没有任何反应）。 */
  useHotkey({ key: "l", mod: true, shift: true }, toggleOpen);

  return <>{children}</>;
}
