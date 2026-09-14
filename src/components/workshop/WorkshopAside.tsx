"use client";

// 工坊右侧栏：缺失素材、生成资源（本地 Checkpoint）、资源库清单。纯展示。

import { Button } from "~/components/ui/button";
import { Icon } from "~/components/ui/icon";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "~/components/ui/select";
import type { ApiChannelsView } from "~/lib/workshop/api-channel-shared";
import type {
  WorkshopWorkflowCategory,
  WorkshopWorkflowOption,
} from "~/lib/workshop/generation-client";
import type { MissingItem } from "~/components/workshop/stage-config";

/** 「工作流库」里某一类别（图 / 视频）的可选工作流下拉。
 *
 *  按类别分栏：生图阶段只列 image 工作流，视频阶段只列 video 工作流，
 *  避免把 txt2img 混进视频下拉（两类工作流的对外参数口径不同）。
 *  选定后工坊只暴露 提示词 / 尺寸 / 参考图(首帧)，其余参数用工作流默认值。 */
function WorkshopWorkflowSelect({
  label,
  builtinLabel,
  builtinPlaceholder,
  category,
  options,
  value,
  onChange,
}: {
  label: string;
  builtinLabel: string;
  builtinPlaceholder: string;
  category: WorkshopWorkflowCategory;
  options: WorkshopWorkflowOption[];
  value: string;
  onChange: (value: string) => void;
}) {
  const scoped = options.filter((option) => option.category === category);
  return (
    <label className="mt-3 block">
      <span className="text-muted-foreground mb-1 block text-[11px]">
        {label}
      </span>
      <Select
        value={value || "__builtin__"}
        onValueChange={(next) =>
          onChange(next === "__builtin__" ? "" : (next ?? ""))
        }
      >
        <SelectTrigger
          size="sm"
          className="border-border bg-bg text-ink w-full text-xs"
        >
          <SelectValue placeholder={builtinPlaceholder} />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="__builtin__">{builtinLabel}</SelectItem>
          {scoped.map((option) => (
            <SelectItem key={option.id} value={option.id}>
              {option.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {scoped.length === 0 && (
        <span className="text-faint mt-1 block text-[10.5px]">
          工作流库里还没有
          {category === "video" ? "视频" : "生图"}
          类工作流（可在工作室的「工作流库」导入）。
        </span>
      )}
    </label>
  );
}

interface WorkshopAsideProps {
  missing: MissingItem[];
  checkpoints: string[];
  checkpoint: string;
  onCheckpointChange: (value: string) => void;
  /** 工作流库里的可选工作流（ISSUE #145）；空 id = 内置 txt2img。
   *  按内容类别分栏：面板只列出当前阶段对应的那一栏。 */
  workflowOptions: WorkshopWorkflowOption[];
  workflowId: string;
  onWorkflowChange: (value: string) => void;
  /** 视频通道选定的工作流 id；空串 = 内置 img2video / txt2video。 */
  videoWorkflowId: string;
  onVideoWorkflowChange: (value: string) => void;
  apiChannels: ApiChannelsView | null;
  onOpenApiSettings: () => void;
  characterCount: number;
  imageDoneCount: number;
  clipDoneCount: number;
  onGoScript: () => void;
}

export function WorkshopAside({
  missing,
  checkpoints,
  checkpoint,
  onCheckpointChange,
  workflowOptions,
  workflowId,
  onWorkflowChange,
  videoWorkflowId,
  onVideoWorkflowChange,
  apiChannels,
  onOpenApiSettings,
  characterCount,
  imageDoneCount,
  clipDoneCount,
  onGoScript,
}: WorkshopAsideProps) {
  const anyChannelConfigured =
    apiChannels?.image.configured === true ||
    apiChannels?.video.configured === true;

  const resourceRows: Array<[string, string]> = [
    ["剧本大纲.md", "文档"],
    ["分镜脚本.json", "数据"],
    ["角色卡", `${characterCount} 项`],
    ["场景图", `${imageDoneCount} 项`],
    ["视频片段", `${clipDoneCount} 项`],
    ["参考图 / 音效", "0 项"],
  ];

  return (
    <aside className="space-y-4">
      {/* Missing materials */}
      <div className="border-border bg-surface rounded-2xl border p-4">
        <div className="mb-3 flex items-center gap-2">
          <span className="grid h-[22px] w-[22px] place-items-center rounded-lg bg-amber/20 text-[13px] font-bold text-amber">
            !
          </span>
          <span className="text-ink text-[13px] font-semibold">
            缺失素材 / 下一步
          </span>
        </div>
        <div className="space-y-2.5">
          {missing.map((item) => (
            <div key={item.label} className="flex items-center gap-3">
              <span
                className="h-2.5 w-2.5 rounded-full"
                style={{ background: item.color }}
              />
              <span className="text-ink flex-1 text-[12.5px]">{item.label}</span>
              <span className="text-faint text-[11px]">
                {item.need > 0 ? `${item.need} 项待补` : "✓ 已完成"}
              </span>
            </div>
          ))}
        </div>
        <Button
          type="button"
          onClick={onGoScript}
          variant="ghost"
          className="mt-3 w-full rounded-lg bg-amber/10 py-2.5 text-xs font-semibold text-amber hover:bg-amber/15"
        >
          补齐缺失素材 →
        </Button>
      </div>

      {/* Generation resources: local checkpoint for the ComfyUI chain */}
      <div className="border-border bg-surface rounded-2xl border p-4">
        <div className="text-ink mb-3 flex items-center justify-between text-[13px] font-semibold">
          生成资源
          <span className="text-faint text-[10.5px]">
            {anyChannelConfigured ? "远端模型已适配" : "远端模型未适配"}
          </span>
        </div>
        <label className="block">
          <span className="text-muted-foreground mb-1 block text-[11px]">
            本地 Checkpoint（生图工作流）
          </span>
          {/* base-ui 的 value 可为 null（清空选择）；工坊用空串表示「未选模型」 */}
          <Select
            value={checkpoint}
            onValueChange={(value) => onCheckpointChange(value ?? "")}
          >
            <SelectTrigger
              size="sm"
              className="border-border bg-bg text-ink w-full text-xs"
            >
              <SelectValue placeholder="选择模型…" />
            </SelectTrigger>
            <SelectContent>
              {checkpoints.map((name) => (
                <SelectItem key={name} value={name}>
                  {name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </label>
        <WorkshopWorkflowSelect
          label="生图工作流（工作流库）"
          builtinLabel="内置 txt2img（默认）"
          builtinPlaceholder="内置 txt2img…"
          category="image"
          options={workflowOptions}
          value={workflowId}
          onChange={onWorkflowChange}
        />
        <WorkshopWorkflowSelect
          label="视频工作流（工作流库）"
          builtinLabel="内置 img2video / txt2video（默认）"
          builtinPlaceholder="内置视频工作流…"
          category="video"
          options={workflowOptions}
          value={videoWorkflowId}
          onChange={onVideoWorkflowChange}
        />
        <Button
          type="button"
          variant="ghost"
          onClick={onOpenApiSettings}
          className="text-muted-foreground mt-3 w-full rounded-lg bg-subtle py-2.5 text-xs hover:bg-surface-2"
        >
          配置模型适配（远端生图 / 视频）
        </Button>
      </div>

      {/* Resource library */}
      <div className="border-border bg-surface rounded-2xl border p-4">
        <div className="text-ink mb-3 text-[13px] font-semibold">资源库</div>
        <div className="space-y-3">
          {resourceRows.map(([name, tag]) => (
            <div key={name} className="flex items-center gap-3">
              <span className="bg-elevated grid h-8 w-8 place-items-center rounded-lg">
                <Icon name="file" size={14} className="text-muted-foreground" />
              </span>
              <span className="text-ink flex-1 truncate text-[12.5px]">
                {name}
              </span>
              <span className="text-faint rounded-md bg-subtle px-2 py-1 text-[10.5px]">
                {tag}
              </span>
            </div>
          ))}
        </div>
        <Button
          type="button"
          variant="ghost"
          className="text-muted-foreground mt-3 w-full rounded-lg bg-subtle py-2.5 text-xs hover:bg-surface-2"
        >
          + 导入素材
        </Button>
      </div>
    </aside>
  );
}
