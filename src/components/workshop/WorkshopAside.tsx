"use client";

// 工坊右侧栏：缺失素材、生成资源（本地 Checkpoint）、资源库计数。
// 纯展示 + 一个跳转入口（「在资源库中打开」广播 `workspace:navigate`）。

import { Button } from "~/components/ui/button";
import { TruncatedText } from "~/components/ui/truncated-text";
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
  category: WorkshopWorkflowCategory;
  label: string;
  onChange: (value: string) => void;
  options: Array<WorkshopWorkflowOption>;
  placeholder: string;
  value: string;
}) {
  const scoped = options.filter((option) => option.category === category);
  return (
    <FieldLabel className="mt-3 block">
      <span className="text-muted-foreground text-2xs mb-1 block">{label}</span>
      <Select
        onValueChange={(next) => {
          onChange(next ?? "");
        }}
        value={value}
      >
        <SelectTrigger className="border-border bg-bg text-ink w-full text-xs" size="sm">
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
        <span className="text-faint text-2xs mt-1 block">
          工作流库里还没有
          {category === "video" ? "视频" : "生图"}
          类工作流（可在工作室的「工作流库」导入）。
        </span>
      )}
    </FieldLabel>
  );
}

type WorkshopAsideProps = {
  apiChannels: ApiChannelsView | null;
  characterCount: number;
  clipDoneCount: number;
  imageDoneCount: number;
  missing: Array<MissingItem>;
  onGoScript: () => void;
  onVideoWorkflowChange: (value: string) => void;
  onWorkflowChange: (value: string) => void;
  /** 视频通道选定的工作流 id。 */
  videoWorkflowId: string;
  workflowId: string;
  /** 工作流库里的可选工作流（ISSUE #145）：本地通道的唯一可执行来源。
   * 按内容类别分栏：面板只列出当前阶段对应的那一栏。 */
  workflowOptions: Array<WorkshopWorkflowOption>;
};

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
    apiChannels?.image.configured === true || apiChannels?.video.configured === true;

  /**
   * 只列**真有计数**的行：此前写死的「剧本大纲.md / 参考图 0 项」等不是项目内容，
   * 真实清单在素材库（`use-material-library`）。「镜头出图」数的是已出图的**镜头**条数。
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
          <span className="bg-amber/20 text-amber grid size-5.5 place-items-center rounded-lg text-sm font-bold">
            !
          </span>
          <span className="text-ink text-sm font-semibold">缺失素材 / 下一步</span>
        </div>
        <div className="flex-col gap-2.5">
          {missing.map((item) => (
            <div className="flex items-center gap-3" key={item.label}>
              <span
                aria-hidden
                className={cn("size-2.5 rounded-full", item.done ? "bg-success" : "bg-warning")}
              />
              <span className="text-ink flex-1 text-[12.5px]">{item.label}</span>
              <span className="text-faint text-2xs">
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
          className="bg-amber/10 text-amber hover:bg-amber/15 mt-3 w-full rounded-lg py-2.5 text-xs font-semibold"
          onClick={onGoScript}
          type="button"
          variant="ghost"
        >
          补齐缺失素材 →
        </Button>
      </div>

      {/* 生成资源：本地 ComfyUI 链路唯一可执行来源 = 工作流库工作流 */}
      <div className="border-border bg-surface rounded-2xl border p-4">
        <div className="text-ink mb-3 flex items-center justify-between text-sm font-semibold">
          生成资源
          <span className="text-faint text-2xs">
            {anyChannelConfigured ? "远端模型已适配" : "远端模型未适配"}
          </span>
        </div>
        <WorkshopWorkflowSelect
          category="image"
          label="生图工作流（工作流库）"
          onChange={onWorkflowChange}
          options={workflowOptions}
          placeholder="选择生图工作流…"
          value={workflowId}
        />
        <WorkshopWorkflowSelect
          category="video"
          label="视频工作流（工作流库）"
          onChange={onVideoWorkflowChange}
          options={workflowOptions}
          placeholder="选择视频工作流…"
          value={videoWorkflowId}
        />
      </div>

      {/* Resource library */}
      <div className="border-border bg-surface rounded-2xl border p-4">
        <div className="text-ink mb-3 text-sm font-semibold">资源库</div>
        <div className="gap-3">
          {resourceRows.map(([name, tag]) => (
            <div className="flex items-center gap-3" key={name}>
              <span className="bg-elevated grid size-8 place-items-center rounded-lg">
                <Icon className="text-muted-foreground" name="file" size={14} />
              </span>
              <TruncatedText className="text-ink flex-1 truncate text-[12.5px]">
                {name}
              </TruncatedText>
              <span className="text-faint bg-subtle text-2xs rounded-md px-2 py-1">{tag}</span>
            </div>
          ))}
        </div>
        {/* 「资源库」现在是项目界面的一级页签（画布 / 工坊 / 资源库 / 产出 / 成片），
            这里只留计数与一个入口 —— 刻意的分工：工坊右栏回答「这一步的材料够不够」，
            真正的分类 / 搜索 / 上传 / 删除都在那一页里做，不在两处各摆一套。 */}
        <Button
          className="text-muted-foreground bg-subtle hover:bg-surface-2 mt-3 w-full rounded-lg py-2.5 text-xs"
          onClick={() => {
            emitAppEvent("workspace:navigate", { view: "library" });
          }}
          type="button"
          variant="ghost"
        >
          在资源库中打开 →
        </Button>
      </div>
    </aside>
  );
}
