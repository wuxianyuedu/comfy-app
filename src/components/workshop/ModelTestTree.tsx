"use client";

// ── 测试模型的页面树（ISSUE #4952）────────────────────────────────────────
// 「用途 / 模式 / 模型」三大项在左栏合并成一棵就地展开的树，不再藏在模型下拉
// 浮层里（#4916 只把下拉做成了树，页面结构没变）。三种布局共用同一份条目：
// - 按用途：用途 → 模式 → 模型（对话没有模式层，叶直接挂）
// - 按来源：本地模型 / 远端模型 → 用途 → 模式 → 模型（与按用途同构，只是先按
//   来源分开；对话没有模式层；叶子自带三态，选中不再按当前页解析模式）
// - 按模型：模型名 → 模式 → 可测条目（同一模型挂多个工作流时在此分开）
// 折叠交互与 a11y 交给 Disclosure（§16.2.4.13），缩进与引导线走 TreeChildren
// （§16.2.4.39）；树构建在 model-test-tree.ts、取数在 hooks/use-model-test-tree.ts，
// 本文件只管交互与渲染（§17 第③层：不出现 fetch / api.*）。

import { useMemo, useState } from "react";
import type { ReactNode } from "react";

import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { Disclosure } from "~/components/ui/disclosure";
import { SelectChip } from "~/components/ui/select-chip";
import { Skeleton } from "~/components/ui/skeleton";
import { StatusDot } from "~/components/ui/status-dot";
import { TreeChildren } from "~/components/ui/tree-rows";
import { TruncatedText } from "~/components/ui/truncated-text";

import { readStorageItem, writeStorageItem } from "~/lib/browser-storage";
import { cn } from "~/lib/utils";

import type { ModelTestKind } from "./model-test-config";
import {
  buildModelTree,
  MODEL_TREE_LAYOUTS,
  type ModelTreeEntry,
  type ModelTreeLayoutId,
  type ModelTreeNode,
} from "./model-test-tree";

/** 布局偏好的本地持久化键（写不进就退化为会话内记忆，不致命）。 */
const LAYOUT_STORAGE_KEY = "comfyapp:model-test:tree-layout";

function readStoredLayout(): ModelTreeLayoutId {
  /* 存取走 ~/lib/browser-storage 的收口（P25 硬闸：视图层不自写 localStorage）；
   * 没有浏览器 / 读不到 / 写不进都回落默认布局。 */
  const raw = readStorageItem(LAYOUT_STORAGE_KEY);
  return MODEL_TREE_LAYOUTS.find((l) => l.id === raw)?.id ?? "kind";
}

/** 「生成中」小徽标（ISSUE #4838 的同款形态）：呼吸圆点 + 文案。给 `count`
 *  = 数量（「N 生成中」，分组节点用）；不给 = 单模型标记（「生成中」，叶子用）。
 *  走 `ui/badge` + `ui/status-dot`（§16.2.4 棘轮）。 */
export function GeneratingBadge({ className, count }: { className?: string; count?: number }) {
  return (
    <Badge className={className} size="pill-md" tone="warning">
      <StatusDot pulse sizeClass="size-1.5" state="busy" />
      {count === undefined ? "生成中" : `${count} 生成中`}
    </Badge>
  );
}

/** 节点下的叶子总数（分组节点的右侧计数徽标）。 */
function leafCount(node: ModelTreeNode): number {
  if (node.entry !== undefined) {
    return 1;
  }
  return node.children.reduce((sum, child) => sum + leafCount(child), 0);
}

/** 该节点子树里正在生成的**不同取值**数（分组节点的「N 生成中」徽标）。 */
function generatingCount(node: ModelTreeNode, generatingModels: ReadonlySet<string>): number {
  const values = new Set<string>();
  const walk = (current: ModelTreeNode) => {
    if (current.entry !== undefined) {
      if (generatingModels.has(current.entry.value)) {
        values.add(current.entry.value);
      }
      return;
    }
    current.children.forEach(walk);
  };
  walk(node);
  return values.size;
}

