"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState, useContext } from "react";
import { createPortal } from "react-dom";
import { DarkSelect } from "@/components/updream/ui/DarkSelect";
import { PackageFooter } from "@/components/workflow-canvas/nodes/PackageFooter";
import { getCustomNodePackage, refreshCustomNodes } from "@/config/customNodes";
import {
  ReactFlow,
  ReactFlowProvider,
  Background,
  BackgroundVariant,
  Controls,
  MiniMap,
  Handle,
  Position,
  useNodesState,
  useEdgesState,
  useReactFlow,
  useStore,
  type Node,
  type Edge,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import {
  portColor,
  portLabel,
  inferInputType,
  inferOutputType,
  inferIsMultiline,
  edgeType,
  edgeTypeByInputName,
} from "@/lib/comfyui/types";
import { friendlyNodeTitle, friendlyInputName, friendlySubgraphLabel } from "@/lib/comfyui/node-titles";
import { renderMarkdown } from "@/lib/comfyui/markdown";
import { DynamicWorkflowForm } from "@/components/updream/shared/DynamicWorkflowForm";
import { defaultInputValues, type WorkflowIOMap } from "@/components/updream/shared/workflow-io";
import { WfEdge } from "@/components/updream/WfEdge";
import { SourceModal } from "@/components/updream/SourceModal";
import { useToast } from "@/components/updream/Toast";


import { WorkflowEditorInner } from "./wf-editor-inner";

export function WorkflowCanvasEditor({
  workflowId,
  open,
  onClose,
  onSave,
}: {
  workflowId: string;
  open: boolean;
  onClose: () => void;
  onSave?: () => void;
}) {
  if (!open) return null;

  return (
    <ReactFlowProvider>
      <WorkflowEditorInner
        workflowId={workflowId}
        onClose={onClose}
        onSave={onSave}
      />
    </ReactFlowProvider>
  );
}
