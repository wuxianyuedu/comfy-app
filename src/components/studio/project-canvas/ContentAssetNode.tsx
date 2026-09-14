 
"use client";

import React from "react";
import { ChevronLeft, ChevronRight, X } from "lucide-react";
import { Icon } from "@/components/ui/icon";
import { WaterFillProgress } from "@/components/studio/ui/WaterFillProgress";
import { useContentAssetGallery } from "./hooks/use-content-asset-gallery";
import type { CanvasNodeData } from "@/lib/project-canvas/canvas-types";
import { overlayClass } from "~/lib/full-screen-layer";

/* 项目画布 · 内容载体节点主体（text / picture / movie）
 * 对齐 Ardot 稿 715394877779066 v2 + icon 迭代（/ -D-v2 / -D-icon）：
 *  - 边框内 ~100% 预览区：图片/视频填满（object-cover）、文本 textarea 填满，
 *    空状态居中类型图标 + helper 文案，呼应「整个节点边框内几乎 100% 区域显示内容」。
 *  - 右下 36×36 圆 FAB（类型色填充 + 白色图标）：图片/视频=上传、文本=编辑聚焦。
 *  - 端口 Handle 仍由 CanvasNode 渲染（picture 左侧 inputImage + 三类型右侧 output），
 *    本组件只负责「内容区 + FAB」，不碰 Handle，避免破坏连线 / 选择行为。
 * 类型配色（与 globals.css token 1:1）：图=#7C5CFC 紫 / 文=#FF5CA8 粉 / 视频=#FB923C 橙。
 * 标题由 CanvasNode 既有 NodeChip 头承载（与画布其它节点一致，不浮出边框）。 */

const ASSET_ACCENT: Record<"text" | "picture" | "movie", string> = {
  text: "#FF5CA8",
  picture: "#7C5CFC",
  movie: "#FB923C",
};

