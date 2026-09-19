"use client";

import { formatClock } from "~/lib/time-format";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { FileText, Lock } from "lucide-react";
import { useLogPanel } from "./logs/LogProvider";
import { MessageCenterButton } from "~/components/message-center/MessageCenterButton";
import { fpsTone, useFps } from "./hooks/use-fps";
import { useComfyReadiness } from "./hooks/use-comfy-readiness";
import { useDevServerStatus } from "./hooks/use-dev-server-status";
import { fmtBytes } from "~/lib/format-bytes";
import { MAIN_TAB_ID, useShellTabs } from "~/lib/shell/shell-tabs-store";
import { StatusDot } from "~/components/ui/status-dot";
import { Button } from "~/components/ui/button";
import { displayValue } from "~/lib/display-value";

/* ── Tauri 窗口底部状态栏 ─────────────────────────
   显示当前浏览器地址 + 系统资源（显存/内存）+ 实时帧率 + 应用服务状态。

   设计要点：
   1. 资源占用来自 ComfyUI `/system_stats`（服务端经 `/api/comfy/stats` 代理，
      客户端由 use-comfy-readiness（内含 useComfyStats 轮询）折叠成显隐谓词；
      离线时隐藏占用条并给出可见降级提示，不静默消失。
   2. FPS 由全局 useFps 提供，取代原先画布内的 FpsMeter 悬浮层——画布不再
      各自叠加一块，改由状态栏统一展示。
   3. 右侧那一格显示**应用服务（dev server）**状态，不再是 ComfyUI 的连接态。
      ComfyUI 是可选后端：没装 / 没开 / 没配路径时它一律「未连接」，而这一格
      读起来像「应用坏了」；反过来应用服务真挂了（页面白屏、查询全失败）时
      旧状态栏一个字也不说。「显存/内存不可用」本身就是 ComfyUI 没启动的表现，
      信息重复且误导，故改判据（详见 src/lib/dev-server-status.ts 的 Why 注释）。

   规范 08 §8.4 禁止 monkey-patch history——同步 setState 会在第三方库的
   useInsertionEffect 阶段触发报错。改用 Next.js usePathname()：路由变化
   自动 re-render，无需手动拦截。
   本应用始终运行于 localhost / tauri://，连接恒为安全，故不再维护不安全态。
   须渲染在 <LogProvider> 内部，日志开关才能工作。
*/

/** HH:mm:ss（重启标记的时间展示）。`null` 由 `displayValue` 统一给占位符。 */
function fmtClock(t: number | null): string {
  return t === null ? displayValue(null) : formatClock(t, {});
}

const fpsTextColor: Record<string, string> = {
  ok: "text-emerald-600 dark:text-emerald-300",
  warn: "text-amber-600 dark:text-amber-300",
  bad: "text-rose-600 dark:text-rose-300",
  unknown: "text-ink-muted",
};

const fpsDotColor: Record<string, string> = {
  ok: "bg-emerald-400 shadow-[0_0_6px_rgba(52,211,153,0.8)]",
  warn: "bg-amber-400 shadow-[0_0_6px_rgba(251,191,36,0.8)]",
  bad: "bg-rose-400 shadow-[0_0_6px_rgba(251,113,133,0.8)]",
  unknown: "bg-ink-fainter",
};

