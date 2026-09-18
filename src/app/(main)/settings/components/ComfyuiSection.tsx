"use client";

/**
 * 创作后端（ComfyUI）分区（规范 17 §17.2 第③层）。
 *
 * 路径 / 端口 / 启动参数 / 自动拉起等配置与「启动 / 停止 / 打开」动作都来自
 * controller；安装形态（桌面版 / 便携版 / venv）是从 `comfyStatus` 派生的展示
 * 判据，也在 controller。视图自持的仅启动日志的滚动跟随（纯视觉偏好）。
 */

import { useEffect, useRef, useState } from "react";

import { Button } from "~/components/ui/button";
import { StatusDot, type StatusDotState } from "~/components/ui/status-dot";

import {
  STATUS_ACTIONS_CLASS,
  STATUS_ROW_CLASS,
  STATUS_TEXT_CLASS,
} from "../settings-status-row-config";

import { AnsiLogText, StatusButton, Card, Field } from "./SettingsPrimitives";
import type { ReadySettingsPageController } from "../hooks/use-settings-page";

/**
 * ComfyUI 运行状态 → 圆点语义（纯派生，无 React 状态）。
 *
 * 顺序是载荷：**「过渡态」优先于「探测中」**，因为启动/关闭过程中状态查询
 * 也会返回 probing 类似的形态；先把过渡态认下，圆点才不会是「未运行」的红。
 */
function comfyDotState(c: ReadySettingsPageController): StatusDotState {
  if (c.comfyStatus?.up) return "up";
  if (
    c.comfyStopping ||
    c.comfyStatus?.stopping ||
    c.comfyStarting ||
    c.comfyStatus?.starting
  ) {
    return "busy";
  }
  if (c.comfyStatus?.probing) return "probing";
  return "down";
}

/** 安装形态 → 设置页徽标文案。 */
const INSTANCE_KIND_LABEL: Record<
  "desktop" | "portable" | "venv" | "unknown",
  string
> = {
  desktop: "桌面版（ComfyUI Desktop）",
  portable: "便携版",
  venv: "venv",
  unknown: "未知安装",
};

