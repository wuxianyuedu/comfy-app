"use client";

import React, { useEffect, useRef } from "react";

import { fetchFileLogSlice } from "@/lib/log-file-client";
import { clampLogTime } from "@/lib/log-session-scope";

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

export type { LogEntry, LogFilter, LogLevel } from "./log-store";

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
  if (reason instanceof Error) return `${reason.name}: ${reason.message}\n${reason.stack ?? ""}`;
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

export function LogProvider({ children }: { children: React.ReactNode }) {
  const addEntry = useLogStore((s) => s.addEntry);
  const appendFileLogs = useLogStore((s) => s.appendFileLogs);
  const toggleOpen = useLogStore((s) => s.toggleOpen);

  // ── Intercept console.* so logs appear in the panel ──
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

  // ── Listen to Tauri backend log events (optional; no-op in browser) ──
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
        // Not running inside Tauri — ignore.
      }
    };

    void setup();
    return () => unlisten?.();
  }, [addEntry]);

  // ── Global uncaught errors & unhandled rejections → panel (source: "system") ──
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

  // ── Load launcher log files: startup logs + ongoing dev-server output ──
  // 轮询来源：launcher（启动链路）、dev（dev-launcher 实时输出）、
  // app-runtime（应用运行期业务操作日志，见 src/lib/app-runtime-log.ts）。
  //
  // 面板只显示「本次运行」：三个来源里只有 dev（dev-launcher.log）每次启动被
  // 覆盖重建，app-runtime 是追加不轮转的——上一次、上上一次运行的行会随首帧
  // 的整文件重读混进来。服务端在轮询响应里带回会话起点，这里用行时刻裁掉
  // （见 log-store 的 dropStaleEntries 与 src/lib/log-session-scope.ts）。
  const offsetsRef = useRef<Partial<Record<"dev" | "launcher" | "app-runtime", number>>>({
    dev: 0,
    launcher: 0,
    "app-runtime": 0,
  });
  const setSessionStart = useLogStore((s) => s.setSessionStart);
  useEffect(() => {
    if (typeof window === "undefined") return;
    let mounted = true;
    const POLL_MS = 2000;

    const sources = ["launcher", "dev", "app-runtime"] as const;
    const pollSource = async (source: (typeof sources)[number]) => {
      try {
        const offset = offsetsRef.current[source] ?? 0;
        const data = await fetchFileLogSlice(source, offset);
        if (!data || !mounted) return;

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

        // 文件被重置（新运行）时 offset 会回 0；此时丢弃旧 offset，完整重读
        if (data.offset === 0 && (offsetsRef.current[source] ?? 0) > 0) {
          offsetsRef.current[source] = 0;
        }
        offsetsRef.current[source] = data.size;
      } catch {
        // 开发服务器尚未就绪或日志文件不存在时静默忽略
      }
    };

    const poll = async () => {
      for (const source of sources) {
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
  }, [appendFileLogs, setSessionStart]);

  // ── Keyboard shortcut: Ctrl+Shift+L ──
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
