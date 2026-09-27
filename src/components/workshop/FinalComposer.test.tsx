// @vitest-environment jsdom
//
// FinalComposer 行为测试：纯客户端合成 stage 的用户可见契约。
//
// 钉死的四组行为：
//   ① 时间线的真实呈现 —— 每镜时长缺省 4s、片段计数、缺片段时的静帧占位提示；
//   ② 导出合成清单 —— 产物字段与镜头顺序、onRendered 的完成记账；
//   ③ 逐镜编辑 —— 时长输入的 1~20 钳取写回 onShotsChange；
//   ④ 门禁与完成态 —— 空镜头列表的引导空态、rendered 的完成横幅。
//
// `downloadJson` 是唯一需要替身的边界（它真会触发浏览器下载），其余全走真组件。
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { FinalComposer } from "./FinalComposer";
import { downloadJson } from "~/lib/browser-io";
import type { Shot } from "~/lib/workshop/types";

vi.mock("~/lib/browser-io", () => ({ downloadJson: vi.fn() }));

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
    ...patch,
  };
}

function renderComposer(shots: Shot[], rendered = false) {
  const onShotsChange = vi.fn();
  const onRendered = vi.fn();
  render(
    <FinalComposer
      shots={shots}
      title="测试项目"
      onShotsChange={onShotsChange}
      onRendered={onRendered}
      rendered={rendered}
    />,
  );
  return { onShotsChange, onRendered };
}

beforeEach(() => {
  vi.mocked(downloadJson).mockClear();
});

afterEach(() => cleanup());

describe("FinalComposer 时间线呈现", () => {
  it("空镜头列表：给引导空态而不是空面板", () => {
    renderComposer([]);
    expect(screen.getByText(/暂无分镜数据/)).toBeTruthy();
  });

  it("时间线按镜头列出：未出图的显示「待生成画面」，片段计数如实", () => {
    renderComposer([
      makeShot({ id: "s1", imageUrl: "/api/generated/1.png" }),
      makeShot({
        id: "s2",
        index: 2,
        sceneHeading: "场景2 · 正午",
        imageUrl: undefined,
      }),
    ]);
    expect(screen.getByText("场景1 · 清晨")).toBeTruthy();
    expect(screen.getByText("场景2 · 正午")).toBeTruthy();
    expect(screen.getByText(/待生成画面/)).toBeTruthy();
    expect(screen.getByText(/片段 0\/2/)).toBeTruthy();
    /* 缺片段镜头的静帧占位提示 */
    expect(screen.getByText(/2 个镜头还没有视频片段/)).toBeTruthy();
  });

  it("有图无片段的镜头标注「以静帧占位」，时长缺省按 4s 计入片长", () => {
    renderComposer([makeShot({ id: "s1", imageUrl: "/api/generated/1.png" })]);
    expect(screen.getByText(/待生成视频（以静帧占位）/)).toBeTruthy();
    /* duration 未给 → 4s；单镜片长约 4s */
    expect(screen.getByText(/片长约 4s/)).toBeTruthy();
  });

  it("rendered 为真时展示完成横幅", () => {
    renderComposer([makeShot({ clipUrl: "/api/generated/1.mp4" })], true);
    expect(screen.getByText(/合成清单已导出/)).toBeTruthy();
  });
});

describe("FinalComposer 导出合成清单", () => {
  it("导出：产物按时间线序携带镜头字段，并记账 rendered", () => {
    const { onRendered } = renderComposer([
      makeShot({
        id: "s2",
        index: 2,
        duration: 6,
        motion: "high",
        transition: "dissolve",
        dialogue: "台词一句",
        imageUrl: "/api/generated/2.png",
        clipUrl: "/api/generated/2.mp4",
      }),
      makeShot({ id: "s1", imageUrl: "/api/generated/1.png" }),
    ]);

    fireEvent.click(screen.getByRole("button", { name: /导出合成清单/ }));

    expect(vi.mocked(downloadJson)).toHaveBeenCalledTimes(1);
    const [plan, filename] = vi.mocked(downloadJson).mock.calls[0]!;
    expect(filename).toBe("测试项目-合成清单.json");
    expect(plan).toMatchObject({
      project: "测试项目",
      totalShots: 2,
      timeline: [
        {
          order: 1,
          shotId: "s2",
          durationSec: 6,
          motion: "high",
          transition: "dissolve",
          dialogue: "台词一句",
          clipUrl: "/api/generated/2.mp4",
        },
        {
          order: 2,
          shotId: "s1",
          imageUrl: "/api/generated/1.png",
          clipUrl: null,
          durationSec: 4,
        },
      ],
    });
    expect(onRendered).toHaveBeenCalledTimes(1);
  });
});

describe("FinalComposer 逐镜编辑", () => {
  it("时长输入被钳到 1~20：越界值写回前收口", async () => {
    const user = userEvent.setup();
    const { onShotsChange } = renderComposer([
      makeShot({ id: "s1", duration: 5 }),
    ]);

    const input = screen.getByDisplayValue("5");
    await user.clear(input);
    await user.type(input, "99");
    /* 每次键入都会 updateShot；最后一条 patch 应是钳取后的 20。 */
    const patches = vi
      .mocked(onShotsChange)
      .mock.calls.map((call) => (call[0] as Shot[])[0]!.duration);
    expect(patches[patches.length - 1]).toBe(20);
  });

  it("清空时长按缺省 4 处理（NaN 兜底）", async () => {
    const user = userEvent.setup();
    const { onShotsChange } = renderComposer([
      makeShot({ id: "s1", duration: 5 }),
    ]);

    const input = screen.getByDisplayValue("5");
    await user.clear(input);
    const patches = vi
      .mocked(onShotsChange)
      .mock.calls.map((call) => (call[0] as Shot[])[0]!.duration);
    expect(patches[patches.length - 1]).toBe(4);
  });
});
