// @vitest-environment jsdom
// 成片工作室逻辑层单测：hook 只经由 vanillaApi 发请求，故整体替换该模块。
// 断言的是**编排行为**（轮询启停、脚本为空时短路、BGM 上传的错误通道），
// 而不是 tRPC 本身。

import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import type { Mock } from "vitest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { uploadBgm } from "~/lib/film/bgm-client";
import { vanillaApi } from "~/trpc/vanilla";

import { useFilmStudio } from "./use-film-studio";

const toast = {
  success: vi.fn(),
  error: vi.fn(),
  info: vi.fn(),
  toast: vi.fn(),
  loading: vi.fn(),
  update: vi.fn(),
  dismiss: vi.fn(),
};

vi.mock("../ToastProvider", () => ({
  useToast: () => toast,
}));

vi.mock("~/lib/film/bgm-client", () => ({
  uploadBgm: vi.fn(),
}));

vi.mock("~/trpc/vanilla", () => ({
  vanillaApi: {
    skill: { list: { query: vi.fn() } },
    film: {
      list: { query: vi.fn() },
      detail: { query: vi.fn() },
      create: { mutate: vi.fn() },
      start: { mutate: vi.fn() },
      cancel: { mutate: vi.fn() },
      compose: { mutate: vi.fn() },
    },
  },
}));

const mockedUpload = vi.mocked(uploadBgm);

/* tRPC 的 resolver 类型是 Resolver<...>（不是 vi.Mock），测试里按 Mock 取用。
 * 收敛成一个 helper，避免每处都写一次双重断言。 */
const mockOf = (fn: unknown) => fn as Mock;

const vanilla = {
  skill: { list: { query: mockOf(vanillaApi.skill.list.query) } },
  film: {
    list: { query: mockOf(vanillaApi.film.list.query) },
    detail: { query: mockOf(vanillaApi.film.detail.query) },
    create: { mutate: mockOf(vanillaApi.film.create.mutate) },
    start: { mutate: mockOf(vanillaApi.film.start.mutate) },
    cancel: { mutate: mockOf(vanillaApi.film.cancel.mutate) },
    compose: { mutate: mockOf(vanillaApi.film.compose.mutate) },
  },
};

/** 一条处于生成中的成片（触发轮询） */
function runningFilm(id = "f-1") {
  return {
    id,
    title: "未命名成片",
    script: "s",
    type: "short_video",
    styleSlug: null,
    size: "1280x720",
    fps: 16,
    framesPerShot: 49,
    subtitleOn: true,
    bgmName: null,
    status: "GENERATING" as const,
    progress: 10,
    finalVideo: null,
    error: null,
    logs: null,
    shots: [],
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.clearAllTimers?.();
  vanilla.skill.list.query.mockResolvedValue({ skills: [] });
  vanilla.film.list.query.mockResolvedValue({ films: [], ffmpegAvailable: true });
  vanilla.film.detail.query.mockResolvedValue({ film: runningFilm() });
  vanilla.film.create.mutate.mockResolvedValue({ id: "f-1" });
  vanilla.film.start.mutate.mockResolvedValue({ ok: true });
  vanilla.film.cancel.mutate.mockResolvedValue({ ok: true });
  vanilla.film.compose.mutate.mockResolvedValue({ ok: true });
});

afterEach(cleanup);

