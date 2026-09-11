// @vitest-environment jsdom
/**
 * 应用日志面板的**可见行为**（ISSUE #262）。
 *
 * 用户诉求逐条对应到断言：
 *   1. 「按时间顺序显示」——时间线由 store 保证，这里断言渲染出来的行首时刻
 *      是单调不减的；
 *   2. 「不能翻页、锁死 2000 条」——页脚给出「第 N / M 页」，翻到历史页能看到
 *      更早的日志且内容与第 1 页不同；
 *   3. 「query 刷满了、其他内容基本看不到」——来源筛选切到「应用」能滤掉启动行；
 *   4. 「看不出有没有新增」——停在历史页时页脚出现「有新的日志 · 回到最新」，
 *      点击后回到第 1 页。
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { act, cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { LogPanel } from "./LogPanel";
import { LOG_PAGE_SIZE, computeOriginCounts, useLogStore } from "./log-store";
import type { LogEntry } from "./log-store";

function makeEntry(index: number, overrides: Partial<LogEntry> = {}): LogEntry {
  return {
    id: `e-${index}`,
    seq: index + 1,
    time: 1_700_000_000_000 + index * 1_000,
    level: "info",
    message: `事件 ${index}`,
    source: "system",
    ...overrides,
  };
}

function seed(count: number) {
  act(() =>
    useLogStore
      .getState()
      .appendFileLogs(Array.from({ length: count }, (_, i) => makeEntry(i))),
  );
}

beforeEach(() => {
  const empty = { all: 0, debug: 0, info: 0, warn: 0, error: 0 };
  useLogStore.setState({
    logs: [],
    filteredLogs: [],
    filter: "all",
    origin: "all",
    search: "",
    isOpen: true,
    counts: empty,
    countsByOrigin: computeOriginCounts([]),
    /* 面板订阅的是 `header` 切片，它必须与上面几项**同时**复位：只重置
     * `filteredLogs` / `origin` 而留着上个用例的切片，面板会继续渲染旧快照，
     * 于是「切了来源却像没切」。 */
    header: {
      filteredLogs: [],
      filter: "all",
      origin: "all",
      search: "",
      isOpen: true,
      counts: empty,
      countsByOrigin: computeOriginCounts([]),
      page: 1,
      pageSize: LOG_PAGE_SIZE,
      bootId: null,
    },
    sessionStart: null,
    page: 1,
    revision: 0,
    viewRevision: 0,
    viewLength: 0,
  });
});

afterEach(async () => {
  cleanup();
  /* 来源下拉是 portal 渲染到 `document.body` 的。`cleanup()` 卸载 React 树之后，
   * base-ui 还要跑一轮收尾才摘掉弹层宿主——jsdom 里那一步等的是 `transitionend`
   * 这类事件，不会自己到来。先放它跑一轮宏任务，再手工把残留清干净：否则下一个
   * 用例继承上一棵树的弹层宿主，新下拉点开也不渲染候选（读到的现象就是「点开了
   * 却没有 option」）。真实浏览器里这些会自行结束，这里只是替测试环境收尾。 */
  await new Promise((resolve) => setTimeout(resolve, 0));
  document
    .querySelectorAll(
      '[data-slot="select-content"], [data-slot="select-backdrop"]',
    )
    .forEach((node) => node.remove());
  document
    .querySelectorAll("[data-base-ui-inert]")
    .forEach((node) => node.removeAttribute("data-base-ui-inert"));
  document.body.innerHTML = "";
});

/**
 * 级别筛选按钮。
 *
 * 用 `title` 前缀定位而不是 role+name：按钮的可访问名是「标签 + 数字」拼出来的
 * （如「警告· 2」），按 `/警告/` 找会同时命中标题徽标里的同名文本，选不中唯一
 * 元素。这里按既有实现给出的 `title`（「当前来源的警告：…」）作为稳定锚点。
 */
