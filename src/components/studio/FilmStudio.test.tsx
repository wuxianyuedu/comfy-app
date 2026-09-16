// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, waitFor } from "@testing-library/react";
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
    expect(container).toMatchSnapshot();
  });
});
