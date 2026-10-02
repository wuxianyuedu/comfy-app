// @vitest-environment jsdom
/**
 * 日志行里「点路径 → 在文件管理器里定位」的可见行为（ISSUE #1365）。
 *
 * 用户诉求一句话：那一列路径要**点得动**。这条链有四段，各段有自己的判据
 * （识别 / 命令形态 / 闸门 / 重入），本文件钉的是**接线**那一半 —— 也是唯一
 * 一段没有任何单测能覆盖、只能靠「渲染出来点一下」验证的部分：
 *
 *   ① 渲染出的确实是可点的按钮（而不是紫字），且**路径文本一字不改**；
 *   ② 点一下真的发一次 `setting.revealPath`，参数是扫出来的那段路径；
 *   ③ 同一次事件循环里的连点只发一次（重入锁，`useReentrancyLock` 的同步 ref）；
 *   ④ 成功说「已定位」、失败说「打开失败」并把服务端给的原因放进 `title`
 *      —— 失败必须有可见出口（硬规则 4）。
 *
 * mock 边界：`~/trpc/vanilla` 换成可编程的假客户端（**绝不真发请求**），
 * `~/lib/log/log-path-tokens` **不 mock** —— 识别是本功能的判据本体，
 * mock 掉它等于把「渲染出来的到底是不是路径」这件事从用例里删掉。
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const { mutateMock } = vi.hoisted(() => ({ mutateMock: vi.fn() }));

vi.mock("~/trpc/vanilla", () => ({
  vanillaApi: {
    setting: {
      revealPath: { mutate: mutateMock },
    },
  },
}));

import { LogRow } from "./LogRow";
import type { LogEntry } from "./log-store";
import { TooltipProvider } from "~/components/ui/tooltip";

const ROOT = "F:\\AI\\Other\\comfy-app-t3-branch4";

function entry(message: string): LogEntry {
  return {
    id: "e-1",
    seq: 1,
    time: 1_700_000_000_000,
    level: "info",
    message,
    source: "system",
    origin: "shell-launch",
  };
}

/** 渲染一行（`LogRow` 的入参里其余几项与本判据无关，给最小可用值）。 */
function renderRow(message: string) {
  render(
    /* `Hint` 的浮层要 `TooltipProvider`（应用里挂在根布局上，见 `app/layout`）。 */
    <TooltipProvider delay={0}>
      <LogRow
        entry={entry(message)}
        wrap
        keyword=""
        expanded={false}
        onToggleExpand={() => undefined}
        style={{}}
      />
    </TooltipProvider>,
  );
}

/**
 * 取悬停出来的提示浮层（Base UI 的 tooltip 不带 `role`，按 `data-slot` 认）。
 *
 * 用悬停而不是读属性：悬停文案是本功能唯一的「失败说清原因」通道（P82 把原生
 * `title=` 换成了 `ui/hint`），只断言「按钮上还有个 title 属性」会在这条治理线
 * 生效之后变成假绿。
 */
async function hintText(
  user: ReturnType<typeof userEvent.setup>,
  el: HTMLElement,
) {
  /* 先 `unhover` 再 `hover`：点击之后指针已经停在按钮上，直接再 hover 不会
   * 触发新的 open（Base UI 认的是「进入」这一次转移）。 */
  await user.unhover(el);
  await user.hover(el);
  const popup = await screen.findByText(/./, {
    selector: '[data-slot="tooltip-content"]',
  });
  return popup.textContent ?? "";
}

