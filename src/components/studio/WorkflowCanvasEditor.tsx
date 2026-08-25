"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState, useContext } from "react";
import { createPortal } from "react-dom";
import { DarkSelect } from "@/components/studio/ui/DarkSelect";
import { PackageFooter } from "@/components/workflow-canvas/nodes/PackageFooter";
import { getCustomNodePackage, refreshCustomNodes } from "@/config/custom-nodes";
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
import { DynamicWorkflowForm } from "@/components/studio/shared/DynamicWorkflowForm";
import { defaultInputValues, type WorkflowIOMap } from "@/components/studio/shared/workflow-io";
import { WorkflowEdge } from "@/components/studio/workflow-edge";
import { SourceModal } from "@/components/studio/SourceModal";
import { useToast } from "@/components/studio/toast-provider";


import { WorkflowEditorInner } from "./workflow-editor-inner";

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
