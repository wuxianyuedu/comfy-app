"use client";

/**
 * 创作后端（ComfyUI）分区（规范 17 §17.2 第③层）。
 *
 * 路径 / 端口 / 启动参数 / 自动拉起等配置与「启动 / 停止 / 打开」动作都来自
 * controller；安装形态（桌面版 / 便携版 / venv）是从 `comfyStatus` 派生的展示
 * 判据，也在 controller。视图自持的仅启动日志的滚动跟随（纯视觉偏好）。
 */

import { StatusDot, type StatusDotState } from "~/components/ui/status-dot";
import { Checkbox } from "~/components/ui/checkbox";

import {
  STATUS_ACTIONS_CLASS,
  STATUS_ROW_CLASS,
  STATUS_TEXT_CLASS,
} from "../settings-status-row-config";

import { SettingsCard } from "~/components/ui/settings-card";
import { StatusButton, Field } from "./SettingsPrimitives";
import { FieldLabel } from "~/components/ui/field";
import { RuntimeLogBox } from "./RuntimeLogBox";
import { ComfyuiStoragePaths } from "./ComfyuiStoragePaths";
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
  /* ComfyUI 安装形态（fs-only 的 comfyInstance，供路径徽标 + 是否隐藏端口/启动参数）。
   * 刻意不取自 comfyStatus：那份要等秒级运行态探测，徽标与输入框显隐会被一起拖着走。 */
  const instanceType = c.comfyInstance?.instanceType ?? null;
  const desktopManaged = !!c.comfyInstance?.desktopManaged;

  return (
    <SettingsCard title="创作后端（ComfyUI）">
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
        {c.comfyInstance?.pathConfigured
          ? "已配置——ComfyUI 未运行时提交任务会自动拉起。"
          : "未配置——ComfyUI 未运行时任务会失败。"}
      </p>
      <Field
        label="comfy-cli 解释器（Python 绝对路径）"
        value={c.drafts.settings.comfyCliPython}
        onChange={(value) => c.patchSettings({ comfyCliPython: value })}
        placeholder="例如 D:\\tools\\python-venv\\comfy-cli\\Scripts\\python.exe"
      />
      <p className="text-muted-foreground -mt-2 mb-3 text-xs">
        任务是通过 comfy-cli 提交给 ComfyUI 的，需要一个装好 comfy-cli 的 Python
        解释器。桌面版不随包
        Python：请自备后把解释器的绝对路径填在这里；留空则退回 项目目录下的
        python-venv/comfy-cli（开发检出的默认落点）。
        {c.drafts.settings.comfyCliPython.trim()
          ? "已配置——执行链会用这个解释器。"
          : "未配置——开发检出里若已有 python-venv/comfy-cli 可留空，桌面版任务会失败。"}
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
      {/* 实例目录：只有桌面实例有「实例根 + 共享目录」这套布局可读（服务端对
          其它形态返回 null）。只读，不提供编辑 —— 改目录属于 ComfyUI Desktop
          自己的配置面，写回那边的文件会与本应用下次启动用的参数打架。 */}
      {desktopManaged && <ComfyuiStoragePaths storage={c.comfyStorage} />}
      <div className="mb-4 flex items-center gap-2">
        <Checkbox
          id="comfyui-autostart"
          checked={c.drafts.settings.comfyuiAutoStart ?? true}
          onCheckedChange={(next) =>
            c.patchSettings({ comfyuiAutoStart: next === true })
          }
        />
        <FieldLabel htmlFor="comfyui-autostart" className="text-ink/80 text-sm">
          提交任务时 ComfyUI 未运行则自动启动
        </FieldLabel>
      </div>
      <div className="mb-4 flex items-center gap-2">
        <Checkbox
          id="auto-sync-local-workflow"
          checked={c.drafts.settings.autoSyncLocalWorkflow ?? false}
          onCheckedChange={(next) =>
            c.patchSettings({ autoSyncLocalWorkflow: next === true })
          }
        />
        <FieldLabel
          htmlFor="auto-sync-local-workflow"
          className="text-ink/80 text-sm"
        >
          查看本地文件工作流时自动同步最新内容
        </FieldLabel>
      </div>
      <p className="text-muted-foreground -mt-2 mb-4 text-xs">
        关（默认）：进详情只提示「磁盘文件有更新」，需回工作流库点「同步」按钮才更新，
        更新前内容不会变。开：进详情即把磁盘最新内容同步回库（相当于自动点一次「同步」）。
        仅对「绑定到本地文件」的工作流生效。
      </p>
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
          让「正在启动…」不再是个黑盒（硬规则 4 的用户可见出口）。
          右上角的下拉按「每次启动」切换（服务端按会话横幅切分），全屏按钮铺满
          标题行下方的内容区 —— 多次启动不再混在一条时间线上。 */}
      <RuntimeLogBox
        fileName="comfyui-runtime.log"
        log={c.comfyLog}
        emptyHint={
          <>
            暂无日志 —— 点「启动 ComfyUI」后这里会实时输出拉起过程（spawn
            参数、模型加载与就绪状态）；也可点「刷新」查看最近一次运行日志。
          </>
        }
      />
      <StatusButton onClick={() => void c.savePrefs()} disabled={c.saving}>
        保存偏好
      </StatusButton>
    </SettingsCard>
  );
}