export function ComfyuiSection({ c }: { c: ReadySettingsPageController }) {
  /* ComfyUI 安装形态（由 comfyStatus 派生，供路径徽标 + 是否隐藏端口/启动参数）。 */
  const instanceType = c.comfyStatus?.instanceType ?? null;
  const desktopManaged = !!c.comfyStatus?.desktopManaged;

  /* 启动日志的滚动跟随是纯视觉偏好，留在视图层。 */
  const logBoxRef = useRef<HTMLDivElement>(null);
  const [logFollow, setLogFollow] = useState(true);
  useEffect(() => {
    const el = logBoxRef.current;
    if (el && logFollow) el.scrollTop = el.scrollHeight;
  }, [c.comfyLogText, logFollow]);
  const onLogScroll = () => {
    const el = logBoxRef.current;
    if (!el) return;
    setLogFollow(el.scrollHeight - el.scrollTop - el.clientHeight < 32);
  };

  return (
    <Card title="创作后端（ComfyUI）">
      <Field
        label="ComfyUI 路径（源码根或桌面版实例根）"
        value={c.drafts.settings.comfyuiPath}
        onChange={(value) => c.patchSettings({ comfyuiPath: value })}
        placeholder="例如 D:\\ComfyUI 或 D:\\Comfy-Desktop\\ComfyUI-Installs\\ComfyUI2"
      />
      <p className="text-muted-foreground -mt-2 mb-3 text-xs">
        桌面版（ComfyUI Desktop）请直接配置实例根目录（含 ComfyUI/ 子目录与
        standalone-env/），便携版配置含 main.py 的源码根。自动识别
        python_embeded / standalone-env / .venv
        解释器，多个环境并存时优先选用装了依赖（torch）的那个。
        {c.comfyStatus?.pathConfigured
          ? "已配置——ComfyUI 未运行时提交任务会自动拉起。"
          : "未配置——ComfyUI 未运行时任务会失败。"}
      </p>
      {instanceType && (
        <div className="-mt-2 mb-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
          <span className="text-muted-foreground">安装形态</span>
          <span
            className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium ${
              desktopManaged
                ? "bg-primary/15 text-primary"
                : "bg-subtle text-ink/70"
            }`}
          >
            {INSTANCE_KIND_LABEL[instanceType]}
          </span>
          {desktopManaged && (
            <span className="text-muted-foreground">
              端口与启动参数由 Comfy Desktop 实例元数据决定，无需在此配置。
            </span>
          )}
        </div>
      )}
      {!desktopManaged && (
        <>
          <Field
            label="ComfyUI 端口"
            value={
              c.drafts.settings.comfyuiPort > 0
                ? String(c.drafts.settings.comfyuiPort)
                : ""
            }
            onChange={(value) =>
              c.patchSettings({
                comfyuiPort: Math.max(0, Number(value) || 0),
              })
            }
            placeholder={`留空使用默认 ${c.comfyDefaultPort}`}
          />
          <p className="text-muted-foreground -mt-2 mb-3 text-xs">
            填了别的端口，启动时会自动传 --port。这里填的是默认端口：实例已经
            由别的方式（Comfy Desktop、你自己的终端）跑起来时，应用会直接按
            实例进程实际监听的端口连——端口不一致也不需要改这里。
          </p>
          <Field
            label="ComfyUI 启动参数（可选）"
            value={c.drafts.settings.comfyuiExtraArgs}
            onChange={(value) => c.patchSettings({ comfyuiExtraArgs: value })}
            placeholder="例如 --input-directory D:\\ComfyUI-Shared\\input"
          />
        </>
      )}
      <div className="mb-4 flex items-center gap-2">
        <input
          id="comfyui-autostart"
          type="checkbox"
          className="accent-primary size-4"
          checked={c.drafts.settings.comfyuiAutoStart ?? true}
          onChange={(event) =>
            c.patchSettings({ comfyuiAutoStart: event.target.checked })
          }
        />
        <label htmlFor="comfyui-autostart" className="text-ink/80 text-sm">
          提交任务时 ComfyUI 未运行则自动启动
        </label>
      </div>
      <div
        className={`border-border bg-surface-1 mb-4 rounded-lg border px-3 py-2 ${STATUS_ROW_CLASS}`}
      >
        <StatusDot state={comfyDotState(c)} />
        <span
          className={`text-ink/80 ${STATUS_TEXT_CLASS}`}
          title={
            c.comfyStatus?.up
              ? `ComfyUI 运行中${c.comfyStatus.base ? `（${c.comfyStatus.base}）` : ""}${
                  c.comfyStatus.via ? `·${c.comfyStatus.via}` : ""
                }`
              : undefined
          }
        >
          {c.comfyStatus?.up
            ? `ComfyUI 运行中${c.comfyStatus.base ? `（${c.comfyStatus.base}）` : ""}${
                c.comfyStatus.via ? `·${c.comfyStatus.via}` : ""
              }`
            : c.comfyStopping || c.comfyStatus?.stopping
              ? "ComfyUI 关闭中…"
              : c.comfyStarting || c.comfyStatus?.starting
                ? "ComfyUI 正在启动…"
                : c.comfyStatus?.probing
                  ? "ComfyUI 状态检测中…"
                  : "ComfyUI 未运行"}
        </span>
        <div className={STATUS_ACTIONS_CLASS}>
          {/* 打开运行中的 ComfyUI 界面：桌面壳内在同一主窗口开一个「页签」
              （iframe 内嵌）；浏览器/dev 模式同样落在应用内页签。
              旁边的「在浏览器打开」是并列出口，不是替代（见该按钮注释）。 */}
          <StatusButton
            onClick={() => void c.openComfy()}
            /* 只在「明确未运行」时禁用：探测进行中（probing）也允许点一下，
           openComfy 会先取一份新鲜状态再打开（ISSUE #339）。 */
            disabled={
              c.comfyOpening || (!c.comfyStatus?.up && !c.comfyStatus?.probing)
            }
          >
            {c.comfyOpening ? "打开中…" : "打开查看"}
          </StatusButton>
          {/* 并列出口：同一个地址再交给系统默认浏览器（放大看 / 装插件 /
              多屏）。页签内嵌照旧，这里不做替换。地址由服务端自己探
              （comfyOpen），不采信界面里缓存的旧 base。禁用口径与
              「打开查看」一致：只看「明确未运行」。 */}
          <StatusButton
            onClick={() => void c.openComfyInBrowser()}
            disabled={
              c.comfyBrowserOpening ||
              (!c.comfyStatus?.up && !c.comfyStatus?.probing)
            }
          >
            {c.comfyBrowserOpening ? "打开中…" : "在浏览器打开"}
          </StatusButton>
          <StatusButton
            onClick={() => void c.startComfy()}
            disabled={
              c.saving ||
              c.comfyStarting ||
              c.comfyStopping ||
              !!c.comfyStatus?.stopping ||
              !!c.comfyStatus?.starting ||
              !!c.comfyStatus?.up
            }
          >
            {c.comfyStarting || c.comfyStatus?.starting
              ? "启动中…"
              : "启动 ComfyUI"}
          </StatusButton>
          <StatusButton
            onClick={() => void c.stopComfy()}
            disabled={
              c.saving ||
              c.comfyStopping ||
              !!c.comfyStatus?.stopping ||
              !c.comfyStatus?.up
            }
          >
            {c.comfyStopping || c.comfyStatus?.stopping
              ? "关闭中…"
              : "关闭 ComfyUI"}
          </StatusButton>
        </div>
      </div>
      {/* ComfyUI 启动日志：启动期间每秒跟随 log/services/comfyui-runtime.log，
          让「正在启动…」不再是个黑盒（硬规则 4 的用户可见出口） */}
      <div className="border-border bg-surface-1 mb-4 rounded-xl border">
        <div className="flex items-center justify-between px-3 py-2">
          <span className="text-ink/80 flex items-center gap-2 text-sm font-medium">
            启动日志（comfyui-runtime.log）
            {c.comfyLogActive && (
              <span className="text-success-strong inline-flex items-center gap-1.5 text-[10px] font-normal">
                <StatusDot state="up" sizeClass="size-1.5" pulse />
                跟随中
              </span>
            )}
          </span>
          <div className="flex items-center gap-2">
            {!logFollow && (
              <Button
                size="xs"
                onClick={() => setLogFollow(true)}
                className="h-auto rounded px-2 py-0.5 text-[11px] font-medium"
              >
                恢复自动滚动
              </Button>
            )}
            <Button
              variant="outline"
              size="xs"
              onClick={() => void c.refreshComfyLog()}
              className="text-muted-foreground h-auto rounded px-2 py-0.5 text-[11px]"
            >
              刷新
            </Button>
          </div>
        </div>
        <div
          ref={logBoxRef}
          onScroll={onLogScroll}
          className="border-border-subtle bg-canvas-deep text-ink-field custom-scrollbar mx-3 mb-3 max-h-44 overflow-y-auto rounded-lg border px-3 py-2 font-mono text-[11px] leading-relaxed"
        >
          {c.comfyLogText ? (
            <span className="break-all whitespace-pre-wrap">
              <AnsiLogText segments={c.comfyLogSegments} />
            </span>
          ) : (
            <span className="text-muted-foreground">
              暂无日志 —— 点「启动 ComfyUI」后这里会实时输出拉起过程（spawn
              参数、模型加载与就绪状态）；也可点「刷新」查看最近一次运行日志。
            </span>
          )}
        </div>
      </div>
      <Field
        label="训练后端 URL"
        value={c.drafts.settings.trainerUrl}
        onChange={(value) => c.patchSettings({ trainerUrl: value })}
        placeholder="留空则显示「未配置」横幅"
      />
      <Field
        label="LoRA 输出目录"
        value={c.drafts.settings.comfyLorasDir}
        onChange={(value) => c.patchSettings({ comfyLorasDir: value })}
        placeholder="留空使用默认 models/loras"
      />
      <StatusButton onClick={() => void c.savePrefs()} disabled={c.saving}>
        保存偏好
      </StatusButton>
    </Card>
  );
}
