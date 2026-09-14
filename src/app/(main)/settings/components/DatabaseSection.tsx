"use client";

/**
 * 数据库（Drizzle Studio）分区（规范 17 §17.2 第③层）。
 *
 * 状态与「启动 / 停止 / 打开」动作来自 controller；视图自持的仅启动日志的
 * 滚动跟随（纯视觉偏好）。
 */

import { useEffect, useRef, useState } from "react";

import {
  STATUS_ACTIONS_CLASS,
  STATUS_ROW_CLASS,
  STATUS_TEXT_CLASS,
} from "../settings-status-row-config";

import { AnsiLogText, Btn, Card } from "./SettingsPrimitives";
import type { ReadySettingsPageController } from "../hooks/use-settings-page";

export function DatabaseSection({ c }: { c: ReadySettingsPageController }) {
  /* 启动日志的滚动跟随是纯视觉偏好，留在视图层。 */
  const logBoxRef = useRef<HTMLDivElement>(null);
  const [logFollow, setLogFollow] = useState(true);
  useEffect(() => {
    const el = logBoxRef.current;
    if (el && logFollow) el.scrollTop = el.scrollHeight;
  }, [c.dbStudioLogText, logFollow]);
  const onLogScroll = () => {
    const el = logBoxRef.current;
    if (!el) return;
    setLogFollow(el.scrollHeight - el.scrollTop - el.clientHeight < 32);
  };

  return (
    <Card title="数据库（Drizzle Studio）">
      <p className="text-muted-foreground mb-3 text-sm">
        可视化浏览本地 SQLite 数据库（schema / 表数据 / 运行 SQL）。 Drizzle
        Studio 的界面托管在官方远端页面
        （local.drizzle.studio），本地只起一个回连端口；点「打开查看」
        会用你的系统默认浏览器打开它。
      </p>
      <div
        className={`border-border bg-surface-1 rounded-lg border px-3 py-2 ${STATUS_ROW_CLASS}`}
      >
        <span
          className={`inline-block size-2 shrink-0 rounded-full ${
            c.dbStudioStatus?.up
              ? "bg-emerald-400"
              : c.dbStudioStatus?.starting || c.dbStudioStarting
                ? "bg-amber-400"
                : "bg-rose-400"
          }`}
        />
        <span
          className={`text-ink/80 ${STATUS_TEXT_CLASS}`}
          title={
            c.dbStudioStatus?.up
              ? `Drizzle Studio 运行中（端口 ${c.dbStudioStatus.port ?? 4983}）`
              : undefined
          }
        >
          {c.dbStudioStatus?.up
            ? `Drizzle Studio 运行中（端口 ${c.dbStudioStatus.port ?? 4983}）`
            : c.dbStudioStarting || c.dbStudioStatus?.starting
              ? "Drizzle Studio 正在启动…"
              : "Drizzle Studio 未运行"}
        </span>
        <div className={STATUS_ACTIONS_CLASS}>
          {/* 按钮只看自身动作的在途状态（dbStudioStarting/Stopping/
              Opening），不看全局 saving——saving 是保存偏好/ComfyUI
              等共享标志，卡住时曾把三个按钮一起锁死（#92）。
              状态查询失败（dbStudioStatus 为 null）时按「未运行」
              处理：启动按钮仍可点，用户不会整组被禁用。 */}
          <Btn
            onClick={() => void c.openDbStudio()}
            disabled={
              c.dbStudioOpening || c.dbStudioStarting || !c.dbStudioStatus?.up
            }
          >
            {c.dbStudioOpening ? "打开中…" : "打开查看"}
          </Btn>
          <Btn
            onClick={() => void c.startDbStudio()}
            disabled={c.dbStudioStarting || c.dbStudioStatus?.up === true}
          >
            {c.dbStudioStarting ? "启动中…" : "启动 Drizzle Studio"}
          </Btn>
          <Btn
            onClick={() => void c.stopDbStudio()}
            disabled={c.dbStudioStopping || !c.dbStudioStatus?.up}
          >
            {c.dbStudioStopping ? "关闭中…" : "关闭 Drizzle Studio"}
          </Btn>
        </div>
      </div>
      {/* Drizzle Studio 启动日志：启动期间每秒跟随
          log/services/drizzle-studio-runtime.log（同 ComfyUI 的用户可见出口） */}
      <div className="border-border bg-surface-1 mt-4 rounded-xl border">
        <div className="flex items-center justify-between px-3 py-2">
          <span className="text-ink/80 flex items-center gap-2 text-sm font-medium">
            启动日志（drizzle-studio-runtime.log）
            {c.dbStudioLogActive && (
              <span className="inline-flex items-center gap-1.5 text-[10px] font-normal text-emerald-600 dark:text-emerald-400">
                <span className="inline-block size-1.5 animate-pulse rounded-full bg-emerald-400" />
                跟随中
              </span>
            )}
          </span>
          <div className="flex items-center gap-2">
            {!logFollow && (
              <button
                type="button"
                onClick={() => setLogFollow(true)}
                className="bg-primary/90 hover:bg-primary rounded px-2 py-0.5 text-[11px] font-medium text-white"
              >
                恢复自动滚动
              </button>
            )}
            <button
              type="button"
              onClick={() => void c.refreshDbStudioLog()}
              className="border-border text-muted-foreground hover:bg-subtle rounded border px-2 py-0.5 text-[11px] transition-colors"
            >
              刷新
            </button>
          </div>
        </div>
        <div
          ref={logBoxRef}
          onScroll={onLogScroll}
          className="border-border-subtle bg-canvas-deep text-ink-field custom-scrollbar mx-3 mb-3 max-h-44 overflow-y-auto rounded-lg border px-3 py-2 font-mono text-[11px] leading-relaxed"
        >
          {c.dbStudioLogText ? (
            <span className="break-all whitespace-pre-wrap">
              <AnsiLogText segments={c.dbStudioLogSegments} />
            </span>
          ) : (
            <span className="text-muted-foreground">
              暂无日志 —— 点「启动 Drizzle Studio」后这里会实时输出拉起
              过程（spawn 参数与 drizzle-kit 输出）；也可点「刷新」查看
              最近一次启动日志。
            </span>
          )}
        </div>
      </div>
      <p className="text-muted-foreground mt-3 text-xs">
        说明：Drizzle Studio 需要本机开发依赖 （node_modules 里的
        drizzle-kit）。双击桌面壳的开发模式可用； 若当前是不可携带完整
        node_modules 的 standalone 打包，启动时会 提示未找到 drizzle-kit。
      </p>
    </Card>
  );
}
