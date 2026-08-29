"use client";

import { useEffect, useState } from "react";
import { FileText, Lock, TriangleAlert } from "lucide-react";
import { useLogPanel } from "./log-provider";

/* ── Tauri window bottom status bar ─────────────────────────
   Shows the current browser address (window.location.href) and
   a simple security indicator.  It listens to Next.js client-side
   navigation by wrapping history.pushState / replaceState, so the
   displayed URL updates on every route change without needing a
   full reload.
   
   Must be rendered inside <LogProvider> so the log toggle works.
*/

export interface BrowserStatusBarProps {
  /** Extra info shown on the right side, e.g. "就绪" */
  status?: string;
}

export function BrowserStatusBar({ status = "就绪" }: BrowserStatusBarProps) {
  const isOpen = useLogPanel((s) => s.isOpen);
  const toggleOpen = useLogPanel((s) => s.toggleOpen);
  const counts = useLogPanel((s) => s.counts);
  const [url, setUrl] = useState<string>("");
  const [secure, setSecure] = useState(true);

  useEffect(() => {
    const update = () => {
      const href = typeof window !== "undefined" ? window.location.href : "";
      setUrl(href);
      setSecure(href.startsWith("https://") || href.startsWith("http://localhost") || href.startsWith("http://127.0.0.1") || href.startsWith("tauri://"));
    };

    update();

    window.addEventListener("popstate", update);
    window.addEventListener("hashchange", update);

    const originalPushState = history.pushState.bind(history);
    const originalReplaceState = history.replaceState.bind(history);

    history.pushState = function (this: History, ...args: Parameters<typeof history.pushState>) {
      originalPushState.apply(this, args);
      update();
    };
    history.replaceState = function (this: History, ...args: Parameters<typeof history.replaceState>) {
      originalReplaceState.apply(this, args);
      update();
    };

    return () => {
      window.removeEventListener("popstate", update);
      window.removeEventListener("hashchange", update);
      history.pushState = originalPushState;
      history.replaceState = originalReplaceState;
    };
  }, []);

  const displayUrl = url.replace(/^https?:\/\//, "").replace(/^tauri:\/\//, "");

  return (
    <div
      className="fixed bottom-0 left-0 right-0 z-[100] flex h-6 items-center justify-between border-t border-white/6 bg-[#0c0c12]/95 px-3 text-[11px] text-gray-500 backdrop-blur-sm"
      aria-label="浏览器地址栏"
    >
      <div className="flex min-w-0 items-center gap-1.5">
        {secure ? (
          <Lock size={11} className="shrink-0 text-emerald-400" />
        ) : (
          <TriangleAlert size={11} className="shrink-0 text-amber-400" />
        )}
        <span className="shrink-0 text-gray-600">{secure ? "安全" : "不安全"}</span>
        <span className="truncate text-gray-400" title={url}>
          {displayUrl || url}
        </span>
      </div>

      <div className="flex shrink-0 items-center gap-2">
        <button
          type="button"
          onClick={toggleOpen}
          title={`日志面板 (${isOpen ? "开" : "关"}) — Ctrl+Shift+L`}
          className={`flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] transition-colors ${
            isOpen
              ? "bg-violet-500/20 text-violet-300"
              : "text-gray-500 hover:bg-white/5 hover:text-gray-300"
          }`}
        >
          <FileText size={12} />
          {counts.error > 0 && (
            <span className="rounded-full bg-rose-500/20 px-1 text-[10px] text-rose-300">
              {counts.error}
            </span>
          )}
        </button>
        <span className="hidden sm:inline">{status}</span>
        <span className="inline-block h-1.5 w-1.5 rounded-full bg-emerald-400" />
      </div>
    </div>
  );
}
