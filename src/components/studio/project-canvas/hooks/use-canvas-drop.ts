"use client";

/** 2026-08-29 T12-3: extracted from ProjectCanvas — media drop-to-canvas
 *  logic.  The material-library / history panels hand files to the canvas
 *  through `placeMediaNode` (button click) or the drag-and-drop handlers.
 *
 *  Files live in public/generated (served via /api/generated), but the
 *  picture / movie node's mediaPath must be a filename inside the ComfyUI
 *  **input** directory so downstream LoadImage / LoadVideo can consume it.
 *  `importOutputAsInput` copies the bytes back into ComfyUI input (cached
 *  by source path, so re-dropping never re-uploads).
 */
import { useCallback, type Dispatch, type SetStateAction } from "react";
import type { XYPosition } from "@xyflow/react";
import { makeNodeId } from "@/lib/project-canvas/canvas-helpers";
import { importOutputAsInput } from "@/lib/project-canvas/canvas-api";
import {
  defaultData,
  type CanvasNodeType,
  type NodeKind,
} from "@/lib/project-canvas/canvas-types";
import { useToast } from "@/components/studio/ToastProvider";

export interface UseCanvasDropArgs {
  screenToFlowPosition: (p: XYPosition) => XYPosition;
  setNodes: Dispatch<SetStateAction<CanvasNodeType[]>>;
}

export interface MediaDropPayload {
  url: string;
  displayName: string;
  /** image / video 才有对应节点；audio 与 doc 目前无载体。 */
  mediaType: "image" | "video" | "audio" | "doc";
  /** 拖拽落地时传入落点的 flow 坐标；缺省则落在视口中心。 */
  position?: XYPosition;
}

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
    if (e.dataTransfer.types.includes("application/x-comfyapp-media")) {
      e.preventDefault();
      e.dataTransfer.dropEffect = "copy";
    }
  }, []);

  const onCanvasDrop = useCallback(
    (e: React.DragEvent<HTMLDivElement>) => {
      const raw = e.dataTransfer.getData("application/x-comfyapp-media");
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
