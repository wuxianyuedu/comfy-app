import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { MediaThumbnail } from "~/components/ui/media-thumbnail";
import { Card } from "~/components/ui/card";
import { displayValue } from "~/lib/display-value";

import { modelCoverGradient } from "./model-cover";
import { modelTypeLabel } from "./model-type-labels";

/**
 * 卡片消费的数据 = `modelRepository.list()` 返回的 `model` 表行的**子集**。
 *
 * 字段名刻意与库里保持一致（`coverUrl` 而不是 `cover`）：此前这里写的是 `cover`，
 * 而库里那一列叫 `coverUrl`，中间又没有任何映射层（hook 直接把行 cast 过来）——
 * 于是封面**从来没有渲染出来过**，每张卡都在走渐变兜底，而界面看起来「只是没有图」。
 * 现在按真名取，缺图与字段名写错才是两件能分开的事。
 *
 * 另外这里**不再有** `uses` / `likes`：`model` 表没有这两列（本机模型库也不是模型站），
 * 原先留着就是两个永远 undefined 的假字段，渲染出一个永远空着的格子。
 */
export type ModelCardData = {
  id: string;
  name: string;
  type: string;
  fileName?: string;
  folder?: string | null;
  subfolder?: string | null;
  baseModel?: string | null;
  coverUrl?: string | null;
  description?: string | null;
  source?: string;
  isAvailable?: boolean;
  createdAt?: string | Date | null;
};

export function ModelCard({
  model,
  onOpen,
}: {
  model: ModelCardData;
  /** 打开详情。整张卡就是一个触发器 —— 不再指向 `/models/[id]`：那条路由不存在，
   *  点进去是 404（详情改为弹窗，见 `ModelDetailDialog`）。 */
  onOpen: (model: ModelCardData) => void;
}) {
  const grad = modelCoverGradient(model.id);
  return (
    <Button
      type="button"
      variant="ghost"
      /* 卡片本体是触发器：`h-auto w-full p-0` 把按钮的盒子让给 Card，
         圆角/边框/悬浮阴影这些外壳形态仍由 `ui/card` 持有（规范 16 §16.2.3）。 */
      className="h-auto w-full p-0 text-left [&:not(:hover)]:bg-transparent"
      onClick={() => onOpen(model)}
      aria-label={`查看 ${model.name} 详情`}
    >
      <Card className="group border-border bg-surface gap-0 py-0 transition-shadow group-hover:shadow-[0_8px_30px_rgba(20,20,40,0.10)]">
        <div className="relative aspect-4/3 w-full overflow-hidden">
          {model.coverUrl ? (
            <MediaThumbnail
              src={model.coverUrl}
              alt={model.name}
              className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
              /* 加载失败落回与「没有封面」同一个渐变底 —— 同一张卡的
                 两种缺图原因不该长得不一样。 */
              fallback={
                <span
                  className="block h-full w-full"
                  style={{ background: grad }}
                />
              }
            />
          ) : (
            <div
              className="h-full w-full transition-transform duration-300 group-hover:scale-105"
              style={{ background: grad }}
            />
          )}
          {/* 类型徽标走 ui/badge：它是「浮在图片上的极小面积叠层」，浅底会与封面
              糊在一起 —— 走 §3.6.1 的固定暗色判据，故底色仍取 `bg-black/45`。 */}
          <Badge className="absolute top-2 left-2 rounded-md border-transparent bg-black/45 px-2 py-0.5 text-xs font-medium text-white backdrop-blur">
            {modelTypeLabel(model.type)}
          </Badge>
        </div>
        <div className="p-3">
          <p className="u-title truncate">{model.name}</p>
          <div className="text-muted-foreground mt-1 flex items-center justify-between gap-2 text-xs">
            {/* 基座未知就显示占位符，不写死「SDXL」：那会让一个 SD1.5 的模型
                在卡面上被说成 SDXL，而用户没有别的地方能看出来。 */}
            <span className="min-w-0 truncate">
              {displayValue(model.baseModel)}
            </span>
            {model.fileName && (
              <span className="u-mono shrink-0 opacity-70">
                {model.fileName}
              </span>
            )}
          </div>
        </div>
      </Card>
    </Button>
  );
}
