"use client";

/**
 * 项目产出的「元数据抽屉」（ProjectOutputs 的拆分件，§17.12 视图二次拆分：
 * 只动 JSX 物理位置，不动行为）。
 *
 * 展示一条产出的参考图 / 提示词 / 参数表 / 来源，页脚是复制元数据与导出
 * JSON 两个动作。状态（选中哪条、复制反馈）由父组件持有——本组件是
 * 纯展示层（§17 第③层），事件全部上抛。
 */
import { X } from "lucide-react";

import { Hint } from "~/components/ui/hint";
import { MediaThumbnail } from "~/components/ui/media-thumbnail";
import { Button } from "~/components/ui/button";
import { KeyValueRows } from "~/components/ui/key-value-rows";
import { Sheet, SheetContent } from "~/components/ui/sheet";
import { copyFailureText } from "~/components/ui/use-copy-feedback";
import { displayValue } from "~/lib/display-value";
import { timeAgo } from "~/lib/time-format";
import { mediaPreviewUrl } from "~/lib/media/media-url";
import type { ProjectOutputItem } from "./hooks/use-project-outputs";

/** 任务类型 → 中文徽标文案（网格卡片与元数据抽屉同一份）。 */
export const TYPE_CHIP: Record<string, string> = {
  TXT2IMG: "文生图",
  IMG2IMG: "图生图",
  INPAINT: "局部重绘",
  HIRERES: "高清放大",
  VIDEO: "视频",
};

/** 拆分件自己声明 props 形状（窄接口），不 import 父组件的 controller。 */
export interface ProjectOutputsMetadataSheetProps {
  selected: ProjectOutputItem | null;
  projectId: string | null;
  /** 复制动作的反馈位（父组件的 useFlashState / 失败位）。 */
  copyFailed: boolean;
  copySucceeded: boolean;
  onCopy: () => void;
  onExport: () => void;
  onClose: () => void;
}

