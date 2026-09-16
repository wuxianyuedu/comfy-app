"use client";

// ── 「模式契约」编辑器：纯展示视图（规范 17 §17.2 第③层）────────────────
// 两个入口（工坊 / 工作流库）共用同一份表单：输入口清单 + 输出类别 + 保存。
// 契约本身（口有哪些、口叫什么）由 `lib/workshop/model-mode-contract` 定义，
// 展示分组与「已改」判据来自 `mode-contract-config`。

import {
  modeContractInputIdLabel,
  modeContractInputLabel,
  type ModeContract,
} from "~/lib/workshop/model-mode-contract";
import {
  CONTRACT_MODE_GROUPS,
  CONTRACT_MODES,
  addableContractInputs,
  contractModeLabel,
  isModeContractCustomized,
} from "../mode-contract-config";
import type { ModeContractEditorController } from "../hooks/use-mode-contract-editor";

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
        <button
          type="button"
          onClick={controller.onClose}
          aria-label="关闭"
          className="text-muted-foreground hover:text-ink"
        >
          ✕
        </button>
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
                    <button
                      key={t.code}
                      type="button"
                      onClick={() => controller.selectMode(t.code)}
                      className={`rounded-full border px-3 py-1 text-xs transition-colors ${
                        mode === t.code
                          ? "border-primary bg-primary/10 text-primary"
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
                    </button>
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
          <div className="border-primary-soft bg-primary-soft/20 space-y-2 rounded-xl border p-3">
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
              「尺寸」是两类等价的写法，在尺寸选择器里任选其一：比例 +
              分辨率（1k / 2k / 4k），或 比例 + 百万像素 + 倍数（8 / 16 / 32 /
              64）。选「分辨率」时工坊按场景尺寸表换算成「百万像素 + 倍数」
              再下发，两种写法落到工作流 / 远端接口上的效果一致。
            </p>
            <div className="space-y-1.5">
              {draft.inputs.map((input, i) => (
                <div
                  key={`${input}-${i}`}
                  className="border-border bg-surface flex items-center justify-between rounded-lg border px-2.5 py-1.5"
                >
                  <span className="text-ink text-[11px]">
                    {i + 1}.{" "}
                    <LabelWithId
                      label={modeContractInputIdLabel(input)}
                      id={input}
                    />
                  </span>
                  <button
                    type="button"
                    disabled={input === "prompt"}
                    onClick={() => controller.removeInput(input)}
                    className="text-muted-foreground/60 px-1 text-xs hover:text-red-700 disabled:opacity-30 dark:text-red-300 dark:hover:text-red-400"
                    aria-label={`移除 ${modeContractInputIdLabel(input)}`}
                  >
                    ✕
                  </button>
                </div>
              ))}
            </div>
            <div className="flex flex-wrap gap-1">
              {addableContractInputs(draft.inputs).map((type) => (
                <button
                  key={type}
                  type="button"
                  onClick={() => controller.appendInput(type)}
                  className="border-primary text-primary hover:bg-primary/10 border-primary/40 rounded border border-dashed px-2 py-0.5 text-[11px]"
                >
                  ＋{" "}
                  <LabelWithId label={modeContractInputLabel(type)} id={type} />
                </button>
              ))}
              {nextReferenceImageId && (
                <button
                  type="button"
                  title="参考图不设数量上限，可继续追加"
                  onClick={() => controller.appendInput(nextReferenceImageId)}
                  className="border-primary text-primary hover:bg-primary/10 border-primary/40 rounded border border-dashed px-2 py-0.5 text-[11px]"
                >
                  ＋{" "}
                  <LabelWithId
                    label={modeContractInputLabel("reference-image")}
                    id={nextReferenceImageId}
                  />
                </button>
              )}
            </div>
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
              <p className="rounded-lg bg-amber-100 px-2 py-1 text-[11px] text-amber-800 dark:text-amber-300">
                契约里没有「提示词」口 —— 工坊生成的提示词将无处可落，
                保存后该模式无法被工坊驱动。
              </p>
            )}
            {saved && (
              <p className="rounded-lg bg-emerald-100 px-2 py-1 text-[11px] text-emerald-800 dark:text-emerald-300">
                已保存 —— 工坊与工作流库读的是同一份注册表，另一处刷新后即生效。
              </p>
            )}
            <button
              type="button"
              onClick={() => void controller.save()}
              disabled={saving}
              className="bg-primary rounded-lg px-3 py-1.5 text-xs font-medium text-white transition-opacity disabled:opacity-40"
            >
              {saving ? "保存中…" : "保存模式契约"}
            </button>
          </div>
        )}
      </div>
    </>
  );
}
