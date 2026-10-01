"use client";

/** 从 ProjectCanvas 抽出 —— 媒体拖放落到画布
 *  的逻辑。素材库 / 历史面板经 `placeMediaNode`（按钮点击）或
 *  拖放处理器把文件交给画布。
 *
 *  文件住在产物根 generated/（经 /api/generated 提供），但
 *  图片 / 影片节点的 mediaPath 必须是 ComfyUI
 *  **输入**目录内的文件名，好让下游 LoadImage / LoadVideo 能消费它。
 *  `importOutputAsInput` 把字节拷回 ComfyUI 输入（按来源路径缓存，
 *  所以重复拖放不会重复上传）。
 */
import { useCallback, type Dispatch, type SetStateAction } from "react";
import type { XYPosition } from "@xyflow/react";
import { placeCanvasNode } from "~/lib/project-canvas/canvas-helpers";
import { runAsyncAction } from "~/lib/async-action";
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
      /* 反馈通道接成**两行** toast（标题 + 文件名）：收口前失败那一侧的
       * 第二行是自己拼 `e instanceof Error ? e.message : undefined` ——
       * 而 `errorMessage` 会把网络层原文翻译成人话（出口负责这一半）。
       * 「成功带文件名、失败带原因」是调用处的表现层选择。 */
      await runAsyncAction(
        async () => {
          const name = await importOutputAsInput(url);
          const kind: NodeKind = mediaType === "video" ? "movie" : "picture";
          /* 「取落点 → 换算 → 组节点 → 追加」四步走唯一出口
           *（`~/lib/project-canvas/canvas-helpers` 的 `placeCanvasNode`，
           * 规范 16 §16.2.4.38）；缺省落点是**视口中心**，
           * 由出口的 `viewportCenter()` 给。 */
          setNodes((nds) =>
            placeCanvasNode({
              nodes: nds,
              point: position,
              flow: { screenToFlowPosition },
              data: {
                ...defaultData(kind),
                mediaPath: name,
                mediaName: displayName,
                mediaKind: mediaType,
              },
            }),
          );
          return true;
        },
        {
          /* 失败侧的两行 toast：标题由调用处给，第二行是出口翻译过的
           * 可读原因（`errorMessage` 的人话）。`failureText` 在这里只作为
           * 「抛出的值取不到 message」时的兜底 —— 与标题同源。 */
          report: (kind, detail) =>
            kind === "ok"
              ? toast.success("已加入画布", displayName)
              : toast.error("加入画布失败", detail),
          failureText: "加入画布失败",
        },
      );
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
