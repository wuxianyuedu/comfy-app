"use client";

// 工坊右侧栏：缺失素材、生成模型摘要、资源库计数（#4834 起「生成资源」的
// 工作流下拉退场 —— 模型选择统一为测试模型级联，各入口选完这里只做摘要）。
// 纯展示 + 跳转入口（「在资源库中打开」广播 `workspace:navigate`）。

import { Button } from "~/components/ui/button";
import { TruncatedText } from "~/components/ui/truncated-text";
import { emitAppEvent } from "~/lib/app-events";
import { cn } from "~/lib/utils";
import { Icon } from "~/components/ui/icon";
import type { ApiChannelsView } from "~/lib/workshop/api-channel-shared";
import type { MissingItem, Tab } from "~/components/workshop/stage-config";
import type { WorkshopModelSelection, WorkshopModelSelections } from "~/lib/workshop/draft-store";

import { useModelCatalog } from "./hooks/use-model-catalog";
import { candidateLabel, candidateValue } from "./model-test-config";

type WorkshopAsideProps = {
  apiChannels: ApiChannelsView | null;
  characterCount: number;
  clipDoneCount: number;
  imageDoneCount: number;
  missing: Array<MissingItem>;
  /** 各生成入口当前选中的模型（#4834，随草稿持久化）。 */
  modelSelections: WorkshopModelSelections;
  onGoScript: () => void;
  /** 摘要行的跳转：把用户送到该模型对应的生成阶段现场调整。 */
  onGoToStage: (tab: Tab) => void;
};

/** 摘要卡的一行：模态名 + 当前选中模型（含模式），点击跳到对应阶段。 */
function ModelSummaryRow({
  catalog,
  label,
  onClick,
  selection,
}: {
  catalog: ReturnType<typeof useModelCatalog>;
  label: string;
  onClick: () => void;
  selection: WorkshopModelSelection | undefined;
}) {
  const value =
    selection === undefined || selection.model.trim() === ""
      ? "未选"
      : (() => {
          const candidate = catalog.allCandidates.find(
            (c) => candidateValue(c) === selection.model,
          );
          if (candidate === undefined) {
            /* 候选目录未到 / 条目已删：至少把原值亮出来，不冒充「未选」。 */
            return selection.model;
          }
          const name = candidateLabel(candidate);
          const modeLabel = catalog.modeTabs.find((t) => t.mode === selection.mode)?.label;
          return modeLabel === undefined ? name : `${name} · ${modeLabel}`;
        })();
  return (
    <Button
      className="hover:bg-subtle text-ink w-full justify-start gap-3 rounded-lg px-2 py-2 text-left font-normal"
      onClick={onClick}
      type="button"
      variant="ghost"
    >
      <span className="flex-1 truncate text-[12.5px]">{label}</span>
      <span
        className={cn(
          "text-2xs max-w-[55%] truncate rounded-md px-2 py-1",
          selection === undefined || selection.model.trim() === ""
            ? "text-faint bg-subtle"
            : "bg-primary-soft text-primary-strong",
        )}
      >
        {value}
      </span>
      <span aria-hidden className="text-faint text-2xs">
        ›
      </span>
    </Button>
  );
}

export function WorkshopAside({
  missing,
  modelSelections,
  onGoToStage,
  apiChannels,
  characterCount,
  imageDoneCount,
  clipDoneCount,
  onGoScript,
}: WorkshopAsideProps) {
  const anyChannelConfigured =
    apiChannels?.image.configured === true || apiChannels?.video.configured === true;
  /* 摘要行的显示名解析：按模态各挂一个目录（React Query 对同一批读数去重）。 */
  const chatCatalog = useModelCatalog("chat", "");
  const imageCatalog = useModelCatalog("image", "");
  const videoCatalog = useModelCatalog("video", "");

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

      {/* 生成模型摘要（#4834）：模型选择统一为测试模型级联，在各生成入口现场选；
       *  这里只回答「现在每一类用的是哪个模型」，点击把人送到对应阶段调整。 */}
      <div className="border-border bg-surface rounded-2xl border p-4">
        <div className="text-ink mb-3 flex items-center justify-between text-sm font-semibold">
          生成模型
          <span className="text-faint text-2xs">
            {anyChannelConfigured ? "远端模型已适配" : "远端模型未适配"}
          </span>
        </div>
        <div className="flex-col gap-1">
          <ModelSummaryRow
            catalog={chatCatalog}
            label="文本（提取 / 剧本）"
            onClick={() => {
              onGoToStage("script");
            }}
            selection={modelSelections.text}
          />
          <ModelSummaryRow
            catalog={imageCatalog}
            label="定妆照"
            onClick={() => {
              onGoToStage("character");
            }}
            selection={modelSelections.portrait}
          />
          <ModelSummaryRow
            catalog={imageCatalog}
            label="镜头生图"
            onClick={() => {
              onGoToStage("shots");
            }}
            selection={modelSelections.shot}
          />
          <ModelSummaryRow
            catalog={videoCatalog}
            label="视频"
            onClick={() => {
              onGoToStage("video");
            }}
            selection={modelSelections.video}
          />
        </div>
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
