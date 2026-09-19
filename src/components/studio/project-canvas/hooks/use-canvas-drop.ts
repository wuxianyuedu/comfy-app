"use client";

/** 从 ProjectCanvas 抽出 —— 媒体拖放落到画布
 *  的逻辑。素材库 / 历史面板经 `placeMediaNode`（按钮点击）或
 *  拖放处理器把文件交给画布。
 *
 *  文件住在 public/generated（经 /api/generated 提供），但
 *  图片 / 影片节点的 mediaPath 必须是 ComfyUI
 *  **输入**目录内的文件名，好让下游 LoadImage / LoadVideo 能消费它。
 *  `importOutputAsInput` 把字节拷回 ComfyUI 输入（按来源路径缓存，
 *  所以重复拖放不会重复上传）。
 */
import { useCallback, type Dispatch, type SetStateAction } from "react";
import type { XYPosition } from "@xyflow/react";
import { makeNodeId } from "~/lib/project-canvas/canvas-helpers";
import { importOutputAsInput } from "~/lib/project-canvas/canvas-api";
import {
  defaultData,
  type CanvasNodeType,
  type NodeKind,
} from "~/lib/project-canvas/canvas-types";
import { useToast } from "~/components/studio/ToastProvider";
import {
  MEDIA_DRAG_MIME,
  type MediaDragPayload,
} from "~/components/ui/media-drag-source";

export interface UseCanvasDropArgs {
  screenToFlowPosition: (p: XYPosition) => XYPosition;
  setNodes: Dispatch<SetStateAction<CanvasNodeType[]>>;
}

/** 落点载荷 = 源端交给 `mediaDragSourceProps` 的形状 + 落地坐标。 */
export type MediaDropPayload = MediaDragPayload & {
  /** 拖拽落地时传入落点的 flow 坐标；缺省则落在视口中心。 */
  position?: XYPosition;
};

export function useCanvasDrop({
  screenToFlowPosition,
  setNodes,
}: UseCanvasDropArgs) {
  const toast = useToast();

  const placeMediaNode = useCallback(
    async (opts: MediaDropPayload) => {
      const { url, displayName, mediaType, position } = opts;
      if (mediaType !== "image" && mediaType !== "video") {
        toast.info(
          mediaType === "audio"
            ? "音频暂不支持落地画布"
            : "该文件类型暂不支持落地画布",
          "画布目前只有图片 / 视频两种内容载体节点",
        );
        return;
      }
      try {
        const name = await importOutputAsInput(url);
        const kind: NodeKind = mediaType === "video" ? "movie" : "picture";
        const center =
          position ??
          screenToFlowPosition({
            x: window.innerWidth / 2,
            y: window.innerHeight / 2,
          });
        const node: CanvasNodeType = {
          id: makeNodeId(),
          type: "canvasNode",
          position: center,
          data: {
            ...defaultData(kind),
            mediaPath: name,
            mediaName: displayName,
            mediaKind: mediaType,
          },
        };
        setNodes((nds) => [...nds, node]);
        toast.success("已加入画布", displayName);
      } catch (e: unknown) {
        toast.error("加入画布失败", e instanceof Error ? e.message : undefined);
      }
    },
    [screenToFlowPosition, setNodes, toast],
  );

  const onCanvasDragOver = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    /* MIME 与载荷形状都由 `~/components/ui/media-drag-source` 定义 ——
     * 源端与落点共用一份，靠手抄保持一致的那段日子到此为止
     * （源端少写一个字段，编译期不会说，运行时是一次静默丢投）。 */
    if (e.dataTransfer.types.includes(MEDIA_DRAG_MIME)) {
      e.preventDefault();
      e.dataTransfer.dropEffect = "copy";
    }
  }, []);

  const onCanvasDrop = useCallback(
    (e: React.DragEvent<HTMLDivElement>) => {
      const raw = e.dataTransfer.getData(MEDIA_DRAG_MIME);
      if (!raw) return; // 非本应用拖拽（如外部文件），忽略
      e.preventDefault();
      let payload: MediaDropPayload;
      try {
        payload = JSON.parse(raw) as MediaDropPayload;
      } catch {
        return;
      }
      const position = screenToFlowPosition({ x: e.clientX, y: e.clientY });
      void placeMediaNode({ ...payload, position });
    },
    [screenToFlowPosition, placeMediaNode],
  );

  return { placeMediaNode, onCanvasDragOver, onCanvasDrop };
}
