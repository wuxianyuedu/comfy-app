"use client";

import { formatClock } from "~/lib/time-format";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { FileText, Lock } from "lucide-react";
import { useLogPanel } from "./logs/LogProvider";
import { MessageCenterButton } from "~/components/message-center/MessageCenterButton";
import { useAppServiceMessageLog } from "~/components/message-center/hooks/use-app-service-message-log";
import { fpsTone, useFps } from "./hooks/use-fps";
import { useComfyReadiness } from "./hooks/use-comfy-readiness";
import { STALE_RESOURCE_NOTE, selectVisibleResourceMetrics } from "./comfy-resource-metrics";
import { useDevServerStatus } from "./hooks/use-dev-server-status";
import type { AppServiceExitNotice } from "~/lib/shell/app-service-exit";
import {
  schemaSyncNotice,
  useSchemaSyncStatus,
  type SchemaSyncNotice,
  type SchemaSyncStatus,
} from "./hooks/use-schema-sync-status";
import { useSchemaSyncPush } from "./hooks/use-schema-sync-push";
import { ConfirmDialog } from "~/components/ui/confirm-dialog";
import { comfyQueueNotice, useComfyQueue, type ComfyQueueView } from "./hooks/use-comfy-queue";
import { Hint } from "~/components/ui/hint";
import { Popover, PopoverContent, PopoverTrigger } from "~/components/ui/popover";
import { fmtBytes } from "~/lib/format-bytes";
import { MAIN_TAB_ID, useShellTabs } from "~/lib/shell/shell-tabs-store";
import { StatusDot } from "~/components/ui/status-dot";
import { Button } from "~/components/ui/button";
import { displayValue } from "~/lib/display-value";
import { KeyValueRows } from "~/components/ui/key-value-rows";

/* ── Tauri 窗口底部状态栏：地址 + 系统资源（显存/内存）+ 帧率 + 应用服务状态 ──
   资源来自 ComfyUI `/system_stats`（经 `/api/comfy/stats` 代理）；右侧那格判**应用服务
   （dev server）**而非 ComfyUI 连接态 —— ComfyUI 是可选后端，未装/未开一律「未连接」，
   读起来像应用坏了。路由变化不 monkey-patch history（08 §8.4：同步 setState 会在
   useInsertionEffect 阶段报错），改读 `usePathname()`；须渲染在 `<LogProvider>` 内。 */

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

/* 状态点的光晕：色相走 `--color-glow-*`（两态，理由与对比读数写在 globals.css 那一段），
 * 强度与同栏的 devServer 点取同一个 80%。此前这三是基准色 α=1 的实心光晕，而隔壁
 * devServer 那点已经是浅彩档 —— 同一栏里两个同尺寸、同语义的点用两套配方。 */
const fpsDotColor: Record<string, string> = {
  ok: "bg-success shadow-[0_0_6px_color-mix(in_srgb,var(--color-glow-success)_80%,transparent)]",
  warn: "bg-warning shadow-[0_0_6px_color-mix(in_srgb,var(--color-glow-warning)_80%,transparent)]",
  bad: "bg-destructive shadow-[0_0_6px_color-mix(in_srgb,var(--color-glow-danger)_80%,transparent)]",
  unknown: "bg-ink-fainter",
};

/**
 * 状态栏里的一项「标签 + 已用/总量 + 百分比」内联项。
 * 三个资源项（显存 / 显存·ComfyUI / 内存）此前各写一份逐字同形的三层 `<span>`，差别只有
 * 标签与 title；行布局统一走 `KeyValueRows` 的 `inline`（P17）、缺值占位走 `displayValue`（P8）。
 */
function UsageItem({
  label,
  title,
  used,
  total,
  pct,
}: {
  label: string;
  pct: number;
  title: string;
  total: number;
  used: number;
}) {
  return (
    <KeyValueRows
      className="text-ink-soft hidden items-center gap-1 tabular-nums sm:flex"
      itemClassName="gap-1"
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
      keyClassName="text-ink-muted"
      layout="inline"
      valueClassName="text-ink-bright"
    />
  );
}

/**
 * 后台 schema 同步的提示格：启动脚本拉起 Next 的同时后台同步库结构（不阻塞启动），完成前
 * 业务请求可能 500 —— 不说「正在同步」，用户只看到一个报错页，无从判断该等还是该查。
 * 文案由 `schemaSyncNotice` 纯函数判定，这里只把 tone 映射成颜色。
 */
const SCHEMA_TONE_CLASS: Record<SchemaSyncNotice["tone"], string> = {
  info: "text-ink-soft",
  ok: "text-success-strong",
  error: "text-destructive",
};

