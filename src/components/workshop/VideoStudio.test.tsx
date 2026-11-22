//
// VideoStudio 行为测试：视频生成 stage 的模型级联出口与门禁（#4834 统一级联后）。
// 钉死：空镜头引导空态；未选视频模型 → 生成禁用不请求；选中远端模型 → 提交带
// model + mode，同步 url 直接 done、异步任务轮询落定、轮询容错口径（#4608）；
// 选中本地工作流候选 → 走 buildLibraryWorkflowInput；进行中有任务 id 显示「取消」。
// 网络层整体 mock，轮询 sleep 替换为即时；模型目录 mock 成固定候选。
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import React from "react";
import type { SetStateAction } from "react";

import { VideoStudio } from "./VideoStudio";
import type { ModelSelection } from "./ModelCascadeSelect";
import {
  apiPollVideo,
  apiSubmitVideo,
  buildLibraryWorkflowInput,
  observeTaskUntilSettled,
  startLocalGenerate,
} from "~/lib/workshop/generation-client";
import type { TestCandidate } from "./model-test-config";
import type { Shot } from "~/lib/workshop/types";

vi.mock("~/lib/workshop/generation-client", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    buildLibraryWorkflowInput: vi.fn(),
    prepareLocalInputImage: vi.fn(),
    startLocalGenerate: vi.fn(),
    observeTaskUntilSettled: vi.fn(),
    apiSubmitVideo: vi.fn(),
    apiPollVideo: vi.fn(),
  };
});
/* 轮询节奏可控：sleep 替换为即时，apiPollVideo 的返回序列由用例编排。 */
vi.mock("~/lib/with-timeout", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, sleep: vi.fn(() => undefined) };
});

/* 模型目录 mock（#4834）：本地工作流候选（wf::vwf-1）+ 远端模型各一。 */
const catalogCandidates: Array<TestCandidate> = [
  {
    baseUrl: null,
    kind: "video",
    local: true,
    name: "wan-video",
    workflow: {
      category: "video",
      encapsulationReady: true,
      id: "vwf-1",
      modelTags: ["wan-video"],
      modes: ["T2V", "I2V"],
      name: "wan-video 视频工作流",
    },
  },
  { baseUrl: "https://api.example.com", kind: "video", local: false, name: "kling-2" },
];

function candidateValueOf(candidate: TestCandidate): string {
  return candidate.workflow === undefined ? candidate.name : `wf::${candidate.workflow.id}`;
}

vi.mock("~/components/workshop/hooks/use-model-catalog", () => ({
  useModelCatalog: () => ({
    modeTabs: [
      { label: "文生视频", mode: "T2V", modelCount: 2 },
      { label: "图生视频", mode: "I2V", modelCount: 2 },
    ],
    candidates: catalogCandidates,
    allCandidates: catalogCandidates,
    loading: false,
    defaultMode: "T2V",
    resolveCandidate: (value: string): TestCandidate | null =>
      catalogCandidates.find((c) => candidateValueOf(c) === value) ?? null,
  }),
}));

const mockedSubmit = vi.mocked(apiSubmitVideo);
const mockedPoll = vi.mocked(apiPollVideo);
const mockedBuild = vi.mocked(buildLibraryWorkflowInput);
const mockedLocalStart = vi.mocked(startLocalGenerate);
const mockedObserve = vi.mocked(observeTaskUntilSettled);

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

type RenderOptions = {
  /** 初始模型选择；缺省 = 已选中远端模型（走 API 提交/轮询那条最常测的链）。 */
  selection?: ModelSelection;
  shots?: Array<Shot>;
};

/** `onShotsChange` 的签名：可收镜头数组或函数式补丁（React 状态 setter）。 */
type ShotsSetter = (value: SetStateAction<Array<Shot>>) => void;

/** 受控壳：模型选择在测试里真实可交互。 */
function Harness({
  initialSelection,
  shots,
  onNotice,
  onShotsChange,
  onCancelShot,
  onOpenModelAdapters,
}: {
  initialSelection: ModelSelection;
  onCancelShot: (shot: Shot) => void;
  onNotice: (m: string) => void;
  onOpenModelAdapters: () => void;
  onShotsChange: ShotsSetter;
  shots: Array<Shot>;
}) {
  const [selection, setSelection] = React.useState<ModelSelection>(initialSelection);
  return (
    <VideoStudio
      modelSelection={selection}
      onCancelShot={onCancelShot}
      onModelSelectionChange={setSelection}
      onNextStage={() => undefined}
      onNotice={onNotice}
      onOpenModelAdapters={onOpenModelAdapters}
      onPrevStage={() => undefined}
      onShotsChange={onShotsChange}
      projectId="proj-1"
      shots={shots}
    />
  );
}

