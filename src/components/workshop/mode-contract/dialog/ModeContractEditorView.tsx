"use client";

// ── 「模式契约」编辑器：纯展示视图（规范 17 §17.2 第③层）────────────────
// 两个入口（工坊 / 工作流库）共用同一份表单：输入口清单 + 输出类别 + 保存。
// 契约本身（口有哪些、口叫什么）由`lib/workshop/model-mode-contract` 定义，
// 展示分组与「已改」判据来自`mode-contract-config`。

import {
  customInputKindOf,
  modeContractInputIdLabel,
  type ModeContract,
} from "~/lib/workshop/model-mode-contract";
import {
  CONTRACT_MODE_GROUPS,
  CONTRACT_MODES,
  contractModeLabel,
  customInputKindLabel,
  isModeContractCustomized,
} from "../mode-contract-config";
import type { ModeContractEditorController } from "../hooks/use-mode-contract-editor";
import { Button } from "~/components/ui/button";
import { Checkbox } from "~/components/ui/checkbox";
import { ContractInputCatalog } from "./ContractInputCatalog";

/** 中文展示名 + 机器 id：界面上只写中文时，对不上代码 / 日志 / 配置里的 id。 */
function LabelWithId({ label, id }: { label: string; id: string }) {
  return (
    <>
      {label}
      <span className="text-muted-foreground/60 ml-1 font-mono text-[10px]">
        {id}
      </span>
    </>
  );
}

