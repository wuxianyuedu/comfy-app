"use client";

/** 从 ProjectCanvas 抽出 —— 连接串联
 *  逻辑（按哪个端口 / 句柄被连接来路由生成出来的输出）。
 *
 *  ref 对象由父级传入，因为回调要读**最新**的
 *  nodes/edges 而不必在每次状态变化时重绑。
 */
import {
  useCallback,
  useEffect,
  type Dispatch,
  type SetStateAction,
  type MouseEvent as ReactMouseEvent,
} from "react";
import { addEdge, type Connection, type Edge } from "@xyflow/react";
import { applyPropagationToNodes } from "~/lib/project-canvas/canvas-helpers";
import { uniqueStamp } from "~/lib/unique-id";
import { importOutputAsInput } from "~/lib/project-canvas/canvas-api";
import {
  isCanvasNode,
  type CanvasNodeType,
} from "~/lib/project-canvas/canvas-types";

export interface UseCanvasConnectionsArgs {
  nodesRef: { current: CanvasNodeType[] };
  edgesRef: { current: Edge[] };
  setNodes: Dispatch<SetStateAction<CanvasNodeType[]>>;
  setEdges: Dispatch<SetStateAction<Edge[]>>;
}

export function useCanvasConnections({
  nodesRef,
  edgesRef,
  setNodes,
  setEdges,
}: UseCanvasConnectionsArgs) {
  const propagateFrom = useCallback(
    async (
      sourceId: string,
      resultPathOverride?: string,
      edgesOverride?: Edge[],
    ) => {
      const srcNode = nodesRef.current.find(
        (current) => current.id === sourceId,
      );
      if (!srcNode || !isCanvasNode(srcNode)) return;
      const src = srcNode.data;
      const rPath = resultPathOverride ?? src.resultPath;
      const rType = src.resultMediaType;
      const es = edgesOverride ?? edgesRef.current;
      const outEdges = es.filter((edge) => edge.source === sourceId);
      if (outEdges.length === 0) return;

      // 只在至少一个下游端口需要时才导入生成出的图片。
      // 当某个连线输入是 IMAGE 类型针脚时，工作流目标也需要
      // 这个导入文件（导入只做一次，下面复用）。
      const needsImage = outEdges.some((outEdge) => {
        const t = nodesRef.current.find(
          (current) => current.id === outEdge.target,
        );
        return (
          !outEdge.targetHandle ||
          outEdge.targetHandle === "inputImage" ||
          t?.data?.kind === "workflow"
        );
      });
      let importedFile: string | null = null;
      if (needsImage && rPath && rType !== "video") {
        try {
          importedFile = await importOutputAsInput(rPath);
        } catch {
          importedFile = null;
        }
      }

      // targetHandle 分派与数据写入抽到 canvas-helpers（纯函数，可独立测试）。
      setNodes((nds) =>
        applyPropagationToNodes(nds, sourceId, {
          srcData: src,
          outEdges,
          importedFile,
        }),
      );
    },
    [nodesRef, edgesRef, setNodes],
  );

  /* 任何节点生成完成时，把它的输出喂给下游。 */
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail as {
        id: string;
        resultPath: string;
        resultMediaType?: string;
      };
      void propagateFrom(detail.id, detail.resultPath);
    };
    window.addEventListener("canvas:produce", handler);
    return () => window.removeEventListener("canvas:produce", handler);
  }, [propagateFrom]);

  const onConnect = useCallback(
    (c: Connection) => {
      setEdges((eds) =>
        addEdge(
          {
            ...c,
            type: "smoothstep",
            animated: true,
            style: { stroke: "url(#canvas-edge-gradient)", strokeWidth: 2.5 },
          },
          eds,
        ),
      );
      if (c.source) {
        const withNew: Edge[] = [
          ...edgesRef.current,
          {
            /* 连线 id 走全库唯一出口（规范 16 §16.2.4.36）—— 收口前这里是
             * 「源 + 目标 + 毫秒数」：同一毫秒内连两条**同样的**线会撞 id，
             * 而 React Flow 以 id 为键做边的增删改，撞 id 的表现是
             * 「新连的那条把上一条顶掉」。 */
            id: uniqueStamp(`e_${c.source}-${c.target}-`),
            source: c.source,
            target: c.target,
          },
        ];
        void propagateFrom(c.source, undefined, withNew);
      }
    },
    [setEdges, edgesRef, propagateFrom],
  );

  /* 惰性边交互 —— 未碰过的边保持惰性
   *（deletable/reconnectable=false）；首次点击把两个标志都打开，
   * 之后就与原来完全一样地支持删除键 / 拖拽重连。 */
  const onEdgeClick = useCallback(
    (_event: ReactMouseEvent, edge: Edge) => {
      if (edge.deletable === true && edge.reconnectable === true) return;
      setEdges((eds) =>
        eds.map((e) =>
          e.id === edge.id ? { ...e, deletable: true, reconnectable: true } : e,
        ),
      );
    },
    [setEdges],
  );

  return { propagateFrom, onConnect, onEdgeClick };
}