function renderStudio(options: RenderOptions = {}) {
  const onShotsChange = vi.fn<ShotsSetter>();
  const onNotice = vi.fn();
  const onCancelShot = vi.fn();
  const onOpenModelAdapters = vi.fn();
  render(
    <Harness
      initialSelection={options.selection ?? { mode: "T2V", model: "kling-2" }}
      onCancelShot={onCancelShot}
      onNotice={onNotice}
      onOpenModelAdapters={onOpenModelAdapters}
      onShotsChange={onShotsChange}
      shots={options.shots ?? [makeShot()]}
    />,
  );
  return { onShotsChange, onNotice, onCancelShot, onOpenModelAdapters };
}

/** 从一条 onShotsChange 调用里取出函数式补丁并应用一次。 */
function patchedShotOf(call: Parameters<ShotsSetter>): Shot {
  const updater = call[0];
  if (typeof updater !== "function") {
    throw new Error("onShotsChange 首参不是函数式更新");
  }
  const patched = updater([makeShot()])[0];
  if (patched === undefined) {
    throw new Error("onShotsChange 的补丁没有返回镜头");
  }
  return patched;
}

/** onShotsChange 是函数式补丁：折叠成最终一条 patch 里的镜头。 */
function lastPatchedShot(mock: { mock: { calls: Array<Parameters<ShotsSetter>> } }): Shot {
  const lastCall = mock.mock.calls.at(-1);
  if (lastCall === undefined) {
    throw new Error("onShotsChange 未被调用");
  }
  return patchedShotOf(lastCall);
}

beforeEach(() => {
  mockedSubmit.mockReset();
  mockedPoll.mockReset();
  mockedBuild.mockReset();
  mockedLocalStart.mockReset();
  mockedObserve.mockReset();
});

afterEach(() => {
  cleanup();
});

describe("VideoStudio 门禁与空态（#4834 统一级联）", () => {
  it("无镜头数据：给引导空态", () => {
    renderStudio({ shots: [] });
    expect(screen.getByText(/暂无镜头数据/)).toBeTruthy();
  });

  it("未选视频模型：生成按钮禁用，不发起请求", () => {
    renderStudio({ selection: { mode: "T2V", model: "" } });
    expect(screen.getByRole("button", { name: "生成片段" })).toHaveProperty("disabled", true);
    expect(screen.getByRole("button", { name: /批量生成视频/ })).toHaveProperty("disabled", true);
    expect(mockedSubmit).not.toHaveBeenCalled();
  });

  it("阶段内那枚就近入口：接在 onOpenModelAdapters 上，且名字与落地页一致", async () => {
    /* 两个判点各治一种静默失效：① 回调此前只写成 `() => undefined`，接错线
       按钮就变成装饰；② 按钮名字必须与落地页「模型适配」（`ModelAdaptersView`）
       一致，名字对不上用户只能靠猜（§12.12）。 */
    const user = userEvent.setup();
    const { onOpenModelAdapters } = renderStudio({});
    await user.click(screen.getByRole("button", { name: "模型适配" }));
    expect(onOpenModelAdapters).toHaveBeenCalledTimes(1);
  });

  it("选中本地工作流候选：走 buildLibraryWorkflowInput（不提交远端）", async () => {
    const user = userEvent.setup();
    const { onShotsChange } = renderStudio({
      selection: { mode: "I2V", model: "wf::vwf-1" },
    });
    mockedBuild.mockResolvedValue({
      input: { workflow: "vwf-1", prompt: "a cat, cinematic" },
      unmatched: [],
      mode: null,
      modes: [],
      usesFirstFrame: false,
      usesLastFrame: false,
    });
    mockedLocalStart.mockResolvedValue("task-1");
    mockedObserve.mockImplementation((opts) => {
      opts.onSettled({ ok: true });
      return () => undefined;
    });

    await user.click(screen.getByRole("button", { name: "生成片段" }));
    await expect.poll(() => mockedBuild).toHaveBeenCalled();
    expect(mockedBuild.mock.calls[0]?.[0]).toBe("vwf-1");
    expect(mockedSubmit).not.toHaveBeenCalled();
    expect(onShotsChange).toHaveBeenCalled();
  });
});

