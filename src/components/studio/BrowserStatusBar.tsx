"use client";

import React, { useEffect, useState } from "react";

/* ── Tauri window bottom status bar ─────────────────────────
   Shows the current browser address (window.location.href) and
   a simple security indicator.  It listens to Next.js client-side
   navigation by wrapping history.pushState / replaceState, so the
   displayed URL updates on every route change without needing a
   full reload.
*/

export interface BrowserStatusBarProps {
  /** Extra info shown on the right side, e.g. "就绪" */
  status?: string;
}

export function BrowserStatusBar({ status = "就绪" }: BrowserStatusBarProps) {
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

    const originalPushState = history.pushState;
    const originalReplaceState = history.replaceState;

    history.pushState = function (...args) {
      originalPushState.apply(this, args);
      update();
    };
    history.replaceState = function (...args) {
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
      className="fixed bottom-0 left-0 right-0 z-[100] flex h-6 items-center justify-between border-t border-white/[0.06] bg-[#0c0c12]/95 px-3 text-[11px] text-gray-500 backdrop-blur-sm"
      aria-label="浏览器地址栏"
    >
      <div className="flex min-w-0 items-center gap-1.5">
        {secure ? (
          <svg
            width="11"
            height="11"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            className="shrink-0 text-emerald-400"
          >
            <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
            <path d="M7 11V7a5 5 0 0110 0v4" />
          </svg>
        ) : (
          <svg
            width="11"
            height="11"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            className="shrink-0 text-amber-400"
          >
            <path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
            <line x1="12" y1="9" x2="12" y2="13" />
            <line x1="12" y1="17" x2="12.01" y2="17" />
          </svg>
        )}
        <span className="shrink-0 text-gray-600">{secure ? "安全" : "不安全"}</span>
        <span className="truncate text-gray-400" title={url}>
          {displayUrl || url}
        </span>
      </div>

      <div className="flex shrink-0 items-center gap-2">
        <span className="hidden sm:inline">{status}</span>
        <span className="inline-block h-1.5 w-1.5 rounded-full bg-emerald-400" />
      </div>
    </div>
  );
}
