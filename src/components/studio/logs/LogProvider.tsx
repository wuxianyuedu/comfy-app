"use client";

import React, { useEffect, useRef } from "react";

import { fetchFileLogSlice } from "@/lib/log-file-client";

import {
  type LogLevel,
  type LogStoreState,
  captureLocation,
  isNextDevNoise,
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
        /* 已识别的框架噪声（React Query / tRPC 往返日志等）不写日志面板。
         * 它们通常由库打到 console.error，即便被过滤也会触发 Next dev
         * overlay 的「Console Error」浮层（看似崩溃实为噪声），因此连带
         * 把输出级别降级为 debug——devtools 的 Verbose 仍可见，便于排查。 */
        if (
          isReactQueryLog(args) ||
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

  // ── Load launcher log files: startup logs + ongoing dev-server output ──
  const offsetsRef = useRef({ dev: 0, launcher: 0 });
  useEffect(() => {
    if (typeof window === "undefined") return;
    let mounted = true;
    const POLL_MS = 2000;

    const pollSource = async (source: "dev" | "launcher") => {
      try {
        const offset = offsetsRef.current[source];
        const data = await fetchFileLogSlice(
          source === "dev" ? "dev" : "launcher",
          offset,
        );
        if (!data || !mounted || !data.content) return;

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
