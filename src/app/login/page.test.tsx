import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

afterEach(cleanup);

/**
 * 登录页「登录 / 创建账号」切换的形态回归（ISSUE #1925 第三批收口）。
 *
 * 它此前是手搓的 `Button variant="ghost"` + 选中三元：选中档给了
 * `bg-primary/15 text-primary hover:bg-primary/20` —— 底色那一半钉住了
 * （`cn()` 会把 `ghost` 的 `hover:bg-muted` 摘掉），**字色那一半没有**：
 * `ghost` 的 `hover:text-foreground` 留了下来，划过已选中的那一枚时
 * `text-primary` 被翻成 `foreground`（ISSUE #1423 那一族的另一半）。
 *
 * 现在整排交给 `ui/select-chip`：视觉与可访问性由 `aria-checked` **一处**驱动，
 * 调用处不可能只改一半。这里钉的就是这条 —— 单选语义 + 选中档四层俱在 + 悬停回钉。
 */
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock("~/server/better-auth/client", () => ({
  authClient: {
    signIn: { email: vi.fn() },
    signUp: { email: vi.fn() },
  },
}));

const { default: LoginPage } = await import("./page");

describe("登录页模式切换 chip（ISSUE #1925）", () => {
  it("是单选语义的 radiogroup，两枚各自带 aria-checked", () => {
    render(<LoginPage />);
    expect(
      screen.getByRole("radiogroup", { name: "登录或创建账号" }),
    ).toBeTruthy();
    const chips = screen.getAllByRole("radio");
    expect(chips.map((c) => c.textContent)).toEqual(["登录", "创建账号"]);
    expect(chips.map((c) => c.getAttribute("aria-checked"))).toEqual([
      "true",
      "false",
    ]);
  });

  it("选中档四层俱在，悬停值钉回常态（字色不会被悬停翻掉）", () => {
    render(<LoginPage />);
    const checked = screen
      .getAllByRole("radio")
      .find((c) => c.getAttribute("aria-checked") === "true")!;
    for (const layer of [
      "aria-checked:bg-primary-soft",
      "aria-checked:text-primary-strong",
      "aria-checked:border-primary",
      "aria-checked:font-semibold",
      "aria-checked:hover:bg-primary-soft",
      "aria-checked:hover:text-primary-strong",
    ]) {
      expect(checked.className).toContain(layer);
    }
  });
});
