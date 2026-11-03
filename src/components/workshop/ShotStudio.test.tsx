//
// ShotStudio 行为测试：镜头生图 stage 的门禁、预填、并发出口与提示接线。
// 钉死：本地没选工作流 → 行内门禁拦下不请求；unmatched 口经 onNotice 上屏；
// API 未配置 → 批量禁用 + 放行提示；进行中有任务 id 显示「取消」接 onCancelShot；
// 空提示词挂载后自动预填且手改不覆盖。网络层整体 mock（generation-client）。
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { ShotStudio } from "./ShotStudio";
import {
  buildLibraryWorkflowInput,
  startLocalGenerate,
  watchTask,
  type LibraryWorkflowBuildResult,
} from "~/lib/workshop/generation-client";
import type { ApiChannelsView } from "~/lib/workshop/api-channel-shared";
import type { Character, Scene, Shot } from "~/lib/workshop/types";

vi.mock("~/lib/workshop/generation-client", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    buildLibraryWorkflowInput: vi.fn(),
    startLocalGenerate: vi.fn(),
    watchTask: vi.fn(),
    preparePortraitReferences: vi.fn(async () => ({
      files: [],
      failedCount: 0,
    })),
  };
});

const mockedBuild = vi.mocked(buildLibraryWorkflowInput);
const mockedStart = vi.mocked(startLocalGenerate);
const mockedWatch = vi.mocked(watchTask);

const scene: Scene = {
  id: "scene-1",
  heading: "场景1 · 清晨",
  location: "咖啡馆",
  time: "清晨",
  action: "小满推门进入",
  dialogue: "你好",
  shotCount: 1,
};
const character: Character = {
  id: "c1",
  name: "小满",
  ageGender: "少女",
  appearance: "短发",
  costume: "校服",
  personality: "开朗",
  temperament: "元气",
  styleTags: [],
  positivePrompt: "a schoolgirl, cinematic",
  negativePrompt: "blurry",
  params: {},
};

function makeShot(patch: Partial<Shot> = {}): Shot {
  return {
    id: "shot-1",
    index: 1,
    sceneId: "scene-1",
    sceneHeading: "场景1 · 清晨",
    shotType: "medium",
    description: "",
    characterIds: ["c1"],
    prompt: "",
    negativePrompt: "",
    params: {},
    status: "idle",
    ...patch,
  };
}

const channelsConfigured: ApiChannelsView = {
  image: {
    configured: true,
    baseUrl: "https://api.example.com",
    path: "/images/generations",
    model: "",
    hasApiKey: true,
  },
  video: {
    configured: false,
    baseUrl: "",
    path: "/videos/generations",
    model: "",
    hasApiKey: false,
  },
};

function buildResult(patch: Partial<LibraryWorkflowBuildResult> = {}): LibraryWorkflowBuildResult {
  return {
    input: { workflow: "wf-1", prompt: "a cat" },
    unmatched: [],
    mode: null,
    modes: [],
    usesFirstFrame: false,
    usesLastFrame: false,
    ...patch,
  };
}

type RenderOptions = {
  apiChannels?: ApiChannelsView | null;
  shots?: Array<Shot>;
  workflowId?: string;
};

function renderStudio(options: RenderOptions = {}) {
  const onShotsChange = vi.fn();
  const onNotice = vi.fn();
  const onCancelShot = vi.fn();
  const utils = render(
    <ShotStudio
      apiChannels={options.apiChannels === undefined ? channelsConfigured : options.apiChannels}
      characters={[character]}
      onCancelShot={onCancelShot}
      onNextStage={() => undefined}
      onNotice={onNotice}
      onOpenModelAdapters={() => undefined}
      onShotsChange={onShotsChange}
      projectId="proj-1"
      scenes={[scene]}
      shots={options.shots ?? [makeShot()]}
      styles={[]}
      workflowId={options.workflowId ?? ""}
    />,
  );
  return { onShotsChange, onNotice, onCancelShot, ...utils };
}

/** onShotsChange 是函数式补丁：把它折叠成「最终一条 patch 里的镜头列表」。 */
function lastPatchedShot(mock: { mock: { calls: Array<Array<unknown>> } }): Shot {
  /* SAFETY: 类型断言已复核 */
  const last = mock.mock.calls.at(-1)![0] as (prev: Array<Shot>) => Array<Shot>;
  return last([makeShot()])[0]!;
}

beforeEach(() => {
  mockedBuild.mockReset();
  mockedStart.mockReset();
  mockedWatch.mockReset();
});

afterEach(() => {
  cleanup();
});

