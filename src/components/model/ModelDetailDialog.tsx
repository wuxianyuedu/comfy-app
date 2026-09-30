"use client";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "~/components/ui/dialog";
import { KeyValueRows } from "~/components/ui/key-value-rows";
import { MediaThumbnail } from "~/components/ui/media-thumbnail";
import { displayValue } from "~/lib/display-value";
import { formatDate } from "~/lib/time-format";

import { modelCoverGradient } from "./model-cover";
import { modelTypeLabel } from "./model-type-labels";
import type { ModelCardData } from "./ModelCard";

/** 目录 = `folder` + `subfolder`，两者都可能为空（库里是 nullable 列）。 */
export function modelDisplayPath(
  model: Pick<ModelCardData, "folder" | "subfolder">,
): string {
  return [model.folder, model.subfolder]
    .filter((part): part is string => Boolean(part))
    .join("/");
}

/**
 * 模型详情弹窗。
 *
 * 为什么是弹窗而不是路由：卡片此前一路链到 `/models/${id}`，而 `src/app/(main)/models/`
 * 下**只有 page.tsx** —— 那条路由从来不存在，点任何一张卡都是 404。补一条路由意味着
 * 再引入一次列表→详情→返回列表的状态往返（页签栏、ProjectGate、视图恢复都要跟着改），
 * 而这一屏要给用户的答案只有「这个模型是什么、在哪、能不能用」。详情是列表上下文里的
 * 一次性查看，弹窗把上下文留在原地。
 *
 * 字段只列 `model` 表里真有的那些。原型上的「N 次引用 · N 次收藏」刻意没搬 ——
 * 本机模型库不是模型站，库里没有这两列，凭空渲染一个数字就是假数据。
 */
export function ModelDetailDialog({
  model,
  onClose,
}: {
  model: ModelCardData | null;
  onClose: () => void;
}) {
  if (!model) return null;
  const grad = modelCoverGradient(model.id);
  const path = modelDisplayPath(model);
  const description = model.description?.trim();

  return (
    <Dialog open onOpenChange={(next) => !next && onClose()}>
      <DialogContent
        aria-label={`${model.name} 详情`}
        className="max-h-[85vh] overflow-y-auto sm:max-w-lg"
      >
        <DialogHeader>
          <DialogTitle className="u-title truncate">{model.name}</DialogTitle>
          <DialogDescription>
            {modelTypeLabel(model.type)}
            {model.source ? ` · 来源 ${model.source}` : ""}
          </DialogDescription>
        </DialogHeader>

        <div className="border-border relative aspect-video w-full overflow-hidden rounded-lg border">
          {model.coverUrl ? (
            <MediaThumbnail
              src={model.coverUrl}
              alt={model.name}
              className="h-full w-full object-cover"
              fallback={
                <span
                  className="block h-full w-full"
                  style={{ background: grad }}
                />
              }
            />
          ) : (
            <div className="h-full w-full" style={{ background: grad }} />
          )}
        </div>

        <KeyValueRows
          layout="rows"
          items={[
            { key: "文件名", value: displayValue(model.fileName) },
            { key: "类型", value: modelTypeLabel(model.type) },
            {
              key: "所在目录",
              value: displayValue(path || null),
            },
            { key: "基座", value: displayValue(model.baseModel) },
            { key: "来源", value: displayValue(model.source) },
            {
              key: "状态",
              /* 库里 `isAvailable` 是 boolean 且默认 false —— 「没这一列」与
                 「明确不可用」不是一回事，别把 undefined 说成不可用。 */
              value:
                model.isAvailable === undefined
                  ? displayValue(null)
                  : model.isAvailable
                    ? "可用"
                    : "不可用",
            },
            {
              key: "入库时间",
              /* 占位符不自己写「—」：`displayValue` 是唯一出处（P8）。 */
              value: displayValue(
                model.createdAt ? formatDate(model.createdAt) : null,
              ),
            },
          ]}
        />

        {description && (
          <p className="text-muted-foreground text-sm leading-relaxed">
            {description}
          </p>
        )}

        {/* 明确说出这里**没有**什么：使用次数/作者/许可证这些模型站才有的信息，
            本机扫描拿不到 —— 不写出来，用户会以为界面在藏。 */}
        <p className="text-muted-foreground/70 text-xs">
          以上字段来自本机 ComfyUI 模型目录的扫描结果；使用量、作者、许可证等
          信息本地扫描拿不到，因此不在这里显示。
        </p>
      </DialogContent>
    </Dialog>
  );
}
