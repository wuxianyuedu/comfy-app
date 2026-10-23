/**
 * `workflow-run.server`（工作流库工作流的服务端执行入口）的判决面测试。
 *
 * 这条路径是**成片工作室 / 首帧合成 / 风格试验的矩阵扇出**唯一的本地执行入口
 * （内置模板已移除），出错的表现是「任务建了但跑不出图」或「参数没落到端口上」
 * ——都属于用户只能看到一句「失败」的那类。这里锁五件事：
 *   ① 工作流不存在 / 不属于该用户 → 直接抛错（不许静默建一个空任务）；
 *   ② rawJson 有 / 无 → 建行与踢领取的两种结果，且**没载荷时一行都不落**
 *      （那道闸原先写在 `createQueued` 之后，抛错时库里已经多了一条注定失败的
 *      排队行，而单卡串行意味着它会跑到用户别的任务前面）；
 *   ③ 对外封装的三元组真的按 nodeId + name 落到图上（数值回写不丢类型），
 *      没连线的口如实进 `unmatched`（调用方拿它告诉用户「这次没生效」）；
 *   ④ 显式传 `mode` 时不被工作流的默认模式顶掉；
 *   ⑤ `kick: false` 时不敲节拍（整批提交由调用方统一敲一次）。
 */
import { describe, expect, it, vi, beforeEach } from "vitest";

const { kickMock, taskRepo } = vi.hoisted(() => ({
  kickMock: vi.fn<(job: unknown) => void>(() => undefined),
  taskRepo: {
    createQueued: vi.fn(async (_input: unknown) => ({ id: "task-1" })),
  },
}));

vi.mock("~/server/db", async () => {
  const { createTestDb } = await import("../../../tests/helpers/test-db");
  return { db: createTestDb() };
});
vi.mock("~/lib/comfyui/executor-continuation", () => ({
  kickQueue: kickMock,
}));
/* `repository` 是 server-only 的 Drizzle 实现（import 即读库），本用例只想验
 * 编排判决，故两个仓储整体换桩（与 server/film/orchestrator.test.ts 同一口径）。 */
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
    expect(kickMock).not.toHaveBeenCalled();
  });

  it("rawJson 工作流 → 建行带 execPayload + workflowInputs，随后踢一次领取", async () => {
    wfRepoStub.findByIdForUser.mockResolvedValue({
      id: "wf-1",
      name: "库生图",
      taskType: "T2I",
      modes: "[]",
      defaultMode: null,
      rawJson: { nodes: [{ id: "1", type: "KSampler" }] },
      workflowIO: IO,
      /* 落点只认作者连的线：提示词口连到该端口。 */
      paramMap: { source: { "mode:T2I": { prompt: "1::widget::prompt" } } },
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
      /* 提示词连了线 ⇒ 没有「给了值却落不到端口」的口。 */
      unmatched: [],
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
    // 载荷只随行走（§14 D1 第二刀：派发是库里的一次 pull，不再有内存 Job）
    const createdFull = taskRepo.createQueued.mock.calls[0]![0] as {
      execPayload?: unknown;
      claimedBy?: string;
    };
    expect(createdFull.execPayload).toBeDefined();
    expect(createdFull.claimedBy).toBe("inline");
    expect(kickMock).toHaveBeenCalledTimes(1);
  });

  it("无 rawJson → 抛「没有可执行内容」，不建任务也不踢领取", async () => {
    wfRepoStub.findByIdForUser.mockResolvedValue({
      id: "wf-2",
      name: "空工作流",
      taskType: "T2I",
      modes: "[]",
      defaultMode: null,
      rawJson: null,
      workflowIO: IO,
      paramMap: { source: { "mode:T2I": { prompt: "1::widget::prompt" } } },
    });
    await expect(
      createWorkflowRunTask({
        userId: "u1",
        workflowId: "wf-2",
        values: { prompt: "新提示词" },
      }),
    ).rejects.toThrow("工作流没有可执行内容");
    /* 标题判的那一半：那道闸必须在落库**之前**。只看 `kickMock` 时，闸写在
       `createQueued` 之后照样绿 —— 而库里那时已经多了一条注定失败的排队行。 */
    expect(taskRepo.createQueued).not.toHaveBeenCalled();
    expect(kickMock).not.toHaveBeenCalled();
  });

  it("显式传 mode：按那个模式算落点，不被工作流的默认模式顶掉", async () => {
    wfRepoStub.findByIdForUser.mockResolvedValue({
      id: "wf-3",
      name: "双模式流",
      taskType: "T2I",
      modes: '["T2I","I2I"]',
      defaultMode: "T2I",
      rawJson: { nodes: [{ id: "1", type: "KSampler" }] },
      workflowIO: IO,
      /* 只有 I2I 那档连了提示词口：拿默认模式 T2I 算就一条都落不上。 */
      paramMap: { source: { "mode:I2I": { prompt: "1::widget::prompt" } } },
    });
    const res = await createWorkflowRunTask({
      userId: "u1",
      workflowId: "wf-3",
      mode: "I2I",
      values: { prompt: "按 I2I 跑" },
    });
    expect(res.unmatched).toEqual([]);
    const created = taskRepo.createQueued.mock.calls[0]![0] as {
      params: { workflowInputs?: { nodeId: string; name: string }[] };
    };
    expect(created.params.workflowInputs).toContainEqual(
      expect.objectContaining({ nodeId: "1", name: "prompt" }),
    );
  });

  it("kick:false 时不敲节拍（整批提交由调用方统一敲一次）", async () => {
    wfRepoStub.findByIdForUser.mockResolvedValue({
      id: "wf-4",
      name: "库生图",
      taskType: "T2I",
      modes: "[]",
      defaultMode: "T2I",
      rawJson: { nodes: [{ id: "1", type: "KSampler" }] },
      workflowIO: IO,
      paramMap: { source: { "mode:T2I": { prompt: "1::widget::prompt" } } },
    });
    await createWorkflowRunTask({
      userId: "u1",
      workflowId: "wf-4",
      values: { prompt: "批量里的一格" },
      kick: false,
    });
    /* 行照样落库（提交只写库里那一行），只是不敲派发器。 */
    expect(taskRepo.createQueued).toHaveBeenCalledTimes(1);
    expect(kickMock).not.toHaveBeenCalled();
  });

  it("作者没连线的口：值落不下去，如实进 unmatched 而不是静默用图内默认值", async () => {
    wfRepoStub.findByIdForUser.mockResolvedValue({
      id: "wf-5",
      name: "未连线",
      taskType: "T2I",
      modes: "[]",
      defaultMode: "T2I",
      rawJson: { nodes: [{ id: "1", type: "KSampler" }] },
      workflowIO: IO,
      paramMap: null,
    });
    const res = await createWorkflowRunTask({
      userId: "u1",
      workflowId: "wf-5",
      values: { prompt: "一句没有落点的提示词", seed: 7 },
    });
    expect(res.unmatched).toEqual(expect.arrayContaining(["prompt", "seed"]));
  });
});
