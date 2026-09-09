"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { FileText, Lock } from "lucide-react";
import { useLogPanel } from "./logs/LogProvider";
import { MessageCenterButton } from "~/components/message-center/MessageCenterButton";
import { fpsTone, useFps } from "./hooks/use-fps";
import { useComfyStats } from "./hooks/use-comfy-stats";
import { useDevServerLiveness } from "./hooks/use-dev-server-liveness";
import { fmtBytes } from "~/lib/format-bytes";

/* ── Tauri window bottom status bar ─────────────────────────
   显示当前浏览器地址 + 系统资源（显存/内存）+ 实时帧率 + ComfyUI 连接状态。

   设计要点：
   1. 资源占用来自 ComfyUI `/system_stats`（服务端经 `/api/comfy/stats` 代理，
      客户端用 useComfyStats 轮询），离线时隐藏占用条、连接态显示「未连接」。
   2. FPS 由全局 useFps 提供，取代原先画布内的 FpsMeter 悬浮层——画布不再
      各自叠加一块，改由状态栏统一展示。
   3. 右下角原本写死的「就绪 + 绿点」含义不明（从不变化、无任何依据），
      现已改成由真实连接状态驱动的「已连接 / 未连接」指示。

   规范 08 §8.4 禁止 monkey-patch history——同步 setState 会在第三方库的
   useInsertionEffect 阶段触发报错。改用 Next.js usePathname()：路由变化
   自动 re-render，无需手动拦截。
   本应用始终运行于 localhost / tauri://，连接恒为安全，故不再维护不安全态。
   须渲染在 <LogProvider> 内部，日志开关才能工作。
*/

/** 用量百分比；total 非法时返回 null（离线/无数据则隐藏）。 */
function pct(used: number, total: number): number | null {
  if (!total || total <= 0 || used < 0) return null;
  return Math.min(100, Math.round((used / total) * 100));
}

