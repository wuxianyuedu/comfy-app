/**
 * `AppearanceSection` 的单选组键盘契约（规范 06 §6.12）：手写 `role="radiogroup"` + `role="radio"` 时
 * 组内方向键没人给；ARIA radiogroup 契约要求方向键组内移动选中、且只有选中项留在 Tab 序列（roving tabindex）。
 * 断言对齐可见行为，不锁样式类。
 */
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { isRecord } from "~/lib/is-record";

import type { ReadySettingsPageController } from "../hooks/use-settings-page";

import { AppearanceSection } from "./AppearanceSection";

/* 本仓不在 setup 里注册 testing-library 的自动 cleanup（`globals: false`），
   每份用例自己收尾 —— 与 RuntimeLogBox.test.tsx 同款。 */
afterEach(cleanup);

/** 本分区只读 `theme` / `setTheme` 两格；接口其余成员与本节无关，替身里缺席。
 *  用谓词收窄而不是断言：先确认拿到的是对象、且这两格确实在。 */
function isAppearanceController(v: unknown): v is ReadySettingsPageController {
  return isRecord(v) && typeof v.theme === "string" && typeof v.setTheme === "function";
}

function controller(theme: "light" | "dark", setTheme = vi.fn()): ReadySettingsPageController {
  const stub: unknown = { theme, setTheme };
  if (!isAppearanceController(stub)) {
    throw new Error("外观分区的 controller 替身缺少 theme / setTheme");
  }
  return stub;
}

/** 主题外观那一组（本分区还有「圆角」「标题字阶」两组，同为 radiogroup）。 */
function themeGroup(): HTMLElement {
  const group = screen
    .getAllByRole("radiogroup")
    .find((g) => g.getAttribute("aria-label") === "主题外观");
  if (!group) {
    throw new Error("找不到「主题外观」radiogroup");
  }
  return group;
}

/** 组内的第 n 个 radio —— `getAllByRole` 的元素带 `undefined`，逐个取要显式收窄。 */
function radioAt(n: number): HTMLElement {
  const radio = within(themeGroup()).getAllByRole("radio")[n];
  if (!radio) {
    throw new Error(`「主题外观」组里没有第 ${n} 个 radio`);
  }
  return radio;
}

describe("AppearanceSection 的单选组键盘契约", () => {
  it("主题卡是 radio、选中态落在 aria-checked 上", () => {
    render(<AppearanceSection c={controller("dark")} />);
    expect(within(themeGroup()).getAllByRole("radio")).toHaveLength(2);
    expect(radioAt(0)).toHaveAttribute("aria-checked", "true");
    expect(radioAt(1)).toHaveAttribute("aria-checked", "false");
  });

  it("只有选中项留在 Tab 序列里（roving tabindex）", () => {
    render(<AppearanceSection c={controller("light")} />);
    expect(radioAt(0)).toHaveAttribute("tabindex", "-1");
    expect(radioAt(1)).toHaveAttribute("tabindex", "0");
  });

  it("方向键在组内移动并选中（这是本批补上的契约）", async () => {
    const user = userEvent.setup();
    const setTheme = vi.fn();
    render(<AppearanceSection c={controller("dark", setTheme)} />);
    await user.click(radioAt(0));
    await user.keyboard("{ArrowDown}");

    expect(setTheme).toHaveBeenCalledWith("light");
  });

  it("三组都带可访问名（否则读屏只念出一串 radio）", () => {
    render(<AppearanceSection c={controller("dark")} />);
    const labels = screen.getAllByRole("radiogroup").map((g) => g.getAttribute("aria-label"));
    expect(labels).toEqual(["主题外观", "圆角", "标题字阶"]);
  });
});