function SchemaSyncItem({ status }: { status: SchemaSyncStatus }) {
  const notice = schemaSyncNotice(status);
  const { push, pushing } = useSchemaSyncPush();
  const [confirming, setConfirming] = useState(false);
  if (notice === null) {
    return null;
  }

  const tone = SCHEMA_TONE_CLASS[notice.tone];
  if (notice.refreshable) {
    return (
      <Hint label={notice.title}>
        <Button
          className={`text-2xs h-auto shrink-0 gap-0 rounded px-1 py-0 hover:underline ${tone}`}
          onClick={() => {
            window.location.reload();
          }}
          variant="ghost"
        >
          {notice.text}
        </Button>
      </Hint>
    );
  }
  if (notice.actionable) {
    return (
      <>
        <Hint label={notice.title}>
          <Button
            className={`text-2xs h-auto shrink-0 gap-1 rounded px-1 py-0 hover:underline ${tone}`}
            disabled={pushing}
            onClick={() => {
              setConfirming(true);
            }}
            variant="ghost"
          >
            {notice.text}
            <span className="text-ink-fainter">· 点击同步</span>
          </Button>
        </Hint>
        <ConfirmDialog
          confirmLabel="同步"
          danger
          description={`${notice.title}\n\n这批变更含「会丢数据」的语句（删列 / 重建表），执行后那些数据无法找回。确认这些数据可以丢弃后再继续。`}
          onClose={() => {
            setConfirming(false);
          }}
          onConfirm={() => {
            setConfirming(false);
            void push();
          }}
          open={confirming}
          pending={pushing}
          title="立即执行数据库同步？"
        />
      </>
    );
  }
  return (
    <span className={`shrink-0 truncate ${tone}`} title={notice.title}>
      {notice.text}
    </span>
  );
}

/**
 * ComfyUI 排队 / 当前执行那一格（数据源 `use-comfy-queue`）：文案由 `comfyQueueNotice`
 * 纯函数判定。用户盯着画布转圈时最想知道的四件事 —— 前面堵着几个、当前跑了多久、跑的
 * 哪个工作流与模型 —— 此前只散在日志面板里，耗时更是从未暴露。
 */