/** HH:mm:ss（重启标记的时间展示）。 */
function fmtClock(t: number | null): string {
  if (t === null) return "—";
  return new Date(t).toLocaleTimeString("zh-CN", {
    hour12: false,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

const fpsTextColor: Record<string, string> = {
  ok: "text-emerald-300",
  warn: "text-amber-300",
  bad: "text-rose-300",
  unknown: "text-gray-500",
};

const fpsDotColor: Record<string, string> = {
  ok: "bg-emerald-400 shadow-[0_0_6px_rgba(52,211,153,0.8)]",
  warn: "bg-amber-400 shadow-[0_0_6px_rgba(251,191,36,0.8)]",
  bad: "bg-rose-400 shadow-[0_0_6px_rgba(251,113,133,0.8)]",
  unknown: "bg-gray-500",
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
  const { stats, online } = useComfyStats();
  const { restarting: serverRestarting, lastRestartAt } = useDevServerLiveness();

  const tone = fpsTone(fps);
  const vramPct = online
    ? pct(stats?.vramUsed ?? 0, stats?.vramTotal ?? 0)
    : null;
  // nvidia-smi 物理专用显存口径（对齐任务管理器），查询失败则为 null 隐藏
  const smiVramPct = online
    ? pct(stats?.smiVramUsed ?? 0, stats?.smiVramTotal ?? 0)
    : null;
  const ramPct = online ? pct(stats?.ramUsed ?? 0, stats?.ramTotal ?? 0) : null;

  return (
    <div
      className="fixed right-0 bottom-0 left-0 z-[10000] flex h-6 items-center justify-between gap-3 border-t border-white/6 bg-[#0c0c12]/95 px-3 text-[11px] text-gray-500 backdrop-blur-sm"
      aria-label="底部状态栏"
    >
      <div className="flex min-w-0 items-center gap-1.5">
        <Lock size={11} className="shrink-0 text-emerald-400" />
        <span className="shrink-0 text-gray-600">安全</span>
        <span
          className="truncate text-gray-400"
          title={host ? `${host}${pathname}` : pathname}
        >
          {host ? `${host}${pathname}` : pathname}
        </span>
      </div>

      <div className="flex shrink-0 items-center gap-2.5">
        {/* 实时帧率（原画布 FpsMeter 统一移入状态栏） */}
        <span
          className="hidden items-center gap-1 md:flex"
          title="画布实时帧率：≥50 流畅，30~49 轻微掉帧，<30 明显卡顿"
        >
          <span
            aria-hidden
            className={`inline-block h-1.5 w-1.5 rounded-full ${fpsDotColor[tone]}`}
          />
          <span className={`tabular-nums ${fpsTextColor[tone]}`}>
            {fps ?? "—"}
          </span>
          <span className="text-gray-400">FPS</span>
        </span>

        {/* 显存（nvidia-smi 物理专用显存口径，对齐任务管理器「专用 GPU 内存」）。
            用户反馈 ComfyUI 的 CUDA 口径有时不准确，故同时显示两种口径做对照。 */}
        {online && smiVramPct !== null && (
          <span
            className="hidden items-center gap-1 text-gray-400 tabular-nums sm:flex"
            title="nvidia-smi 物理专用显存（与任务管理器「专用 GPU 内存」同口径）"
          >
            <span className="text-gray-500">显存</span>
            <span className="text-gray-200">
              {fmtBytes(stats?.smiVramUsed ?? 0) ?? "—"}/{fmtBytes(stats?.smiVramTotal ?? 0) ?? "—"}
            </span>
            <span className="text-gray-600">({smiVramPct}%)</span>
          </span>
        )}

        {/* 显存（ComfyUI CUDA 逻辑口径）：vram_free 语义是「剩余可用」，
            已用 = 总量 − 剩用，与内存侧推导一致。 */}
        {online && vramPct !== null && (
          <span
            className="hidden items-center gap-1 text-gray-400 tabular-nums sm:flex"
            title="ComfyUI 上报的 CUDA 口径（显存剩余可用/总量，已用 = 总量 − 剩用）"
          >
            <span className="text-gray-500">显存·ComfyUI</span>
            <span className="text-gray-200">
              {fmtBytes(stats?.vramUsed ?? 0) ?? "—"}/{fmtBytes(stats?.vramTotal ?? 0) ?? "—"}
            </span>
            <span className="text-gray-600">({vramPct}%)</span>
          </span>
        )}

        {/* 内存占用：具体数值 + 百分比 */}
        {online && ramPct !== null && (
          <span
            className="hidden items-center gap-1 text-gray-400 tabular-nums sm:flex"
            title="系统内存占用"
          >
            <span className="text-gray-500">内存</span>
            <span className="text-gray-200">
              {fmtBytes(stats?.ramUsed) ?? "—"}/{fmtBytes(stats?.ramTotal) ?? "—"}
            </span>
            <span className="text-gray-600">({ramPct}%)</span>
          </span>
        )}

        {/* 消息中心：系统级提示（本地更新需重启等）的收件箱，未读有数量，点开全屏查看 */}
        <MessageCenterButton />

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

        {/* dev server 重启标记：仅当检测到**真正**重启（bootId 变化）才展示。
         *  重启瞬间高亮告警（进行中任务随进程丢失，恢复后需重新执行）；
         *  随后弱化展示最近一次真正重启时间。显示器关闭/瞬时断网等探测
         *  波动不被当成重启，不再误报。 */}
        {serverRestarting ? (
          <span
            className="flex items-center gap-1 text-amber-300"
            title={`dev server 于 ${fmtClock(lastRestartAt)} 重启，当时进行中的任务已丢失，请重新执行`}
          >
            <span
              aria-hidden
              className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-amber-400 shadow-[0_0_6px_rgba(251,191,36,0.8)]"
            />
            <span className="hidden sm:inline">后端已重启 · {fmtClock(lastRestartAt)}</span>
          </span>
        ) : lastRestartAt !== null ? (
          <span
            className="hidden items-center gap-1 text-gray-600 sm:flex"
            title={`dev server 最近一次重启于 ${fmtClock(lastRestartAt)}，当时进行中的任务已丢失`}
          >
            上次重启 {fmtClock(lastRestartAt)}
          </span>
        ) : null}

        {/* ComfyUI 连接状态（替代原写死的「就绪」） */}
        <span
          className={`flex items-center gap-1 ${
            online ? "text-emerald-300" : "text-gray-500"
          }`}
          title={
            online
              ? "ComfyUI 已连接，指标实时更新"
              : "ComfyUI 未运行，无法读取显存/内存"
          }
        >
          <span
            className={`inline-block h-1.5 w-1.5 rounded-full ${
              online
                ? "bg-emerald-400 shadow-[0_0_6px_rgba(52,211,153,0.8)]"
                : "bg-gray-500"
            }`}
          />
          <span className="hidden sm:inline">
            {online ? "已连接" : "未连接"}
          </span>
        </span>
      </div>
    </div>
  );
}
