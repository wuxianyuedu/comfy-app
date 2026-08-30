 
"use client";

import React from "react";
import { ChevronLeft, ChevronRight, X } from "lucide-react";
import { Icon } from "@/components/ui/Icon";
import { WaterFillProgress } from "@/components/studio/ui/WaterFillProgress";
import { vanillaApi } from "~/trpc/vanilla";
import type { CanvasNodeData } from "./canvas-types";

/* 项目画布 · 内容载体节点主体（text / picture / movie）
 * 对齐 Ardot 稿 715394877779066 v2 + icon 迭代（R-ardot73-D / -D-v2 / -D-icon）：
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
  /* R-ardot103 (2026-08-17): progress overlay while a generation is in
   *  flight. Rendered only when status === "running"; otherwise the body
   *  falls back to the existing empty/populated preview. */
  status,
  progress,
}: {
  kind: "text" | "picture" | "movie";
  data: CanvasNodeData;
  onPatch: (p: Partial<CanvasNodeData>) => void;
  onPickMedia: (k: "picture" | "movie") => void;
  /* R-ardot101 (2026-08-17): drag-and-drop upload onto the dashed area.
   *  Previously the area was a <button> with onClick={onPickMedia} (R96);
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
  const [taskImages, setTaskImages] = React.useState<{
    id: string;
    localPath: string;
    isCover: boolean;
  }[] | null>(null);
  const [galleryOpen, setGalleryOpen] = React.useState(false);
  const [galleryIndex, setGalleryIndex] = React.useState(0);

  // Clear stale images when the task / kind switches to a non-picture state
  // (adjusted during render, React 19 pattern).
  const picCtx = `${data.taskId}|${kind}`;
  const [prevPicCtx, setPrevPicCtx] = React.useState(picCtx);
  if (picCtx !== prevPicCtx) {
    setPrevPicCtx(picCtx);
    if (!data.taskId || kind !== "picture") setTaskImages(null);
  }

  React.useEffect(() => {
    const taskId = data.taskId;
    if (!taskId || kind !== "picture") return;
    let cancelled = false;
    void (async () => {
      try {
        if (cancelled) return;
        const t = await vanillaApi.task.detail.query({ id: taskId });
        const rawImgs = (t.images ?? []) as unknown as {
          id?: string;
          localPath?: string;
          isCover?: boolean;
        }[];
        const imgs: { id: string; localPath: string; isCover: boolean }[] | undefined =
          rawImgs
            .filter((img) => !!img && typeof img.localPath === "string")
            .map((img) => ({
              id: img.id ?? "",
              localPath: img.localPath!,
              isCover: img.isCover ?? false,
            }));
        if (!cancelled) setTaskImages(imgs && imgs.length > 1 ? imgs : null);
      } catch {
        /* silently ignore — 单图模式仍正常显示 */
      }
    })();
    return () => { cancelled = true; };
  }, [data.taskId, kind]);

  if (kind === "text") {
    return (
      <div className="relative">
        <textarea
          ref={textareaRef}
          className="h-[260px] w-full resize-none rounded-xl border border-white/8 bg-black/20 px-3 py-2.5 text-[12px] leading-relaxed text-gray-200 outline-none transition-colors focus:border-violet-500/40"
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

  const imageCount = taskImages?.length ?? 0;

  return (
    <div className="relative">
      {mediaSrc ? (
        isPic ? (
           
          <img
            src={mediaSrc}
            alt={data.mediaName ?? "参考图"}
            className="h-[260px] w-full rounded-xl border border-white/8 bg-black/20 object-cover"
            onClick={() => { if (imageCount > 1) { setGalleryIndex(0); setGalleryOpen(true); } }}
            style={imageCount > 1 ? { cursor: "pointer" } : undefined}
          />
        ) : (
          <video
            src={mediaSrc}
            controls
            className="h-[260px] w-full rounded-xl border border-white/8 bg-black/20 object-cover"
          />
        )
      ) : (
        /* R-ardot101 (2026-08-17): 虚线大区改为 drop-only。
         *  - 不再是 <button>，所以点击**不会**触发文件选择器（用户要的就是这点）。
         *  - 仍然需要 `nodrag nopan` + onPointerDown/onMouseDown stopPropagation，
         *    否则 React Flow v12 节点 wrapper 在 mousedown 时进入 drag-suspect
         *    状态会吞掉 drop 事件。
         *  - onDragOver 主动 preventDefault() 是让 drop 真正可触发的必要条件
         *    （HTML5 drag-and-drop 规范要求）。
         *  - dragover 高亮 + 加深边框颜色给用户视觉反馈。
         *  文件选择器现在**只**能从右下角 FAB 触发（onPickMedia）。
         *  R-ardot96 历史：曾用 button + nodrag 三件套做点击触发；本次反向修复。 */
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
          className={`nodrag nopan flex h-[260px] w-full flex-col items-center justify-center gap-2.5 rounded-xl border border-dashed text-gray-400 transition-colors ${
            isDropOver
              ? "border-violet-500/70 bg-violet-500/10 text-gray-200"
              : "border-white/14.000000000000002 bg-black/15 hover:border-white/30 hover:text-gray-200"
          }`}
        >
          <Icon name={isPic ? "image" : "film"} size={38} className="opacity-60" />
          <span className="text-[12px]">
            {isPic ? "拖入上传图片" : "拖入上传视频"}
          </span>
        </div>
      )}
      {/* R-ardot103 (2026-08-17): "水逐渐装满" 进度覆盖层 — 仅当 status ===
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
          onClick={() => { setGalleryIndex(0); setGalleryOpen(true); }}
          className="absolute right-2.5 top-2.5 flex h-5 min-w-[20px] items-center justify-center rounded-full bg-black/70 px-1.5 text-[10px] font-medium tabular-nums text-white/90 shadow-md backdrop-blur-sm ring-1 ring-white/10 transition-colors hover:bg-violet-500/80 hover:text-white"
          title={`查看全部 ${imageCount} 张图片`}
        >
          {imageCount}
        </button>
      )}

      {/* ── 画廊覆盖层 ── */}
      {galleryOpen && taskImages && taskImages.length > 0 && (
        <div
          className="fixed inset-0 z-100 flex items-center justify-center bg-black/80 backdrop-blur-sm"
          onClick={() => setGalleryOpen(false)}
          role="dialog"
          aria-modal
          aria-label="图片画廊"
        >
          {/* 关闭按钮 */}
          <button
            type="button"
            onClick={(event) => { event.stopPropagation(); setGalleryOpen(false); }}
            className="absolute top-4 right-4 flex h-8 w-8 items-center justify-center rounded-full bg-white/10 text-gray-300 transition-colors hover:bg-white/20 hover:text-white"
            title="关闭"
          >
            <X size={16} />
          </button>

          {/* 主图 */}
          <img
            src={`/api/images?filename=${encodeURIComponent(taskImages[galleryIndex]?.localPath ?? "")}&type=input`}
            alt={`图片 ${galleryIndex + 1}/${taskImages.length}`}
            className="max-h-[85vh] max-w-[85vw] rounded-lg border border-white/8 object-contain shadow-2xl"
            onClick={(event) => event.stopPropagation()}
          />

          {/* 左右切换 + 计数 */}
          {taskImages.length > 1 && (
            <>
              <button
                type="button"
                onClick={(event) => {
                  event.stopPropagation();
                  setGalleryIndex((index) => (index - 1 + taskImages.length) % taskImages.length);
                }}
                disabled={taskImages.length <= 1}
                className="absolute left-4 top-1/2 -translate-y-1/2 flex h-10 w-10 items-center justify-center rounded-full bg-white/10 text-gray-300 transition-colors hover:bg-white/20 hover:text-white disabled:opacity-30"
                title="上一张"
              >
                <ChevronLeft size={18} />
              </button>
              <button
                type="button"
                onClick={(event) => {
                  event.stopPropagation();
                  setGalleryIndex((index) => (index + 1) % taskImages.length);
                }}
                disabled={taskImages.length <= 1}
                className="absolute right-4 top-1/2 -translate-y-1/2 flex h-10 w-10 items-center justify-center rounded-full bg-white/10 text-gray-300 transition-colors hover:bg-white/20 hover:text-white disabled:opacity-30"
                title="下一张"
              >
                <ChevronRight size={18} />
              </button>
              {/* 底部计数 + 缩略条 */}
              <div className="absolute bottom-4 left-1/2 flex -translate-x-1/2 items-center gap-3">
                <span className="rounded-full bg-black/60 px-3 py-1 text-[11px] font-medium tabular-ns text-white/90 backdrop-blur-sm">
                  {galleryIndex + 1} / {taskImages.length}
                </span>
                <div className="flex gap-1.5 overflow-hidden rounded-full bg-white/10 p-1 backdrop-blur-sm">
                  {taskImages.map((img, i) => (
                    <button
                      key={img.id}
                      type="button"
                      onClick={(event) => {
                        event.stopPropagation();
                        setGalleryIndex(i);
                      }}
                      className={`h-6 w-6 shrink-0 overflow-hidden rounded-full border-2 transition-all ${
                        i === galleryIndex
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
