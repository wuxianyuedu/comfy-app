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

interface NodeEditorProps {
  /** Currently selected node data */
  node: NodeData | null;
  /** Callback when a field value changes */
  onFieldChange: (nodeId: string, fieldKey: string, value: any) => void;
  /** Current paramMap for role assignment */
  paramMap: ParamMap;
  /** Callback when role changes */
  onRoleChange: (nodeId: string, role: string) => void;
  /** Available checkpoints for dropdown */
  checkpoints?: string[];
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
}: NodeEditorProps) {
  // Auto-scroll to editor when node changes
  useEffect(() => {
    if (node) {
      const el = document.getElementById("wf-node-editor");
      if (el) {
        el.scrollIntoView({ behavior: "smooth", block: "nearest" });
      }
    }
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
            {config.icon || "\u2699"}
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
          <select
            value={currentRole}
            onChange={(e) => onRoleChange(node.comfyId, e.target.value)}
            style={{
              background: "rgba(139,92,246,0.12)",
              border: "1px solid rgba(139,92,246,0.25)",
              borderRadius: 8,
              color: "#D4CFF9",
              padding: "4px 10px",
              fontSize: 12,
              cursor: "pointer",
            }}
          >
            {ROLE_OPTIONS.map((r) => (
              <option key={r.value} value={r.value}>{r.label}</option>
            ))}
          </select>
        </div>
      </div>

      {/* Field groups as tabs */}
      {groupNames.length > 1 ? (
        <div className="wf-editor__tabs">
          {groupNames.map((g) => (
            <button key={g} className="wf-editor__tab">
              {g}
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
        <span style={{ fontSize: 11, color: "#555" }}>
          模型: {config.label} &nbsp;|&nbsp; 节点类型: {config.category}
        </span>
      </div>
    </div>
  );
}

/* ── Individual field row ── */

interface FieldRowProps {
  field: FieldDef;
  value: any;
  checkpoints?: string[];
  onChange: (value: any) => void;
}

function FieldRow({ field, value, checkpoints, onChange }: FieldRowProps) {
  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => {
      const raw = e.target.value;
      let parsed: any = raw;

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
            placeholder={field.placeholder || `输入 ${field.label}...`}
            rows={3}
            spellCheck={false}
          />
        </div>
      );

    case "select":
      const options = field.options ??
        (field.key.includes("ckpt") || field.key.includes("model")
          ? checkpoints
          : undefined) ?? [];
      return (
        <div className="wf-field">
          <label className="wf-field__label">{field.label}</label>
          <select value={(value as string) ?? ""} onChange={handleChange}>
            <option value="">-- 选择 --</option>
            {options.map((o: string) => (
              <option key={o} value={o}>{o}</option>
            ))}
          </select>
        </div>
      );

    case "number":
      return (
        <div className="wf-field">
          <label className="wf-field__label">{field.label}</label>
          <input
            type="number"
            value={(value as number) ?? ""}
            onChange={handleChange}
            placeholder={field.placeholder}
            step={
              ["seed", "steps"].includes(field.key) ? 1 :
              ["cfg", "denoise", "strength_model", "strength_clip"].includes(field.key) ? 0.05 :
              0.01
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
              <button type="button" className="wf-image-btn" onClick={() => {}}>
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
