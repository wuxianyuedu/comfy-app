//
// ShotStudio 行为测试：镜头生图 stage 的门禁、预填、并发出口与提示接线。
// 钉死（#4834 统一级联后）：未选图片模型 → 行内门禁拦下不请求；选中本地工作流
// 候选（wf::<id>）走 buildLibraryWorkflowInput；选中远端模型走 apiGenerateImage
// （带 model + mode）；unmatched 口经 onNotice 上屏；进行中有任务 id 显示「取消」
// 接 onCancelShot；空提示词挂载后自动预填且手改不覆盖。网络层整体 mock
//（generation-client），模型目录 mock 成固定候选（本地工作流 + 远端模型各一）。
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import React from "react";
import type { SetStateAction } from "react";

import { ShotStudio } from "./ShotStudio";
import type { ModelSelection } from "./ModelCascadeSelect";
import {
  apiGenerateImage,
  buildLibraryWorkflowInput,
  startLocalGenerate,
  observeTaskUntilSettled,
  type LibraryWorkflowBuildResult,
} from "~/lib/workshop/generation-client";
import type { TestCandidate } from "./model-test-config";
import type { Character, Scene, Shot } from "~/lib/workshop/types";

vi.mock("~/lib/workshop/generation-client", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    apiGenerateImage: vi.fn(),
    buildLibraryWorkflowInput: vi.fn(),
    startLocalGenerate: vi.fn(),
    observeTaskUntilSettled: vi.fn(),
    prepareShotReferences: vi.fn(() => ({
      files: [],
      failedCount: 0,
    })),
  };
});

/* 模型目录 mock（#4834）：本地工作流候选（wf::wf-1）+ 远端模型各一，
 * 模式页签固定 文生图 / 图像编辑 两档 —— ShotStudio 只消费这份读数。 */
const catalogCandidates: Array<TestCandidate> = [
  {
    baseUrl: null,
    kind: "image",
    local: true,
    name: "z-image",
    workflow: {
      category: "image",
      encapsulationReady: true,
      id: "wf-1",
      modelTags: ["z-image"],
      modes: ["T2I", "I2I"],
      name: "z-image 生图工作流",
    },
  },
  { baseUrl: "https://api.example.com", kind: "image", local: false, name: "gpt-image-2" },
];

function candidateValueOf(candidate: TestCandidate): string {
  return candidate.workflow === undefined ? candidate.name : `wf::${candidate.workflow.id}`;
}

vi.mock("~/components/workshop/hooks/use-model-catalog", () => ({
  useModelCatalog: () => ({
    modeTabs: [
      { label: "文生图", mode: "T2I", modelCount: 2 },
      { label: "图像编辑", mode: "I2I", modelCount: 2 },
    ],
    candidates: catalogCandidates,
    allCandidates: catalogCandidates,
    loading: false,
    defaultMode: "T2I",
    resolveCandidate: (value: string): TestCandidate | null =>
      catalogCandidates.find((c) => candidateValueOf(c) === value) ?? null,
  }),
}));

const mockedApiGenerateImage = vi.mocked(apiGenerateImage);
const mockedBuild = vi.mocked(buildLibraryWorkflowInput);
const mockedStart = vi.mocked(startLocalGenerate);
const mockedObserve = vi.mocked(observeTaskUntilSettled);

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
  /** 初始模型选择；缺省 = 已选中本地工作流候选（wf::wf-1）。 */
  selection?: ModelSelection;
  shots?: Array<Shot>;
};

/** `onShotsChange` 的签名：可收镜头数组或函数式补丁（React 状态 setter）。 */
type ShotsSetter = (value: SetStateAction<Array<Shot>>) => void;

/** 受控壳：模型选择在测试里真实可交互（点模式 / 换模型会写回 state）。 */
function Harness({
  initialSelection,
  shots,
  onNotice,
  onShotsChange,
  onCancelShot,
}: {
  initialSelection: ModelSelection;
  onCancelShot: (shot: Shot) => void;
  onNotice: (m: string) => void;
  onShotsChange: ShotsSetter;
  shots: Array<Shot>;
}) {
  const [selection, setSelection] = React.useState<ModelSelection>(initialSelection);
  return (
    <ShotStudio
      characters={[character]}
      modelSelection={selection}
      onCancelShot={onCancelShot}
      onModelSelectionChange={setSelection}
      onNextStage={() => undefined}
      onNotice={onNotice}
      onOpenModelAdapters={() => undefined}
      onShotsChange={onShotsChange}
      projectId="proj-1"
      scenes={[scene]}
      shots={shots}
      styles={[]}
    />
  );
}

