"use client";

import { usePathname } from "next/navigation";
import { FileText, Lock } from "lucide-react";
import { useLogPanel } from "./logs/LogProvider";

/* ── Tauri window bottom status bar ─────────────────────────
   显示当前浏览器地址与安全标识。规范 08 §8.4 禁止 monkey-patch
   history（pushState / replaceState）——同步 setState 会在第三方库
   的 useInsertionEffect 阶段触发 "useInsertionEffect must not
   schedule updates"。改用 Next.js usePathname()：路由变化自动
   re-render，无需手动拦截。
   本应用始终运行于 localhost / tauri://，连接恒为安全，故不再维护
   不安全态。
   须渲染在 <LogProvider> 内部，日志开关才能工作。
*/

export interface BrowserStatusBarProps {
  /** Extra info shown on the right side, e.g. "就绪" */
  status?: string;
}

export function BrowserStatusBar({ status = "就绪" }: BrowserStatusBarProps) {
  const isOpen = useLogPanel((s) => s.isOpen);
  const toggleOpen = useLogPanel((s) => s.toggleOpen);
  const counts = useLogPanel((s) => s.counts);
  const pathname = usePathname();

  return (
    <div
      className="fixed bottom-0 left-0 right-0 z-[10000] flex h-6 items-center justify-between border-t border-white/6 bg-[#0c0c12]/95 px-3 text-[11px] text-gray-500 backdrop-blur-sm"
      aria-label="浏览器地址栏"
    >
      <div className="flex min-w-0 items-center gap-1.5">
        <Lock size={11} className="shrink-0 text-emerald-400" />
        <span className="shrink-0 text-gray-600">安全</span>
        <span className="truncate text-gray-400" title={pathname}>
          {pathname}
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
