"use client";

/**
 * NodeEditor — Parameter editor panel for selected workflow node
 *
 * Shows when a node is clicked on the canvas. Renders all editable fields
 * grouped by category. Changes sync back to the graph state.
 *
 * UX pattern inspired by Jimeng's bottom parameter card:
 *  - Tabs for different field groups
 *  - Reference image support
 *  - Prompt text area with @-mention
 *  - Generation settings bar
 */

import { useCallback, useEffect } from "react";
import type { NodeData, FieldDef, ParamMap } from "./types";
import { getNodeConfig } from "./node-registry";
import { DarkSelect } from "@/components/studio/ui/DarkSelect";
import { NumberField } from "@/components/studio/ui/NumberField";

interface NodeEditorProps {
  /** Currently selected node data */
  node: NodeData | null;
  /** Callback when a field value changes */
  onFieldChange: (nodeId: string, fieldKey: string, value: unknown) => void;
  /** Current paramMap for role assignment */
  paramMap: ParamMap;
  /** Callback when role changes */
  onRoleChange: (nodeId: string, role: string) => void;
  /** Available checkpoints for dropdown */
  checkpoints?: string[];
  /** Model file lists keyed by folder (checkpoints/loras/vae/...). Used by
   *  select fields whose FieldDef carries `modelFolder`. */
  modelLists?: Record<string, string[]>;
}

const ROLE_OPTIONS = [
  { value: "", label: "无" },
  { value: "positive", label: "正向提示词" },
  { value: "negative", label: "负向提示词" },
  { value: "checkpoint", label: "模型 (Checkpoint)" },
  { value: "sampler", label: "采样器 (KSampler)" },
  { value: "lora", label: "LoRA" },
  { value: "output", label: "输出节点" },
];

export default function NodeEditor({
  node,
  onFieldChange,
  paramMap,
  onRoleChange,
  checkpoints = [],
  modelLists,
}: NodeEditorProps) {
  // Auto-scroll to editor when node changes
  useEffect(() => {
    if (node) {
      const el = document.getElementById("wf-node-editor");
      if (el) {
        el.scrollIntoView({ behavior: "smooth", block: "nearest" });
      }
    }
    /* 只在切到另一个节点（comfyId 变化）时滚动。node 对象每次渲染都是新引用，
     * 若把它放进依赖，编辑器会在每一次无关重渲染里反复滚动、抢走用户焦点。 */
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [node?.comfyId]);

  if (!node) {
    return (
      <div className="wf-editor wf-editor--empty">
        <div style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          height: "100%",
          color: "#555",
          fontSize: 13,
          gap: 8,
        }}>
          <span style={{ fontSize: 18 }}>{"\u{1F4AF}"}</span>
          点击画布上的节点以编辑参数
        </div>
      </div>
    );
  }

  const config = getNodeConfig(node.classType);
  const currentRole =
    Object.entries(paramMap).find(([, id]) => id === node.comfyId)?.[0] ?? "";

  // Group fields by `group` property
  const groups = new Map<string, FieldDef[]>();
  for (const f of node.fields ?? []) {
    if (f.hidden) continue;
    const g = f.group ?? "\u53C2\u6570"; // 参数
    if (!groups.has(g)) groups.set(g, []);
    groups.get(g)!.push(f);
  }

  const groupNames = Array.from(groups.keys());

  return (
    <div className="wf-editor" id="wf-node-editor">
      {/* Header */}
      <div className="wf-editor__header">
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <span style={{
            width: 28, height: 28, borderRadius: 7,
            background: `${config.color}22`,
            display: "grid", placeItems: "center",
            fontSize: 15,
          }}>
            {config.icon ?? "\u2699"}
          </span>
          <div>
            <div style={{ fontWeight: 700, fontSize: 14, color: "#F4EEFF" }}>
              {node.label}
            </div>
            <div style={{ fontSize: 11, color: "#6B7280" }}>
              {node.classType} · ID: {node.comfyId.slice(0, 8)}
            </div>
          </div>
        </div>

        {/* Role selector */}
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ fontSize: 11, color: "#6B7280" }}>角色:</span>
          <DarkSelect
            className="text-[12px]"
            value={currentRole}
            onChange={(value) => onRoleChange(node.comfyId, value)}
            options={ROLE_OPTIONS.map((ROLE_OPTIONS) => ROLE_OPTIONS.value)}
            labels={Object.fromEntries(ROLE_OPTIONS.map((ROLE_OPTIONS) => [ROLE_OPTIONS.value, ROLE_OPTIONS.label]))}
            placeholder="选择角色"
          />
        </div>
      </div>

      {/* Field groups as tabs */}
      {groupNames.length > 1 ? (
        <div className="wf-editor__tabs">
          {groupNames.map((groupName) =>
(
            <button key={groupName} className="wf-editor__tab">
              {groupName}
            </button>
          ))}
        </div>
      ) : null}

      {/* Fields */}
      <div className="wf-editor__fields">
        {Array.from(groups.entries()).map(([groupName, fields]) => (
          <div key={groupName} className="wf-editor__group">
            {groupNames.length > 1 && (
              <div className="wf-editor__group-label">{groupName}</div>
            )}
            {fields.map((field) => (
              <FieldRow
                key={field.key}
                field={field}
                value={node.inputs?.[field.key]}
                checkpoints={checkpoints}
                modelLists={modelLists}
                onChange={(val) =>
                  onFieldChange(node.comfyId, field.key, val)
                }
              />
            ))}
          </div>
        ))}
      </div>

      {/* Quick actions bar */}
      <div className="wf-editor__bar">
        {config.custom ? (
          <span style={{ fontSize: 11, color: "#555" }}>
            自定义节点
            {config.rawCategory ? ` · 类别: ${config.rawCategory}` : ""}
            {config.outputNode ? " · 终端节点" : ""}
            {config.frontendOnly ? " · 前端专属" : ""}
            {config.description ? ` · ${config.description}` : ""}
          </span>
        ) : (
          <span style={{ fontSize: 11, color: "#555" }}>
            模型: {config.label} &nbsp;|&nbsp; 节点类型: {config.category}
          </span>
        )}
      </div>
    </div>
  );
}

