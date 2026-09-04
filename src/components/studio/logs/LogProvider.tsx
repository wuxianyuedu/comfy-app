"use client";

import React, { useEffect, useRef } from "react";

import {
  type LogLevel,
  type LogStoreState,
  captureLocation,
  isNoisyFrameworkLog,
  isReactQueryLog,
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
        /* 观察者绝不能成为故障源：这里曾是全页面报错的放大器
         * （Console Error 截图）。originals[level] 在多重包装/
         * 热更新竞态下可能不是函数——直接调用会把日志调用变成 TypeError，
         * 把业务错误（如 workflow.list 查询失败）淹没掉。守卫后 fail-open：
         * 原生 console 不可用时至少日志仍进面板。 */
        const original = originals[level];
        if (typeof original === "function") {
          original(...args);
        }
        if (isReactQueryLog(args) || isNoisyFrameworkLog(args)) return;
        /* 同步捕获调用点与序列化参数：调用栈只在当前 tick 有效，而参数
         * 可能在日志入库前就被调用方改写。 */
        const location = captureLocation();
        const message = serialize(args);
        /* 延迟入库：React Flow 等第三方库会在 render 期间打日志（例如
         *  EdgeWrapper 校验 edge 时 console.warn）。同步调用 addEntry 会在
         *  渲染另一个组件的过程中更新 BrowserStatusBar / LogPanel，触发
         *  React 的 "Cannot update a component while rendering a different
         *  component" 报错。排到微任务，等本次渲染提交后再写入 store。
         *  微任务按入队顺序执行，日志先后顺序保持不变。 */
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

  // ── Load launcher log files: startup logs + ongoing dev-server output ──
  const offsetsRef = useRef({ dev: 0, launcher: 0 });
  useEffect(() => {
    if (typeof window === "undefined") return;
    let mounted = true;
    const POLL_MS = 2000;

    const pollSource = async (source: "dev" | "launcher") => {
      try {
        const offset = offsetsRef.current[source];
        const res = await fetch(
          `/api/logs/current?source=${source === "dev" ? "dev-launcher" : "launcher"}&offset=${offset}`,
        );
        if (!res.ok) return;
        const data = (await res.json()) as {
          content: string;
          size: number;
          offset: number;
        };
        if (!mounted || !data.content) return;

        // 文件被重置（新运行）时 offset 会回 0；此时丢弃旧 offset，完整重读
        if (data.offset === 0 && offsetsRef.current[source] > 0) {
          offsetsRef.current[source] = 0;
        }

        const entries = parseFileLogs(data.content);
        if (entries.length > 0) {
          appendFileLogs(entries);
        }
        offsetsRef.current[source] = data.size;
      } catch {
        // 开发服务器尚未就绪或日志文件不存在时静默忽略
      }
    };

    const poll = async () => {
      await pollSource("launcher");
      await pollSource("dev");
    };

    void poll();
    const id = setInterval(() => {
      void poll();
    }, POLL_MS);
    return () => {
      mounted = false;
      clearInterval(id);
    };
  }, [appendFileLogs]);

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