function ComfyQueueItem({ view }: { view: ComfyQueueView }) {
  const notice = comfyQueueNotice(view);
  if (notice === null) {
    return null;
  }
  const detailLines = notice.title.split("\n");
  return (
    <Popover>
      <PopoverTrigger className="text-ink-soft hover:bg-subtle inline-flex max-w-40 cursor-pointer items-center gap-1 rounded px-1 py-0.5 tabular-nums">
        <span className="truncate">{notice.text}</span>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-80 text-xs" side="top">
        <div className="flex flex-col gap-1">
          {detailLines.map((line, i) => (
            <span className="text-ink-soft leading-relaxed" key={i}>
              {line}
            </span>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}

/**
 * 「应用服务上一次为什么结束」那一格（`useDevServerStatus` 的 `exitNotice`）：这句是用户唯一
 * 想问的（ISSUE #1692），故占一格可见文字而不塞进 hover —— 悬停不是可发现的动作。排版只放
 * 一句原因（`why`），细节与「现在该做什么」留给 `title`：这格弹性，旁边还有排队信息共存。
 */
function DevServerExitItem({ notice }: { notice: AppServiceExitNotice | null }) {
  if (notice === null) {
    return null;
  }
  return (
    <span
      className="text-destructive/90 max-w-60 shrink-0 truncate"
      title={`${notice.why}。${notice.detail}。${notice.action}`}
    >
      {notice.why}
    </span>
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
    const t = setTimeout(() => {
      setHost(window.location.host);
    }, 0);
    return () => {
      clearTimeout(t);
    };
  }, []);

  const fps = useFps();
  const { cudaVram, smiVram, ram, degradedNote, stale } = useComfyReadiness();
  const devServer = useDevServerStatus();
  /* 「应用服务断开 / 启动」记进消息中心（时间 + 原因）。接在**这里**而不是新起容器：
     `useDevServerStatus()` 是 `useDevServerLiveness()` 的唯一消费方（2 秒一拍打
     `/api/dev/server-id`），消息中心要的是同一份事实的边沿，自己再轮一遍等于探活翻倍。
     位置在早退分支之前：非主应用页签时状态栏整体隐藏，但记录必须继续，否则「看内嵌页面时
     服务断了一次」就没人记。 */
  useAppServiceMessageLog({
    state: devServer.state,
    processIsNew: devServer.processIsNew,
    /* 当前是哪一次启动：消息中心按它把历史消息分成「每一次启动」一组，
     * 并标出哪一组是用户此刻身处的这一次。 */
    currentRunId: devServer.currentRunId,
    /* 探活停表的那一段（窗口失焦 / 后台节流）：恢复那条要拿它标注「断开持续
     * 了多久」里有多少时间根本没人探测（见 `~/lib/shell/app-service-message`）。 */
    unprobedMs: devServer.unprobedMs,
  });
  const schemaSync = useSchemaSyncStatus();
  const comfyQueue = useComfyQueue();
  // 非主应用页签（内嵌 ComfyUI 等 iframe 页签）时整体隐藏：状态栏是固定悬浮层，
  // 盖住窗口最底下 24px——iframe 页面自绘的底部控件（运行操作栏下缘、扩展面板）
  // 恰好落在这一条里，浏览器整窗打开时它们是完整可见的，页签里却被压住，形成
  // 「浏览器里看得见、应用里看不到」的适配差。主应用页签恢复显示。
  const activeTabId = useShellTabs((s) => s.activeTabId);

  const tone = fpsTone(fps);

  if (activeTabId !== MAIN_TAB_ID) {
    return null;
  }

  return (
    <div
      aria-label="底部状态栏"
      className="border-border bg-panel/95 text-ink-muted z-toast text-2xs fixed right-0 bottom-0 left-0 flex h-6 items-center gap-3 border-t px-3 backdrop-blur-sm"
    >
      {/* ── 第 1 区：地址栏（固定宽度） ── */}
      <div className="flex w-42.5 shrink-0 items-center gap-1.5">
        <Lock className="text-success-strong shrink-0" size={11} />
        <span className="text-ink-fainter shrink-0">安全</span>
        <span className="text-ink-soft truncate" title={host ? `${host}${pathname}` : pathname}>
          {host ? `${host}${pathname}` : pathname}
        </span>
      </div>

      {/* ── 第 2 区：ComfyUI 排队/运行信息（弹性，左对齐） ── */}
      <div className="flex min-w-0 flex-1 items-center gap-2 overflow-hidden">
        {/* 服务刚出过事时，原因优先于排队信息占位：排队信息此刻本来也拿不到
            （它同样要问服务），而原因正是用户唯一想知道的。 */}
        <DevServerExitItem notice={devServer.exitNotice} />
        <ComfyQueueItem view={comfyQueue} />
        <SchemaSyncItem status={schemaSync} />
      </div>

      {/* ── 第 3 区：显存 + 内存等资源指标（固定宽度） ── */}
      <div
        className={`flex w-125 shrink-0 items-center gap-2.5 transition-opacity ${
          stale ? "opacity-50" : "opacity-100"
        }`}
        title={stale ? STALE_RESOURCE_NOTE : undefined}
      >
        {/* 三档资源的标签、口径 title 与「缺值整档隐藏」的判据都在
           `comfy-resource-metrics`（首页算力卡读同一份），这里只负责行内排版。 */}
        {selectVisibleResourceMetrics({ cudaVram, smiVram, ram }).map(({ descriptor, bar }) => (
          <UsageItem
            key={descriptor.key}
            label={descriptor.label}
            pct={bar.pct}
            title={descriptor.title}
            total={bar.total}
            used={bar.used}
          />
        ))}

        {/* 降级提示 */}
        {degradedNote !== null && degradedNote !== "" && (
          <span
            className="text-warning-strong/90 hidden items-center gap-1 sm:flex"
            title={degradedNote}
          >
            {degradedNote}
          </span>
        )}
      </div>

      {/* ── 第 4 区：FPS + 消息中心 + 日志 + 应用服务状态（固定宽度，最右） ── */}
      <div className="flex w-70 shrink-0 items-center justify-end gap-2.5 whitespace-nowrap">
        {/* 实时帧率 */}
        <span
          className="hidden items-center gap-1 md:flex"
          title="全应用实时帧率：≥50 流畅，30~49 轻微掉帧，<30 明显卡顿"
        >
          <span aria-hidden className={`inline-block size-1.5 rounded-full ${fpsDotColor[tone]}`} />
          <span className={`tabular-nums ${fpsTextColor[tone]}`}>{displayValue(fps)}</span>
          <span className="text-ink-soft">FPS</span>
        </span>

        <MessageCenterButton />

        {/* 纯图标按钮（只有图标与可选的错误计数徽标，没有可见文字）：按 ui/hint 的契约
            传 accessibleName，让提示文案同时成为 aria-label —— 否则读屏只报一颗匿名按钮。 */}
        <Hint accessibleName label={`日志面板 (${isOpen ? "开" : "关"}) — Ctrl+Shift+L`}>
          <Button
            className={`text-2xs flex h-auto gap-1 rounded px-1.5 py-0.5 ${
              isOpen
                ? "bg-primary/20 text-primary-strong hover:bg-primary/25"
                : "text-ink-muted hover:bg-subtle hover:text-ink"
            }`}
            onClick={toggleOpen}
            variant="ghost"
          >
            <FileText data-icon="inline-start" size={12} />
            {counts.error > 0 && (
              <span className="bg-destructive/20 text-destructive text-3xs rounded-full px-1">
                {counts.error}
              </span>
            )}
          </Button>
        </Hint>

        <span
          aria-label={devServer.label}
          className={`flex items-center gap-1 ${
            devServer.state === "online"
              ? "text-success-strong"
              : devServer.state === "starting"
                ? "text-ink-soft"
                : "text-destructive"
          }`}
          data-dev-server={devServer.state}
          title={devServer.title}
        >
          <StatusDot
            className={
              devServer.state === "online"
                ? "shadow-[0_0_6px_color-mix(in_srgb,var(--color-glow-success)_80%,transparent)]"
                : devServer.state === "starting"
                  ? "bg-ink-fainter"
                  : "shadow-[0_0_6px_color-mix(in_srgb,var(--color-glow-danger)_80%,transparent)]"
            }
            pulse={devServer.state === "starting"}
            sizeClass="size-1.5"
            state={
              devServer.state === "online" ? "up" : devServer.state === "starting" ? "busy" : "down"
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
