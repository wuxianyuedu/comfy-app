import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

afterEach(cleanup);

/**
 * 登录页「登录/创建账号」切换的形态回归（ISSUE #1925）：此前手搓 `Button variant="ghost"`
 * 钉了底色没钉字色，划过已选中项时 `text-primary` 被 hover 翻成 `foreground`（ISSUE #1423
 * 那一族的另一半）。现整排交给 `ui/select-chip`，钉单选语义 + 选中档四层俱在 + 悬停回钉。
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
    expect(screen.getByRole("radiogroup", { name: "登录或创建账号" })).toBeTruthy();
    const chips = screen.getAllByRole("radio");
    expect(chips.map((c) => c.textContent)).toEqual(["登录", "创建账号"]);
    expect(chips.map((c) => c.getAttribute("aria-checked"))).toEqual(["true", "false"]);
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
