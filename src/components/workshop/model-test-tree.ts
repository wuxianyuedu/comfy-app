// ── 「测试模型」树形菜单的纯构建（ISSUE #4916）──────────────────────────
// 模型下拉从「本地 / 远端两组平铺」升级为树形，且布局可切换。本文件只放
// 布局定义、条目装配与树构建这些纯函数（不碰 React / 网络）：视图在
// ModelTestTree.tsx，跨用途取数在 hooks/use-model-test-tree.ts（复用
// useTestCatalog，不另立第二份取数口径）。

import { ALL_WORKFLOW_TYPES } from "~/lib/workflow/workflow-types";

import {
  MODEL_TEST_KINDS,
  MODEL_TEST_KIND_LABELS,
  candidateLabel,
  candidateModelName,
  candidateValue,
  workflowSupportsMode,
  type AdaptersByModel,
  type ModelTestKind,
  type TestCandidate,
} from "./model-test-config";

/** 树形菜单的布局（浮层里的切换项；顺序即展示顺序）。 */
export type ModelTreeLayoutId = "kind" | "source" | "model";

export const MODEL_TREE_LAYOUTS: ReadonlyArray<{
  id: ModelTreeLayoutId;
  label: string;
}> = [
  { id: "kind", label: "按用途" },
  { id: "source", label: "按来源" },
  { id: "model", label: "按模型" },
];

/** 树里的一片叶子 = 「某用途下、某模式可测的一个候选」。取值空间与测试页
 *  下拉一致（模型名 / `wf::<工作流id>`，见 candidateValue）；同一个候选支持
 *  多个模式时会展开成多片叶子（对应「用途 + 模式 + 模型」一格一份的会话）。 */
export type ModelTreeEntry = {
  /** 用途（图片 / 视频 / 对话）。 */
  kind: ModelTestKind;
  /** 显示名（模型标签 / 工作流名消歧后）。 */
  label: string;
  /** 本地（工作流 / Ollama）还是远端（设置页 API 条目）。 */
  local: boolean;
  /** 可测的模式码；对话没有模式维度，恒 ""。 */
  mode: string;
  /** 模型名（工作流候选 = 挂的模型标签）——「按模型」布局的聚合键。 */
  modelName: string;
  /** 候选取值（candidateValue）。 */
  value: string;
};

/** 该用途下「按声明 / 适配器可测」的生成类模式码（顺序 = 工作流类型注册表）。 */
function generativeModeCodes(kind: ModelTestKind): Array<string> {
  return ALL_WORKFLOW_TYPES.filter((t) => t.isGenerative && t.category === kind).map((t) => t.code);
}

function workflowTypeLabel(code: string): string {
  return ALL_WORKFLOW_TYPES.find((t) => t.code === code)?.label ?? code;
}

/** 装配一个用途的树条目：工作流候选按 modes 声明展开（与模式收窄同一条判据
 *  workflowSupportsMode）；远端候选按已配适配器展开（与左栏模式页签的计数
 *  口径 modeTabsForKind 同源）；对话没有模式维度，一条候选一片叶子。
 *  不认 Register 表之外的模式码（脏适配器不进树）。 */
export function modelTreeEntriesForKind(args: {
  adaptersByModel: AdaptersByModel | undefined;
  candidates: ReadonlyArray<TestCandidate>;
  kind: ModelTestKind;
}): Array<ModelTreeEntry> {
  const { adaptersByModel, candidates, kind } = args;
  const modeCodes = new Set(generativeModeCodes(kind));
  const entries: Array<ModelTreeEntry> = [];
  for (const candidate of candidates) {
    const base = {
      kind,
      label: candidateLabel(candidate),
      local: candidate.local,
      modelName: candidateModelName(candidate),
      value: candidateValue(candidate),
    };
    if (candidate.workflow !== undefined) {
      for (const code of generativeModeCodes(kind)) {
        if (workflowSupportsMode(candidate.workflow, code)) {
          entries.push({ ...base, mode: code });
        }
      }
      continue;
    }
    if (kind === "chat") {
      entries.push({ ...base, mode: "" });
      continue;
    }
    for (const adapter of adaptersByModel?.[candidate.name] ?? []) {
      if (modeCodes.has(adapter.mode)) {
        entries.push({ ...base, mode: adapter.mode });
      }
    }
  }
  return entries;
}

/** 树节点：分组节点带 children，叶子带 entry。key 是「布局前缀 + 层级路径」
 *  的稳定串，给展开集合与用例锚定用（可访问名会随文案变，key 才是身份）。 */
export type ModelTreeNode = {
  children: Array<ModelTreeNode>;
  /** 叶子条目（分组节点没有）。 */
  entry?: ModelTreeEntry;
  key: string;
  kind?: ModelTestKind;
  label: string;
  local?: boolean;
  mode?: string;
  modelName?: string;
};

function leafNode(entry: ModelTreeEntry, key: string): ModelTreeNode {
  return { children: [], entry, key, label: entry.label };
}

/** 同一取值在同一父节点下只出现一次（防御性：装配层本就不该重复）。 */
function dedupeLeaves(
  entries: ReadonlyArray<ModelTreeEntry>,
  keyOf: (entry: ModelTreeEntry) => string,
): Array<ModelTreeNode> {
  const seen = new Set<string>();
  const nodes: Array<ModelTreeNode> = [];
  for (const entry of entries) {
    const key = keyOf(entry);
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    nodes.push(leafNode(entry, key));
  }
  return nodes;
}