describe("ShotStudio 门禁", () => {
  it("本地通道未选工作流：点单镜生成被行内门禁拦下，不发起请求", async () => {
    const user = userEvent.setup();
    renderStudio({ workflowId: "", shots: [makeShot({ prompt: "a cat" })] });

    await user.click(screen.getByRole("button", { name: "生成此镜头" }));

    expect(screen.getByText(/本地通道需要先在右侧「生成资源」/)).toBeTruthy();
    expect(mockedStart).not.toHaveBeenCalled();
  });

  it("API 通道未配置：切到 API 通道后批量禁用并给出放行提示", async () => {
    const user = userEvent.setup();
    renderStudio({
      workflowId: "wf-1",
      shots: [makeShot({ prompt: "a cat" })],
      apiChannels: null,
    });
    /* 通道 chip 是 `role="radio"`（一排里选一个，规范 16 §16.2.4.75）——
       不是 `role="button"`。改的是读法，不是它锁的那件事。 */
    await user.click(screen.getByRole("radio", { name: /API 直连/ }));
    expect(screen.getByText(/API 生图通道未配置/)).toBeTruthy();
    expect(screen.getByRole("button", { name: /批量生图/ })).toHaveProperty("disabled", true);
  });
});

describe("ShotStudio 自动预填", () => {
  it("空提示词的镜头在挂载后从场景 + 角色卡回填", async () => {
    const { onShotsChange } = renderStudio({ shots: [makeShot()] });
    await expect.poll(() => onShotsChange).toHaveBeenCalled();
    const patched = lastPatchedShot(onShotsChange);
    /* 预填文案来自 prompt-builder 的拼装：景别 + 场景要素 + 角色卡特征。 */
    expect(patched.prompt).toContain("小满");
    expect(patched.prompt).toContain("咖啡馆");
  });
});

describe("ShotStudio 生图出口", () => {
  it("本地生成：unmatched 口在发起前经 onNotice 上屏（不静默丢输入）", async () => {
    const user = userEvent.setup();
    const { onNotice } = renderStudio({
      workflowId: "wf-1",
      shots: [makeShot({ prompt: "a cat" })],
    });
    mockedBuild.mockResolvedValue(buildResult({ unmatched: ["seed"] }));
    mockedStart.mockResolvedValue("task-1");
    mockedWatch.mockImplementation((_taskId, h) => {
      h.onSettled({ ok: true });
      return () => undefined;
    });

    await user.click(screen.getByRole("button", { name: "生成此镜头" }));
    await expect.poll(() => mockedStart).toHaveBeenCalled();
    await expect.poll(() => onNotice).toHaveBeenCalledWith(expect.stringContaining("种子"));
  });

  it("进行中且有本机任务 id 的镜头显示「取消」，点击接 onCancelShot", () => {
    const { onCancelShot } = renderStudio({
      workflowId: "wf-1",
      shots: [
        makeShot({
          status: "running",
          taskId: "task-live",
          prompt: "a cat",
        }),
      ],
    });
    const cancel = screen.getByRole("button", { name: "取消" });
    fireEvent.click(cancel);
    expect(onCancelShot).toHaveBeenCalledTimes(1);
  });

  it("本地任务落定后按结果回写状态（成功 → done）", async () => {
    const user = userEvent.setup();
    const { onShotsChange } = renderStudio({
      workflowId: "wf-1",
      shots: [makeShot({ prompt: "a cat" })],
    });
    mockedBuild.mockResolvedValue(buildResult());
    mockedStart.mockResolvedValue("task-1");
    mockedWatch.mockImplementation((_taskId, h) => {
      h.onOutput?.({ url: "/api/generated/1.png", kind: "image" });
      h.onSettled({ ok: true });
      return () => undefined;
    });

    await user.click(screen.getByRole("button", { name: "生成此镜头" }));
    await expect.poll(() => onShotsChange).toHaveBeenCalled();
    /* watchShot 的产物回写经 onShotsChange 的函数式补丁发生 */
    const calls = vi.mocked(onShotsChange).mock.calls;
    const wroteImage = calls.some((call) => {
      /* SAFETY: 类型断言已复核 */
      const patch = (call[0] as (prev: Array<Shot>) => Array<Shot>)([makeShot()])[0]!;
      return patch.imageUrl === "/api/generated/1.png";
    });
    expect(wroteImage).toBe(true);
  });
});

describe("ShotStudio 空态", () => {
  it("无镜头数据：给引导空态", () => {
    renderStudio({ shots: [] });
    expect(screen.getByText(/暂无镜头数据/)).toBeTruthy();
  });
});
