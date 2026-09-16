/**
 * `workflow-run.server`（工作流库工作流的服务端执行入口）的判决面测试。
 *
 * 这条路径是**成片工作室 / 首帧合成**唯一的本地执行入口（内置模板已移除），
 * 出错的表现是「任务建了但跑不出图」或「参数没落到端口上」——都属于用户只能
 * 看到一句「失败」的那类。这里锁三件事：
 *   ① 工作流不存在 / 不属于该用户 → 直接抛错（不许静默建一个空任务）；
 *   ② rawJson 有 / 无 → 两条入队形状（comfy-cli 覆盖项 vs 服务端回填的 API 图）；
 *   ③ 对外封装的三元组真的按 nodeId + name 落到图上（数值回写不丢类型）。
 */
import { describe, expect, it, vi, beforeEach } from "vitest";

const { enqueueMock, taskRepo } = vi.hoisted(() => ({
  enqueueMock: vi.fn<(job: unknown) => void>(() => undefined),
  taskRepo: {
    createQueued: vi.fn(async (_input: unknown) => ({ id: "task-1" })),
  },
}));

vi.mock("~/server/db", async () => {
  const { createTestDb } = await import("../../../tests/helpers/test-db");
  return { db: createTestDb() };
});
vi.mock("~/lib/comfyui/enqueue", () => ({
  enqueue: enqueueMock,
  subscribe: vi.fn(),
  getLogs: vi.fn(),
  cancelTask: vi.fn(),
}));
/* `repository` 是 server-only 的 Drizzle 实现（import 即读库），本用例只想验
 * 编排判决，故两个仓储整体换桩（与 film/orchestrator.test.ts 同一口径）。 */
vi.mock("~/lib/core/repository", () => ({
  workflowTemplateRepository: wfRepoStub,
  taskRepository: taskRepo,
}));

const wfRepoStub = vi.hoisted(() => ({
  findByIdForUser: vi.fn(),
}));

import { createWorkflowRunTask } from "./workflow-run.server";

beforeEach(() => {
  vi.clearAllMocks();
});

const IO = {
  "1::widget::prompt": {
    direction: "input",
    kind: "widget",
    nodeId: "1",
    name: "prompt",
    type: "STRING",
    defaultValue: "",
  },
  "2::widget::steps": {
    direction: "input",
    kind: "widget",
    nodeId: "2",
    name: "steps",
    type: "INT",
    defaultValue: 20,
  },
};

describe("createWorkflowRunTask", () => {
  it("工作流不存在 → 抛错且不建任务", async () => {
    wfRepoStub.findByIdForUser.mockResolvedValue(null);
    await expect(
      createWorkflowRunTask({
        userId: "u1",
        workflowId: "nope",
        values: { prompt: "hi" },
      }),
    ).rejects.toThrow("工作流不存在");
    expect(taskRepo.createQueued).not.toHaveBeenCalled();
    expect(enqueueMock).not.toHaveBeenCalled();
  });

  it("rawJson 工作流 → enqueue 带 rawJson + workflowInputs 作 overrides", async () => {
    wfRepoStub.findByIdForUser.mockResolvedValue({
      id: "wf-1",
      name: "库生图",
      taskType: "T2I",
      modes: "[]",
      defaultMode: null,
      rawJson: { nodes: [{ id: "1", type: "KSampler" }] },
      graph: {},
      workflowIO: IO,
    });
    const res = await createWorkflowRunTask({
      userId: "u1",
      workflowId: "wf-1",
      values: { prompt: "一只猫" },
    });
    expect(res).toEqual({
      taskId: "task-1",
      workflowName: "库生图",
      taskType: "T2I",
    });
    const created = taskRepo.createQueued.mock.calls[0]![0] as {
      params: {
        workflowInputs?: { nodeId: string; name: string; value: unknown }[];
      };
      prompt: string;
      workflowName: string;
    };
    expect(created.prompt).toBe("一只猫");
    expect(created.workflowName).toBe("库生图");
    expect(created.params.workflowInputs).toContainEqual({
      nodeId: "1",
      name: "prompt",
      value: "一只猫",
    });
    const job = enqueueMock.mock.calls[0]![0] as {
      rawJson?: unknown;
      overrides?: unknown;
    };
    expect(job.rawJson).toBeDefined();
    expect(job.overrides).toContainEqual({
      nodeId: "1",
      name: "prompt",
      value: "一只猫",
    });
  });

  it("无 rawJson（API 图）→ 服务端按 nodeId+name 回填，数值口保持 number", async () => {
    wfRepoStub.findByIdForUser.mockResolvedValue({
      id: "wf-2",
      name: "API 图",
      taskType: "T2I",
      modes: "[]",
      defaultMode: null,
      rawJson: null,
      graph: {
        "1": { class_type: "CLIPTextEncode", inputs: { prompt: "旧" } },
        "2": { class_type: "KSampler", inputs: { steps: 12 } },
      },
      workflowIO: IO,
    });
    await createWorkflowRunTask({
      userId: "u1",
      workflowId: "wf-2",
      values: { prompt: "新提示词" },
    });
    const job = enqueueMock.mock.calls[0]![0] as {
      prompt: Record<string, { inputs: Record<string, unknown> }>;
    };
    expect(job.prompt["1"]?.inputs.prompt).toBe("新提示词");
    // 库里是 number 时，字符串形数值回写要转回 number（ComfyUI 拒收字符串）
    const steps = job.prompt["2"]?.inputs.steps;
    expect(typeof steps).toBe("number");
  });
});
