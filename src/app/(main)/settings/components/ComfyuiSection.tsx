"use client";

/**
 * 创作后端（ComfyUI）分区（规范 17 §17.2 第③层）—— **只配置路径**。
 *
 * 自 ISSUE #1900 起这一分区只答一件事：ComfyUI 装在哪、用什么解释器提交、
 * 端口与启动参数是什么、要不要自动拉起。**启动 / 关闭 / 打开与启动日志整块
 * 搬去了侧栏「ComfyUI」页**（`~/components/studio/comfyui`）—— 两件事各有
 * 自己的屏之后，改路径的人不必先等一遍秒级运行态探测，看日志的人不必滚过
 * 一屏输入框。
 *
 * 因此本分区不再持任何运行态：controller 只给配置草稿与两份只读派生
 *（安装形态 / 桌面实例的存储目录）。
 */

import { ArrowRight } from "lucide-react";

import { emitAppEvent } from "~/lib/app-events";
import { Checkbox } from "~/components/ui/checkbox";
import { Button } from "~/components/ui/button";
import { StatusButton } from "~/components/ui/service-status-row";

import { SettingsCard } from "~/components/ui/settings-card";
import { Field } from "./SettingsPrimitives";
import { FieldLabel } from "~/components/ui/field";
import { ComfyuiStoragePaths } from "./ComfyuiStoragePaths";
import { CpuLimitPicker } from "./CpuLimitPicker";
import type { ReadySettingsPageController } from "../hooks/use-settings-page";

