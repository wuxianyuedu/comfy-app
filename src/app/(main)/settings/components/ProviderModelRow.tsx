"use client";

/**
 * 供应商详情里的一行模型（#3517 拆出）：启停开关、名称 / 用途 / 接口格式摘要，
 * 以及「测试连接 / 测试生成 / 编辑 / 移除」四个动作。
 *
 * 拆出来的原因只有一条：`ProviderDetail` 的函数体已经顶到 400 行硬闸
 * （规范 §12.13），而这一行的 JSX 与父级的状态无关 —— 它需要的全部输入
 * 都由 props 给出，动作失败时的提示由父级统一落在一个错误位上。
 */

import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { Hint } from "~/components/ui/hint";
import { SETTINGS_ROW_CLASS } from "~/components/ui/settings-card";
import { Switch } from "~/components/ui/switch";
import {
  LLM_API_FORMAT_SHORT_LABELS,
  MODEL_INPUT_TYPE_LABELS,
  formatContextWindow,
  parseInputTypes,
} from "~/lib/llm/provider-types";
import { REMOTE_MODEL_KINDS, REMOTE_MODEL_KIND_LABELS } from "~/lib/llm/types";

import type { ProviderModelDialogs } from "../hooks/use-provider-model-dialogs";
import type {
  ProviderActionResult,
  ProviderModelView,
  ProviderView,
  SettingsProviders,
} from "../hooks/use-settings-providers";
import type { UsageTestDialogs } from "../hooks/use-usage-test-dialogs";

export function ProviderModelRow({
  d,
  model,
  onAction,
  p,
  provider,
  usage,
}: {
  d: ProviderModelDialogs;
  model: ProviderModelView;
  /** 启停 / 删除的结果交回父级：详情页只有一处错误位，行内不再各报一份。 */
  onAction: (action: Promise<ProviderActionResult>) => Promise<void>;
  p: SettingsProviders;
  provider: ProviderView;
  usage: UsageTestDialogs;
}) {
  const thisProbe = d.modelProbe?.id === model.id ? d.modelProbe : null;
  const kind = REMOTE_MODEL_KINDS.find((candidate) => candidate === model.kind) ?? "chat";
  const inputTypes = parseInputTypes(model.inputTypes);

  return (
    <div className="flex-col gap-1">
      <div className={`${SETTINGS_ROW_CLASS} flex items-center gap-2`}>
        <Switch
          aria-label={`${model.enabled ? "停用" : "启用"}模型 ${model.name}`}
          checked={model.enabled}
          disabled={p.busy}
          onCheckedChange={(checked) => {
            void onAction(p.toggleModel(model.id, checked));
          }}
          size="sm"
        />
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-center gap-2">
            <span className="text-ink truncate text-sm">{model.name}</span>
            <Badge size="xs" tone="neutral">
              {REMOTE_MODEL_KIND_LABELS[kind]}
            </Badge>
            {!model.enabled && (
              <Badge size="xs" tone="warning">
                已停用
              </Badge>
            )}
          </div>
          <p className="text-muted-foreground text-2xs truncate">
            上下文 {formatContextWindow(model.contextWindow)} · 输出{" "}
            {formatContextWindow(model.maxOutputTokens)} ·{" "}
            {LLM_API_FORMAT_SHORT_LABELS[model.apiFormat]}
            {inputTypes.length > 0 &&
              ` · ${inputTypes.map((type) => MODEL_INPUT_TYPE_LABELS[type]).join("/")}`}
          </p>
        </div>
        <Hint label="用供应商地址 + 该模型的接口格式探测（不生成、不耗额度）" wrap>
          <Button
            className="text-muted-foreground text-2xs h-auto rounded px-1.5 py-0.5"
            disabled={thisProbe?.running === true}
            onClick={() => {
              void d.testModel(model);
            }}
            size="xs"
            variant="outline"
          >
            {thisProbe?.running === true ? "连接测试中…" : "测试连接"}
          </Button>
        </Hint>
        <Hint label="按实际用法发起一次真实生成调用（参数可在弹窗内自定义）">
          <Button
            className="text-muted-foreground text-2xs h-auto rounded px-1.5 py-0.5"
            onClick={() => {
              usage.openUsageTest(kind, {
                name: model.name,
                kind,
                apiFormat: model.apiFormat,
                baseUrl: provider.baseUrl,
              });
            }}
            size="xs"
            variant="outline"
          >
            测试生成
          </Button>
        </Hint>
        <Hint label="编辑窗口 / 输入类型 / 模型能力 / 推理映射">
          <Button
            className="text-muted-foreground text-2xs h-auto rounded px-1.5 py-0.5"
            onClick={() => {
              d.openEditModel(model);
            }}
            size="xs"
            variant="outline"
          >
            编辑
          </Button>
        </Hint>
        <Hint label="移除该模型（即时保存）">
          <Button
            aria-label={`移除模型 ${model.name}`}
            className="text-muted-foreground hover:text-danger-strong"
            onClick={() => {
              void onAction(p.deleteModel(model.id));
            }}
            size="icon-xs"
            variant="ghost"
          >
            ✕
          </Button>
        </Hint>
      </div>
      {thisProbe?.msg && (
        <div
          className={`text-2xs mr-1 ml-1 rounded border px-2 py-1 ${
            thisProbe.msg.kind === "ok"
              ? "border-success/30 bg-success/10 text-success-strong"
              : "border-destructive/30 bg-destructive/10 text-danger-strong"
          }`}
        >
          {thisProbe.msg.text}
        </div>
      )}
    </div>
  );
}
