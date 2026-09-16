// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import { cleanup, render, waitFor } from "@testing-library/react";
import { vanillaApi } from "~/trpc/vanilla";
import { TrainingStudio } from "./TrainingStudio";

/* 与 FilmStudio 同理：整体替换 vanilla tRPC 客户端，避免真实网络请求。 */
vi.mock("~/trpc/vanilla", () => ({
  vanillaApi: {
    model: { list: { query: vi.fn().mockResolvedValue({ models: [] }) } },
    train: {
      list: {
        query: vi
          .fn()
          .mockResolvedValue({ jobs: [], backendConfigured: false }),
      },
      create: { mutate: vi.fn().mockResolvedValue({ id: "t-1" }) },
      cancel: { mutate: vi.fn().mockResolvedValue({}) },
    },
  },
}));

/* TrainingStudio 用 next/navigation 的 useRouter 做跳转、用 next/link 渲染链接；
 * 测试环境没有 App Router 上下文，两个模块都换成最小等价实现。 */
vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: vi.fn(),
    replace: vi.fn(),
    back: vi.fn(),
    refresh: vi.fn(),
    prefetch: vi.fn(),
  }),
}));

vi.mock("next/link", () => ({
  default: ({ children, href }: { children: ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  ),
}));

afterEach(cleanup);

describe("TrainingStudio", () => {
  it("挂载后拉取底模与训练任务列表，并渲染表单外壳", async () => {
    const { container } = render(<TrainingStudio />);

    expect(container).not.toBeEmptyDOMElement();
    await waitFor(() => expect(vanillaApi.model.list.query).toHaveBeenCalled());
    expect(vanillaApi.train.list.query).toHaveBeenCalled();
    expect(container).toMatchSnapshot();
  });
});
