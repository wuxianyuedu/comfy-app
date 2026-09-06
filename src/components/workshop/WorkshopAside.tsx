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
import type { MissingItem } from "~/components/workshop/stage-config";

interface WorkshopAsideProps {
  missing: MissingItem[];
  checkpoints: string[];
  checkpoint: string;
  onCheckpointChange: (value: string) => void;
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
          <span className="grid h-[22px] w-[22px] place-items-center rounded-lg bg-(--color-amber)/20 text-[13px] font-bold text-(--color-amber)">
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
          className="mt-3 w-full rounded-lg bg-(--color-amber)/10 py-2.5 text-xs font-semibold text-(--color-amber) hover:bg-(--color-amber)/15"
        >
          补齐缺失素材 →
        </Button>
      </div>

      {/* Generation resources: local checkpoint for the ComfyUI chain */}
      <div className="border-border bg-surface rounded-2xl border p-4">
        <div className="text-ink mb-3 flex items-center justify-between text-[13px] font-semibold">
          生成资源
          <span className="text-faint text-[10.5px]">
            {anyChannelConfigured ? "API 通道已配置" : "API 通道未配置"}
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
        <Button
          type="button"
          variant="ghost"
          onClick={onOpenApiSettings}
          className="text-muted-foreground mt-3 w-full rounded-lg bg-(--color-subtle) py-2.5 text-xs hover:bg-(--color-surface-2)"
        >
          配置 API 直连通道
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
              <span className="text-faint rounded-md bg-(--color-subtle) px-2 py-1 text-[10.5px]">
                {tag}
              </span>
            </div>
          ))}
        </div>
        <Button
          type="button"
          variant="ghost"
          className="text-muted-foreground mt-3 w-full rounded-lg bg-(--color-subtle) py-2.5 text-xs hover:bg-(--color-surface-2)"
        >
          + 导入素材
        </Button>
      </div>
    </aside>
  );
}
