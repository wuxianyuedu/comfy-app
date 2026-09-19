"use client";

import React from "react";
import { ChevronLeft, ChevronRight, X } from "lucide-react";
import { Icon } from "~/components/ui/icon";
import { Button } from "~/components/ui/button";
import { WaterFillProgress } from "~/components/ui/water-fill-progress";
import { useContentAssetGallery } from "./hooks/use-content-asset-gallery";
import type { CanvasNodeData } from "~/lib/project-canvas/canvas-types";
import { Dialog, DialogContent } from "~/components/ui/dialog";

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
  /* 生成进行中的进度覆盖层。
   *  只在 status === "running" 时渲染；否则卡片体
   *  回落到既有的空 / 有内容预览。 */
  status,
  progress,
}: {
  kind: "text" | "picture" | "movie";
  data: CanvasNodeData;
  onPatch: (p: Partial<CanvasNodeData>) => void;
  onPickMedia: (k: "picture" | "movie") => void;
  /* 拖放到虚线区上传。
   *  该区域**曾**是带 onClick={onPickMedia} 的按钮元素；用户希望虚线区
   *  只接受拖放 —— 文件选择器现在只能从右下角 FAB 触发。 */
  onUploadFile?: (file: File) => void | Promise<void>;
  status?: CanvasNodeData["status"];
  progress?: number;
}) {
  const accent = ASSET_ACCENT[kind];
  /* 本地拖入高亮，好让用户看到落点在哪。
   *  放在顶部，好让空态分支与日后任何
   *  拖放区接线共用同一个布尔量。 */
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
        <Button
          variant="ghost"
          size="icon-lg"
          onClick={() => textareaRef.current?.focus()}
          title="编辑文本"
          className="absolute right-3 bottom-3 rounded-full text-white shadow-lg shadow-black/30 transition-transform hover:scale-105 hover:bg-transparent hover:text-white"
          style={{ background: accent }}
        >
          <Icon name="pen" size={16} />
        </Button>
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
            onClick={() => {
              if (imageCount > 1) {
                gallery.setIndex(0);
                gallery.setOpen(true);
              }
            }}
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
         *  - 不再是按钮元素，所以点击**不会**触发文件选择器（用户要的就是这点）。
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
            /* 只有当拖入的是文件（不是节点 / 边）时才高亮
             *  —— `types` 对原生文件拖拽含 "Files"。 */
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
              ? "text-ink-bright border-violet-500/70 bg-violet-500/10"
              : "border-ink-fainter bg-canvas-deep hover:text-ink-bright hover:border-ink-soft"
          }`}
        >
          <Icon
            name={isPic ? "image" : "film"}
            size={38}
            className="opacity-60"
          />
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
      <Button
        variant="ghost"
        size="icon-lg"
        onClick={() => onPickMedia(isPic ? "picture" : "movie")}
        title={isPic ? "上传图片" : "上传视频"}
        className="absolute right-3 bottom-3 rounded-full text-white shadow-lg shadow-black/30 transition-transform hover:scale-105 hover:bg-transparent hover:text-white"
        style={{ background: accent }}
      >
        <Icon name="plus" size={18} />
      </Button>

      {/* 多图数量标签（右上角） */}
      {imageCount > 1 && mediaSrc && (
        <Button
          variant="ghost"
          size="icon-xs"
          onClick={() => {
            gallery.setIndex(0);
            gallery.setOpen(true);
          }}
          className="absolute top-2.5 right-2.5 h-auto min-w-[20px] rounded-full bg-black/70 px-1.5 text-[10px] font-medium text-white/90 tabular-nums shadow-md ring-1 ring-white/10 backdrop-blur-sm hover:bg-violet-500/80 hover:text-white"
          title={`查看全部 ${imageCount} 张图片`}
        >
          {imageCount}
        </Button>
      )}

      {/* ── 画廊覆盖层 ── */}
      {/* 关闭语义（Esc / 点遮罩 / 焦点锁与归还）交给 `ui/dialog`：此前 `role` /
          `aria-modal` / 遮罩点击都手写齐了，但 Esc 与焦点锁仍缺 —— 键盘用户
          进得来出不去。 */}
      <Dialog
        open={gallery.open && galleryImages.length > 0}
        onOpenChange={(next) => !next && gallery.setOpen(false)}
      >
        <DialogContent
          aria-label="图片画廊"
          showCloseButton={false}
          className="bg-transparent p-0 ring-0"
          popupClassName="flex max-w-none items-center justify-center bg-transparent"
        >
          {/* 关闭按钮 */}
          <Button
            variant="ghost"
            size="icon"
            onClick={(event) => {
              event.stopPropagation();
              gallery.setOpen(false);
            }}
            className="bg-subtle text-ink-soft hover:bg-surface-2 absolute top-4 right-4 rounded-full hover:text-white"
            title="关闭"
          >
            <X size={16} />
          </Button>

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
              <Button
                variant="ghost"
                size="icon-lg"
                onClick={(event) => {
                  event.stopPropagation();
                  gallery.setIndex(
                    (index) =>
                      (index - 1 + galleryImages.length) % galleryImages.length,
                  );
                }}
                disabled={galleryImages.length <= 1}
                className="bg-subtle text-ink-soft hover:bg-surface-2 absolute top-1/2 left-4 -translate-y-1/2 rounded-full hover:text-white"
                title="上一张"
              >
                <ChevronLeft size={18} />
              </Button>
              <Button
                variant="ghost"
                size="icon-lg"
                onClick={(event) => {
                  event.stopPropagation();
                  gallery.setIndex(
                    (index) => (index + 1) % galleryImages.length,
                  );
                }}
                disabled={galleryImages.length <= 1}
                className="bg-subtle text-ink-soft hover:bg-surface-2 absolute top-1/2 right-4 -translate-y-1/2 rounded-full hover:text-white"
                title="下一张"
              >
                <ChevronRight size={18} />
              </Button>
              {/* 底部计数 + 缩略条 */}
              <div className="absolute bottom-4 left-1/2 flex -translate-x-1/2 items-center gap-3">
                <span className="tabular-ns rounded-full bg-black/60 px-3 py-1 text-[11px] font-medium text-white/90 backdrop-blur-sm">
                  {gallery.index + 1} / {galleryImages.length}
                </span>
                <div className="bg-subtle flex gap-1.5 overflow-hidden rounded-full p-1 backdrop-blur-sm">
                  {galleryImages.map((img, i) => (
                    <Button
                      key={img.id}
                      variant="ghost"
                      size="icon-xs"
                      onClick={(event) => {
                        event.stopPropagation();
                        gallery.setIndex(i);
                      }}
                      className={`h-auto w-6 shrink-0 overflow-hidden rounded-full border-2 p-0 hover:bg-transparent ${
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
                    </Button>
                  ))}
                </div>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
