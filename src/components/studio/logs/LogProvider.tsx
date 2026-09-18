"use client";

import React, { useEffect, useRef } from "react";

import { fetchFileLogSlice } from "~/lib/log/log-file-client";
import { clampLogTime } from "~/lib/log/log-session-scope";

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

export type {
  LogEntry,
  LogFilter,
  LogLevel,
  LogOriginFilter,
} from "./log-store";

/**
 * 订阅日志 store 的指定字段（规范 07 §7.4：组件只订阅自己需要的字段，
 * 避免高频日志更新导致所有消费组件 re-render）。
 */
export function useLogPanel<T>(selector: (state: LogStoreState) => T): T {
  return useLogStore(selector);
}

/* ── 全局未捕获错误进面板（规范 07：操作出问题在日志里要能看到）──────────
 * window.onerror / unhandledrejection 此前没有任何钩子：页面级异常
 * （如设置页 tRPC 拿到 HTML 报 "Unexpected token '<'"）只会出现在浏览器
 * devtools，用户反馈问题时日志面板一片空白。这里统一捕获进面板
 * （source: "system"），与既有 console 拦截、Tauri 事件两条来源并列。
 * 只序列化、不再调用 addEntry 外的 store 动作，保证监听器自身零副作用。 */

/** unknown 抛值 → 可读文本（Error 带堆栈；对象取 message；其余 JSON/String 兜底）。 */
export function describeGlobalError(reason: unknown): string {
  if (reason instanceof Error)
    return `${reason.name}: ${reason.message}\n${reason.stack ?? ""}`;
  if (typeof reason === "string") return reason;
  if (
    typeof reason === "object" &&
    reason !== null &&
    "message" in reason &&
    typeof (reason as { message?: unknown }).message === "string"
  ) {
    return (reason as { message: string }).message;
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
 * 面板轮询的日志来源与顺序。顺序即请求顺序，也决定同一批轮询的入库先后。
 *
 * - `dev` / `launcher`：启动链路（dev-launcher.log / start-tauri-launcher.log）；
 * - `app`：**应用服务自身输出**（Next dev server 的 stdout / stderr 转录，
 *   见 `src/lib/capture-streams.server.ts`）——首屏编译错误、Turbopack FATAL、
 *   未捕获的服务端异常都在这里，此前不在任何被轮询的文件里，导致「应用服务
 *   没起来」时面板一片空白（ISSUE #360）；
 * - `app-runtime`：应用运行期业务操作（见 src/lib/app-runtime-log.ts）。
 *
 * 四路的行都带写入时刻，合并后由 `mergeTimeline` 按时刻排序，因此到达顺序
 * 不影响面板的时间序（ISSUE #262）。
 */
const POLL_SOURCES = ["launcher", "dev", "app", "app-runtime"] as const;
type PollSource = (typeof POLL_SOURCES)[number];

/** 轮询间隔：日志「实时感」与请求量的折中（对齐规范 07 §7.8 的增量轮询）。 */
const POLL_MS = 2000;

export function LogProvider({ children }: { children: React.ReactNode }) {
  const addEntry = useLogStore((s) => s.addEntry);
  const appendFileLogs = useLogStore((s) => s.appendFileLogs);
  const toggleOpen = useLogStore((s) => s.toggleOpen);

  // ── 拦截 console.*，好让日志出现在面板里 ──
  useEffect(() => {
    if (typeof window === "undefined") return;

    const originals = {
      log: console.log,
      info: console.info,
      warn: console.warn,
      error: console.error,
      debug: console.debug,
    } as const;

    const makeLogger =
      (level: LogLevel) =>
      (...args: unknown[]) => {
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
    if (typeof window === "undefined") return;
    let unlisten: (() => void) | undefined;

    const setup = async () => {
      try {
        const { listen } = await import("@tauri-apps/api/event");
        unlisten = await listen<{ level: string; message: string }>(
          "log:emit",
          (event) => {
            const lv = event.payload?.level ?? "info";
            const message = event.payload?.message ?? "";
            if (!message) return;
            const level: LogLevel =
              lv === "error"
                ? "error"
                : lv === "warn"
                  ? "warn"
                  : lv === "debug"
                    ? "debug"
                    : "info";
            addEntry({ level, message, source: "tauri" });
          },
        );
      } catch {
        // 不在 Tauri 里运行 —— 忽略。
      }
    };

    void setup();
    return () => unlisten?.();
  }, [addEntry]);

  // ── 全局未捕获错误与未处理 rejection → 面板（来源："system"） ──
  useEffect(() => {
    if (typeof window === "undefined") return;

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
  //
  // 增量读取靠服务端回传的字节游标（`data.size`）。此前把「本轮新增」错当成
  // 游标（`offsetsRef.current[source] = data.size` 看似对，但服务端在文件超出
  // 首屏窗口时会把 offset 归零并要求重读整文件），于是每次轮询都在重读整段、
  // 重复行反复入库——面板看起来「一直在刷同一批内容」，2000 条的环形缓冲被
  // 重复行占满，真正的新内容反而进不来（ISSUE #262）。
  //
  // 现在服务端返回的 `offset` 就是「本段内容在文件里的起点」，游标只能推进到
  // `size`，并且**回退重读**由面板侧的去重（mergeTimeline）兜底：重复行不会
  // 被计入时间线，也不会挤掉真正的新日志。
  //
  // 面板只显示「本次运行」：`dev`（dev-launcher.log）每次启动被覆盖重建；
  // `app-runtime` 是追加不轮转的——上一次运行的行会随整段重读混进来。服务端在
  // 轮询响应里带回会话起点，这里用行时刻裁掉（log-store 的 dropStaleEntries）。
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
  useEffect(() => {
    if (typeof window === "undefined") return;
    let mounted = true;

    const pollSource = async (source: PollSource) => {
      try {
        const offset = offsetsRef.current[source] ?? 0;
        const data = await fetchFileLogSlice(source, offset, bootIdRef.current);
        if (!data || !mounted) return;

        /* 服务端进程换过了（真重启 / 另一实例接管端口）：时间线里已有的行属于
         * 上一个进程，与本次会话没有可比性。清空时间线、重置全部游标，本轮从
         * 头读——否则两个进程的输出会混成一条线，用户看到的「重启后什么都没
         * 有」正是这种污染的另一种表现（ISSUE #360）。 */
        let forceReread = false;
        if (typeof data.bootId === "string" && data.bootId !== "") {
          if (bootIdRef.current !== "" && data.bootId !== bootIdRef.current) {
            forceReread = true;
            for (const key of POLL_SOURCES) offsetsRef.current[key] = 0;
          }
          bootIdRef.current = data.bootId;
          setBootId(data.bootId);
        }
        if (data.mismatch) forceReread = true;
        if (forceReread) offsetsRef.current[source] = 0;

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
              "请先确认应用能正常打开；启动相关的日志见「启动器」来源与 log/launcher/。",
            source: "system",
          });
        }
      }
    };

    const poll = async () => {
      for (const source of POLL_SOURCES) {
        await pollSource(source);
      }
    };

    void poll();
    const id = setInterval(() => {
      void poll();
    }, POLL_MS);
    return () => {
      mounted = false;
      clearInterval(id);
    };
  }, [addEntry, appendFileLogs, setSessionStart, setBootId]);

  // ── 键盘快捷键：Ctrl+Shift+L ──
  useEffect(() => {
    if (typeof window === "undefined") return;
    const handler = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.shiftKey && e.key.toLowerCase() === "l") {
        e.preventDefault();
        toggleOpen();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [toggleOpen]);

  return <>{children}</>;
}