describe("useFilmStudio", () => {
  it("挂载即拉取技能与近期成片，并带上 ffmpeg 可用性", async () => {
    renderHook(() => useFilmStudio());
    await waitFor(() => expect(vanilla.skill.list.query).toHaveBeenCalled());
    expect(vanilla.film.list.query).toHaveBeenCalled();
  });

  it("元信息拉取失败不影响成片生成（静默，不弹错误）", async () => {
    vanilla.film.list.query.mockRejectedValue(new Error("500"));
    renderHook(() => useFilmStudio());
    await waitFor(() => expect(vanilla.skill.list.query).toHaveBeenCalled());
    expect(toast.error).not.toHaveBeenCalled();
  });

  it("脚本为空时直接短路：不发请求、提示请先输入剧本", async () => {
    const { result } = renderHook(() => useFilmStudio());
    act(() => result.current.setScript("   "));
    await act(async () => {
      await result.current.create();
    });
    expect(vanilla.film.create.mutate).not.toHaveBeenCalled();
    expect(toast.error).toHaveBeenCalledWith("请先输入剧本或创意");
  });

  it("一键成片：create → start → 拉详情 → 成功提示", async () => {
    const { result } = renderHook(() => useFilmStudio());
    await act(async () => {
      await result.current.create();
    });
    expect(vanilla.film.create.mutate).toHaveBeenCalledWith(
      expect.objectContaining({ title: "未命名成片", size: "1280x720", fps: 16 }),
    );
    expect(vanilla.film.start.mutate).toHaveBeenCalledWith({ id: "f-1" });
    expect(vanilla.film.detail.query).toHaveBeenCalledWith({ id: "f-1" });
    expect(toast.success).toHaveBeenCalledWith("已启动一键成片，正在逐镜生成…");
    // 生成中 → running 为真（决定进度条与「取消」按钮）
    expect(result.current.running).toBe(true);
  });

  it("create 失败：错误走 toast，loading 收敛回 false", async () => {
    vanilla.film.create.mutate.mockRejectedValue(new Error("配额不足"));
    const { result } = renderHook(() => useFilmStudio());
    await act(async () => {
      await result.current.create();
    });
    expect(toast.error).toHaveBeenCalledWith("配额不足");
    expect(result.current.loading).toBe(false);
  });

  it("create 抛非 Error 时用兜底文案（失败路径必须有可读出口）", async () => {
    vanilla.film.create.mutate.mockRejectedValue("boom");
    const { result } = renderHook(() => useFilmStudio());
    await act(async () => {
      await result.current.create();
    });
    expect(toast.error).toHaveBeenCalledWith("启动失败");
  });

  it("生成中进行中时启动轮询，完成后停止（不泄漏 interval）", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      vanilla.film.detail.query
        .mockResolvedValueOnce({ film: runningFilm() })
        .mockResolvedValue({ film: { ...runningFilm(), status: "DONE", finalVideo: "/v.mp4" } });
      const { result } = renderHook(() => useFilmStudio());
      await act(async () => {
        await result.current.create();
      });
      expect(result.current.running).toBe(true);

      // 推进一次轮询周期：详情回包变成 DONE → 停止轮询
      await act(async () => {
        vi.advanceTimersByTime(3100);
      });
      await waitFor(() => expect(result.current.running).toBe(false));

      const callsAfterDone = vanilla.film.detail.query.mock.calls.length;
      await act(async () => {
        vi.advanceTimersByTime(9000);
      });
      // 停止后不再继续拉详情
      expect(vanilla.film.detail.query.mock.calls.length).toBe(callsAfterDone);
    } finally {
      vi.useRealTimers();
    }
  });

  it("取消：先 cancel 再拉详情，并给出「已取消」提示", async () => {
    const { result } = renderHook(() => useFilmStudio());
    await act(async () => {
      await result.current.create();
    });
    await act(async () => {
      await result.current.cancel();
    });
    expect(vanilla.film.cancel.mutate).toHaveBeenCalledWith({ id: "f-1" });
    expect(toast.info).toHaveBeenCalledWith("已取消");
  });

  it("BGM 上传成功：写入文件名 + 成功提示", async () => {
    mockedUpload.mockResolvedValue("bgm.mp3");
    const { result } = renderHook(() => useFilmStudio());
    await act(async () => {
      await result.current.uploadBgmFile(new File(["x"], "bgm.mp3"));
    });
    expect(result.current.bgmName).toBe("bgm.mp3");
    expect(toast.success).toHaveBeenCalledWith("背景音乐已上传");
  });

  it("BGM 上传失败：错误走 toast，不把 bgmName 写成 undefined", async () => {
    mockedUpload.mockRejectedValue(new Error("音频大小不能超过 100MB"));
    const { result } = renderHook(() => useFilmStudio());
    await act(async () => {
      await result.current.uploadBgmFile(new File(["x"], "x.wav"));
    });
    expect(toast.error).toHaveBeenCalledWith("音频大小不能超过 100MB");
    expect(result.current.bgmName).toBeNull();
  });

  it("未启动成片时 cancel / recompose 是空操作（不发请求）", async () => {
    const { result } = renderHook(() => useFilmStudio());
    await act(async () => {
      await result.current.cancel();
      await result.current.recompose();
    });
    expect(vanilla.film.cancel.mutate).not.toHaveBeenCalled();
    expect(vanilla.film.compose.mutate).not.toHaveBeenCalled();
  });
});
