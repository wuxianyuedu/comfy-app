"use client";

/** extracted from ProjectCanvas — connection chaining
 *  logic (routes generated output by which port/handle is connected).
 *
 *  Ref objects are threaded in from the parent because the callbacks read
 *  the *latest* nodes/edges without re-binding on every state change.
 */
import {
  useCallback,
  useEffect,
  type Dispatch,
  type SetStateAction,
  type MouseEvent as ReactMouseEvent,
} from "react";
import { addEdge, type Connection, type Edge } from "@xyflow/react";
import { applyPropagationToNodes, importOutputAsInput } from "./canvas-helpers";
import { isCanvasNode, type CanvasNodeType } from "./canvas-types";

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

      // Only import the generated image if at least one downstream port needs it.
      // A workflow target also needs the imported file when a wire input is an
      // IMAGE-type pin (the import happens once and is reused below).
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

  /* When any node finishes a generation, feed its output downstream. */
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
            id: `e_${c.source}-${c.target}-${Date.now()}`,
            source: c.source,
            target: c.target,
          },
        ];
        void propagateFrom(c.source, undefined, withNew);
      }
    },
    [setEdges, edgesRef, propagateFrom],
  );

  /* lazy edge interactivity — untouched edges stay inert
   *  (deletable/reconnectable=false); the first click flips both flags on,
   *  after which delete-key / drag-reconnect behave exactly as before. */
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
