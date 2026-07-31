"use client";

/**
 * WorkflowCanvas — Executable workflow engine canvas
 *
 * A ReactFlow-based visual node editor that:
 *  1. Renders ComfyUI graph JSON as draggable, connectable nodes
 *  2. Allows inline parameter editing via NodeEditor panel
 *  3. Supports role tagging (positive/negative/checkpoint/sampler)
 *  4. Exports back to ComfyUI API format for execution
 *  5. Provides toolbar (add node, zoom, minimap, fullscreen, export)
 *
 * UX inspired by Jimeng's canvas: dark background, bottom editor panel,
 * bezier animated edges, role badges on nodes.
 */

import { useCallback, useMemo, useState } from "react";
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  BackgroundVariant,
  useNodesState,
  useEdgesState,
  addEdge,
  type Connection,
  type OnConnect,
  type OnNodesChange,
  type OnEdgesChange,
  type NodeChange,
  type EdgeChange,
  type Node,
  type Edge,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";

import { ComfyNode } from "./nodes/ComfyNode";
import { BezierEdge, EdgeGradientDefs } from "./nodes/BezierEdge";
import NodeEditor from "./NodeEditor";
import { comfyGraphToFlow, flowToComfyGraph } from "./graph-utils";
import { getNodeConfig, ALL_NODE_TYPES, CATEGORY_LABELS } from "./node-registry";
import type {
  ComfyGraph,
  WfNode,
  WfEdge,
  NodeData,
  ParamMap,
} from "./types";

/* ── Props ── */
interface WorkflowCanvasProps {
  /** Initial ComfyUI graph (API format) */
  initialGraph?: ComfyGraph;
  /** Initial param map (nodeId → role) */
  initialParamMap?: ParamMap | null;
  /** Available checkpoints for dropdowns */
  checkpoints?: string[];
  /** Called when graph changes (for save/persist) */
  onGraphChange?: (graph: ComfyGraph, paramMap: ParamMap) => void;
  /** Called when user clicks "Generate" */
  onGenerate?: (graph: ComfyGraph, paramMap: ParamMap) => void;
}

/* ── Custom node & edge types for ReactFlow ── */
const nodeTypes = { comfyNode: ComfyNode };
const edgeTypes = { bezierEdge: BezierEdge };