export function ModelTestTree({
  className,
  currentKind,
  currentMode,
  entries,
  generatingModels,
  loading,
  onSelect,
  selectedValue,
}: {
  className?: string;
  /** 页面当前的用途 / 模式：叶子的选中态用它。 */
  currentKind: ModelTestKind;
  currentMode: string;
  entries: ReadonlyArray<ModelTreeEntry>;
  /** 正在生成的模型取值集合（打「生成中」徽标）。 */
  generatingModels: ReadonlySet<string>;
  loading: boolean;
  /** 选中一片叶子：把该叶子的 用途 / 模式 / 模型取值一起交回页面。 */
  onSelect: (kind: ModelTestKind, mode: string, value: string) => void;
  selectedValue: string;
}) {
  const [layout, setLayoutState] = useState<ModelTreeLayoutId>(readStoredLayout);
  /* 展开表态（键 = 节点 key）。缺键的默认值 = 展开（与「模式契约」的模式导航
   * 同一口径：折叠是「先看别的」的临时动作，默认折着等于把候选藏起来）。 */
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  const tree = useMemo(() => buildModelTree(layout, entries), [layout, entries]);

  const setLayout = (next: ModelTreeLayoutId) => {
    setLayoutState(next);
    /* 换布局 = 换键空间，旧表态不作数。写失败（隐私模式 / 配额）只当本次
     * 会话内有效，静默即可。 */
    setExpanded({});
    writeStorageItem(LAYOUT_STORAGE_KEY, next);
  };

  /* 三种布局的叶子都自带用途 / 模式 / 取值：点一次就把三态一起回填。 */
  const handleLeafClick = (entry: ModelTreeEntry) => {
    onSelect(entry.kind, entry.mode, entry.value);
  };

  /* 递归渲染：分组节点 = Disclosure（chevron + 计数），叶子 = 可选按钮。
     普通函数（非组件）递归，避免内联组件每轮重挂。 */
  const renderBranch = (node: ModelTreeNode, depth: number): ReactNode => {
    const entry = node.entry;
    if (entry !== undefined) {
      /* 同一取值会挂多片叶子（多模式 / 多工作流）：只亮「当前用途 + 模式」
         那一片，与页面的会话格对得上。 */
      const selected =
        entry.value === selectedValue && entry.kind === currentKind && entry.mode === currentMode;
      /* 叶子是密集列表行：用 11px 具名档（text-2xs），否则长模型名（如
       * MiniMax H3 Image）在侧栏里会被截成省略号（#5082）。 */
      return (
        <Button
          aria-checked={selected}
          className={cn(
            "h-auto w-full justify-start gap-1.5 rounded-md px-2 py-1.5 font-normal",
            selected
              ? "bg-primary-soft text-primary-strong hover:bg-primary-soft"
              : "text-ink-muted hover:bg-subtle hover:text-ink",
          )}
          data-model-value={entry.value}
          data-tree-key={node.key}
          key={node.key}
          onClick={() => {
            handleLeafClick(entry);
          }}
          role="radio"
          variant="ghost"
        >
          <TruncatedText className="text-2xs min-w-0 flex-1 truncate text-left">
            {node.label}
          </TruncatedText>
          {generatingModels.has(entry.value) && <GeneratingBadge />}
          {/* 「按来源」布局整组同源，行上不再重复标。 */}
          {layout !== "source" && (
            <span
              className={cn(
                "shrink-0 rounded-full px-1.5 py-0.5 text-2xs",
                entry.local
                  ? "bg-subtle text-muted-foreground"
                  : "bg-primary-soft text-primary-strong",
              )}
            >
              {entry.local ? "本地" : "远端"}
            </span>
          )}
        </Button>
      );
    }
    const open = expanded[node.key] ?? true;
    const running = generatingCount(node, generatingModels);
    return (
      <Disclosure
        className={cn(
          "rounded-md px-2 py-1.5 hover:bg-subtle",
          depth === 0 ? "text-ink text-xs font-semibold" : "text-ink-muted text-xs font-medium",
        )}
        key={node.key}
        marker="chevron"
        onOpenChange={() => {
          setExpanded((prev) => ({ ...prev, [node.key]: !open }));
        }}
        open={open}
        panelClassName="mb-1"
        trigger={
          <span className="flex min-w-0 flex-1 items-center gap-1.5" data-tree-key={node.key}>
            <TruncatedText className="min-w-0 flex-1 truncate text-left">
              {node.label}
            </TruncatedText>
            {running > 0 && <GeneratingBadge count={running} />}
            <span className="text-muted-foreground text-2xs shrink-0 tabular-nums">
              {leafCount(node)}
            </span>
          </span>
        }
      >
        <TreeChildren className="flex flex-col gap-0.5" depth={depth + 1}>
          {node.children.map((child) => renderBranch(child, depth + 1))}
        </TreeChildren>
      </Disclosure>
    );
  };

  return (
    <div className={cn("flex flex-col gap-2", className)}>
      {/* 布局切换：三种布局共用同一份条目（#4916），就地挂在树上方。 */}
      <div aria-label="切换树形布局" className="flex flex-wrap gap-1.5" role="radiogroup">
        {MODEL_TREE_LAYOUTS.map((l) => (
          <SelectChip
            key={l.id}
            onClick={() => {
              setLayout(l.id);
            }}
            selected={layout === l.id}
            shape="pill"
          >
            {l.label}
          </SelectChip>
        ))}
      </div>
      {loading ? (
        <div aria-label="加载中" className="flex flex-col gap-2" role="status">
          {[0, 1, 2].map((i) => (
            <Skeleton className="h-8 w-full rounded-lg" key={i} />
          ))}
        </div>
      ) : tree.length === 0 ? (
        <p className="text-muted-foreground px-2 py-1.5 text-xs leading-relaxed">
          还没有可测的模型 —— 到设置页 / 工作流库添加候选后这里会出现树形清单。
        </p>
      ) : (
        <div
          aria-label="用途 / 模式 / 模型树"
          className="min-h-0 flex-1 overflow-y-auto pr-0.5"
          role="radiogroup"
        >
          {tree.map((node) => renderBranch(node, 0))}
        </div>
      )}
    </div>
  );
}