export function ContentAssetBody({
  kind,
  data,
  onPatch,
  onPickMedia,
  onUploadFile,
  /* progress overlay while a generation is in
   *  flight. Rendered only when status === "running"; otherwise the body
   *  falls back to the existing empty/populated preview. */
  status,
  progress,
}: {
  kind: "text" | "picture" | "movie";
  data: CanvasNodeData;
  onPatch: (p: Partial<CanvasNodeData>) => void;
  onPickMedia: (k: "picture" | "movie") => void;
  /* drag-and-drop upload onto the dashed area.
   *  Previously the area was a <button> with onClick={onPickMedia};
   *  user wants the dashed area to be drop-only — file picker is now only
   *  reachable from the bottom-right FAB. */
  onUploadFile?: (file: File) => void | Promise<void>;
  status?: CanvasNodeData["status"];
  progress?: number;
}) {
  const accent = ASSET_ACCENT[kind];
  /* Local drag-over highlight so the user can see where the drop lands.
   *  Lives at the top so both the empty-state branch and any future
   *  drop-zone wiring share the same boolean. */
  const [isDropOver, setIsDropOver] = React.useState(false);
  const textareaRef = React.useRef<HTMLTextAreaElement>(null);
  /* 多图相册：数据（图片列表）+ 开关/下标都在 hook 里，视图只消费。
   * movie / text 节点不拉（enabled=false），避免无谓请求。 */
  const gallery = useContentAssetGallery({
    taskId: data.taskId,
    enabled: kind === "picture",
  });
  if (kind === "text") {
    return (
      <div className="relative">
        <textarea
          ref={textareaRef}
          className="border-border-strong bg-canvas-deep text-ink-bright h-[260px] w-full resize-none rounded-xl border px-3 py-2.5 text-[12px] leading-relaxed transition-colors outline-none focus:border-violet-500/40"
          value={data.content ?? ""}
          placeholder="输入要喂给下游生成节点的提示词 / 参考文字…"
          onChange={(event) => onPatch({ content: event.target.value })}
        />
        <button
          type="button"
          onClick={() => textareaRef.current?.focus()}
          title="编辑文本"
          className="absolute bottom-3 right-3 flex h-9 w-9 items-center justify-center rounded-full text-white shadow-lg shadow-black/30 transition-transform hover:scale-105"
          style={{ background: accent }}
        >
          <Icon name="pen" size={16} />
        </button>
      </div>
    );
  }

  // picture / movie
  const isPic = kind === "picture";
  const mediaSrc = data.mediaPath
    ? `/api/images?filename=${encodeURIComponent(data.mediaPath)}&type=input`
    : undefined;

  /* 相册区已在下方用 `galleryImages` 收窄过一次：JSX 回调里的 TS 不会沿
   * 用外层的 `gallery.images &&` 判空，故先取成局部常量。 */
  const galleryImages = gallery.images ?? [];
  const imageCount = galleryImages.length;

  return (
    <div className="relative">
      {mediaSrc ? (
        isPic ? (
           
          <img
            src={mediaSrc}
            alt={data.mediaName ?? "参考图"}
            className="border-border-strong bg-canvas-deep h-[260px] w-full rounded-xl border object-cover"
            onClick={() => { if (imageCount > 1) { gallery.setIndex(0); gallery.setOpen(true); } }}
            style={imageCount > 1 ? { cursor: "pointer" } : undefined}
          />
        ) : (
          <video
            src={mediaSrc}
            controls
            className="border-border-strong bg-canvas-deep h-[260px] w-full rounded-xl border object-cover"
          />
        )
      ) : (
        /* 虚线大区改为 drop-only。
         *  - 不再是 <button>，所以点击**不会**触发文件选择器（用户要的就是这点）。
         *  - 仍然需要 `nodrag nopan` + onPointerDown/onMouseDown stopPropagation，
         *    否则 React Flow v12 节点 wrapper 在 mousedown 时进入 drag-suspect
         *    状态会吞掉 drop 事件。
         *  - onDragOver 主动 preventDefault() 是让 drop 真正可触发的必要条件
         *    （HTML5 drag-and-drop 规范要求）。
         *  - dragover 高亮 + 加深边框颜色给用户视觉反馈。
         *  文件选择器现在**只**能从右下角 FAB 触发（onPickMedia）。
         *  历史：曾用 button + nodrag 三件套做点击触发；本次反向修复。 */
        <div
          onDrop={(event) => {
            event.preventDefault();
            event.stopPropagation();
            setIsDropOver(false);
            const f = event.dataTransfer.files?.[0];
            if (f && onUploadFile) void onUploadFile(f);
          }}
          onDragOver={(event) => {
            event.preventDefault();
            event.stopPropagation();
            /* Only highlight when a file (not a node/edge) is being dragged
             *  over — `types` includes "Files" for native file drags. */
            const types = Array.from(event.dataTransfer.types ?? []);
            if (types.includes("Files") && !isDropOver) setIsDropOver(true);
            event.dataTransfer.dropEffect = "copy";
          }}
          onDragLeave={(event) => {
            event.preventDefault();
            event.stopPropagation();
            setIsDropOver(false);
          }}
          onPointerDown={(event) => event.stopPropagation()}
          onMouseDown={(event) => event.stopPropagation()}
          className={`nodrag nopan text-ink-soft flex h-[260px] w-full flex-col items-center justify-center gap-2.5 rounded-xl border border-dashed transition-colors ${
            isDropOver
              ? "bg-violet-500/10 text-ink-bright border-violet-500/70"
              : "border-ink-fainter bg-canvas-deep hover:text-ink-bright hover:border-ink-soft"
          }`}
        >
          <Icon name={isPic ? "image" : "film"} size={38} className="opacity-60" />
          <span className="text-[12px]">
            {isPic ? "拖入上传图片" : "拖入上传视频"}
          </span>
        </div>
      )}
      {/* "水逐渐装满" 进度覆盖层 — 仅当 status ===
       *  "running" 时渲染。absolute inset-0 + pointer-events-none 让它覆盖
       *  整个预览区但不拦截 FAB / 拖入 / 点击。FAB 是后渲染的兄弟节点，
       *  视觉上自然压在覆盖层之上。 */}
      {status === "running" && <WaterFillProgress progress={progress ?? 0} />}
      <button
        type="button"
        onClick={() => onPickMedia(isPic ? "picture" : "movie")}
        title={isPic ? "上传图片" : "上传视频"}
        className="absolute bottom-3 right-3 flex h-9 w-9 items-center justify-center rounded-full text-white shadow-lg shadow-black/30 transition-transform hover:scale-105"
        style={{ background: accent }}
      >
        <Icon name="plus" size={18} />
      </button>

      {/* 多图数量标签（右上角） */}
      {imageCount > 1 && mediaSrc && (
        <button
          type="button"
          onClick={() => { gallery.setIndex(0); gallery.setOpen(true); }}
          className="absolute right-2.5 top-2.5 flex h-5 min-w-[20px] items-center justify-center rounded-full bg-black/70 px-1.5 text-[10px] font-medium tabular-nums text-white/90 shadow-md backdrop-blur-sm ring-1 ring-white/10 transition-colors hover:bg-violet-500/80 hover:text-white"
          title={`查看全部 ${imageCount} 张图片`}
        >
          {imageCount}
        </button>
      )}

      {/* ── 画廊覆盖层 ── */}
      {gallery.open && galleryImages.length > 0 && (
        <div
          className={overlayClass(
            "modal",
            "z-100 flex items-center justify-center bg-black/40 backdrop-blur-sm dark:bg-black/80",
          )}
          onClick={() => gallery.setOpen(false)}
          role="dialog"
          aria-modal
          aria-label="图片画廊"
        >
          {/* 关闭按钮 */}
          <button
            type="button"
            onClick={(event) => { event.stopPropagation(); gallery.setOpen(false); }}
            className="bg-subtle text-ink-soft hover:bg-surface-2 absolute top-4 right-4 flex h-8 w-8 items-center justify-center rounded-full transition-colors hover:text-white"
            title="关闭"
          >
            <X size={16} />
          </button>

          {/* 主图 */}
          <img
            src={`/api/images?filename=${encodeURIComponent(galleryImages[gallery.index]?.localPath ?? "")}&type=input`}
            alt={`图片 ${gallery.index + 1}/${galleryImages.length}`}
            className="border-border-strong max-h-[85vh] max-w-[85vw] rounded-lg border object-contain shadow-2xl"
            onClick={(event) => event.stopPropagation()}
          />

          {/* 左右切换 + 计数 */}
          {galleryImages.length > 1 && (
            <>
              <button
                type="button"
                onClick={(event) => {
                  event.stopPropagation();
                  gallery.setIndex((index) => (index - 1 + galleryImages.length) % galleryImages.length);
                }}
                disabled={galleryImages.length <= 1}
                className="bg-subtle text-ink-soft hover:bg-surface-2 absolute top-1/2 left-4 flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-full transition-colors hover:text-white disabled:opacity-30"
                title="上一张"
              >
                <ChevronLeft size={18} />
              </button>
              <button
                type="button"
                onClick={(event) => {
                  event.stopPropagation();
                  gallery.setIndex((index) => (index + 1) % galleryImages.length);
                }}
                disabled={galleryImages.length <= 1}
                className="bg-subtle text-ink-soft hover:bg-surface-2 absolute top-1/2 right-4 flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-full transition-colors hover:text-white disabled:opacity-30"
                title="下一张"
              >
                <ChevronRight size={18} />
              </button>
              {/* 底部计数 + 缩略条 */}
              <div className="absolute bottom-4 left-1/2 flex -translate-x-1/2 items-center gap-3">
                <span className="rounded-full bg-black/60 px-3 py-1 text-[11px] font-medium tabular-ns text-white/90 backdrop-blur-sm">
                  {gallery.index + 1} / {galleryImages.length}
                </span>
                <div className="bg-subtle flex gap-1.5 overflow-hidden rounded-full p-1 backdrop-blur-sm">
                  {galleryImages.map((img, i) => (
                    <button
                      key={img.id}
                      type="button"
                      onClick={(event) => {
                        event.stopPropagation();
                        gallery.setIndex(i);
                      }}
                      className={`h-6 w-6 shrink-0 overflow-hidden rounded-full border-2 transition-all ${
                        i === gallery.index
                          ? "border-violet-400 opacity-100"
                          : "border-transparent opacity-50 hover:opacity-80"
                      }`}
                      title={`第 ${i + 1} 张`}
                    >
                      <img
                        src={`/api/images?filename=${encodeURIComponent(img.localPath)}&type=input`}
                        alt=""
                        className="h-full w-full object-cover"
                      />
                    </button>
                  ))}
                </div>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
