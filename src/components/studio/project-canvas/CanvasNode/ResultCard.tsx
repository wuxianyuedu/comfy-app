"use client";

import { Hint } from "~/components/ui/hint";
import { Icon } from "~/components/ui/icon";
import { Button } from "~/components/ui/button";
import {
  NODE_META,
  type CanvasNodeData,
  type NodeKind,
} from "~/lib/project-canvas/canvas-types";
import { useCopyFeedback } from "~/components/ui/use-copy-feedback";
import { MediaThumbnail } from "~/components/ui/media-thumbnail";
import { isVideo as isVideoSource } from "~/lib/media/media-kind";
import { NodeChip, StatusBadge } from "./CanvasNodePrimitives";

/* ── 结果预览卡 ──
 * 卡片本身模仿一个节点：它有左上角「类型字符 + 名字」头部
 * 与下方的状态徽标，好让用户一眼读出输出的身份与
 * 生命周期 —— 与父节点上已显示的同一套界面。然后才是
 * 内容（图片 / 视频 / 文本）与一颗替换按钮。 */
export function ResultCard({
  kind,
  name,
  status,
  path,
  mediaType,
  text,
  onReplace,
}: {
  kind: NodeKind;
  name?: string;
  status: CanvasNodeData["status"];
  path?: string;
  mediaType?: string;
  text?: string;
  onReplace: () => void;
}) {
  /* 这枚「下载」（实为复制文本）的失败**显式静默**：产出文本就在下面的
   * 只读块里印着，用户能直接手动选中复制（规范 16 §16.2.4.43）。 */
  const copyResult = useCopyFeedback({ onFailure: "silent" });

  /* 业务事实（节点类型 / 产出元数据）与文件事实（扩展名）分层判断：扩展名那份
   * 判据收敛在 `media-kind.ts`（ISSUE #571），视图层不再自带第四份正则。 */
  const isVideo =
    kind === "video" || mediaType === "video" || isVideoSource(path);
  const src = path?.startsWith("/") ? path : path ? `/${path}` : undefined;
  const meta = NODE_META[kind];
  // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- 空字符串名视为无输出，需用 || 回退到 meta.label
  const displayName = name?.trim() || meta.label;

  /* ── Text result ── */
  if (kind === "script" || kind === "agent" || (!src && text)) {
    return (
      <div className="nodrag nopan border-border-strong bg-subtle relative mt-2 overflow-hidden rounded-xl border">
        {/* 头部 —— 左上：类型字符 + 名字；右上：状态徽标 */}
        <div className="border-border-strong bg-canvas-deep flex items-center justify-between border-b px-2.5 py-1.5">
          <NodeChip kind={kind} name={displayName} size="sm" />
          <StatusBadge status={status} />
        </div>
        {/* Edit toolbar */}
        <div className="border-border-strong bg-canvas-deep flex items-center justify-center gap-1 border-b px-2 py-1.5">
          <Hint label="字号减小">
            <Button
              variant="ghost"
              className="text-ink-soft hover:bg-subtle text-2xs h-auto rounded-md px-2 py-1 font-medium"
            >
              A-
            </Button>
          </Hint>
          <Hint label="字号增大">
            <Button
              variant="ghost"
              className="text-ink-soft hover:bg-subtle text-2xs h-auto rounded-md px-2 py-1 font-medium"
            >
              A+
            </Button>
          </Hint>
          <span className="bg-border-strong mx-1 h-3 w-px" />
          <Hint label="编辑">
            <Button
              variant="ghost"
              className="text-ink-soft hover:bg-subtle text-2xs h-auto rounded-md px-2 py-1 font-normal"
            >
              <Icon
                data-icon="inline-start"
                name="pen"
                size={11}
                className="mr-1 inline align-[-1px]"
              />
              编辑
            </Button>
          </Hint>
          <Hint label="下载">
            <Button
              variant="ghost"
              onClick={() => {
                if (text) copyResult(text);
              }}
              className="text-ink-soft hover:bg-subtle text-2xs h-auto rounded-md px-2 py-1 font-normal"
            >
              <Icon
                data-icon="inline-start"
                name="download"
                size={11}
                className="mr-1 inline align-[-1px]"
              />
              下载
            </Button>
          </Hint>
        </div>
        <div className="text-ink-bright max-h-56 overflow-auto p-3 text-xs leading-relaxed">
          {
            // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- 空字符串也视为无输出，需回退占位
            text || <span className="text-ink-muted">尚无文本输出</span>
          }
        </div>
        <div className="border-border-strong flex items-center justify-center border-t py-2">
          <Button
            variant="outline"
            onClick={onReplace}
            className="bg-canvas-deep text-ink-bright ring-border-strong hover:bg-surface-2 text-2xs flex h-auto items-center gap-1.5 rounded-full px-3 py-1.5 font-normal ring-1"
          >
            <Icon data-icon="inline-start" name="refresh" size={11} />
            替换
          </Button>
        </div>
      </div>
    );
  }

  /* ── 图片 / 视频结果 ── */
  return (
    <div className="nodrag nopan border-border-strong bg-subtle relative mt-2 overflow-hidden rounded-xl border">
      {/* 头部 —— 左上：类型字符 + 名字；右上：状态徽标 */}
      <div className="border-border-strong bg-canvas-deep flex items-center justify-between border-b px-2.5 py-1.5">
        <NodeChip kind={kind} name={displayName} size="sm" />
        <StatusBadge status={status} />
      </div>
      <div className="from-subtle to-canvas-deep relative flex aspect-video items-center justify-center bg-linear-to-br">
        {!src ? (
          <Icon
            name={isVideo ? "film" : "image"}
            size={32}
            className="text-ink-fainter"
          />
        ) : isVideo ? (
          <MediaThumbnail
            src={src}
            /* `as="video"`：`mediaType` / `kind` 已判过视频，而媒体路径
             * 可能是 `.png`（ComfyUI 把视频帧存成图片后缀）—— 语义判断
             * 优先于后缀推断（§16.2.4.21 的口径）。 */
            as="video"
            controls
            autoPlay
            loop
            muted
            className="max-h-56 w-full object-contain"
          />
        ) : (
          <MediaThumbnail
            src={src}
            alt="result"
            className="max-h-56 w-full object-contain"
          />
        )}
      </div>
      <div className="border-border-strong flex items-center justify-center border-t py-2">
        <Button
          variant="outline"
          onClick={onReplace}
          className="bg-canvas-deep text-ink-bright ring-border-strong hover:bg-surface-2 text-2xs flex h-auto items-center gap-1.5 rounded-full px-3 py-1.5 font-normal ring-1"
        >
          <Icon data-icon="inline-start" name="refresh" size={11} />
          替换
        </Button>
      </div>
    </div>
  );
}