function levelButton(label: string): HTMLElement {
  const button = screen
    .getAllByRole("button")
    .find((item) =>
      item.getAttribute("title")?.startsWith(`当前来源的${label}：`),
    );
  if (!button) throw new Error(`找不到级别按钮「${label}」`);
  return button;
}

describe("LogPanel 日志面板", () => {
  it("渲染最新一页，并给出总页数（不再只有一个 2000 条的封顶页）", () => {
    seed(LOG_PAGE_SIZE + 50);
    render(<LogPanel />);

    expect(screen.getByText(/第 1 \/ 2 页/)).toBeInTheDocument();
    // 最新一页包含时间最近的那条
    expect(screen.getByText(/事件 249/)).toBeInTheDocument();
  });

  it("翻到更早一页能看到第 1 页没有的日志", async () => {
    seed(LOG_PAGE_SIZE + 50);
    render(<LogPanel />);
    const user = userEvent.setup();

    expect(screen.queryByText(/事件 0$/)).not.toBeInTheDocument();
    await user.click(screen.getByTitle("更早的一页"));
    expect(screen.getByText(/第 2 \/ 2 页/)).toBeInTheDocument();
    expect(screen.getByText(/事件 0$/)).toBeInTheDocument();
  });

  it("渲染的行按时刻升序（用户诉求「最基本的时间顺序」）", () => {
    seed(20);
    const { container } = render(<LogPanel />);
    const stamps = Array.from(
      container.querySelectorAll<HTMLElement>("time"),
    ).map((el) => el.textContent ?? "");
    expect(stamps).not.toHaveLength(0);
    const sorted = [...stamps].sort();
    expect(stamps).toEqual(sorted);
  });

  it("停在历史页时提示「有新的日志」并可一键回到最新", async () => {
    seed(LOG_PAGE_SIZE * 3);
    render(<LogPanel />);
    const user = userEvent.setup();
    await user.click(screen.getByTitle("更早的一页"));

    act(() =>
      useLogStore
        .getState()
        .appendFileLogs([makeEntry(9_999, { message: "新来的" })]),
    );
    const banner = screen.getByRole("button", { name: /有 1 条新的日志/ });
    await user.click(banner);

    expect(screen.getByText(/第 1 \//)).toBeInTheDocument();
    expect(screen.getByText(/新来的/)).toBeInTheDocument();
  });

  it("按来源筛选能滤掉启动行，只看应用运行日志", async () => {
    act(() =>
      useLogStore
        .getState()
        .appendFileLogs([
          makeEntry(1, { message: "开发服务已就绪", origin: "dev" }),
          makeEntry(2, { message: "任务入队", origin: "app-runtime" }),
        ]),
    );
    render(<LogPanel />);

    act(() => useLogStore.getState().setOrigin("app-runtime"));
    expect(screen.getByText(/任务入队/)).toBeInTheDocument();
    expect(screen.queryByText(/开发服务已就绪/)).not.toBeInTheDocument();
  });

  it("搜索命中时高亮关键词，并只留下命中的行", async () => {
    act(() =>
      useLogStore
        .getState()
        .appendFileLogs([
          makeEntry(1, { message: "ComfyUI 启动完成" }),
          makeEntry(2, { message: "任务入队" }),
        ]),
    );
    render(<LogPanel />);
    const user = userEvent.setup();

    await user.type(screen.getByPlaceholderText(/搜索日志/), "ComfyUI");
    const marks = document.querySelectorAll("mark");
    expect(marks).toHaveLength(1);
    expect(marks[0]?.textContent).toBe("ComfyUI");
  });

  it("连续重复行被折叠成一条「重复 N 次」说明", () => {
    act(() =>
      useLogStore
        .getState()
        .appendFileLogs(
          Array.from({ length: 40 }, (_, i) =>
            makeEntry(i, { message: "ComfyUI 未就绪，等待中" }),
          ),
        ),
    );
    render(<LogPanel />);
    expect(screen.getByText(/以上内容连续重复 35 次/)).toBeInTheDocument();
  });

  /* ISSUE #360：用户的原话是「看着警告有很多，切换过去结果显示是空的，
   * 这一类型就没有警告」。根因是来源下拉只有名字、级别数字又是全局合计，
   * 两边对不上。下面两条锁住修法：计数要分来源，且能一眼看出警告/错误。 */

  it("收起状态下只显示当前来源的名字，不重复每一项的条数", () => {
    act(() =>
      useLogStore
        .getState()
        .appendFileLogs([makeEntry(1, { level: "warn", origin: "app" })]),
    );
    render(<LogPanel />);
    /* 收缩面板本来就窄：这里报一遍每个来源多少条，只是把宽度再挤掉一块，
     * 而左侧级别按钮上已经写着同样的数字（用户反馈第 4 条）。 */
    const trigger = document.querySelector('[data-slot="select-trigger"]');
    const label =
      trigger?.textContent?.replace(/[\s\u25b2\u25bc\u200b]/g, "") ?? "";
    expect(label).toBe("全部来源");
  });

  it("级别按钮显示当前来源的计数，切来源后同步变化", () => {
    act(() =>
      useLogStore
        .getState()
        .appendFileLogs([
          makeEntry(1, { level: "warn", origin: "app" }),
          makeEntry(2, { level: "warn", origin: "app" }),
          makeEntry(3, { level: "warn", origin: "launcher" }),
        ]),
    );
    render(<LogPanel />);
    const warnButton = () => levelButton("警告");

    /* 全部来源：3 条警告 */
    expect(warnButton().textContent).toContain("3");

    /* 切来源（等价于在来源列表里点一项——选择动作本身由
     * 「按来源筛选能滤掉启动行」那条用例覆盖） */
    act(() => useLogStore.getState().setOrigin("launcher"));
    expect(warnButton().textContent).toContain("1");

    act(() => useLogStore.getState().setOrigin("dev"));
    /* 启动来源里一条警告都没有：按钮上是 0，列表也确实是空的——
     * 数字与内容对得上，用户不会再怀疑「日志丢了」。 */
    expect(warnButton().textContent).toContain("0");
    expect(screen.getByText(/暂无匹配的日志/)).toBeInTheDocument();
  });

  it("级别按钮的标签与数字上下分行（横向不再挤成竖排的汉字）", () => {
    act(() =>
      useLogStore
        .getState()
        .appendFileLogs([makeEntry(1, { level: "warn", origin: "app" })]),
    );
    render(<LogPanel />);

    const button = levelButton("警告");
    /* 标签与数字是**两个**子元素、且容器是竖向排列：并排时中文单字标签与四位
     * 数字各占一份宽度，行头放不下就只能把字竖起来（用户反馈第 3 条）。 */
    expect(button.className).toContain("flex-col");
    expect(button.children).toHaveLength(2);
    expect(button.children[0]?.textContent).toBe("警告");
    /* 警告计数非零时徽标带「·」前缀（用级别色强调），这里只断言数字本身 */
    expect(button.children[1]?.textContent).toContain("1");
  });

  it("标题旁常驻「来源 · 总数 · 警告 · 错误」汇总", () => {
    act(() =>
      useLogStore
        .getState()
        .appendFileLogs([
          makeEntry(1, { level: "warn", origin: "app" }),
          makeEntry(2, { level: "error", origin: "app" }),
          makeEntry(3, { level: "info", origin: "app" }),
        ]),
    );
    render(<LogPanel />);

    const badge = screen.getByTitle(/当前来源「全部来源」共 3 条/);
    expect(badge.textContent).toContain("全部来源");
    expect(badge.textContent).toContain("3");
    /* 警告与错误也要在这一句里带出来（此前只显示错误数） */
    expect(badge.textContent).toContain("警告 1");
    expect(badge.textContent).toContain("错误 1");
  });

  it("页脚写出当前看的是哪一段，点一下即去掉该层筛选", async () => {
    act(() =>
      useLogStore
        .getState()
        .appendFileLogs([
          makeEntry(1, { message: "开发服务已就绪", origin: "dev" }),
          makeEntry(2, { level: "error", message: "任务失败", origin: "app" }),
        ]),
    );
    render(<LogPanel />);
    const user = userEvent.setup();

    act(() => useLogStore.getState().setOrigin("app"));
    await user.click(levelButton("错误"));

    const footer = screen.getByTitle("去掉来源筛选");
    expect(footer.textContent).toContain("应用服务");
    expect(screen.getByTitle("去掉级别筛选").textContent).toContain("错误");

    /* 点一下来源标签 → 回到全部来源；再点级别标签 → 回到全部级别 */
    await user.click(footer);
    expect(screen.queryByTitle("去掉来源筛选")).not.toBeInTheDocument();
    await user.click(screen.getByTitle("去掉级别筛选"));
    expect(screen.queryByTitle("去掉级别筛选")).not.toBeInTheDocument();
    expect(screen.getByText(/开发服务已就绪/)).toBeInTheDocument();
  });

  it("计数与过滤同口径：搜索时数字跟着收窄，不会「写着 2 切过去只有 1」", async () => {
    act(() =>
      useLogStore
        .getState()
        .appendFileLogs([
          makeEntry(1, { message: "启动完成", origin: "app" }),
          makeEntry(2, { message: "另一件事", origin: "app" }),
        ]),
    );
    render(<LogPanel />);
    const user = userEvent.setup();
    const allButton = () => levelButton("全部");

    expect(allButton().textContent).toContain("2");
    await user.type(screen.getByPlaceholderText(/搜索日志/), "启动");
    expect(allButton().textContent).toContain("1");
  });

  it("无匹配日志时给出明确的空状态文案", async () => {
    seed(3);
    render(<LogPanel />);
    const user = userEvent.setup();
    await user.type(screen.getByPlaceholderText(/搜索日志/), "不存在的关键字");
    const body = screen.getByText(/暂无匹配的日志/);
    expect(body).toBeInTheDocument();
    expect(within(body.parentElement!).queryByText(/事件/)).toBeNull();
  });

  /* ISSUE #360 复审：候选列表要能当表读，且每项都要写清「切过去有多少」。
     这是全文唯一真正展开下拉的用例，且刻意排在最后：base-ui 的弹层关闭要等过渡
     结束（jsdom 不会派发那个事件），展开过一次就会给后续用例留下一份没摘除的
     弹层宿主。只影响测试环境，真实浏览器里过渡会正常结束。 */
  it("来源列表里每一项都自带「条数 / 信息 / 警告 / 错误」的计数", async () => {
    act(() =>
      useLogStore
        .getState()
        .appendFileLogs([
          makeEntry(1, { level: "warn", origin: "app" }),
          makeEntry(2, { level: "warn", origin: "app" }),
          makeEntry(3, { level: "error", origin: "app" }),
          makeEntry(4, { level: "info", origin: "launcher" }),
        ]),
    );
    render(<LogPanel />);
    const user = userEvent.setup();

    await user.click(screen.getByRole("combobox", { name: "按来源筛选" }));
    const optionOf = (label: string) =>
      screen
        .queryAllByRole("option")
        .find((option) => (option.textContent ?? "").startsWith(label))
        ?.textContent ?? "";

    /* 「应用服务」有 2 警告 1 错误；「启动器」一条警告都没有——切换过去是空
     * 列表这件事，在切换之前就已经写在选项里了。零条目读「无」，与「这一项
     * 本来就不存在」区分开。 */
    expect(optionOf("应用服务")).toContain("3 条 · 信息无 · 警告 2 · 错误 1");
    expect(optionOf("启动器")).toContain("1 条 · 信息 1 · 警告无 · 错误无");
    expect(optionOf("全部来源")).toContain("4 条 · 信息 1 · 警告 2 · 错误 1");
  });
});