export function ProjectOutputsMetadataSheet({
  selected,
  projectId,
  copyFailed,
  copySucceeded,
  onCopy,
  onExport,
  onClose,
}: ProjectOutputsMetadataSheetProps) {
  return (
    <>
      {/* 右侧抽屉走`ui/sheet`（side="right"）：此前自绘遮罩 div + 手写
`onClick` 关闭 + 手搓右锚定面板，Esc 没接、焦点不锁也不归还 ——
 与设置页两个抽屉（已迁`ui/sheet`）是同一件事的两套写法。
 遮罩与面板都由基元 Portal，顶部让出标题行的硬判据（ISSUE #310）
 收在`dialogBackdropClass()` 里。 */}
      <Sheet
        open={selected !== null}
        onOpenChange={(next) => !next && onClose()}
      >
        <SheetContent
          side="right"
          aria-label={`产出 #${selected?.id.slice(-4) ?? ""}`}
          showCloseButton={false}
          className="gap-0 p-0"
          panelClassName="bg-node border-border-strong w-[380px] max-w-[90vw]"
        >
          {selected && (
            <>
              {/* head */}
              <div className="border-border-strong flex items-center justify-between border-b px-5 py-3">
                <div className="flex items-center gap-2">
                  <h3 className="font-title text-ink-bright text-sm font-bold">
                    产出 #{selected.id.slice(-4)}
                  </h3>
                  <span className="bg-primary/15 text-primary-strong rounded-md px-1.5 py-0.5 text-[10px] font-medium">
                    {TYPE_CHIP[selected.type] ?? selected.type}
                  </span>
                </div>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  onClick={onClose}
                  className="text-ink-muted hover:text-ink"
                  aria-label="关闭"
                >
                  <X data-icon="inline-start" size={16} />
                </Button>
              </div>

              <div className="min-h-0 flex-1 flex-col gap-5 overflow-y-auto p-5">
                {/* reference images */}
                <section>
                  <p className="text-ink-soft mb-2 text-xs font-semibold">
                    参考图
                  </p>
                  {selected.referenceImages.length ? (
                    <div className="grid grid-cols-4 gap-2">
                      {selected.referenceImages.map((image, index) => (
                        <div
                          key={image}
                          className="border-border-strong bg-panel-deep aspect-square overflow-hidden rounded-lg border"
                        >
                          {}
                          <MediaThumbnail
                            src={mediaPreviewUrl(image)}
                            alt={`参考图 ${index + 1}`}
                            className="h-full w-full object-cover"
                          />
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="text-ink-fainter text-[11px]">
                      本次生成无参考图（纯文生图）。
                    </p>
                  )}
                  <p className="text-ink-fainter mt-1.5 text-[10.5px]">
                    参考图随产出一起保存到项目目录，复现时可一键还原。
                  </p>
                </section>

                {/* prompts */}
                <section className="flex flex-col gap-2">
                  <div>
                    <p className="text-ink-soft mb-1 text-xs font-semibold">
                      正向提示词
                    </p>
                    <div className="border-border-strong bg-subtle text-ink-soft max-h-28 overflow-y-auto rounded-lg border p-2.5 text-[12px] leading-relaxed whitespace-pre-wrap">
                      {displayValue(selected.prompt)}
                    </div>
                  </div>
                  {selected.negativePrompt && (
                    <div>
                      <p className="text-ink-soft mb-1 text-xs font-semibold">
                        反向提示词
                      </p>
                      <div className="border-border-strong bg-subtle text-ink-muted max-h-24 overflow-y-auto rounded-lg border p-2.5 text-[12px] leading-relaxed whitespace-pre-wrap">
                        {selected.negativePrompt}
                      </div>
                    </div>
                  )}
                </section>

                {/* params table */}
                <section>
                  <p className="text-ink-soft mb-2 text-xs font-semibold">
                    参数
                  </p>
                  {/* 「取到没有」由`displayValue` 定义（P8），行布局由
`KeyValueRows` 定义（P17）—— 此前这一块两件事各写一遍，
 值自己怎么成文本（`steps` /`cfg` 是数字、`timeAgo` 已是
 字符串）也留在了调用处。 */}
                  <KeyValueRows
                    bordered
                    striped
                    items={[
                      { key: "Seed", raw: selected.seed },
                      { key: "模型", raw: selected.checkpoint },
                      { key: "采样器", raw: selected.sampler },
                      { key: "步数", raw: selected.steps },
                      { key: "CFG", raw: selected.cfg },
                      { key: "尺寸", raw: selected.size },
                      {
                        key: "时间",
                        value: displayValue(timeAgo(selected.createdAt)),
                      },
                    ]}
                  />
                </section>

                {/* source */}
                <section>
                  <p className="text-ink-soft mb-1 text-xs font-semibold">
                    来源
                  </p>
                  <p className="text-ink-soft text-[12px]">
                    工作流：{displayValue(selected.workflowName)}
                  </p>
                </section>
              </div>

              {/* footer actions */}
              <div className="border-border-strong border-t p-4">
                <div className="flex gap-2">
                  <Hint
                    label={
                      copyFailed ? copyFailureText() : "复制元数据到剪贴板"
                    }
                  >
                    <Button
                      variant="primary-solid"
                      size="sm"
                      onClick={onCopy}
                      className="h-auto flex-1 rounded-lg px-3 py-2 text-[12px]"
                    >
                      {copyFailed
                        ? "复制失败"
                        : copySucceeded
                          ? "已复制 ✓"
                          : "复制元数据"}
                    </Button>
                  </Hint>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={onExport}
                    className="border-border-strong text-ink-soft hover:bg-subtle h-auto flex-1 rounded-lg px-3 py-2 text-[12px]"
                  >
                    导出 JSON
                  </Button>
                </div>
                <p className="text-ink-fainter mt-2 text-[10.5px]">
                  文件已保存至{""}
                  <span className="text-ink-muted font-mono">
                    public/generated/projects/{projectId}/{selected.id}/
                  </span>
                </p>
              </div>
            </>
          )}
        </SheetContent>
      </Sheet>
    </>
  );
}
