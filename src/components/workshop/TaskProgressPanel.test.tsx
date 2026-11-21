import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render } from "@testing-library/react";

import type { TaskLogEntry } from "~/lib/workshop/generation-client";
import { TaskProgressPanel } from "./TaskProgressPanel";

const line = (msg: string, t = 0): TaskLogEntry => ({ level: "info", msg, t });

/** minimax-h3 同款：executing + progress 一帧。 */
const stageLogs = (nodeId: string, title: string, completed: number, total: number) => [
  line(
    `[comfy-cli 原始] {"type":"executing","node":"${nodeId}","title":"${title}","class_type":"KSampler"}`,
  ),
  line(
    `[comfy-cli 原始] {"type":"progress","node":"${nodeId}","completed":${String(completed)},"total":${String(total)}}`,
  ),
];

afterEach(cleanup);

describe("TaskProgressPanel", () => {
  it("日志没有进度事件（对话 / API 中继）时不渲染", () => {
    const { container } = render(
      <TaskProgressPanel logs={[line("普通日志"), line("[comfy-cli stdout] hi")]} />,
    );
    expect(container.querySelector('[data-testid="task-progress-panel"]')).toBeNull();
    expect(container.textContent).toBe("");
  });

  it("按节点渲染名称、completed/total 与百分比", () => {
    const { container } = render(
      <TaskProgressPanel
        logs={[
          ...stageLogs("23:15", "Generate Text", 4096, 8192),
          line('[comfy-cli 原始] {"type":"executed","node":"23:15"}'),
          ...stageLogs("23:7", "KSampler", 3, 6),
        ]}
      />,
    );
    const panel = container.querySelector('[data-testid="task-progress-panel"]')!;
    expect(panel.textContent).toContain("Generate Text");
    expect(panel.textContent).toContain("4096/8192");
    expect(panel.textContent).toContain("KSampler");
    expect(panel.textContent).toContain("3/6");
    const bars = [...panel.querySelectorAll('[data-slot="progress-bar-track"]')];
    expect(bars).toHaveLength(2);
    const [textBar, samplerBar] = bars;
    expect(textBar?.getAttribute("aria-valuenow")).toBe("50");
    expect(samplerBar?.getAttribute("aria-valuenow")).toBe("50");
  });

  it("收尾节点保留进度读数，无数字的运行中节点给不确定态与「进行中」", () => {
    const { container } = render(
      <TaskProgressPanel
        logs={[
          line('[comfy-cli 原始] {"type":"executing","node":"23:15","title":"Generate Text"}'),
          line('[comfy-cli 原始] {"type":"progress","node":"23:15","completed":8192,"total":8192}'),
          line('[comfy-cli 原始] {"type":"executed","node":"23:15"}'),
          line('[comfy-cli 原始] {"type":"executing","node":"23:8","title":"VAE Decode"}'),
        ]}
      />,
    );
    const panel = container.querySelector('[data-testid="task-progress-panel"]')!;
    expect(panel.textContent).toContain("8192/8192");
    expect(panel.textContent).toContain("进行中");
    const bars = [...panel.querySelectorAll('[data-slot="progress-bar-track"]')];
    expect(bars).toHaveLength(2);
    const [doneBar, runningBar] = bars;
    expect(doneBar?.getAttribute("aria-valuenow")).toBe("100");
    /* 无进度数字的运行中节点 = 不确定态：不给 aria-valuenow。 */
    expect(runningBar?.getAttribute("aria-valuenow")).toBeNull();
  });

  it("节点多于 6 个时只展开最近 6 行，其余以计数交代", () => {
    const logs = [1, 2, 3, 4, 5, 6, 7, 8].flatMap((i) =>
      stageLogs(`node-${String(i)}`, `节点${String(i)}`, i, 10),
    );
    const { container } = render(<TaskProgressPanel logs={logs} />);
    const panel = container.querySelector('[data-testid="task-progress-panel"]')!;
    expect(panel.textContent).toContain("另有 2 个节点已略去");
    expect(panel.textContent).not.toContain("节点1");
    expect(panel.textContent).not.toContain("节点2");
    expect(panel.textContent).toContain("节点7");
    expect(panel.textContent).toContain("节点8");
    expect(panel.querySelectorAll('[data-slot="progress-bar-track"]')).toHaveLength(6);
  });

  it("显示整轮已运行与每节点耗时（#4754）", () => {
    const { container } = render(
      <TaskProgressPanel
        logs={[
          line(
            '[comfy-cli 原始] {"type":"executing","node":"23:15","title":"Generate Text"}',
            1000,
          ),
          line(
            '[comfy-cli 原始] {"type":"progress","node":"23:15","completed":8192,"total":8192}',
            121_000,
          ),
          line('[comfy-cli 原始] {"type":"executed","node":"23:15"}', 121_000),
          line('[comfy-cli 原始] {"type":"executing","node":"23:7","title":"KSampler"}', 181_000),
          line(
            '[comfy-cli 原始] {"type":"progress","node":"23:7","completed":3,"total":6}',
            193_000,
          ),
        ]}
      />,
    );
    const panel = container.querySelector('[data-testid="task-progress-panel"]')!;
    /* 整轮：最早 1s → 最新 193s = 3m12s。 */
    expect(panel.textContent).toContain("已运行 3m12s");
    /* 已完成节点：8192/8192 · 耗时 2m00s；运行中节点：3/6 · 已跑 12s。 */
    expect(panel.textContent).toContain("8192/8192 · 2m00s");
    expect(panel.textContent).toContain("3/6 · 12s");
  });
});