export default function WorkflowCanvas({
  initialGraph = {},
  initialParamMap = null,
  checkpoints = [],
  onGraphChange,
  onGenerate,
}: WorkflowCanvasProps) {
  /* ── State ── */
  const [nodes, setNodes, onNodesChange] = useNodesState<Node>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [paramMap, setParamMap] = useState<ParamMap>(
    initialParamMap ?? {}
  );
  const [showAddMenu, setShowAddMenu] = useState(false);
  const [showExport, setShowExport] = useState(false);

  /* ── Initialize from graph ── */
  const initFlow = useMemo(
    () => comfyGraphToFlow(initialGraph, initialParamMap),
    // Only recompute when graph reference changes
    [] // eslint-disable-line react-hooks/exhaustive-deps
  );

  // Apply initial flow data once
  if (nodes.length === 0 && initFlow.nodes.length > 0) {
    setNodes(initFlow.nodes);
    setEdges(initFlow.edges);
  }

  /* ── Selected node data for editor panel ── */
  const selectedNode: NodeData | null = useMemo(() => {
    if (!selectedNodeId) return null;
    const n = nodes.find((nd) => nd.id === selectedNodeId);
    return (n?.data as unknown as NodeData) ?? null;
  }, [selectedNodeId, nodes]);

  /* ── Handlers ── */
  const handleConnect: OnConnect = useCallback(
    (connection: Connection) => {
      setEdges((eds) =>
        addEdge(
          {
            ...connection,
            type: "bezierEdge",
            animated: true,
          },
          eds)
      );
    },
    [setEdges]
  );

  const handleNodesChange: OnNodesChange = useCallback(
    (changes: NodeChange[]) => {
      onNodesChange(changes);
      // Track selection
      for (const change of changes) {
        if (change.type === "select" && change.selected) {
          setSelectedNodeId(change.id);
        }
      }
    },
    [onNodesChange]
  );

  const handlePaneClick = useCallback(() => {
    setSelectedNodeId(null);
  }, []);

  const handleFieldChange = useCallback(
    (nodeId: string, fieldKey: string, value: any) => {
      setNodes((nds) =>
        nds.map((n) => {
          if (n.id !== nodeId) return n;
          const d = { ...(n.data as any) };
          d.inputs = { ...d.inputs, [fieldKey]: value };
          return { ...n, data: d };
        })
      );
    },
    [setNodes]
  );

  const handleRoleChange = useCallback(
    (nodeId: string, role: string) => {
      setParamMap((prev: ParamMap) => {
        const next = { ...prev } as Record<string, string | undefined>;
        // Remove this node from all roles first
        for (const k of Object.keys(next)) {
          if (next[k] === nodeId) delete next[k];
        }
        if (role) next[role] = nodeId;
        return next as ParamMap;
      });
    },
    []
  );

  /* ── Add node ── */
  const addNode = useCallback(
    (classType: string) => {
      const config = getNodeConfig(classType);
      const id = `node_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
      const newNode: WfNode = {
        id,
        type: "comfyNode",
        position: {
          x: 100 + Math.random() * 400,
          y: 100 + Math.random() * 300,
        },
        data: {
          comfyId: id,
          classType,
          label: config.label,
          inputs: {},
          fields: config.defaultFields,
        },
        style: { width: config.width },
      };

      setNodes((nds) => [...nds, newNode]);
      setShowAddMenu(false);
      setSelectedNodeId(id);
    },
    [setNodes]
  );

  /* ── Export current state to ComfyUI graph ── */
  const exportGraph = useMemo(() => {
    return flowToComfyGraph(nodes, edges);
  }, [nodes, edges]);

  /* ── Generate ── */
  const handleGenerate = useCallback(() => {
    const graph = flowToComfyGraph(nodes, edges);
    onGraphChange?.(graph, paramMap);
    onGenerate?.(graph, paramMap);
  }, [nodes, edges, paramMap, onGraphChange, onGenerate]);

  /* ── Delete selected node ── */
  const deleteSelected = useCallback(() => {
    if (!selectedNodeId) return;
    setNodes((nds) => nds.filter((n) => n.id !== selectedNodeId));
    setEdges((eds) =>
      eds.filter((e) => e.source !== selectedNodeId && e.target !== selectedNodeId)
    );
    setSelectedNodeId(null);
  }, [selectedNodeId, setNodes, setEdges]);

  /* ── Keyboard shortcuts ── */
  // (handled in useEffect below)

  return (
    <div className="workflow-canvas">
      {/* Canvas area */}
      <div className="workflow-canvas__viewport">
        <ReactFlow
          nodes={nodes}
          edges={edges}
          onNodesChange={handleNodesChange}
          onEdgesChange={onEdgesChange}
          onConnect={handleConnect}
          onPaneClick={handlePaneClick}
          nodeTypes={nodeTypes}
          edgeTypes={edgeTypes}
          fitView
          snapToGrid
          snapGrid={[12, 12]}
          defaultEdgeOptions={{
            type: "bezierEdge",
            animated: true,
          }}
          proOptions={{ hideAttribution: true }}
        >
          {/* Dark background with subtle grid */}
          <Background
            variant={BackgroundVariant.Dots}
            gap={20}
            size={1}
            color="rgba(139,92,246,0.08)"
          />
          <Controls
            style={{
              background: "#0D0818",
              borderRadius: 10,
              border: "1px solid rgba(255,255,255,0.08)",
            }}
          />
          <MiniMap
            nodeColor={(n) => {
              const d = n.data as unknown as NodeData;
              return getNodeConfig(d.classType)?.color ?? "#6B7280";
            }}
            maskColor="#050010CC"
            style={{
              background: "#0B0712",
              border: "1px solid rgba(255,255,255,0.08)",
              borderRadius: 8,
            }}
          />
          {/* SVG gradient for edges */}
          <svg style={{ position: "absolute", width: 0, height: 0 }}>
            <EdgeGradientDefs />
          </svg>
        </ReactFlow>

        {/* Floating Toolbar */}
        <div className="wf-toolbar">
          <button
            className="wf-toolbar__btn"
            onClick={() => setShowAddMenu(!showAddMenu)}
            title="添加节点"
          >
            +
          </button>
          <button
            className="wf-toolbar__btn"
            onClick={deleteSelected}
            disabled={!selectedNodeId}
            title="删除选中"
          >
            {"\u2715"}
          </button>
          <span className="wf-toolbar__sep" />

          <button
            className="wf-toolbar__btn wf-toolbar__btn--primary"
            onClick={handleGenerate}
            title="生成图像"
          >
            {"\u25B6"} 生成
          </button>
          <button
            className="wf-toolbar__btn"
            onClick={() => setShowExport(!showExport)}
            title="导出 JSON"
          >
            {"\u{1F4BE}"}
          </button>
        </div>

        {/* Add-node menu */}
        {showAddMenu && (
          <div className="wf-add-menu" onMouseLeave={() => setShowAddMenu(false)}>
            <div className="wf-add-menu__header">添加节点</div>
            {Object.entries(CATEGORY_LABELS).map(([cat, label]) => (
              <div key={cat} className="wf-add-menu__group">
                <div className="wf-add-menu__group-label">{label}</div>
                {ALL_NODE_TYPES.filter((ct) => getNodeConfig(ct).category === cat)
                  .map((ct) => {
                    const cfg = getNodeConfig(ct);
                    return (
                      <button
                        key={ct}
                        className="wf-add-menu__item"
                        onClick={() => addNode(ct)}
                      >
                        <span style={{ color: cfg.color }}>{cfg.icon}</span>
                        <span>{cfg.label}</span>
                        <span className="wf-add-menu__item-type">{ct}</span>
                      </button>
                    );
                  })}
              </div>
            ))}
          </div>
        )}

        {/* Export modal */}
        {showExport && (
          <div className="wf-export-modal" onClick={() => setShowExport(false)}>
            <div className="wf-export-modal__card" onClick={(e) => e.stopPropagation()}>
              <h3>导出工作流 JSON</h3>
              <p style={{ fontSize: 11, color: "#888", marginBottom: 8 }}>
                ComfyUI API 格式，可直接导入 ComfyUI 或保存为模板
              </p>
              <textarea
                readOnly
                value={JSON.stringify(exportGraph, null, 2)}
                rows={12}
                style={{
                  width: "100%",
                  background: "#0D0818",
                  border: "1px solid rgba(255,255,255,0.1)",
                  borderRadius: 8,
                  color: "#A99BC7",
                  fontFamily: '"SF Mono", ui-monospace, monospace',
                  fontSize: 11,
                  padding: 10,
                }}
              />
              <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
                <button
                  className="wf-toolbar__btn wf-toolbar__btn--primary"
                  onClick={() => {
                    navigator.clipboard.writeText(JSON.stringify(exportGraph));
                    setShowExport(false);
                  }}
                >
                  复制到剪贴板
                </button>
                <button
                  className="wf-toolbar__btn"
                  onClick={() => setShowExport(false)}
                >
                  关闭
                </button>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Bottom parameter editor */}
      <div className="workflow-canvas__editor">
        <NodeEditor
          node={selectedNode}
          onFieldChange={handleFieldChange}
          paramMap={paramMap}
          onRoleChange={handleRoleChange}
          checkpoints={checkpoints}
        />
      </div>
    </div>
  );
}
