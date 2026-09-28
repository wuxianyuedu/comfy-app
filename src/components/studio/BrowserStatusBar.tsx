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
import {
  schemaSyncNotice,
  useSchemaSyncStatus,
  type SchemaSyncNotice,
  type SchemaSyncStatus,
} from "./hooks/use-schema-sync-status";
import {
  comfyQueueNotice,
  useComfyQueue,
  type ComfyQueueView,
} from "./hooks/use-comfy-queue";
import { Hint } from "~/components/ui/hint";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "~/components/ui/popover";
import { fmtBytes } from "~/lib/format-bytes";
import { MAIN_TAB_ID, useShellTabs } from "~/lib/shell/shell-tabs-store";
import { StatusDot } from "~/components/ui/status-dot";
import { Button } from "~/components/ui/button";
import { displayValue } from "~/lib/display-value";
import { KeyValueRows } from "~/components/ui/key-value-rows";

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
  ok: "text-success-strong",
  warn: "text-warning-strong",
  bad: "text-destructive",
  unknown: "text-ink-muted",
};

const fpsDotColor: Record<string, string> = {
  ok: "bg-success shadow-[0_0_6px_var(--color-success)]",
  warn: "bg-warning shadow-[0_0_6px_var(--color-warning)]",
  bad: "bg-destructive shadow-[0_0_6px_var(--color-destructive)]",
  unknown: "bg-ink-fainter",
};

/**
 * 状态栏里的一项「标签 + 已用/总量 + 百分比」内联项。
 *
 * 三个资源项（显存 / 显存·ComfyUI / 内存）此前**各写一份逐字同形的三层
 * `<span>`** —— 差别只有标签文案与 title，`used/total (pct%)` 那段三份完全
 * 一致。行布局走 `KeyValueRows` 的 `inline`（P17），缺值占位走 `displayValue`
 * （P8）—— 两件事各只写一遍。
 */
function UsageItem({
  label,
  title,
  used,
  total,
  pct,
}: {
  label: string;
  title: string;
  used: number;
  total: number;
  pct: number;
}) {
  return (
    <KeyValueRows
      layout="inline"
      className="text-ink-soft hidden items-center gap-1 tabular-nums sm:flex"
      itemClassName="gap-1"
      keyClassName="text-ink-muted"
      valueClassName="text-ink-bright"
      items={[
        {
          key: label,
          title,
          value: (
            <>
              {displayValue(fmtBytes(used))}/{displayValue(fmtBytes(total))}
              <span className="text-ink-fainter"> ({pct}%)</span>
            </>
          ),
        },
      ]}
    />
  );
}

/**
 * 后台 schema 同步的提示格（数据源 `use-schema-sync-status`）。
 *
 * 为什么值得占一格：启动脚本把 Next 拉起来的**同时**在后台核对/同步库结构
 * （不阻塞启动），同步完成前业务请求可能 500。页面若不说「正在同步」，用户看到
 * 的就是一个报错页，无从判断该等一等还是该去查别的原因 —— 那正是「静默失败」
 * 最贵的形态。
 *
 * 说什么由 `schemaSyncNotice` 判（纯函数，见 hooks/use-schema-sync-status.ts），
 * 这里只把 tone 映射成颜色。
 */
const SCHEMA_TONE_CLASS: Record<SchemaSyncNotice["tone"], string> = {
  info: "text-ink-soft",
  ok: "text-success-strong",
  error: "text-destructive",
};

function SchemaSyncItem({ status }: { status: SchemaSyncStatus }) {
  const notice = schemaSyncNotice(status);
  if (notice === null) return null;

  const tone = SCHEMA_TONE_CLASS[notice.tone];
  if (notice.refreshable) {
    return (
      <Hint label={notice.title}>
        <Button
          variant="ghost"
          className={`h-auto shrink-0 gap-0 rounded px-1 py-0 text-[11px] hover:underline ${tone}`}
          onClick={() => window.location.reload()}
        >
          {notice.text}
        </Button>
      </Hint>
    );
  }
  return (
    <span className={`shrink-0 truncate ${tone}`} title={notice.title}>
      {notice.text}
    </span>
  );
}

/**
 * ComfyUI 排队 / 当前执行那一格（数据源 `use-comfy-queue`）。
 *
 * 说什么由 `comfyQueueNotice` 判（纯函数），这里只渲染。它回答的是用户盯着画布
 * 转圈时最想知道的四件事：前面还堵着几个、当前跑了多久、跑的是哪个工作流、哪个
 * 模型 —— 此前这些只散在日志面板里，**耗时更是完全没暴露过**（`startedAt` 只在
 * 任务结束时被算成一句文本日志）。
 */