export function BrowserStatusBar() {
  const isOpen = useLogPanel((s) => s.isOpen);
  const toggleOpen = useLogPanel((s) => s.toggleOpen);
  const counts = useLogPanel((s) => s.counts);
  const pathname = usePathname();
  /* 当前页面的地址+端口（如 localhost:3100）。读取 window.location 属纯客户端
   * 环境信息，非网络/业务 IO，视图层可直接取；SSR 阶段 window 不可用，故首帧
   * host 为空、仅显示 pathname（与旧行为一致），客户端填充后补全完整地址。
   * 用 setTimeout 延迟到 render 提交后 setState，规避 react-hooks/set-state-in-effect。 */
  const [host, setHost] = useState("");
  useEffect(() => {
    const t = setTimeout(() => setHost(window.location.host), 0);
    return () => clearTimeout(t);
  }, []);

  const fps = useFps();
  const { cudaVram, smiVram, ram, degradedNote } = useComfyReadiness();
  const devServer = useDevServerStatus();
  // 非主应用页签（内嵌 ComfyUI 等 iframe 页签）时整体隐藏：状态栏是固定悬浮层，
  // 盖住窗口最底下 24px——iframe 页面自绘的底部控件（运行操作栏下缘、扩展面板）
  // 恰好落在这一条里，浏览器整窗打开时它们是完整可见的，页签里却被压住，形成
  // 「浏览器里看得见、应用里看不到」的适配差。主应用页签恢复显示。
  const activeTabId = useShellTabs((s) => s.activeTabId);

  const tone = fpsTone(fps);

  if (activeTabId !== MAIN_TAB_ID) return null;

  return (
    <div
      className="border-border bg-panel/95 text-ink-muted z-toast fixed right-0 bottom-0 left-0 flex h-6 items-center justify-between gap-3 border-t px-3 text-[11px] backdrop-blur-sm"
      aria-label="底部状态栏"
    >
      <div className="flex min-w-0 items-center gap-1.5">
        <Lock
          size={11}
          className="shrink-0 text-emerald-600 dark:text-emerald-400"
        />
        <span className="text-ink-fainter shrink-0">安全</span>
        <span
          className="text-ink-soft truncate"
          title={host ? `${host}${pathname}` : pathname}
        >
          {host ? `${host}${pathname}` : pathname}
        </span>
      </div>

      <div className="flex shrink-0 items-center gap-2.5">
        {/* 实时帧率：画布 FpsMeter 悬浮层已移除，全应用仅此一处（FPS 归属见
            BrowserStatusBar 文件头设计要点 2）。 */}
        <span
          className="hidden items-center gap-1 md:flex"
          title="全应用实时帧率：≥50 流畅，30~49 轻微掉帧，<30 明显卡顿"
        >
          <span
            aria-hidden
            className={`inline-block h-1.5 w-1.5 rounded-full ${fpsDotColor[tone]}`}
          />
          <span className={`tabular-nums ${fpsTextColor[tone]}`}>
            {displayValue(fps)}
          </span>
          <span className="text-ink-soft">FPS</span>
        </span>

        {/* 显存（nvidia-smi 物理专用显存口径，对齐任务管理器「专用 GPU 内存」）。
            用户反馈 ComfyUI 的 CUDA 口径有时不准确，故同时显示两种口径做对照。
            非 NVIDIA 卡 / nvidia-smi 查询失败 → smiVram 为 null，整项隐藏（不留空项）。 */}
        {smiVram && (
          <span
            className="text-ink-soft hidden items-center gap-1 tabular-nums sm:flex"
            title="nvidia-smi 物理专用显存（与任务管理器「专用 GPU 内存」同口径）"
          >
            <span className="text-ink-muted">显存</span>
            <span className="text-ink-bright">
              {displayValue(fmtBytes(smiVram.used))}/
              {displayValue(fmtBytes(smiVram.total))}
            </span>
            <span className="text-ink-fainter">({smiVram.pct}%)</span>
          </span>
        )}

        {/* 显存（ComfyUI CUDA 逻辑口径）：vram_free 语义是「剩余可用」，
            已用 = 总量 − 剩用，与内存侧推导一致。非 NVIDIA 卡上这是唯一口径。 */}
        {cudaVram && (
          <span
            className="text-ink-soft hidden items-center gap-1 tabular-nums sm:flex"
            title="ComfyUI 上报的 CUDA 口径（显存剩余可用/总量，已用 = 总量 − 剩用）"
          >
            <span className="text-ink-muted">显存·ComfyUI</span>
            <span className="text-ink-bright">
              {displayValue(fmtBytes(cudaVram.used))}/
              {displayValue(fmtBytes(cudaVram.total))}
            </span>
            <span className="text-ink-fainter">({cudaVram.pct}%)</span>
          </span>
        )}

        {/* 内存占用：具体数值 + 百分比 */}
        {ram && (
          <span
            className="text-ink-soft hidden items-center gap-1 tabular-nums sm:flex"
            title="系统内存占用"
          >
            <span className="text-ink-muted">内存</span>
            <span className="text-ink-bright">
              {displayValue(fmtBytes(ram.used))}/
              {displayValue(fmtBytes(ram.total))}
            </span>
            <span className="text-ink-fainter">({ram.pct}%)</span>
          </span>
        )}

        {/* 降级提示：离线/轮询失败时占用条不再显示，这里给出可见出口，
            说明「看不到数据」的原因，而不是让两项静默消失。 */}
        {degradedNote && (
          <span
            className="hidden items-center gap-1 text-amber-600/90 sm:flex dark:text-amber-300/80"
            title={degradedNote}
          >
            {degradedNote}
          </span>
        )}

        {/* 消息中心：系统级提示（本地更新需重启等）的收件箱，未读有数量，点开全屏查看 */}
        <MessageCenterButton />

        <Button
          variant="ghost"
          onClick={toggleOpen}
          title={`日志面板 (${isOpen ? "开" : "关"}) — Ctrl+Shift+L`}
          className={`flex h-auto gap-1 rounded px-1.5 py-0.5 text-[11px] ${
            isOpen
              ? "bg-primary/20 text-primary-strong hover:bg-primary/25"
              : "text-ink-muted hover:bg-subtle hover:text-ink"
          }`}
        >
          <FileText size={12} />
          {counts.error > 0 && (
            <span className="rounded-full bg-rose-500/20 px-1 text-[10px] text-rose-600 dark:text-rose-300">
              {counts.error}
            </span>
          )}
        </Button>

        {/* 应用服务（dev server）状态：这一格回答「应用服务此刻能不能应答」，
         *  与 ComfyUI 是否运行无关（判据见 ~/lib/dev-server-status）。
         *  重启后的「任务已丢失」提示不另占一格，并进这条的文案里，
         *  避免状态栏为同一件事叠两处标记。 */}
        <span
          className={`flex items-center gap-1 ${
            devServer.state === "online"
              ? "text-emerald-600 dark:text-emerald-300"
              : devServer.state === "starting"
                ? "text-ink-soft"
                : "text-rose-600 dark:text-rose-300"
          }`}
          title={devServer.title}
          aria-label={devServer.label}
          data-dev-server={devServer.state}
        >
          <StatusDot
            state={
              devServer.state === "online"
                ? "up"
                : devServer.state === "starting"
                  ? "busy"
                  : "down"
            }
            sizeClass="size-1.5"
            pulse={devServer.state === "starting"}
            /* 这格是状态栏里的**实时状态灯**：与设置页的状态行不同，它沿用
               原来的发光描边，好在深色状态栏上仍然显眼。 */
            className={
              devServer.state === "online"
                ? "shadow-[0_0_6px_rgba(52,211,153,0.8)]"
                : devServer.state === "starting"
                  ? "bg-ink-fainter"
                  : "shadow-[0_0_6px_rgba(251,113,133,0.8)]"
            }
          />
          <span className="hidden sm:inline">{devServer.label}</span>
          {devServer.lastRestartAt !== null && devServer.state === "online" && (
            <span className="text-ink-muted hidden lg:inline">
              · {fmtClock(devServer.lastRestartAt)}
            </span>
          )}
        </span>
      </div>
    </div>
  );
}
