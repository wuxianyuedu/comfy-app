// 成片预览面板的**知情交付**判据（ISSUE #4609）：部分镜头失败的影片照样合成出片
// （DONE），预览区必须露出「N 镜失败，已用其余 M 镜合成」；全部成功与生成中都不许出现。

import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

import { FilmStudioPreviewPanel, type FilmStudioPreviewPanelProps } from "./FilmStudioPreviewPanel";
import { FILM_SIZE, type Film } from "./film-studio-config";

function filmWith(overrides: Partial<Film> = {}): Film {
  return {
    bgmName: null,
    error: null,
    finalVideo: null,
    fps: 16,
    framesPerShot: 49,
    id: "f1",
    logs: [],
    progress: 100,
    script: "",
    shots: [],
    size: "16:9 横屏 1k",
    status: "DONE",
    styleSlug: null,
    subtitleOn: false,
    title: "测试成片",
    type: "short_video",
    ...overrides,
  };
}

/** 面板 props 的控制器切片（与组件的 Pick 同源，不另立第二份）。 */
type PreviewController = FilmStudioPreviewPanelProps["c"];

function controllerWith(film: Film | null): PreviewController {
  /* 面板 props 已按 Pick 收窄到这四块，桩对象直接可赋值，无需类型断言。 */
  return { film, size: FILM_SIZE, fps: 16, running: false };
}

afterEach(cleanup);

describe("FilmStudioPreviewPanel — 部分镜头失败的知情提示（#4609）", () => {
  it("DONE 且有失败镜头：露出「N 镜失败，已用其余 M 镜合成」", () => {
    const c = controllerWith(
      filmWith({
        shots: [
          {
            duration: 3,
            heading: "开场",
            id: "s0",
            order: 0,
            progress: 100,
            prompt: "p",
            status: "SUCCEEDED",
            videoPath: null,
          },
          {
            duration: null,
            heading: "转折",
            id: "s1",
            order: 1,
            progress: 0,
            prompt: "p",
            status: "FAILED",
            videoPath: null,
          },
        ],
      }),
    );
    render(<FilmStudioPreviewPanel c={c} isPlaying={false} onTogglePlay={() => undefined} />);

    expect(screen.getByText(/1 镜失败，已用其余 1 镜合成/)).toBeInTheDocument();
  });

  it("全部成功：不出现失败提示", () => {
    const c = controllerWith(
      filmWith({
        shots: [
          {
            duration: 3,
            heading: "开场",
            id: "s0",
            order: 0,
            progress: 100,
            prompt: "p",
            status: "SUCCEEDED",
            videoPath: null,
          },
          {
            duration: 3,
            heading: "收尾",
            id: "s1",
            order: 1,
            progress: 100,
            prompt: "p",
            status: "SUCCEEDED",
            videoPath: null,
          },
        ],
      }),
    );
    render(<FilmStudioPreviewPanel c={c} isPlaying={false} onTogglePlay={() => undefined} />);

    expect(screen.queryByText(/镜失败/)).toBeNull();
  });

  it("生成中的影片即使已有失败镜头也不提示（只在 DONE 露出）", () => {
    const c = controllerWith(
      filmWith({
        status: "GENERATING",
        shots: [
          {
            duration: 3,
            heading: "开场",
            id: "s0",
            order: 0,
            progress: 100,
            prompt: "p",
            status: "SUCCEEDED",
            videoPath: null,
          },
          {
            duration: null,
            heading: "转折",
            id: "s1",
            order: 1,
            progress: 0,
            prompt: "p",
            status: "FAILED",
            videoPath: null,
          },
        ],
      }),
    );
    render(<FilmStudioPreviewPanel c={c} isPlaying={false} onTogglePlay={() => undefined} />);

    expect(screen.queryByText(/镜失败/)).toBeNull();
  });
});