describe("AppearanceSection 字体自定义（#3513）", () => {
  it("渲染三个字体输入框（界面 / 代码 / 终端），带可访问名", () => {
    render(<AppearanceSection c={controller("dark")} />);
    for (const name of ["界面字体", "代码字体", "终端字体"]) {
      const input = screen.getByRole("textbox", { name });
      expect(input).toBeInTheDocument();
    }
  });

  it("每档字体都带「恢复默认」按钮", () => {
    render(<AppearanceSection c={controller("dark")} />);
    for (const name of ["界面字体", "代码字体", "终端字体"]) {
      expect(screen.getByRole("button", { name: `${name}恢复默认` })).toBeInTheDocument();
    }
  });

  it("字体输入框不增加 radiogroup 数量（恰好仍是三个）", () => {
    render(<AppearanceSection c={controller("dark")} />);
    const labels = screen.getAllByRole("radiogroup").map((g) => g.getAttribute("aria-label"));
    expect(labels).toEqual(["主题外观", "圆角", "标题字阶"]);
  });
});

/**
 * 三组的选中档都缺过「悬停值」（ISSUE #1925 第五批）：底是 `Button variant="ghost"` 自带无条件 `hover:`（(0,2,0)），
 * 而 `data-checked:*` 经 `:where()` 只有 (0,1,0) —— 悬停档稳赢，划过已选中项会被改回「未选中」；修法是就地钉
 * `data-checked:hover:*`。判的是裸 token 的存在，不是「读起来像不像」。
 */
describe("AppearanceSection 选中档的悬停值（ISSUE #1925）", () => {
  /** 从 className 里切出类名 token 集合：`a:hover:b` 是一整个 token。 */
  function tokensOf(el: HTMLElement): Set<string> {
    return new Set(el.className.split(/\s+/).filter(Boolean));
  }

  it("主题卡（含 `data-unchecked:bg-surface-row` 那一组）钉住了选中档的悬停值", () => {
    render(<AppearanceSection c={controller("dark")} />);
    const cls = radioAt(0).className;
    /* 选中档三层（描边 / 底色 / 字色）在悬停期间都必须成立 —— 少任何一层，
       悬停就会把「选中」改写成另一副样子。 */
    expect(cls).toContain("data-checked:hover:bg-primary-soft");
    expect(cls).toContain("data-checked:hover:text-ink");
    expect(cls).toContain("data-checked:hover:border-primary");
  });

  it("「圆角」「标题字阶」两排 chip 同样钉住了选中档的悬停值", () => {
    render(<AppearanceSection c={controller("dark")} />);
    for (const label of ["圆角", "标题字阶"]) {
      const group = screen.getByRole("radiogroup", { name: label });
      for (const radio of within(group).getAllByRole("radio")) {
        const cls = radio.className;
        expect(cls).toContain("data-checked:hover:bg-primary-soft");
        expect(cls).toContain("data-checked:hover:text-primary");
        expect(cls).toContain("data-checked:hover:border-primary");
        /* 未选中档的悬停也仍在，且**不含**选中档的底色 —— 两档不能互相串。 */
        expect(tokensOf(radio).has("data-checked:hover:bg-primary-soft")).toBe(true);
      }
    }
  });
});

describe("AppearanceSection 字体文件加载器（#3513 运行时替换）", () => {
  it("每档字体都带「选择文件」入口（拖入或选择字体文件）", () => {
    render(<AppearanceSection c={controller("dark")} />);
    /* 三档各一个浏览按钮 + 一句拖拽提示，且不应产生额外的 radiogroup。 */
    expect(screen.getAllByRole("button", { name: "选择文件" })).toHaveLength(3);
    expect(screen.getAllByText(/拖入字体文件/)).toHaveLength(3);
    const labels = screen.getAllByRole("radiogroup").map((g) => g.getAttribute("aria-label"));
    expect(labels).toEqual(["主题外观", "圆角", "标题字阶"]);
  });

  it("文件输入框接受字体扩展名（.ttf / .otf / .woff / .woff2）", () => {
    const { container } = render(<AppearanceSection c={controller("dark")} />);
    const inputs = container.querySelectorAll('input[type="file"][accept*=".ttf"]');
    expect(inputs).toHaveLength(3);
    inputs.forEach((el) => {
      const accept = el.getAttribute("accept") ?? "";
      expect(accept).toContain(".otf");
      expect(accept).toContain(".woff");
      expect(accept).toContain(".woff2");
    });
  });
});
