/**
 * 日志行里「点路径 → 在文件管理器里定位」的可见行为（ISSUE #1365）——本文件钉**接线**：
 * 渲染出可点按钮且文本一字不改；点一下发一次 `setting.revealPath`；同一事件循环连点只发一次
 * （`useReentrancyLock`）；成功「已定位」、失败「打开失败」并把原因放进 `title`（硬规则 4）。
 * mock 边界：`~/trpc/vanilla` 换假客户端；`log-path-tokens` 不 mock（识别是判据本体）。 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const { mutateMock } = vi.hoisted(() => ({
  mutateMock: vi.fn<(input: { path: string }) => Promise<{ detail: string; ok: boolean }>>(),
}));

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

const ROOT = String.raw`F:\AI\Other\comfy-app-t3-branch4`;

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
        expanded={false}
        keyword=""
        onToggleExpand={() => undefined}
        style={{}}
        wrap
      />
    </TooltipProvider>,
  );
}

/**
 * 取悬停出来的提示浮层（Base UI tooltip 不带 `role`，按 `data-slot` 认）。
 * 用悬停而不是读属性：悬停文案是唯一的「失败说清原因」通道（P82 把原生 `title=` 换成
 * `ui/hint`），只断言「按钮上还有 title 属性」会在这条治理线生效后变成假绿。
 */
async function hintText(user: ReturnType<typeof userEvent.setup>, el: HTMLElement) {
  /* 先 `unhover` 再 `hover`：点击之后指针已经停在按钮上，直接再 hover 不会
   * 触发新的 open（Base UI 认的是「进入」这一次转移）。 */
  await user.unhover(el);
  await user.hover(el);
  const popup = await screen.findByText(/./, {
    selector: '[data-slot="tooltip-content"]',
  });
  // oxlint-disable-next-line typescript/no-unnecessary-condition -- DOM textContent 运行期是 string|null（lib.dom 声明），规则未建模，保留空值兜底
  return popup.textContent ?? "";
}

/** 这一行里所有「定位路径」按钮（按 aria-label 前缀数，见上面那条说明）。 */
function revealButtons(): Array<HTMLElement> {
  return screen
    .queryAllByRole("button")
    .filter((el) => (el.getAttribute("aria-label") ?? "").startsWith("在文件管理器里定位 "));
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
    expect(screen.getByRole("button", { name: `在文件管理器里定位 ${ROOT}` })).toBeTruthy();
  });

  it("不像路径的行不产生按钮（相对路径 / 散文都不给假入口）", () => {
    renderRow("保留 .next 缓存（首次启动：写入初始指纹，执行全量编译）");
    /* 只数「定位」类按钮：行尾那个复制按钮是既有件、与本判据无关，
     * 用 `data-*` 之外的判据（aria-label 前缀）数，计数才说得清数的是什么。 */
    expect(revealButtons()).toHaveLength(0);
  });

  it("相对路径不产生按钮（判不了相对谁，指错比不可点更糟）", () => {
    renderRow("shell log: log/shell/shell.log（见 src/lib/log/log-paths.ts:12）");
    expect(revealButtons()).toHaveLength(0);
  });

  it("带空格的路径是**整条**一个按钮（启动器回显 pwsh/pnpm 的那行）", () => {
    /* 钉的是「上色层与可点层同源」：上色层此前自持 `[^\s]*` 正则，把 `C:\Program Files\…`
     * 切成两段；识别在分片内做，切碎的路径认不出，按钮指向不存在的目录。
     * 现在两处都取自 `findLogPathTokens` 的区间，一条路径恒在一个分片里。 */
    renderRow(
      String.raw`>>> "C:\Program Files\PowerShell\7\pwsh.EXE" -NoProfile -File "D:\Program Files\nodejs\pnpm.ps1" -v`,
    );
    expect(revealButtons().map((el) => el.getAttribute("aria-label"))).toEqual([
      String.raw`在文件管理器里定位 C:\Program Files\PowerShell\7\pwsh.EXE`,
      String.raw`在文件管理器里定位 D:\Program Files\nodejs\pnpm.ps1`,
    ]);
  });

  it(String.raw`点带空格的路径，参数是整条（不是截断的 C:\Program）`, async () => {
    mutateMock.mockResolvedValue({ ok: true, detail: "已在文件管理器里定位" });
    const user = userEvent.setup();
    renderRow(String.raw`>>> "C:\Program Files\PowerShell\7\pwsh.EXE" -NoProfile`);
    await user.click(
      screen.getByRole("button", {
        name: String.raw`在文件管理器里定位 C:\Program Files\PowerShell\7\pwsh.EXE`,
      }),
    );
    await expect
      .poll(() => mutateMock.mock.calls[0]?.[0])
      .toEqual({ path: String.raw`C:\Program Files\PowerShell\7\pwsh.EXE` });
  });

  it("点一下发一次请求，参数是扫出来的那段路径", async () => {
    mutateMock.mockResolvedValue({ ok: true, detail: "已在文件管理器里定位" });
    const user = userEvent.setup();
    renderRow(`项目根: ${ROOT}`);
    await user.click(screen.getByRole("button", { name: `在文件管理器里定位 ${ROOT}` }));
    await expect.poll(() => mutateMock).toHaveBeenCalledTimes(1);
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
    await expect.poll(() => button.textContent).toContain("已定位");
  });

  it("失败时改口「打开失败」，悬停提示里给出服务端那句原因（硬规则 4）", async () => {
    mutateMock.mockResolvedValue({
      ok: false,
      detail: String.raw`找不到可在文件管理器里打开的路径：F:\nope`,
    });
    const user = userEvent.setup();
    renderRow(`项目根: ${ROOT}`);
    const button = screen.getByRole("button", {
      name: `在文件管理器里定位 ${ROOT}`,
    });
    await user.click(button);
    await expect.poll(() => button.textContent).toContain("打开失败");
    expect(await hintText(user, button)).toContain("找不到可在文件管理器里打开的路径");
  });

  it("网络层抛错也变成可见的失败（不许点了没反应）", async () => {
    mutateMock.mockRejectedValue(new Error("boom"));
    const user = userEvent.setup();
    renderRow(`项目根: ${ROOT}`);
    const button = screen.getByRole("button", {
      name: `在文件管理器里定位 ${ROOT}`,
    });
    await user.click(button);
    await expect.poll(() => button.textContent).toContain("打开失败");
    expect(await hintText(user, button)).toContain("boom");
  });

  it("同一次事件循环里连点两下只发一次（重入判据走同步 ref，读 busy state 会漏）", async () => {
    /* 挂起的 promise：用例要在请求**还没回来**的时候点第二下 —— 这正是
     * `setBusy(true)` 尚未提交的那个窗口。 */
    let resolveIt: (value: { detail: string; ok: boolean }) => void = () => {
      // 有意为空：赋值发生在下面 mock 的实现里，调用时早已被替换。
    };
    mutateMock.mockImplementation(
      () =>
        new Promise<{ detail: string; ok: boolean }>((resolve) => {
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
