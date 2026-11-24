"use client";

/**
 * `CharacterGenerateDialog` — 批量生图弹窗（ISSUE #5009）：选工作流库里的
 * 图片工作流（默认认名字带 minimax 的那条，对应 minimax_h3_image）+ 本批数量，
 * 提交后按选中角色（或全部待生成角色）逐个入队生图任务。
 * 纯展示 + 本地选择态：工作流清单与提交回调由 CharacterLibrary 注入；
 * 弹窗外壳共用 `CharacterDialogShell`。
 */
import { useMemo, useState } from "react";

import { SelectChip } from "~/components/ui/select-chip";
import { cn } from "~/lib/utils";

import type { WorkflowRow } from "./hooks/use-character-library";
import { CharacterDialogShell } from "./CharacterDialogShell";

export type CharacterGenerateDialogProps = {
  onClose: () => void;
  /** 只对这一个角色重跑（详情页「重新生图」）；空 = 面向全部待生成角色。 */
  onlyCharacterName?: string | null;
  onSubmit: (workflowId: string, limit: number) => void;
  open: boolean;
  pending: boolean;
  workflows: Array<WorkflowRow>;
  workflowsLoading: boolean;
};

/** 本批数量的档位（一次入队太多会长时间占满队列，分批点几次更可控）。 */
const BATCH_LIMITS = [10, 50, 100, 200] as const;

/** 图片工作流：文本生图优先；没有时退回全部（让用户自己挑）。 */
function isImageWorkflow(workflow: WorkflowRow): boolean {
  return workflow.taskType === "TXT2IMG";
}

/** 默认工作流：名字带 minimax 的优先，其次清单里的第一张（入参已过滤为可选项）。 */
function defaultWorkflow(candidates: Array<WorkflowRow>): WorkflowRow | null {
  if (candidates.length === 0) {
    return null;
  }
  return (
    candidates.find((workflow) => workflow.name.toLowerCase().includes("minimax")) ??
    candidates[0] ??
    null
  );
}

export function CharacterGenerateDialog({
  onlyCharacterName,
  onClose,
  onSubmit,
  open,
  pending,
  workflows,
  workflowsLoading,
}: CharacterGenerateDialogProps) {
  const [workflowId, setWorkflowId] = useState<string | null>(null);
  const [limit, setLimit] = useState<number>(50);

  /* 选中态：用户点选优先；未点选时按默认派生（minimax 优先，ISSUE #5009 的
   * 指定工作流）——派生值随工作流清单到达自动就位，不需要 effect 回写。 */
  const candidates = useMemo(
    () => (workflows.some(isImageWorkflow) ? workflows.filter(isImageWorkflow) : workflows),
    [workflows],
  );
  const defaultId = useMemo(() => defaultWorkflow(candidates)?.id ?? null, [candidates]);
  const effectiveWorkflowId = workflowId ?? defaultId;
  const selected = candidates.find((workflow) => workflow.id === effectiveWorkflowId) ?? null;
  const forSingle = onlyCharacterName !== undefined && onlyCharacterName !== null;

  return (
    <CharacterDialogShell
      description={
        <>
          从工作流库选一条图片工作流（如 minimax_h3_image），按角色描述逐个生成
          {forSingle
            ? "；新生成的立绘会作为新候选加入，不覆盖旧图。"
            : "；已有立绘的角色本轮跳过。"}
        </>
      }
      onClose={onClose}
      onSubmit={() => {
        if (selected !== null) {
          onSubmit(selected.id, forSingle ? 1 : limit);
        }
      }}
      open={open}
      pending={pending}
      submitDisabled={selected === null}
      submitLabel="开始生成"
      title={forSingle ? `重新生成「${onlyCharacterName}」的立绘` : "批量生成角色立绘"}
    >
      <div>
        <p className="text-ink-strong mb-1.5 text-xs font-medium">工作流</p>
        {workflowsLoading ? (
          <p className="text-ink-fainter text-xs">正在读取工作流库…</p>
        ) : candidates.length === 0 ? (
          <p className="text-warning-strong text-xs">
            工作流库里还没有可用的工作流；请先在「工作流库」导入（例如 minimax_h3_image）。
          </p>
        ) : (
          <div className="custom-scrollbar flex max-h-40 flex-wrap gap-1.5 overflow-y-auto">
            {candidates.map((workflow) => (
              <SelectChip
                key={workflow.id}
                onClick={() => {
                  setWorkflowId(workflow.id);
                }}
                selected={workflow.id === effectiveWorkflowId}
                shape="pill"
              >
                <span>{workflow.name}</span>
              </SelectChip>
            ))}
          </div>
        )}
      </div>

      {forSingle ? null : (
        <div>
          <p className="text-ink-strong mb-1.5 text-xs font-medium">本批数量</p>
          <div className="flex flex-wrap gap-1.5">
            {BATCH_LIMITS.map((value) => (
              <SelectChip
                key={value}
                onClick={() => {
                  setLimit(value);
                }}
                selected={limit === value}
                shape="pill"
              >
                <span>{value} 个</span>
              </SelectChip>
            ))}
          </div>
        </div>
      )}

      <p className={cn("text-ink-fainter text-2xs", selected !== null && "text-ink-faint")}>
        {selected === null
          ? "请选择一条工作流。"
          : `将使用「${selected.name}」生成；任务进入既有队列逐个执行，完成一张入库一张。`}
      </p>
    </CharacterDialogShell>
  );
}