function ComfyQueueItem({ view }: { view: ComfyQueueView }) {
  const notice = comfyQueueNotice(view);
  if (notice === null) return null;
  const detailLines = notice.title.split("\n");
  return (
    <Popover>
      <PopoverTrigger className="text-ink-soft hover:bg-subtle inline-flex max-w-[160px] cursor-pointer items-center gap-1 rounded px-1 py-0.5 tabular-nums">
        <span className="truncate">{notice.text}</span>
      </PopoverTrigger>
      <PopoverContent side="top" align="start" className="w-80 text-[12px]">
        <div className="flex flex-col gap-1">
          {detailLines.map((line, i) => (
            <span key={i} className="text-ink-soft leading-relaxed">
              {line}
            </span>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}

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
  const { cudaVram, smiVram, ram, degradedNote, stale } = useComfyReadiness();
  const devServer = useDevServerStatus();
  const schemaSync = useSchemaSyncStatus();
  const comfyQueue = useComfyQueue();
  // 非主应用页签（内嵌 ComfyUI 等 iframe 页签）时整体隐藏：状态栏是固定悬浮层，
  // 盖住窗口最底下 24px——iframe 页面自绘的底部控件（运行操作栏下缘、扩展面板）
  // 恰好落在这一条里，浏览器整窗打开时它们是完整可见的，页签里却被压住，形成
  // 「浏览器里看得见、应用里看不到」的适配差。主应用页签恢复显示。
  const activeTabId = useShellTabs((s) => s.activeTabId);

  const tone = fpsTone(fps);

  if (activeTabId !== MAIN_TAB_ID) return null;

  return (
    <div
      className="border-border bg-panel/95 text-ink-muted z-toast fixed right-0 bottom-0 left-0 flex h-6 items-center gap-3 border-t px-3 text-[11px] backdrop-blur-sm"
      aria-label="底部状态栏"
    >
      {/* ── 第 1 区：地址栏（固定宽度） ── */}
      <div className="flex w-[170px] shrink-0 items-center gap-1.5">
        <Lock size={11} className="text-success-strong shrink-0" />
        <span className="text-ink-fainter shrink-0">安全</span>
        <span
          className="text-ink-soft truncate"
          title={host ? `${host}${pathname}` : pathname}
        >
          {host ? `${host}${pathname}` : pathname}
        </span>
      </div>

      {/* ── 第 2 区：ComfyUI 排队/运行信息（弹性，左对齐） ── */}
      <div className="flex min-w-0 flex-1 items-center gap-2 overflow-hidden">
        <ComfyQueueItem view={comfyQueue} />
        <SchemaSyncItem status={schemaSync} />
      </div>

      {/* ── 第 3 区：显存 + 内存等资源指标（固定宽度） ── */}
      <div
        className={`flex w-[500px] shrink-0 items-center gap-2.5 transition-opacity ${
          stale ? "opacity-50" : "opacity-100"
        }`}
        title={stale ? "ComfyUI 指标暂时读不到，显示的是上一次数据" : undefined}
      >
        {/* 显存（nvidia-smi 物理专用显存口径） */}
        {smiVram && (
          <UsageItem
            label="显存"
            title="nvidia-smi 物理专用显存（与任务管理器「专用 GPU 内存」同口径）"
            used={smiVram.used}
            total={smiVram.total}
            pct={smiVram.pct}
          />
        )}

        {/* 显存（ComfyUI CUDA 逻辑口径） */}
        {cudaVram && (
          <UsageItem
            label="显存·ComfyUI"
            title="ComfyUI 上报的 CUDA 口径（显存剩余可用/总量，已用 = 总量 − 剩用）"
            used={cudaVram.used}
            total={cudaVram.total}
            pct={cudaVram.pct}
          />
        )}

        {/* 内存占用 */}
        {ram && (
          <UsageItem
            label="内存"
            title="系统内存占用"
            used={ram.used}
            total={ram.total}
            pct={ram.pct}
          />
        )}

        {/* 降级提示 */}
        {degradedNote && (
          <span
            className="text-warning-strong/90 hidden items-center gap-1 sm:flex"
            title={degradedNote}
          >
            {degradedNote}
          </span>
        )}
      </div>

      {/* ── 第 4 区：FPS + 消息中心 + 日志 + 应用服务状态（固定宽度，最右） ── */}
      <div className="flex w-[280px] shrink-0 items-center justify-end gap-2.5 whitespace-nowrap">
        {/* 实时帧率 */}
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

        <MessageCenterButton />

        {/* 纯图标按钮（只有图标与可选的错误计数徽标，没有可见文字）：按 ui/hint 的契约
            传 accessibleName，让提示文案同时成为 aria-label —— 否则读屏只报一颗匿名按钮。 */}
        <Hint
          label={`日志面板 (${isOpen ? "开" : "关"}) — Ctrl+Shift+L`}
          accessibleName
        >
          <Button
            variant="ghost"
            onClick={toggleOpen}
            className={`flex h-auto gap-1 rounded px-1.5 py-0.5 text-[11px] ${
              isOpen
                ? "bg-primary/20 text-primary-strong hover:bg-primary/25"
                : "text-ink-muted hover:bg-subtle hover:text-ink"
            }`}
          >
            <FileText data-icon="inline-start" size={12} />
            {counts.error > 0 && (
              <span className="bg-destructive/20 text-destructive rounded-full px-1 text-[10px]">
                {counts.error}
              </span>
            )}
          </Button>
        </Hint>

        <span
          className={`flex items-center gap-1 ${
            devServer.state === "online"
              ? "text-success-strong"
              : devServer.state === "starting"
                ? "text-ink-soft"
                : "text-destructive"
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
