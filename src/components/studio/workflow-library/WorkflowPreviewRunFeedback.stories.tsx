import type { Meta, StoryObj } from "@storybook/nextjs";

import { WorkflowPreviewRunFeedback } from "~/components/studio/workflow-library/WorkflowPreviewRunFeedback";
import type { Phase } from "~/components/studio/workflow-library/hooks/use-generation-runner";

/**
 * 工作流预览底部的运行反馈条（两种视图模式通用）。
 *
 * 纯 props：`phase` 是 `use-generation-runner` 的状态机投影（五档：
 * idle / starting / running / done / failed），其余是几个可空值。它值得有 story
 * 的地方是**「哪些档位在哪种视图模式下出现」这条交叉判据**：
 *
 *   进度条         —— 两种模式通用（`running` 时才画）；
 *   结果图 / 失败原因 / 缺参提醒 —— **只在 `viewMode="use"` 显示**。
 *
 * 后一条是刻意的：编辑对外参数是配置界面，不该在那儿展示「上一次运行的结果与错误」
 * ——那样用户会以为改完参数结果就跟着变了。所以下面把两档视图 × 若干 phase
 * 逐组摆出来，单摆一档看不出这条规则在做减法。
 *
 * `uploadNotice` 是**素材上传的可见出口**（ComfyUI 未运行 / 正在启动 / 启动超时
 * 都落这里）：上传位自身没有错误区，只记 console 用户看不到任何原因（ISSUE #345）
 * —— 所以下面给了「有提示」与「无提示」两档，那条提示是它可以修掉的事故形状。
 */
const PHASES: Record<string, Phase> = {
  done: { imageUrl: "/storybook-assets/sample-landscape.svg", kind: "done" },
  failed: {
    kind: "failed",
    message: "缺参：模型文件 sd_xl_base_1.0.safetensors 不在本机",
  },
  idle: { kind: "idle" },
  running: {
    kind: "running",
    node: { id: "3", label: "K采样器", max: 8, value: 3 },
    pct: 42,
  },
  runningNoNode: { kind: "running", pct: 17 },
  starting: { kind: "starting" },
};

/**
 * 「两档视图 × 三条 phase」的矩阵行。
 *
 * 写成具名常量而不是 `PHASES[key]`：`PHASES` 是 `Record<string, Phase>`，
 * 在 `noUncheckedIndexedAccess` 下索引结果是 `Phase | undefined`，而这里要的
 * 是三档**确定存在**的 phase。用 `!` 或 `as` 都会被既有硬闸拦下
 *（`check-non-null-assertions.cjs` 与 `non-nullable-type-assertion-style`），
 * 所以直接给一份显式清单。
 */
const MATRIX_ROWS: ReadonlyArray<readonly [string, Phase]> = [
  [
    "running",
    {
      kind: "running",
      node: { id: "3", label: "K采样器", max: 8, value: 3 },
      pct: 42,
    },
  ],
  ["done", { imageUrl: "/storybook-assets/sample-landscape.svg", kind: "done" }],
  [
    "failed",
    {
      kind: "failed",
      message: "缺参：模型文件 sd_xl_base_1.0.safetensors 不在本机",
    },
  ],
];

const meta = {
  args: {
    missingLabels: [],
    nodeLabel: "K采样器",
    onDismissUploadNotice: () => undefined,
    pct: 42,
    phase: PHASES.running,
    resultUrl: null,
    running: true,
    uploadNotice: null,
    viewMode: "use",
    workflowName: "角色一致性 · 三视图",
  },
  argTypes: {
    running: { control: { type: "boolean" } },
    viewMode: { control: { type: "select" }, options: ["edit", "use"] },
  },
  component: WorkflowPreviewRunFeedback,
  title: "Studio/WorkflowPreviewRunFeedback",
} satisfies Meta<typeof WorkflowPreviewRunFeedback>;

export default meta;

type Story = StoryObj<typeof meta>;

/** 执行中（use 模式）：进度条 + 正在执行的节点名与步数。 */
export const Running: Story = {};

/** 执行中但没有节点名：退化成「正在执行工作流」整体进度，不显示步数。 */
export const RunningWithoutNodeLabel: Story = {
  args: { nodeLabel: null, pct: 17, phase: PHASES.runningNoNode },
};

/** 完成：结果图挂在反馈条里（只有 use 模式会走到这条）。 */
export const Done: Story = {
  args: {
    nodeLabel: null,
    pct: 100,
    phase: PHASES.done,
    resultUrl: "/storybook-assets/sample-landscape.svg",
    running: false,
  },
};

/** 失败：原因文案 + 缺参清单（两个出口都在这一档）。 */
export const Failed: Story = {
  args: {
    missingLabels: ["模型文件 sd_xl_base_1.0.safetensors", "输入图 input.png"],
    nodeLabel: null,
    pct: 0,
    phase: PHASES.failed,
    running: false,
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
 * **两档视图模式的交叉**：同一批 phase，`use` 模式显示结果/错误，`edit` 模式只留进度。
 *
 * 这是本件唯一「做减法」的规则，也是最容易在改动里被抹掉的一条 ——
 * 编辑对外参数时看到上一次运行的结果，会让人以为参数改完结果就跟着变了。
 */
export const ViewModeMatrix: Story = {
  render: (args) => (
    <div className="flex flex-col gap-8">
      {
        /* SAFETY: 类型断言已复核 */ (["edit", "use"] as const).map((viewMode) => (
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
        ))
      }
    </div>
  ),
};