describe("VideoStudio 远端模型出口", () => {
  it("远端同步返回 url：clipStatus 直接 done 并写回 clipUrl；提交带 model + mode", async () => {
    const user = userEvent.setup();
    const { onShotsChange } = renderStudio({ shots: [makeShot()] });
    mockedSubmit.mockResolvedValue({ url: "/api/materials/clip.mp4" });

    await user.click(screen.getByRole("button", { name: "生成片段" }));
    await expect
      .poll(() => lastPatchedShot(onShotsChange))
      .toMatchObject({
        clipStatus: "done",
        clipUrl: "/api/materials/clip.mp4",
      });
    expect(mockedSubmit.mock.calls[0]?.[0]).toMatchObject({
      model: "kling-2",
      mode: "T2V",
    });
  });

  it("远端异步任务：轮询到 url 后落定；中途 pending 不误写", async () => {
    const user = userEvent.setup();
    const { onShotsChange } = renderStudio({ shots: [makeShot()] });
    mockedSubmit.mockResolvedValue({ remoteTaskId: "remote-1" });
    mockedPoll.mockResolvedValueOnce({ pending: true }).mockResolvedValueOnce({
      url: "/api/materials/remote.mp4",
      pending: false,
    });

    await user.click(screen.getByRole("button", { name: "生成片段" }));
    await expect
      .poll(() => lastPatchedShot(onShotsChange))
      .toMatchObject({
        clipStatus: "done",
        clipUrl: "/api/materials/remote.mp4",
      });
    expect(mockedPoll).toHaveBeenCalledWith("remote-1");
  });

  it("远端轮询单次 5xx 不判失败：下一拍拿到 url 仍落 done（#4608）", async () => {
    const user = userEvent.setup();
    const { onShotsChange } = renderStudio({ shots: [makeShot()] });
    mockedSubmit.mockResolvedValue({ remoteTaskId: "remote-1" });
    mockedPoll
      .mockRejectedValueOnce(new Error("API 视频轮询失败 (500)"))
      .mockResolvedValueOnce({ url: "/api/materials/remote.mp4", pending: false });

    await user.click(screen.getByRole("button", { name: "生成片段" }));
    await expect
      .poll(() => lastPatchedShot(onShotsChange))
      .toMatchObject({
        clipStatus: "done",
        clipUrl: "/api/materials/remote.mp4",
      });
    expect(mockedPoll).toHaveBeenCalledTimes(2);
  });

  it("远端轮询的失败计数是「连续」：中间一拍 pending 会清零（#4608）", async () => {
    const user = userEvent.setup();
    const { onShotsChange } = renderStudio({ shots: [makeShot()] });
    mockedSubmit.mockResolvedValue({ remoteTaskId: "remote-1" });
    mockedPoll
      .mockRejectedValueOnce(new Error("抖动一"))
      .mockResolvedValueOnce({ pending: true })
      .mockRejectedValueOnce(new Error("抖动二"))
      .mockResolvedValueOnce({ url: "/api/materials/remote.mp4", pending: false });

    await user.click(screen.getByRole("button", { name: "生成片段" }));
    await expect
      .poll(() => lastPatchedShot(onShotsChange))
      .toMatchObject({
        clipStatus: "done",
        clipUrl: "/api/materials/remote.mp4",
      });
    expect(mockedPoll).toHaveBeenCalledTimes(4);
  });

  it("远端轮询连续三次请求级失败才落 failed，提示带连续次数（#4608）", async () => {
    const user = userEvent.setup();
    const { onShotsChange } = renderStudio({ shots: [makeShot()] });
    mockedSubmit.mockResolvedValue({ remoteTaskId: "remote-1" });
    mockedPoll.mockRejectedValue(new Error("上游 503"));

    await user.click(screen.getByRole("button", { name: "生成片段" }));
    await expect.poll(() => lastPatchedShot(onShotsChange).clipStatus).toBe("failed");
    expect(mockedPoll).toHaveBeenCalledTimes(3);
    expect(screen.getByText(/连续失败 3 次/)).toBeTruthy();
  });

  it("远端提交失败：错误进行内 Alert 并把片段置 failed", async () => {
    const user = userEvent.setup();
    const { onShotsChange } = renderStudio({ shots: [makeShot()] });
    mockedSubmit.mockRejectedValue(new Error("远端限流"));

    await user.click(screen.getByRole("button", { name: "生成片段" }));
    await expect.poll(() => lastPatchedShot(onShotsChange).clipStatus).toBe("failed");
    expect(screen.getByText("远端限流")).toBeTruthy();
  });
});

describe("VideoStudio 取消", () => {
  it("进行中且有本机任务 id 的片段显示「取消」，点击接 onCancelShot", () => {
    const { onCancelShot } = renderStudio({
      selection: { mode: "T2V", model: "wf::vwf-1" },
      shots: [makeShot({ clipStatus: "running", clipTaskId: "clip-live" })],
    });
    fireEvent.click(screen.getByRole("button", { name: "取消" }));
    expect(onCancelShot).toHaveBeenCalledTimes(1);
  });
});
