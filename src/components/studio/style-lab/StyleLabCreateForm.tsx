"use client";

import { Play } from "lucide-react";

import { AttributeMultiSelect } from "~/components/workshop/AttributeMultiSelect";
import { Button } from "~/components/ui/button";
import { EmptyState } from "~/components/ui/empty-state";
import { FormField } from "~/components/ui/form-field";
import { Hint } from "~/components/ui/hint";
import { SelectChip } from "~/components/ui/select-chip";
import { SelectMenu } from "~/components/ui/select-menu";
import { textHandler } from "~/lib/form-props";

import { TRAIT_AXES } from "./style-lab-config";
import type { StyleLabController } from "./hooks/use-style-lab";
import { STYLE_TAG_OPTIONS } from "./style-lab-config";

/**
 * 风格实验室 · 创建表单（第③层的一部分，纯视图）。
 *
 * 拆成独立文件而不是塞进 `StyleLabView`：新建表单本身就有名称 / 工作流 / 模式 /
 * 风格 / 逐维特征 / 预览 / 提交 七个区，和列表叠在一个文件里会超「新组件 ≤200 行」
 * 那道闸，而两块的关注点本就可分（规范 §12.13 的「按职责拆」）。这里不取数、不发请求，
 * 全部状态与动作都从第②层的 controller 上拿（规范 17 §17.2）。
 */
export function StyleLabCreateForm({ c }: { c: StyleLabController }) {
  const workflowLabels: Record<string, string> = {};
  for (const option of c.workflowOptions) {
    workflowLabels[option.id] = option.name;
  }

  return (
    <section
      aria-labelledby="style-lab-create-heading"
      className="bg-card border-border rounded-2xl border p-4"
    >
      <h3
        id="style-lab-create-heading"
        className="text-ink-bright text-sm font-semibold"
      >
        新建试验
      </h3>

      {c.workflowOptions.length === 0 ? (
        <EmptyState
          className="mt-3"
          variant="hint"
          /* 同上：hint 档只出一句，两句合一才不会被静默截掉一半。 */
          description="还没有封装就绪的工作流 —— 去「工作流库」给某个模式的必备口连好落点，这边才会出现可选项。"
        />
      ) : (
        <div className="mt-3 flex flex-col gap-4">
          <FormField label="名称" labelClassName="text-ink-faint text-xs">
            {(field) => (
              <input
                {...field}
                value={c.form.name}
                onChange={textHandler(c.setName)}
                maxLength={80}
                placeholder="给这组风格 × 特征起个名"
                className="border-border bg-subtle text-ink-bright rounded-md border px-2.5 py-1.5 text-xs outline-none"
              />
            )}
          </FormField>

          <div className="flex flex-col gap-1">
            <span className="text-ink-faint text-xs">工作流（仅就绪）</span>
            <SelectMenu
              className="w-full"
              fullWidth
              value={c.form.workflowId}
              onChange={c.selectWorkflow}
              options={c.workflowOptions.map((o) => o.id)}
              labels={workflowLabels}
              placeholder="选择一个已封装就绪的工作流"
              aria-label="选择工作流"
            />
          </div>

          {c.selectedModes.length > 0 ? (
            <div className="flex flex-col gap-1">
              <span className="text-ink-faint text-xs">模式</span>
              <div role="radiogroup" aria-label="选择模式" className="flex flex-wrap gap-1.5">
                {c.selectedModes.map((mode) => (
                  <SelectChip
                    key={mode}
                    shape="compact"
                    selected={c.form.mode === mode}
                    onClick={() => c.setMode(mode)}
                  >
                    {mode}
                  </SelectChip>
                ))}
              </div>
            </div>
          ) : null}

          <AttributeMultiSelect
            label="风格"
            groups={STYLE_TAG_OPTIONS}
            value={c.form.styles}
            onChange={c.setStyles}
            placeholder="选风格（不选 = 不约束）"
          />

          {TRAIT_AXES.map((axis) => (
            <AttributeMultiSelect
              key={axis.id}
              label={axis.label}
              groups={axis.groups}
              value={c.form.traits[axis.id] ?? []}
              onChange={(values) => c.setTraitValues(axis.id, values)}
              placeholder="选特征（不选 = 不约束）"
            />
          ))}

          <p className="text-ink-faint text-xs tabular-nums">
            计划 {String(c.preview.cellCount)} 格 · 预计 {c.preview.etaText}
            {c.preview.overSoft ? "（这批会很久，建议拆开试）" : ""}
            {c.preview.overHard ? "（超出单批上限）" : ""}
          </p>

          {c.formError ? (
            <p
              role="alert"
              className="text-2xs text-warning-strong"
            >
              {c.formError}
            </p>
          ) : null}

          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={!c.canSubmit}
              onClick={() => void c.submit()}
            >
              {c.creating ? "保存中" : "创建试验"}
            </Button>
            {/* 诚实的禁用出口：点了什么都不做或必失败，比明说「下一批开放」更坏。 */}
            <Hint label={c.batchRunner.reason} side="top" wrap>
              <Button
                variant="ghost"
                size="sm"
                disabled
                aria-label={c.batchRunner.reason}
              >
                <Play data-icon="inline-start" className="size-3" aria-hidden />
                {c.batchRunner.label}
              </Button>
            </Hint>
          </div>
        </div>
      )}
    </section>
  );
}
