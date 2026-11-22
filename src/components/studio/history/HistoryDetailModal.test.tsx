/**
 * 历史详情弹窗的提示词展示格（ISSUE #4665）：提示词这类长文案在参数表里
 * 定高 + 纵向滚动查看，不再把弹窗内容无限拉长。工坊参数（契约口 prompt）
 * 与工作流参数（pin 名 prompt / positive_prompt）两条来路都要命中。
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { ToastProvider } from "~/components/studio/ToastProvider";

import { HistoryDetailModal } from "./HistoryDetailModal";
import type { TaskDetail } from "./history-types";

// vitest globals: false 下 RTL 不会自动 cleanup，需手动注册
afterEach(cleanup);

/** TaskDetail 很大，这里只造测试关心的 params，其余字段按数据库行的必填形状补齐。 */
const TASK_DETAIL_BASE: TaskDetail = {
  id: "t-1",
  userId: "u-test",
  type: "image",
  prompt: "",
  negativePrompt: null,
  params: {},
  workflowName: "wf-test",
  workflowSnapshot: null,
  projectId: null,
  shotId: null,
  referenceImages: null,
  parentId: null,
  status: "SUCCEEDED",
  promptId: null,
  progress: 0,
  resultImages: null,
  logs: null,
  rawCli: null,
  error: null,
  validationErrors: null,
  createdAt: new Date(0),
  finishedAt: null,
  claimedBy: null,
  claimedAt: null,
  execPayload: null,
  progressNode: null,
  images: [],
};

const LONG_PROMPT = "一段很长的提示词。".repeat(60);

function renderModal(detail: TaskDetail) {
  return render(
    <ToastProvider>
      <HistoryDetailModal
        detail={detail}
        detailId={detail.id}
        detailLoading={false}
        modeContracts={null}
        onClose={vi.fn()}
        workflowIO={{}}
      />
    </ToastProvider>,
  );
}

describe("HistoryDetailModal 提示词定高滚动（ISSUE #4665）", () => {
  it("工坊参数里的提示词行：值在定高滚动格里（h-24 + overflow-y-auto）", () => {
    renderModal({
      ...TASK_DETAIL_BASE,
      params: { prompt: LONG_PROMPT, negative: "低质量", workflow: "wf-1" },
    });
    const promptEl = screen.getByText(LONG_PROMPT);
    expect(promptEl.className).toContain("h-24");
    expect(promptEl.className).toContain("overflow-y-auto");
  });

  it("工作流参数里的 prompt pin 同样定高滚动；其余参数值不套滚动格", () => {
    renderModal({
      ...TASK_DETAIL_BASE,
      params: {
        workflow: "wf-1",
        workflowInputs: [
          { nodeId: "6", name: "prompt", value: LONG_PROMPT },
          { nodeId: "3", name: "seed", value: 42 },
        ],
      },
    });
    const promptEl = screen.getByText(LONG_PROMPT);
    expect(promptEl.className).toContain("h-24");
    expect(promptEl.className).toContain("overflow-y-auto");
    const seedEl = screen.getByText("42");
    expect(seedEl.className).not.toContain("overflow-y-auto");
  });
});

describe("HistoryDetailModal 工作流参数按 IO 端口渲染", () => {
  const ioMap = {
    "6::widget::replace": {
      direction: "input" as const,
      kind: "widget",
      nodeId: "6",
      name: "replace",
      label: "prompt",
      defaultValue: "默认提示词",
    },
    "8::widget::seed": {
      direction: "input" as const,
      kind: "widget",
      nodeId: "8",
      name: "seed",
      label: "种子",
      defaultValue: 42,
    },
  };

  function renderWithIO(detail: TaskDetail) {
    return render(
      <ToastProvider>
        <HistoryDetailModal
          detail={detail}
          detailId={detail.id}
          detailLoading={false}
          onClose={vi.fn()}
          workflowIO={ioMap}
        />
      </ToastProvider>,
    );
  }

  it("列 IO 作者标签而不是内部 widget 名，没提交值时标注「默认值」", () => {
    renderWithIO(TASK_DETAIL_BASE);
    expect(screen.getByText("prompt")).toBeTruthy();
    expect(screen.queryByText("replace")).toBeNull();
    expect(screen.getByText("默认提示词")).toBeTruthy();
    expect(screen.getAllByText("默认值")).toHaveLength(2);
  });

  it("提交值覆盖默认值，且带 prompt 标签的长文本仍定高滚动", () => {
    renderWithIO({
      ...TASK_DETAIL_BASE,
      params: {
        workflow: "w",
        workflowInputs: [{ nodeId: "6", name: "replace", value: LONG_PROMPT }],
      },
    });
    const promptEl = screen.getByText(LONG_PROMPT);
    expect(promptEl.className).toContain("h-24");
    expect(promptEl.className).toContain("overflow-y-auto");
    /* 提示词被覆盖 ⇒ 不再标「默认值」；种子仍是默认值。 */
    expect(screen.getAllByText("默认值")).toHaveLength(1);
  });
});