/** 这一行里所有「定位路径」按钮（按 aria-label 前缀数，见上面那条说明）。 */
function revealButtons(): HTMLElement[] {
  return screen
    .queryAllByRole("button")
    .filter((el) =>
      (el.getAttribute("aria-label") ?? "").startsWith("在文件管理器里定位 "),
    );
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("日志行里的路径可点（ISSUE #1365）", () => {
  it("路径渲染成可点的按钮，文本一字不改", () => {
    renderRow(`编排脚本: ${ROOT}\\scripts\\dev-launcher.mjs`);
    const button = screen.getByRole("button", {
      name: `在文件管理器里定位 ${ROOT}\\scripts\\dev-launcher.mjs`,
    });
    expect(button.textContent).toContain(`${ROOT}\\scripts\\dev-launcher.mjs`);
  });

  it("一行里两段路径各有一个按钮（不合并成一段）", () => {
    renderRow(`node ${ROOT}\\scripts\\dev.mjs （cwd ${ROOT}）`);
    expect(
      screen.getByRole("button", {
        name: `在文件管理器里定位 ${ROOT}\\scripts\\dev.mjs`,
      }),
    ).toBeTruthy();
    expect(
      screen.getByRole("button", { name: `在文件管理器里定位 ${ROOT}` }),
    ).toBeTruthy();
  });

  it("不像路径的行不产生按钮（相对路径 / 散文都不给假入口）", () => {
    renderRow("保留 .next 缓存（首次启动：写入初始指纹，执行全量编译）");
    /* 只数「定位」类按钮：行尾那个复制按钮是既有件、与本判据无关，
     * 用 `data-*` 之外的判据（aria-label 前缀）数，计数才说得清数的是什么。 */
    expect(revealButtons()).toHaveLength(0);
  });

  it("相对路径不产生按钮（判不了相对谁，指错比不可点更糟）", () => {
    renderRow(
      "shell log: log/shell/shell.log（见 src/lib/log/log-paths.ts:12）",
    );
    expect(revealButtons()).toHaveLength(0);
  });

  it("点一下发一次请求，参数是扫出来的那段路径", async () => {
    mutateMock.mockResolvedValue({ ok: true, detail: "已在文件管理器里定位" });
    const user = userEvent.setup();
    renderRow(`项目根: ${ROOT}`);
    await user.click(
      screen.getByRole("button", { name: `在文件管理器里定位 ${ROOT}` }),
    );
    await waitFor(() => expect(mutateMock).toHaveBeenCalledTimes(1));
    expect(mutateMock).toHaveBeenCalledWith({ path: ROOT });
  });

  it("成功时按钮改口「已定位」（点一下要看得出有反应）", async () => {
    mutateMock.mockResolvedValue({ ok: true, detail: "已在文件管理器里定位" });
    const user = userEvent.setup();
    renderRow(`项目根: ${ROOT}`);
    const button = screen.getByRole("button", {
      name: `在文件管理器里定位 ${ROOT}`,
    });
    await user.click(button);
    await waitFor(() => expect(button.textContent).toContain("已定位"));
  });

  it("失败时改口「打开失败」，悬停提示里给出服务端那句原因（硬规则 4）", async () => {
    mutateMock.mockResolvedValue({
      ok: false,
      detail: "找不到可在文件管理器里打开的路径：F:\\nope",
    });
    const user = userEvent.setup();
    renderRow(`项目根: ${ROOT}`);
    const button = screen.getByRole("button", {
      name: `在文件管理器里定位 ${ROOT}`,
    });
    await user.click(button);
    await waitFor(() => expect(button.textContent).toContain("打开失败"));
    expect(await hintText(user, button)).toContain(
      "找不到可在文件管理器里打开的路径",
    );
  });

  it("网络层抛错也变成可见的失败（不许点了没反应）", async () => {
    mutateMock.mockRejectedValue(new Error("boom"));
    const user = userEvent.setup();
    renderRow(`项目根: ${ROOT}`);
    const button = screen.getByRole("button", {
      name: `在文件管理器里定位 ${ROOT}`,
    });
    await user.click(button);
    await waitFor(() => expect(button.textContent).toContain("打开失败"));
    expect(await hintText(user, button)).toContain("boom");
  });

  it("同一次事件循环里连点两下只发一次（重入判据走同步 ref，读 busy state 会漏）", async () => {
    /* 挂起的 promise：用例要在请求**还没回来**的时候点第二下 —— 这正是
     * `setBusy(true)` 尚未提交的那个窗口。 */
    let resolveIt: (value: { ok: boolean; detail: string }) => void = () => {
      // 有意为空：赋值发生在下面 mock 的实现里，调用时早已被替换。
    };
    mutateMock.mockImplementation(
      () =>
        new Promise<{ ok: boolean; detail: string }>((resolve) => {
          resolveIt = resolve;
        }),
    );
    const user = userEvent.setup();
    renderRow(`项目根: ${ROOT}`);
    const button = screen.getByRole("button", {
      name: `在文件管理器里定位 ${ROOT}`,
    });
    /* 不 await 第一次点击的收尾：两次点击落在同一批事件里，`setBusy(true)` 还没
     * 提交时第二次已经进来 —— 读 state 的写法正是在这里漏掉的。 */
    const first = user.click(button);
    const second = user.click(button);
    await Promise.all([first, second]);
    expect(mutateMock).toHaveBeenCalledTimes(1);
    resolveIt({ ok: true, detail: "已在文件管理器里定位" });
  });
});