function renderStudio(options: RenderOptions = {}) {
  const onShotsChange = vi.fn<ShotsSetter>();
  const onNotice = vi.fn();
  const onCancelShot = vi.fn();
  const utils = render(
    <Harness
      initialSelection={options.selection ?? { mode: "T2I", model: "wf::wf-1" }}
      onCancelShot={onCancelShot}
      onNotice={onNotice}
      onShotsChange={onShotsChange}
      shots={options.shots ?? [makeShot()]}
    />,
  );
  return { onShotsChange, onNotice, onCancelShot, ...utils };
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
  mockedApiGenerateImage.mockReset();
  mockedBuild.mockReset();
  mockedStart.mockReset();
  mockedObserve.mockReset();
});

afterEach(() => {
  cleanup();
});

describe("ShotStudio 门禁（#4834 统一级联）", () => {
  it("未选图片模型：生成按钮禁用，不发起任何请求", () => {
    renderStudio({
      selection: { mode: "T2I", model: "" },
      shots: [makeShot({ prompt: "a cat" })],
    });

    expect(screen.getByRole("button", { name: "生成此镜头" })).toHaveProperty("disabled", true);
    expect(screen.getByRole("button", { name: /批量生图/ })).toHaveProperty("disabled", true);
    expect(mockedStart).not.toHaveBeenCalled();
    expect(mockedApiGenerateImage).not.toHaveBeenCalled();
  });

  it("选中远端模型：不要求本地工作流，批量按钮可用", () => {
    renderStudio({
      selection: { mode: "T2I", model: "gpt-image-2" },
      shots: [makeShot({ prompt: "a cat" })],
    });
    expect(screen.getByRole("button", { name: /批量生图/ })).toHaveProperty("disabled", false);
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

describe("ShotStudio 生图出口（按候选分流两条通道）", () => {
  it("本地工作流候选（wf::<id>）：buildLibraryWorkflowInput 收到工作流 id", async () => {
    const user = userEvent.setup();
    const { onNotice } = renderStudio({
      selection: { mode: "T2I", model: "wf::wf-1" },
      shots: [makeShot({ prompt: "a cat" })],
    });
    mockedBuild.mockResolvedValue(buildResult({ unmatched: ["seed"] }));
    mockedStart.mockResolvedValue("task-1");
    mockedObserve.mockImplementation((opts) => {
      opts.onSettled({ ok: true });
      return () => undefined;
    });

    await user.click(screen.getByRole("button", { name: "生成此镜头" }));
    await expect.poll(() => mockedStart).toHaveBeenCalled();
    expect(mockedBuild.mock.calls[0]?.[0]).toBe("wf-1");
    await expect.poll(() => onNotice).toHaveBeenCalledWith(expect.stringContaining("种子"));
    expect(mockedApiGenerateImage).not.toHaveBeenCalled();
  });

  it("远端模型候选：走 apiGenerateImage，带选中的 model + mode", async () => {
    const user = userEvent.setup();
    renderStudio({
      selection: { mode: "I2I", model: "gpt-image-2" },
      shots: [makeShot({ prompt: "a cat" })],
    });
    mockedApiGenerateImage.mockResolvedValue("/api/generated/remote.png");

    await user.click(screen.getByRole("button", { name: "生成此镜头" }));
    await expect.poll(() => mockedApiGenerateImage).toHaveBeenCalled();
    expect(mockedApiGenerateImage.mock.calls[0]?.[0]).toMatchObject({
      model: "gpt-image-2",
      mode: "I2I",
    });
    expect(mockedStart).not.toHaveBeenCalled();
  });

  it("进行中且有本机任务 id 的镜头显示「取消」，点击接 onCancelShot", () => {
    const { onCancelShot } = renderStudio({
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
      selection: { mode: "T2I", model: "wf::wf-1" },
      shots: [makeShot({ prompt: "a cat" })],
    });
    mockedBuild.mockResolvedValue(buildResult());
    mockedStart.mockResolvedValue("task-1");
    mockedObserve.mockImplementation((opts) => {
      opts.onOutput?.({ url: "/api/generated/1.png", kind: "image" });
      opts.onSettled({ ok: true });
      return () => undefined;
    });

    await user.click(screen.getByRole("button", { name: "生成此镜头" }));
    await expect.poll(() => onShotsChange).toHaveBeenCalled();
    /* watchShot 的产物回写经 onShotsChange 的函数式补丁发生 */
    const calls = onShotsChange.mock.calls;
    const wroteImage = calls.some((call) => {
      const patch = patchedShotOf(call);
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