/** 安装形态 → 设置页徽标文案。 */
const INSTANCE_KIND_LABEL: Record<"desktop" | "portable" | "venv" | "unknown", string> = {
  desktop: "桌面版（ComfyUI Desktop）",
  portable: "便携版",
  unknown: "未知安装",
  venv: "venv",
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
        onChange={(value) => c.patchSettings({ comfyuiPath: value })}
        placeholder="例如 D:\\ComfyUI 或 D:\\Comfy-Desktop\\ComfyUI-Installs\\ComfyUI2"
        value={c.drafts.settings.comfyuiPath}
      />
      <p className="text-muted-foreground -mt-2 mb-3 text-xs">
        桌面版（ComfyUI Desktop）请直接配置实例根目录（含 ComfyUI/ 子目录与
        standalone-env/），便携版配置含 main.py 的源码根。自动识别 python_embeded / standalone-env /
        .venv 解释器，多个环境并存时优先选用装了依赖（torch）的那个。
        {c.comfyInstance?.pathConfigured
          ? "已配置——这里只管路径；启动 / 关闭与启动日志在侧栏「ComfyUI」页。"
          : "未配置——ComfyUI 未运行时任务会失败，侧栏「ComfyUI」页也启动不了它。"}
      </p>
      <Field
        label="comfy-cli 解释器（Python 绝对路径）"
        onChange={(value) => c.patchSettings({ comfyCliPython: value })}
        placeholder="例如 D:\\tools\\python-venv\\comfy-cli\\Scripts\\python.exe"
        value={c.drafts.settings.comfyCliPython}
      />
      <p className="text-muted-foreground -mt-2 mb-3 text-xs">
        任务是通过 comfy-cli 提交给 ComfyUI 的，需要一个装好 comfy-cli 的 Python
        解释器。桌面版不随包 Python：请自备后把解释器的绝对路径填在这里；留空则退回 项目目录下的
        python-venv/comfy-cli（开发检出的默认落点）。
        {c.drafts.settings.comfyCliPython.trim()
          ? "已配置——执行链会用这个解释器。"
          : "未配置——开发检出里若已有 python-venv/comfy-cli 可留空，桌面版任务会失败。"}
      </p>
      {instanceType && (
        <div className="-mt-2 mb-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
          <span className="text-muted-foreground">安装形态</span>
          <span
            className={`text-2xs inline-flex items-center rounded-full px-2 py-0.5 font-medium ${
              desktopManaged ? "bg-primary/15 text-primary" : "bg-subtle text-ink/70"
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
            onChange={(value) =>
              c.patchSettings({
                comfyuiPort: Math.max(0, Number(value) || 0),
              })
            }
            placeholder={`留空使用默认 ${c.comfyDefaultPort}`}
            value={c.drafts.settings.comfyuiPort > 0 ? String(c.drafts.settings.comfyuiPort) : ""}
          />
          <p className="text-muted-foreground -mt-2 mb-3 text-xs">
            填了别的端口，启动时会自动传 --port。这里填的是默认端口：实例已经 由别的方式（Comfy
            Desktop、你自己的终端）跑起来时，应用会直接按
            实例进程实际监听的端口连——端口不一致也不需要改这里。
          </p>
          <Field
            label="ComfyUI 启动参数（可选）"
            onChange={(value) => c.patchSettings({ comfyuiExtraArgs: value })}
            placeholder="例如 --input-directory D:\\ComfyUI-Shared\\input"
            value={c.drafts.settings.comfyuiExtraArgs}
          />
        </>
      )}
      {/* CPU 档位（ISSUE #1959）：出图是可长跑的后台负载，占满机器时用户在
          同一个窗口里的编辑器 / 浏览器 / 画布拖拽都在抢核。三档语义与「用
          什么系统手段实现」见 `~/lib/comfyui/cpu-limit`；这里只让人选。
          放在端口 / 启动参数之后、自动启动之前 —— 它是运行偏好，不是安装配置。 */}
      <CpuLimitPicker c={c} />
      {/* 实例目录：只有桌面实例有「实例根 + 共享目录」这套布局可读（服务端对
          其它形态返回 null）。只读，不提供编辑 —— 改目录属于 ComfyUI Desktop
          自己的配置面，写回那边的文件会与本应用下次启动用的参数打架。 */}
      {desktopManaged && <ComfyuiStoragePaths storage={c.comfyStorage} />}
      <div className="mb-4 flex items-center gap-2">
        <Checkbox
          checked={c.drafts.settings.comfyuiAutoStart ?? true}
          id="comfyui-autostart"
          onCheckedChange={(next) => c.patchSettings({ comfyuiAutoStart: next === true })}
        />
        <FieldLabel className="text-ink/80 text-sm" htmlFor="comfyui-autostart">
          提交任务时 ComfyUI 未运行则自动启动
        </FieldLabel>
      </div>
      <div className="mb-4 flex items-center gap-2">
        <Checkbox
          checked={c.drafts.settings.autoSyncLocalWorkflow ?? false}
          id="auto-sync-local-workflow"
          onCheckedChange={(next) => c.patchSettings({ autoSyncLocalWorkflow: next === true })}
        />
        <FieldLabel className="text-ink/80 text-sm" htmlFor="auto-sync-local-workflow">
          查看本地文件工作流时自动同步最新内容
        </FieldLabel>
      </div>
      <p className="text-muted-foreground -mt-2 mb-4 text-xs">
        关（默认）：进详情只提示「磁盘文件有更新」，需回工作流库点「同步」按钮才更新，
        更新前内容不会变。开：进详情即把磁盘最新内容同步回库（相当于自动点一次「同步」）。
        仅对「绑定到本地文件」的工作流生效。
      </p>
      {/* 运行态与启动日志**不在这里**了：这一段此前是一整块「状态圆点 + 四颗
          按钮 + 日志框」，它让「改路径」这件小事要穿过一屏运行操作。现在这里只
          留一句指路 —— 它不是装饰，是这一分区撤掉四个动作之后**必须**给的出口
          （用户按老位置找「启动 ComfyUI」时会先看到这句，而不是以为功能没了）。 */}
      <div className="border-border bg-surface-1 mb-4 rounded-lg border px-3 py-2">
        <p className="text-ink-muted text-xs leading-relaxed">
          路径配好并保存之后，到侧栏的「ComfyUI」页启动它 —— 那里有运行状态、启动 /
          关闭、打开查看，以及每一次启动的日志。
        </p>
        <Button
          className="border-border text-ink-muted hover:text-ink mt-2 h-auto gap-1 rounded-lg px-2.5 py-1"
          onClick={() => emitAppEvent("workspace:navigate", { view: "comfyui" })}
          size="xs"
          variant="outline"
        >
          去启动与查看日志
          <ArrowRight aria-hidden className="size-3" data-icon="inline-end" />
        </Button>
      </div>
      <StatusButton disabled={c.saving} onClick={() => void c.savePrefs()} variant="primary-solid">
        保存偏好
      </StatusButton>
    </SettingsCard>
  );
}