/* ── Individual field row ── */

interface FieldRowProps {
  field: FieldDef;
  value: unknown;
  checkpoints?: string[];
  modelLists?: Record<string, string[]>;
  onChange: (value: unknown) => void;
}

function FieldRow({ field, value, checkpoints, modelLists, onChange }: FieldRowProps) {
  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => {
      const raw = e.target.value;
      let parsed: unknown = raw;

      if (field.type === "number") {
        const n = parseFloat(raw);
        parsed = isNaN(n) ? raw : n;
      } else if (field.type === "toggle") {
        parsed = (e.target as HTMLInputElement).checked;
      }

      onChange(parsed);
    },
    [field.type, onChange]
  );

  switch (field.type) {
    case "text":
      return (
        <div className="wf-field wf-field--text">
          <label className="wf-field__label">{field.label}</label>
          <textarea
            value={(value as string) ?? ""}
            onChange={handleChange}
            placeholder={field.placeholder ?? `输入 ${field.label}...`}
            rows={3}
            spellCheck={false}
          />
        </div>
      );

    case "select":
      // 模型文件字段：优先用对应 folder 的真实文件列表（来自 modelLists），
      // 否则回退到旧逻辑（key 含 ckpt/model 时用 checkpoints），再否则用静态 options。
      let options = field.options ?? [];
      if (field.modelFolder && modelLists) {
        options = modelLists[field.modelFolder] ?? field.options ?? [];
      } else if (field.key.includes("ckpt") || field.key.includes("model")) {
        options = checkpoints ?? field.options ?? [];
      }
      return (
        <div className="wf-field">
          <label className="wf-field__label">{field.label}</label>
          <DarkSelect
            value={(value as string) ?? ""}
            onChange={(value) => onChange(value)}
            options={options}
            placeholder="-- 选择 --"
          />
        </div>
      );

    case "number":
      return (
        <div className="wf-field">
          <label className="wf-field__label">{field.label}</label>
          {/*
           *  R-ardot92 (2026-08-17): 同样把原生 `<input type="number">` 替换为
           *  NumberField（`─ value +` 左右 stepper，与 DynamicWorkflowForm
           *  Ardot 规范统一）。`field.value` 一律经 Number() 化兜底：API 残留
           *  字面量（如 "fixed"）会落回 field.min，杜绝渲染出方块字符。
           */}
          <NumberField
            value={(typeof value === "number" ? value : Number(value)) || Number(field.min ?? 0)}
            onChange={(value) => onChange(value)}
            min={Number(field.min ?? 0)}
            max={Number(field.max ?? 9999)}
            step={
              field.step ??
              (["seed", "steps"].includes(field.key) ? 1 :
              ["cfg", "denoise", "strength_model", "strength_clip"].includes(field.key) ? 0.05 :
              0.01)
            }
            decimalPlaces={
              ["cfg", "denoise", "strength_model", "strength_clip"].includes(field.key) ? 2 : 0
            }
          />
        </div>
      );

    case "toggle":
      return (
        <div className="wf-field wf-field--toggle-row">
          <label className="wf-field__label">{field.label}</label>
          <label className="wf-toggle">
            <input
              type="checkbox"
              checked={!!value}
              onChange={handleChange}
            />
            <span className="wf-toggle__slider" />
          </label>
        </div>
      );

    case "image":
      return (
        <div className="wf-field wf-field--image">
          <label className="wf-field__label">{field.label}</label>
          <div className="wf-image-upload">
            {(value as string) ? (
              <div className="wf-image-preview">
                <span>{String(value).slice(-20)}</span>
                <button type="button" onClick={() => onChange("")}>
                  移除
                </button>
              </div>
            ) : (
              <button type="button" className="wf-image-btn" onClick={() => undefined}>
                + 上传图像
              </button>
            )}
          </div>
        </div>
      );

    default:
      // string fallback
      return (
        <div className="wf-field">
          <label className="wf-field__label">{field.label}</label>
          <input
            type="text"
            value={(value as string) ?? ""}
            onChange={handleChange}
            placeholder={field.placeholder}
          />
        </div>
      );
  }
}
