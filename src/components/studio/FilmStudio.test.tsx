// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { vanillaApi } from "~/trpc/vanilla";
import { ToastProvider } from "./ToastProvider";
import { FilmStudio } from "./FilmStudio";

/* FilmStudio 通过 vanilla tRPC 客户端拉数，测试里整体替换该模块：
 * 只保留组件挂载路径用到的 skill.list / film.list，其余（create/start/
 * cancel/compose/detail）同样给出桩实现，避免误触发真实网络请求。 */
vi.mock("~/trpc/vanilla", () => ({
  vanillaApi: {
    skill: { list: { query: vi.fn().mockResolvedValue({ skills: [] }) } },
    film: {
      list: {
        query: vi.fn().mockResolvedValue({ films: [], ffmpegAvailable: false }),
      },
      detail: { query: vi.fn().mockResolvedValue(null) },
      create: { mutate: vi.fn().mockResolvedValue({ id: "f-1" }) },
      createFromProject: { mutate: vi.fn().mockResolvedValue({ id: "f-1" }) },
      start: { mutate: vi.fn().mockResolvedValue({}) },
      cancel: { mutate: vi.fn().mockResolvedValue({}) },
      compose: { mutate: vi.fn().mockResolvedValue({}) },
    },
  },
}));

afterEach(cleanup);

describe("FilmStudio", () => {
  it("挂载后拉取技能与近期影片，并渲染工作台外壳", async () => {
    const { container } = render(
      <ToastProvider>
        <FilmStudio />
      </ToastProvider>,
    );

    expect(container).not.toBeEmptyDOMElement();
    await waitFor(() => expect(vanillaApi.skill.list.query).toHaveBeenCalled());
    expect(vanillaApi.film.list.query).toHaveBeenCalled();
    /* 按 §11.9 断言**用户可见结果**，不再 dump 整棵 49KB 的 DOM 树。
     * 这一屏要钉住的是「挂载后那些区块真的都在」，按区块各挑一条可失败的
     * 判据（标题文案 / 可访问名 / 可交互基元的 role）：
     *   顶栏 → 预览区 → 分镜列表 → 时间轴 → 右侧「镜头属性」。 */
    for (const [what, text] of [
      ["顶栏", "· 视频成片工作室"],
      ["预览区", "未命名成片"],
      ["分镜列表", "分镜列表"],
      ["时间轴", "视频轨"],
      ["时间轴·字幕轨", "字幕轨"],
      ["属性区", "镜头属性"],
    ] as const) {
      expect(screen.getByText(text), `${what}没渲染出来`).toBeInTheDocument();
    }
    // 三个带可访问名的图标按钮（撤/重做/新增镜头）是键盘与读屏器唯一入口。
    for (const name of ["撤销", "重做", "新增镜头"] as const) {
      expect(screen.getByLabelText(name)).toBeInTheDocument();
    }
    // 剧本输入框是这一屏的主动作，空态下也该在。
    expect(
      screen.getByPlaceholderText("支持一句话自动分镜…"),
    ).toBeInTheDocument();
  });
});