function buildKindTree(entries: ReadonlyArray<ModelTreeEntry>): Array<ModelTreeNode> {
  const nodes: Array<ModelTreeNode> = [];
  for (const kind of MODEL_TEST_KINDS) {
    const kindEntries = entries.filter((e) => e.kind === kind);
    if (kindEntries.length === 0) {
      continue;
    }
    const children: Array<ModelTreeNode> =
      kind === "chat"
        ? dedupeLeaves(kindEntries, (e) => `leaf:chat:${e.value}`)
        : generativeModeCodes(kind).flatMap((code) => {
            const modeEntries = kindEntries.filter((e) => e.mode === code);
            if (modeEntries.length === 0) {
              return [];
            }
            return [
              {
                children: dedupeLeaves(modeEntries, (e) => `leaf:${kind}:${code}:${e.value}`),
                key: `kind:${kind}:${code}`,
                kind,
                label: workflowTypeLabel(code),
                mode: code,
              } satisfies ModelTreeNode,
            ];
          });
    nodes.push({ children, key: `kind:${kind}`, kind, label: MODEL_TEST_KIND_LABELS[kind] });
  }
  return nodes;
}

function buildSourceGroup(
  local: boolean,
  label: string,
  entries: ReadonlyArray<ModelTreeEntry>,
): ModelTreeNode {
  const seen = new Set<string>();
  const children: Array<ModelTreeNode> = [];
  for (const entry of entries) {
    if (entry.local !== local || seen.has(entry.value)) {
      continue;
    }
    seen.add(entry.value);
    children.push(leafNode(entry, `leaf:source:${local ? "local" : "remote"}:${entry.value}`));
  }
  return { children, key: `source:${local ? "local" : "remote"}`, label, local };
}

function buildSourceTree(entries: ReadonlyArray<ModelTreeEntry>): Array<ModelTreeNode> {
  return [
    buildSourceGroup(true, "本地模型", entries),
    buildSourceGroup(false, "远端模型", entries),
  ].filter((node) => node.children.length > 0);
}

function buildModelNameTree(entries: ReadonlyArray<ModelTreeEntry>): Array<ModelTreeNode> {
  /* 聚合键带来源：远端模型名与工作流模型标签撞名时各自成组，不混树。 */
  const groups = new Map<string, Array<ModelTreeEntry>>();
  for (const entry of entries) {
    const groupKey = `${entry.local ? "l" : "r"}::${entry.modelName}`;
    const list = groups.get(groupKey);
    if (list === undefined) {
      groups.set(groupKey, [entry]);
    } else {
      list.push(entry);
    }
  }
  const nodes: Array<ModelTreeNode> = [];
  for (const [groupKey, groupEntries] of groups) {
    const first = groupEntries[0];
    if (first === undefined) {
      continue;
    }
    const modelKey = `model:${groupKey}`;
    const children: Array<ModelTreeNode> =
      first.kind === "chat"
        ? dedupeLeaves(groupEntries, (e) => `leaf:${modelKey}:${e.value}`)
        : generativeModeCodes(first.kind).flatMap((code) => {
            const modeEntries = groupEntries.filter((e) => e.mode === code);
            if (modeEntries.length === 0) {
              return [];
            }
            return [
              {
                children: dedupeLeaves(modeEntries, (e) => `leaf:${modelKey}:${code}:${e.value}`),
                key: `${modelKey}:${code}`,
                kind: first.kind,
                label: workflowTypeLabel(code),
                mode: code,
                modelName: first.modelName,
              } satisfies ModelTreeNode,
            ];
          });
    nodes.push({
      children,
      key: modelKey,
      kind: first.kind,
      label: first.modelName,
      local: first.local,
      modelName: first.modelName,
    });
  }
  return nodes;
}

/** 按布局把条目组树。三种布局共用同一份条目，只是分组维度不同。 */
export function buildModelTree(
  layout: ModelTreeLayoutId,
  entries: ReadonlyArray<ModelTreeEntry>,
): Array<ModelTreeNode> {
  if (layout === "source") {
    return buildSourceTree(entries);
  }
  if (layout === "model") {
    return buildModelNameTree(entries);
  }
  return buildKindTree(entries);
}

/** 「按来源」布局的叶子没有展开模式层：选中时按当前页状态解析落在哪个模式格
 *  —— 当前「用途 + 模式」可用就用当前的，否则取该候选在同用途下的第一个
 *  可测模式；跨用途选中（如图片页里点了一个对话模型）则整条切换。 */
export function resolveSourceSelection(args: {
  currentKind: ModelTestKind;
  currentMode: string;
  entries: ReadonlyArray<ModelTreeEntry>;
  value: string;
}): ModelTreeEntry | null {
  const sameValue = args.entries.filter((e) => e.value === args.value);
  const exact = sameValue.find((e) => e.kind === args.currentKind && e.mode === args.currentMode);
  if (exact !== undefined) {
    return exact;
  }
  const sameKind = sameValue.filter((e) => e.kind === args.currentKind);
  return sameKind[0] ?? sameValue[0] ?? null;
}