export function ModeContractEditorView({
  controller,
}: {
  controller: ModeContractEditorController;
}) {
  const { mode, draft, stored, saving, saved, nextReferenceImageId } =
    controller;

  return (
    <>
      <div className="flex items-start justify-between px-5 pt-4 pb-2">
        <div>
          <h3 className="text-ink-strong text-sm font-semibold">模式契约</h3>
          <p className="text-muted-foreground mt-0.5 text-[11px]">
            每种模式的统一输入 / 输出 ——
            本地工作流按它配落点，远端模型按它建适配器。
            契约是模式级的全局口径，与具体接口无关（接口字段映射在「模型适配」里配）。
          </p>
        </div>
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={controller.onClose}
          aria-label="关闭"
          className="text-muted-foreground hover:text-ink"
        >
          ✕
        </Button>
      </div>

      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-auto px-5 pb-4">
        <div>
          <p className="text-ink/80 mb-1.5 text-xs font-medium">
            选择要配置的模式（与工作流库同一定义）
          </p>
          {CONTRACT_MODE_GROUPS.map((group) => {
            const modes = CONTRACT_MODES.filter(
              (t) => t.category === group.category,
            );
            if (modes.length === 0) return null;
            return (
              <div key={group.category} className="mb-1.5">
                <p className="text-muted-foreground mb-1 text-[10px]">
                  {group.label}
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {modes.map((t) => (
                    <Button
                      key={t.code}
                      variant="outline"
                      size="xs"
                      onClick={() => controller.selectMode(t.code)}
                      className={`h-auto rounded-full px-3 py-1 ${
                        mode === t.code
                          ? "border-primary text-primary bg-primary/10"
                          : "border-border text-muted-foreground hover:bg-subtle"
                      }`}
                    >
                      <LabelWithId
                        label={contractModeLabel(t.code)}
                        id={t.code}
                      />
                      {isModeContractCustomized(t.code, stored) && (
                        <span className="text-primary/70 ml-1 text-[10px]">
                          已改
                        </span>
                      )}
                    </Button>
                  ))}
                </div>
              </div>
            );
          })}
          <p className="text-muted-foreground/70 mt-1 text-[10px]">
            标「已改」的模式使用你自定义的统一输入 / 输出；其余按内置默认。
          </p>
        </div>

        {draft && (
          <div className="border-primary-soft bg-primary-soft/20 flex flex-col gap-2 rounded-xl border p-3">
            <p className="text-ink text-xs font-semibold">
              {contractModeLabel(draft.mode)}（
              <span className="text-muted-foreground/60 font-mono text-[10px]">
                {draft.mode}
              </span>
              ）的统一对外参数
            </p>
            <p className="text-muted-foreground text-[10px]">
              输入口（按顺序作为工坊对该模式的统一输入；本地工作流在「画布节点」
              为每个口配落点，远端模型在「模型适配」里为每个口配请求字段）
            </p>
            <p className="text-muted-foreground/80 text-[10px]">
              「必备」表示这条模式**少不得**这个口：本地工作流缺它的落点时，
              「工坊封装」会判为未配置（工坊驱动不起来）。哪些口必备按模式配，
              不写死在代码里 ——
              例如纯文生图把「提示词」勾必备、「负向提示词」不勾。
            </p>
            <p className="text-muted-foreground/80 text-[10px]">
              「尺寸」是两类等价的写法，在尺寸选择器里任选其一：比例 +
              分辨率（1k / 2k / 4k），或 比例 + 百万像素 + 倍数（8 / 16 / 32 /
              64）。选「分辨率」时工坊按场景尺寸表换算成「百万像素 + 倍数」
              再下发，两种写法落到工作流 / 远端接口上的效果一致。
            </p>
            <div className="flex flex-col gap-1.5">
              {draft.inputs.map((input, i) => {
                const label = modeContractInputIdLabel(
                  input,
                  draft.customInputs,
                );
                const kind = customInputKindOf(input);
                return (
                  <div
                    key={input}
                    className="border-border bg-surface flex items-center justify-between rounded-lg border px-2.5 py-1.5"
                  >
                    <span className="text-ink text-[11px]">
                      {i + 1}. <LabelWithId label={label} id={input} />
                      {kind && (
                        <span className="text-muted-foreground/70 bg-subtle border-border-strong ml-1 rounded border px-1 py-0.5 text-[10px]">
                          {customInputKindLabel(kind)}
                        </span>
                      )}
                    </span>
                    <span className="flex items-center gap-1">
                      {/* 顺序**就是**工坊对外的参数顺序（序号即数组下标），
 所以调序改的是契约本身，不是界面偏好。 */}
                      <span className="flex items-center">
                        <Button
                          variant="ghost"
                          size="icon-xs"
                          onClick={() => controller.moveInput(input, -1)}
                          disabled={i === 0}
                          aria-label={`上移 ${label}`}
                          className="text-muted-foreground/70 hover:text-ink disabled:opacity-25"
                        >
                          ↑
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon-xs"
                          onClick={() => controller.moveInput(input, 1)}
                          disabled={i === draft.inputs.length - 1}
                          aria-label={`下移 ${label}`}
                          className="text-muted-foreground/70 hover:text-ink disabled:opacity-25"
                        >
                          ↓
                        </Button>
                      </span>
                      <label
                        className="text-muted-foreground flex cursor-pointer items-center gap-1 text-[10px]"
                        title="必备口：本地工作流缺它的落点时，工坊里驱动不起来"
                      >
                        <Checkbox
                          checked={controller.isRequired(input)}
                          onCheckedChange={() =>
                            controller.toggleRequired(input)
                          }
                          className="size-3"
                        />
                        必备
                      </label>
                      <Button
                        variant="ghost"
                        size="icon-xs"
                        onClick={() => controller.removeInput(input)}
                        className="text-muted-foreground/60 hover:text-danger-strong"
                        aria-label={`移除 ${label}`}
                      >
                        ✕
                      </Button>
                    </span>
                  </div>
                );
              })}
            </div>
            {/* 参数库：全部预制口 + 自定义口（浏览 + 增删改都在这一块）。 */}
            <ContractInputCatalog
              inputs={draft.inputs}
              customInputs={draft.customInputs ?? []}
              onAddPredefined={(type) =>
                controller.appendInput(
                  type === "reference-image"
                    ? (nextReferenceImageId ?? "reference-image")
                    : type,
                )
              }
              onAddCustom={controller.addCustomInput}
              onRenameCustom={controller.renameCustomInput}
              onRemoveCustom={controller.removeInput}
            />
            <div>
              <p className="text-muted-foreground mb-1 text-[10px]">输出类别</p>
              <select
                value={draft.output}
                onChange={(event) =>
                  controller.setOutput(
                    event.target.value as ModeContract["output"],
                  )
                }
                className="border-border bg-bg text-ink rounded-lg border px-2 py-1 text-[11px]"
              >
                <option value="image">图片（image）</option>
                <option value="video">视频（video）</option>
                <option value="audio">音频（audio）</option>
              </select>
            </div>
            {!draft.inputs.includes("prompt") && (
              <p className="bg-warning/10 text-warning-strong rounded-lg px-2 py-1 text-[11px]">
                契约里没有「提示词」口 —— 工坊生成的提示词将无处可落，
                保存后该模式无法被工坊驱动。
              </p>
            )}
            {!controller.hasAnyRequired && (
              <p className="bg-warning/10 text-warning-strong rounded-lg px-2 py-1 text-[11px]">
                一个必备口都没勾 —— 这条模式下任何工作流都会被判为「工坊可用」，
                缺任何口都不再提示。若你不是有意如此，给承载生成输入的那个口勾上。
              </p>
            )}
            {saved && (
              <p className="bg-success/10 text-success-strong rounded-lg px-2 py-1 text-[11px]">
                已保存 —— 工坊与工作流库读的是同一份注册表，另一处刷新后即生效。
              </p>
            )}
            <Button
              variant="primary-solid"
              size="xs"
              onClick={() => void controller.save()}
              disabled={saving}
              className="h-auto rounded-lg px-3 py-1.5"
            >
              {saving ? "保存中…" : "保存模式契约"}
            </Button>
          </div>
        )}
      </div>
    </>
  );
}
