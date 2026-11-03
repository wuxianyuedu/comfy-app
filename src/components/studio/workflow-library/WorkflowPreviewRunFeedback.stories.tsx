import type { Meta, StoryObj } from "@storybook/nextjs";

import { WorkflowPreviewRunFeedback } from "~/components/studio/workflow-library/WorkflowPreviewRunFeedback";
import type { Phase } from "~/components/studio/workflow-library/hooks/use-generation-runner";

/**
 * 工作流预览底部的运行反馈条（两种视图模式通用）。纯 props：`phase` 是
 * `use-generation-runner` 五档状态机投影。核心是交叉判据：进度条两种模式通用；
 * 结果图 / 失败原因 / 缺参提醒只在 `viewMode="use"` 显示（编辑页签是配置界面）；`uploadNotice` 是素材上传的可见出口（ISSUE #345）。
 */
const PHASES: Record<string, Phase> = {
  idle: { kind: "idle" },
  starting: { kind: "starting" },
  running: {
    kind: "running",
    pct: 42,
    node: { id: "3", label: "K采样器", value: 3, max: 8 },
  },
  runningNoNode: { kind: "running", pct: 17 },
  done: { kind: "done", imageUrl: "/storybook-assets/sample-landscape.svg" },
  failed: {
    kind: "failed",
    message: "缺参：模型文件 sd_xl_base_1.0.safetensors 不在本机",
  },
};

/**
 * 「两档视图 × 三条 phase」的矩阵行。写成具名常量而不是 `PHASES[key]`：
 * `PHASES` 是 `Record<string, Phase>`，`noUncheckedIndexedAccess` 下索引结果是
 * `Phase | undefined`，而 `!` / `as` 会被既有硬闸拦下，故显式列出确定存在的三档。
 */
const MATRIX_ROWS: ReadonlyArray<readonly [string, Phase]> = [
  [
    "running",
    {
      kind: "running",
      pct: 42,
      node: { id: "3", label: "K采样器", value: 3, max: 8 },
    },
  ],
  ["done", { kind: "done", imageUrl: "/storybook-assets/sample-landscape.svg" }],
  [
    "failed",
    {
      kind: "failed",
      message: "缺参：模型文件 sd_xl_base_1.0.safetensors 不在本机",
    },
  ],
];

const meta = {
  title: "Studio/WorkflowPreviewRunFeedback",
  component: WorkflowPreviewRunFeedback,
  args: {
    phase: PHASES.running,
    pct: 42,
    nodeLabel: "K采样器",
    resultUrl: null,
    workflowName: "角色一致性 · 三视图",
    viewMode: "use",
    running: true,
    missingLabels: [],
    uploadNotice: null,
    onDismissUploadNotice: () => undefined,
  },
  argTypes: {
    viewMode: { control: { type: "select" }, options: ["edit", "use"] },
    running: { control: { type: "boolean" } },
  },
} satisfies Meta<typeof WorkflowPreviewRunFeedback>;

export default meta;

type Story = StoryObj<typeof meta>;

/** 执行中（use 模式）：进度条 + 正在执行的节点名与步数。 */
export const Running: Story = {};

/** 执行中但没有节点名：退化成「正在执行工作流」整体进度，不显示步数。 */
export const RunningWithoutNodeLabel: Story = {
  args: { phase: PHASES.runningNoNode, nodeLabel: null, pct: 17 },
};

/** 完成：结果图挂在反馈条里（只有 use 模式会走到这条）。 */
export const Done: Story = {
  args: {
    phase: PHASES.done,
    pct: 100,
    running: false,
    nodeLabel: null,
    resultUrl: "/storybook-assets/sample-landscape.svg",
  },
};

/** 失败：原因文案 + 缺参清单（两个出口都在这一档）。 */
export const Failed: Story = {
  args: {
    phase: PHASES.failed,
    pct: 0,
    running: false,
    nodeLabel: null,
    missingLabels: ["模型文件 sd_xl_base_1.0.safetensors", "输入图 input.png"],
  },
};

/**
 * 素材上传的可见出口：`uploadNotice` 有值时那条提示才出现 ——
 * 这一档与 `Running` 的差别只有这一个字段，所以并排能看出「谁负责说这件事」。
 */
export const UploadNotice: Story = {
  args: {
    uploadNotice: "ComfyUI 还没起来，素材暂时上传不了（正在启动，约 30 秒）",
  },
};

/**
 * **两档视图模式的交叉**：同一批 phase，`use` 模式显示结果/错误，`edit` 只留进度。
 * 这是本件唯一「做减法」的规则：编辑对外参数时看到上一次运行结果，会让人以为
 * 改完参数结果就跟着变了。
 */
export const ViewModeMatrix: Story = {
  render: (args) => (
    /* SAFETY: 类型断言已复核 */
    <div className="flex flex-col gap-8">
      {(["edit", "use"] as const).map((viewMode) => (
        <div className="flex flex-col gap-3" key={viewMode}>
          <span className="text-ink-muted font-mono text-[11px]">viewMode = {viewMode}</span>
          {MATRIX_ROWS.map(([key, phase]) => (
            <div className="flex flex-col gap-1" key={key}>
              <span className="text-ink-faint font-mono text-[11px]">phase = {key}</span>
              <div className="border-border-strong bg-surface w-152 rounded-lg border p-2">
                <WorkflowPreviewRunFeedback
                  {...args}
                  missingLabels={key === "failed" ? ["模型文件缺失"] : []}
                  nodeLabel={key === "running" ? "K采样器" : null}
                  pct={key === "running" ? 42 : key === "done" ? 100 : 0}
                  phase={phase}
                  resultUrl={key === "done" ? "/storybook-assets/sample-landscape.svg" : null}
                  running={key === "running"}
                  viewMode={viewMode}
                />
              </div>
            </div>
          ))}
        </div>
      ))}
    </div>
  ),
};
