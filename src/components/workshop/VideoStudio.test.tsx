//
// VideoStudio 行为测试：视频生成 stage 的双通道出口与门禁。
//
// 钉死的用户可见契约：
//   • 空镜头列表给引导空态；
//   • 本地通道没选视频工作流 → 单镜生成被行内门禁拦下（不发起请求）；
//   • API 通道未配置 → 切过去后生成按钮禁用 + 放行提示；
//   • API 提交同步返回 url → clipStatus 直接 done 并写回 clipUrl；
//   • API 异步任务（remoteTaskId）→ 轮询到 url 后落定；
//   • 进行中且有本机任务 id 的片段显示「取消」并接 onCancelShot。
// 网络层整体 mock（generation-client），轮询用的 sleep 替换为即时（可控节奏）。
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { VideoStudio } from "./VideoStudio";
import {
  apiPollVideo,
  apiSubmitVideo,
  buildLibraryWorkflowInput,
} from "~/lib/workshop/generation-client";
import type { ApiChannelsView } from "~/lib/workshop/api-channel-shared";
import type { Shot } from "~/lib/workshop/types";

vi.mock("~/lib/workshop/generation-client", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    buildLibraryWorkflowInput: vi.fn(),
    prepareLocalInputImage: vi.fn(),
    startLocalGenerate: vi.fn(),
    apiSubmitVideo: vi.fn(),
    apiPollVideo: vi.fn(),
  };
});
/* 轮询节奏可控：sleep 替换为即时，apiPollVideo 的返回序列由用例编排。 */
vi.mock("~/lib/with-timeout", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, sleep: vi.fn(async () => undefined) };
});

const mockedSubmit = vi.mocked(apiSubmitVideo);
const mockedPoll = vi.mocked(apiPollVideo);

const videoReady: ApiChannelsView = {
  image: {
    configured: false,
    baseUrl: "",
    path: "/images/generations",
    model: "",
    hasApiKey: false,
  },
  video: {
    configured: true,
    baseUrl: "https://api.example.com",
    path: "/videos/generations",
    model: "",
    hasApiKey: true,
  },
};

function makeShot(patch: Partial<Shot> = {}): Shot {
  return {
    id: "shot-1",
    index: 1,
    sceneId: "scene-1",
    sceneHeading: "场景1 · 清晨",
    shotType: "medium",
    description: "",
    characterIds: [],
    prompt: "a cat, cinematic",
    negativePrompt: "",
    params: {},
    status: "done",
    imageUrl: "/api/generated/1.png",
    dialogue: "",
    ...patch,
  };
}

interface RenderOptions {
  shots?: Shot[];
  workflowId?: string;
  apiChannels?: ApiChannelsView | null;
}

function renderStudio(options: RenderOptions = {}) {
  const onShotsChange = vi.fn();
  const onNotice = vi.fn();
  const onCancelShot = vi.fn();
  render(
    <VideoStudio
      shots={options.shots ?? [makeShot()]}
      workflowId={options.workflowId ?? "vwf-1"}
      projectId="proj-1"
      apiChannels={
        options.apiChannels === undefined ? videoReady : options.apiChannels
      }
      onOpenApiSettings={() => undefined}
      onShotsChange={onShotsChange}
      onNotice={onNotice}
      onCancelShot={onCancelShot}
      onPrevStage={() => undefined}
      onNextStage={() => undefined}
    />,
  );
  return { onShotsChange, onNotice, onCancelShot };
}

/** onShotsChange 是函数式补丁：折叠成最终一条 patch 里的镜头。 */
function lastPatchedShot(mock: { mock: { calls: unknown[][] } }): Shot {
  const last = mock.mock.calls[mock.mock.calls.length - 1]![0] as (
    prev: Shot[],
  ) => Shot[];
  return last([makeShot()])[0]!;
}

async function switchToApi(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole("button", { name: /API 直连/ }));
}

