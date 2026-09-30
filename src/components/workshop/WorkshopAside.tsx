"use client";

// 工坊右侧栏：缺失素材、生成资源（本地 Checkpoint）、资源库计数。
// 纯展示 + 一个跳转入口（「在资源库中打开」广播 `workspace:navigate`）。

import { Button } from "~/components/ui/button";
import { emitAppEvent } from "~/lib/app-events";
import { cn } from "~/lib/utils";
import { Icon } from "~/components/ui/icon";
import { FieldLabel } from "~/components/ui/field";
import {
  Select,
  SelectContent,
  SelectGroup,
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
 * 按类别分栏：生图阶段只列 image 工作流，视频阶段只列 video 工作流，
 * 避免把 txt2img 混进视频下拉（两类工作流的对外参数口径不同）。
 * 选定后工坊只暴露 提示词 / 尺寸 / 参考图(首帧)，其余参数用工作流默认值。 */
function WorkshopWorkflowSelect({
  label,
  placeholder,
  category,
  options,
  value,
  onChange,
}: {
  label: string;
  placeholder: string;
  category: WorkshopWorkflowCategory;
  options: WorkshopWorkflowOption[];
  value: string;
  onChange: (value: string) => void;
}) {
  const scoped = options.filter((option) => option.category === category);
  return (
    <FieldLabel className="mt-3 block">
      <span className="text-muted-foreground mb-1 block text-[11px]">
        {label}
      </span>
      <Select value={value} onValueChange={(next) => onChange(next ?? "")}>
        <SelectTrigger
          size="sm"
          className="border-border bg-bg text-ink w-full text-xs"
        >
          <SelectValue placeholder={placeholder} />
        </SelectTrigger>
        <SelectContent>
          <SelectGroup>
            {scoped.map((option) => (
              <SelectItem key={option.id} value={option.id}>
                {option.name}
              </SelectItem>
            ))}
          </SelectGroup>
        </SelectContent>
      </Select>
      {scoped.length === 0 && (
        <span className="text-faint mt-1 block text-[10.5px]">
          工作流库里还没有
          {category === "video" ? "视频" : "生图"}
          类工作流（可在工作室的「工作流库」导入）。
        </span>
      )}
    </FieldLabel>
  );
}

interface WorkshopAsideProps {
  missing: MissingItem[];
  /** 工作流库里的可选工作流（ISSUE #145）：本地通道的唯一可执行来源。
   * 按内容类别分栏：面板只列出当前阶段对应的那一栏。 */
  workflowOptions: WorkshopWorkflowOption[];
  workflowId: string;
  onWorkflowChange: (value: string) => void;
  /** 视频通道选定的工作流 id。 */
  videoWorkflowId: string;
  onVideoWorkflowChange: (value: string) => void;
  apiChannels: ApiChannelsView | null;
  characterCount: number;
  imageDoneCount: number;
  clipDoneCount: number;
  onGoScript: () => void;
}

export function WorkshopAside({
  missing,
  workflowOptions,
  workflowId,
  onWorkflowChange,
  videoWorkflowId,
  onVideoWorkflowChange,
  apiChannels,
  characterCount,
  imageDoneCount,
  clipDoneCount,
  onGoScript,
}: WorkshopAsideProps) {
  const anyChannelConfigured =
    apiChannels?.image.configured === true ||
    apiChannels?.video.configured === true;

  /**
   * 只列**真有计数**的行。此前这里还摆着「剧本大纲.md / 分镜脚本.json」两行
   * 与固定「参考图 / 音效 0 项」—— 那是写死的文案，不是项目的内容；素材的真实
   * 清单在画布的素材库里（`use-material-library`），这一屏不再冒充。
   * 「场景图」也改名为「镜头出图」：它数的是已出图的**镜头**条数，不是场景数。
   */
  const resourceRows: Array<[string, string]> = [
    ["角色卡", `${String(characterCount)} 项`],
    ["镜头出图", `${String(imageDoneCount)} 项`],
    ["视频片段", `${String(clipDoneCount)} 项`],
  ];

  return (
    <aside className="flex-col gap-4">
      {/* Missing materials */}
      <div className="border-border bg-surface rounded-2xl border p-4">
        <div className="mb-3 flex items-center gap-2">
          <span className="bg-amber/20 text-amber grid h-[22px] w-[22px] place-items-center rounded-lg text-[13px] font-bold">
            !
          </span>
          <span className="text-ink text-[13px] font-semibold">
            缺失素材 / 下一步
          </span>
        </div>
        <div className="flex-col gap-2.5">
          {missing.map((item) => (
            <div key={item.label} className="flex items-center gap-3">
              <span
                className={cn(
                  "size-2.5 rounded-full",
                  item.done ? "bg-success" : "bg-warning",
                )}
                aria-hidden
              />
              <span className="text-ink flex-1 text-[12.5px]">
                {item.label}
              </span>
              <span className="text-faint text-[11px]">
                {item.done
                  ? "已完成"
                  : item.gap === null
                    ? "尚未建立"
                    : `${String(item.gap)} 项待补`}
              </span>
            </div>
          ))}
        </div>
        <Button
          type="button"
          onClick={onGoScript}
          variant="ghost"
          className="bg-amber/10 text-amber hover:bg-amber/15 mt-3 w-full rounded-lg py-2.5 text-xs font-semibold"
        >
          补齐缺失素材 →
        </Button>
      </div>

      {/* 生成资源：本地 ComfyUI 链路唯一可执行来源 = 工作流库工作流 */}
      <div className="border-border bg-surface rounded-2xl border p-4">
        <div className="text-ink mb-3 flex items-center justify-between text-[13px] font-semibold">
          生成资源
          <span className="text-faint text-[10.5px]">
            {anyChannelConfigured ? "远端模型已适配" : "远端模型未适配"}
          </span>
        </div>
        <WorkshopWorkflowSelect
          label="生图工作流（工作流库）"
          placeholder="选择生图工作流…"
          category="image"
          options={workflowOptions}
          value={workflowId}
          onChange={onWorkflowChange}
        />
        <WorkshopWorkflowSelect
          label="视频工作流（工作流库）"
          placeholder="选择视频工作流…"
          category="video"
          options={workflowOptions}
          value={videoWorkflowId}
          onChange={onVideoWorkflowChange}
        />
      </div>

      {/* Resource library */}
      <div className="border-border bg-surface rounded-2xl border p-4">
        <div className="text-ink mb-3 text-[13px] font-semibold">资源库</div>
        <div className="gap-3">
          {resourceRows.map(([name, tag]) => (
            <div key={name} className="flex items-center gap-3">
              <span className="bg-elevated grid size-8 place-items-center rounded-lg">
                <Icon name="file" size={14} className="text-muted-foreground" />
              </span>
              <span className="text-ink flex-1 truncate text-[12.5px]">
                {name}
              </span>
              <span className="text-faint bg-subtle rounded-md px-2 py-1 text-[10.5px]">
                {tag}
              </span>
            </div>
          ))}
        </div>
        {/* 「资源库」现在是项目界面的一级页签（画布 / 工坊 / 资源库 / 产出 / 成片），
            这里只留计数与一个入口 —— 刻意的分工：工坊右栏回答「这一步的材料够不够」，
            真正的分类 / 搜索 / 上传 / 删除都在那一页里做，不在两处各摆一套。 */}
        <Button
          type="button"
          variant="ghost"
          onClick={() =>
            emitAppEvent("workspace:navigate", { view: "library" })
          }
          className="text-muted-foreground bg-subtle hover:bg-surface-2 mt-3 w-full rounded-lg py-2.5 text-xs"
        >
          在资源库中打开 →
        </Button>
      </div>
    </aside>
  );
}