beforeEach(() => {
  mockedSubmit.mockReset();
  mockedPoll.mockReset();
  vi.mocked(buildLibraryWorkflowInput).mockReset();
});

afterEach(() => cleanup());

describe("VideoStudio 门禁与空态", () => {
  it("无镜头数据：给引导空态", () => {
    renderStudio({ shots: [] });
    expect(screen.getByText(/暂无镜头数据/)).toBeTruthy();
  });

  it("本地通道未选视频工作流：点生成被行内门禁拦下，不发起请求", async () => {
    const user = userEvent.setup();
    renderStudio({
      workflowId: "",
      shots: [makeShot()],
    });
    await user.click(screen.getByRole("button", { name: "生成片段" }));
    /* 常驻放行提示（ChannelSwitch）+ 点按后的行内门禁 Alert 同时在场：
       前者只有 1 条，出现第 2 条即证明门禁生效。 */
    const gateTexts = screen.getAllByText(/本地通道需要先在右侧「生成资源」/);
    expect(gateTexts.length).toBeGreaterThanOrEqual(2);
    expect(mockedSubmit).not.toHaveBeenCalled();
  });

  it("API 通道未配置：切过去后生成按钮禁用并给出放行提示", async () => {
    const user = userEvent.setup();
    renderStudio({ apiChannels: null });
    await switchToApi(user);
    expect(screen.getByText(/API 视频通道未配置/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "生成片段" })).toHaveProperty(
      "disabled",
      true,
    );
  });
});

describe("VideoStudio API 通道出口", () => {
  it("API 同步返回 url：clipStatus 直接 done 并写回 clipUrl", async () => {
    const user = userEvent.setup();
    const { onShotsChange } = renderStudio({ shots: [makeShot()] });
    await switchToApi(user);
    mockedSubmit.mockResolvedValue({ url: "/api/materials/clip.mp4" });

    await user.click(screen.getByRole("button", { name: "生成片段" }));
    await waitFor(() =>
      expect(lastPatchedShot(onShotsChange)).toMatchObject({
        clipStatus: "done",
        clipUrl: "/api/materials/clip.mp4",
      }),
    );
  });

  it("API 异步任务：轮询到 url 后落定；中途 pending 不误写", async () => {
    const user = userEvent.setup();
    const { onShotsChange } = renderStudio({ shots: [makeShot()] });
    await switchToApi(user);
    mockedSubmit.mockResolvedValue({ remoteTaskId: "remote-1" });
    mockedPoll.mockResolvedValueOnce({ pending: true }).mockResolvedValueOnce({
      url: "/api/materials/remote.mp4",
      pending: false,
    });

    await user.click(screen.getByRole("button", { name: "生成片段" }));
    await waitFor(() =>
      expect(lastPatchedShot(onShotsChange)).toMatchObject({
        clipStatus: "done",
        clipUrl: "/api/materials/remote.mp4",
      }),
    );
    expect(mockedPoll).toHaveBeenCalledWith("remote-1");
  });

  it("API 提交失败：错误进行内 Alert 并把片段置 failed", async () => {
    const user = userEvent.setup();
    const { onShotsChange } = renderStudio({ shots: [makeShot()] });
    await switchToApi(user);
    mockedSubmit.mockRejectedValue(new Error("远端限流"));

    await user.click(screen.getByRole("button", { name: "生成片段" }));
    await waitFor(() =>
      expect(lastPatchedShot(onShotsChange).clipStatus).toBe("failed"),
    );
    expect(screen.getByText("远端限流")).toBeTruthy();
  });
});

describe("VideoStudio 取消", () => {
  it("进行中且有本机任务 id 的片段显示「取消」，点击接 onCancelShot", () => {
    const { onCancelShot } = renderStudio({
      shots: [makeShot({ clipStatus: "running", clipTaskId: "clip-live" })],
    });
    fireEvent.click(screen.getByRole("button", { name: "取消" }));
    expect(onCancelShot).toHaveBeenCalledTimes(1);
  });
});
