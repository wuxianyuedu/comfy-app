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
import {
  LOG_PANEL_OVERLAY_Z,
  LOG_PANEL_POPUP_Z_CLASS,
} from "./log-panel-layers";

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
      autoScroll: true,
      anchorId: null,
      viewBaselineAfter: 0,
    },
    sessionStart: null,
    page: 1,
    revision: 0,
    viewRevision: 0,
    viewSeenIds: new Set<string>(),
    followBaseline: 0,
    followResetAt: 0,
    autoScroll: true,
    anchorId: null,
    viewBaselineAfter: 0,
  });
});

afterEach(async () => {
  cleanup();
  /* 来源下拉是 portal 渲染到 `document.body` 的。`cleanup()` 卸载 React 树之后，
   * base-ui 还要跑几轮收尾才摘掉弹层宿主：jsdom 里它等的是 `transitionend`
   * 这类事件，不会自己到来；而它的清理回调又会在**之后**的某个宏任务里再动一次
   * DOM。只放一轮宏任务就清空 `body`，下一轮回调会往清空后的 DOM 里补写节点，
   * 下一个用例于是继承到一个坏掉的弹层宿主——用户读到的现象是「点开了却没有
   * option」（本文件里表现为「来源列表计数」那条在整文件跑时随机失败）。
   *
   * 因此收尾分**两轮**：先让 base-ui 自己跑完两轮宏任务，再手工把残留清干净，
   * 最后清空 `body`。真实浏览器里这些会自行结束，这里只是替测试环境收尾。 */
  await new Promise((resolve) => setTimeout(resolve, 0));
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
 * （如「警告 2」），而标题旁那组警告/错误文本里也有一个「警告」，按 `/警告/` 找
 * 会命中不止一个元素。这里按既有实现给出的 `title`（「当前来源的警告：…」）
 * 作为稳定锚点。
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
    /* 回到最新后会看到窗口里的内容；新来的那条在窗口之后（下一轮滚动就能看到），
     * 因此这里断言的是「页码回到了第 1 页」与「计数归零」这两件用户能感知的事。 */
    expect(
      screen.queryByRole("button", { name: /有 \d+ 条新的日志/ }),
    ).toBeNull();
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

  /* 位置有意放在「弹层与扳机底边对齐」**之前**：那一条会把下拉打开着结束，
   * 而 base-ui 的浮层树是模块级的、jsdom 里关不干净——它之后的用例再点自己的
   * 下拉会点不开（候选一个都不渲染）。这里断言的是「选项里写了什么」，不该被
   * 那条用例的实现细节牵连，所以排在它前面。 */
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

  /* ISSUE #262 回归：面板遮罩 z-99，弹层若留在默认 z-50，在真实浏览器里会被
   * 遮罩整块压住——弹层照常渲染，却收不到指针事件（「点下拉看不到菜单」
   * 「没法切换来源」「日志没法翻页」是同一个根因）。
   * jsdom 不做层叠与命中测试，所以这里断言的是**层级接线**：弹层定位层拿到的
   * class 必须高于遮罩。真正「点得动」由 e2e（真实 Chromium）兜底。 */
  it("级别按钮整组吃掉行头的富余宽度（不再挤成 32px 的窄条）", () => {
    act(() =>
      useLogStore
        .getState()
        .appendFileLogs([makeEntry(1, { level: "warn", origin: "app" })]),
    );
    render(<LogPanel />);

    const button = levelButton("警告");
    /* 用户诉求：「顶部还有较大空白区域，全部/警告/错误这些挤在一起，可以占用
     * 大些空间」。落地方式有两件，缺一不可：
     *   1. 每个按钮 `flex-1 basis-0` —— 五个按钮**等分**容器宽度，不再是固定的
     *      `w-8`（32px）；
     *   2. 容器 `flex-1` —— 它自己就是那块弹性空间，富余宽度不再被一个无名的
     *      空白 div 吸走（多一个 `flex-1` 会与它平分，"空白又回来了"）。
     * 几何结果（按钮实际有多宽）由 e2e 在真实浏览器里量，这里断言接线。 */
    expect(button.className).toContain("flex-1");
    expect(button.className).toContain("basis-0");
    expect(button.className).not.toContain("w-8");
    const group = button.parentElement!;
    expect(group.className).toContain("flex-1");
    /* 标签与计数是**两个**子元素、同行排布。 */
    expect(button.children).toHaveLength(2);
    expect(button.children[0]?.textContent).toBe("警告");
    expect(button.children[1]?.textContent).toContain("1");
  });

  /* ISSUE #262 五审：「不要因为宽度不够导致文字显示成省略号」。
   *
   * 省略号在 CSS 里需要**同时**满足三个前提：`text-overflow: ellipsis`
   * （`.truncate`）、`overflow: hidden`、`white-space: nowrap`。去掉后两个，
   * 文本就不可能被换成省略号；再把按钮的 `min-w-0` 换成 `min-w-fit`，按钮的
   * 最小宽度就是「内边距 + 文字 + 四位数字」的固有宽度，挤不下时也不会切字。
   * 这三条在 jsdom 里只能断言**接线**（不做布局），实际渲染宽度由 e2e 量。 */
  it("级别按钮不会把文字切成省略号（无 truncate/overflow-hidden/min-w-0）", () => {
    act(() =>
      useLogStore
        .getState()
        .appendFileLogs([
          makeEntry(1, { level: "warn", origin: "app" }),
          makeEntry(2, { level: "info", origin: "app" }),
        ]),
    );
    render(<LogPanel />);

    for (const label of ["全部", "调试", "信息", "警告", "错误"]) {
      const button = levelButton(label);
      expect(button.className).not.toContain("truncate");
      expect(button.className).not.toContain("overflow-hidden");
      expect(button.className).not.toContain("min-w-0");
      expect(button.className).toContain("min-w-fit");

      const labelEl = button.children[0] as HTMLElement;
      const countEl = button.children[1] as HTMLElement;
      expect(labelEl.className).toContain("whitespace-nowrap");
      expect(labelEl.className).not.toContain("truncate");
      /* 数字列：定宽 `4ch` + 右对齐 + 等宽数字——「文字 + 四位数字」是固定预算，
       * 数字位数再多也不省略、不缩窄。 */
      expect(countEl.className).toContain("tabular-nums");
      expect(countEl.className).toContain("w-[4ch]");
      /* 数字就是数字本身：不缩、不省、不加「·」前缀。 */
      expect(countEl.textContent).toMatch(/^\d+$/);
    }
  });

  /* ISSUE #262 五审：级别色给**文字**——「警告」黄、「错误」红（用户原话
   * 「右侧的警告文字改成黄色，错误改成红色」）。
   *
   * 颜色不上在数字上，是因为按 `/警告/` 扫过去时用户读的是那几个字；数字
   * （`4ch` 定宽）保持中性灰，避免一行里出现两个互相稀释的高亮块。
   * 零条目也照样着色：它表达的是「这一格是警告」，不是「这里有 0 个问题」。 */
  it("级别按钮的标签带级别色：警告黄、错误红，数字保持中性", () => {
    act(() =>
      useLogStore.getState().appendFileLogs([
        makeEntry(1, { level: "warn", origin: "app" }),
        makeEntry(2, { level: "error", origin: "app" }),
      ]),
    );
    render(<LogPanel />);

    /* 颜色挂在按钮上、由标签文字继承（标签自身只管不换行）。 */
    expect(levelButton("警告").className).toContain("text-amber-300");
    expect(levelButton("错误").className).toContain("text-rose-300");
    /* 其余级别不带这两个警示色（否则「警告黄」就不成立了）。 */
    expect(levelButton("全部").className).not.toContain("text-amber-300");
    expect(levelButton("信息").className).not.toContain("text-amber-300");
    /* 数字是中性灰、显式覆盖继承色，不跟着级别变色。 */
    for (const label of ["警告", "错误"]) {
      expect(levelButton(label).children[1]!.className).toContain(
        "text-gray-600",
      );
    }
  });

  /* ISSUE #262 五审：「警告/错误显示重复了，左侧那两个去掉」。
   *
   * 标题旁那块灰底胶囊（`警告 n · 错误 n`）与级别按钮上的同名计数完全同源
   * （同一个 `originCounts`），是同一项数据在两处出现。现在整块删除，计数只
   * 保留在级别按钮上；完整分类数（含信息）留在各按钮的悬浮说明里。 */
  it("标题旁不再有复述警告/错误的灰底胶囊（计数只在级别按钮上）", () => {
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

    /* 老形态：标题旁一个 `rounded-full bg-white/5` 的胶囊，title 里写全分类数。 */
    expect(screen.queryByText(/^警告 \d+ · 错误 \d+$/)).toBeNull();
    expect(document.querySelector("span.rounded-full")).toBeNull();

    /* 计数与完整分类数改由级别按钮承载（悬浮说明里能读全）。 */
    expect(levelButton("警告").textContent).toContain("警告1");
    expect(levelButton("错误").textContent).toContain("错误1");
    expect(levelButton("警告").getAttribute("title")).toContain(
      "共 3 条 · 警告 1 · 错误 1",
    );
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
    /* 该来源行重新出现在时间线里（第 1 页就是全部内容时必然可见） */
    expect(useLogStore.getState().filteredLogs.map((e) => e.message)).toContain(
      "开发服务已就绪",
    );
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

  /* ISSUE #262 复审（这一轮的 4 条反馈）──────────────────────────────── */

  it("行头里类别与计数在前，搜索与来源下拉被推到最右", () => {
    act(() =>
      useLogStore.getState().appendFileLogs([makeEntry(1, { origin: "app" })]),
    );
    const { container } = render(<LogPanel />);

    const header = container.querySelector(".min-h-14");
    expect(header).not.toBeNull();
    const order = Array.from(header!.children);

    /* 类别计数（级别按钮）必须排在前半段、来源下拉排在后半段：用户反馈「下拉
     * 右侧有很多红白（空白），左边的类别与条数反而最挤」——行头里那两块的位置
     * 本末倒置了。这里按 DOM 顺序钉住「计数 ← … → 下拉」的分工，
     * 中间的弹性空白负责把右边那组推到最右。 */
    const trigger = header!.querySelector('[data-slot="select-trigger"]');
    expect(trigger).not.toBeNull();
    const levelButtons = order.indexOf(levelButton("全部").parentElement!);
    const triggerHost = order.indexOf(
      trigger!.closest("div.relative")?.parentElement ?? trigger!,
    );
    const searchBox = header!.querySelector("input")!.closest("div.relative")!;
    const search = order.indexOf(searchBox);

    expect(levelButtons).toBeGreaterThanOrEqual(0);
    expect(search).toBeGreaterThan(levelButtons);
    expect(triggerHost).toBeGreaterThan(search);

    /* 「留大空间给左边」的载体是本轮的**级别按钮容器**（它自己 `flex-1`），
     * 位置在搜索之前：没有它，行头会把搜索框与下拉直接顶在级别按钮后面，
     * 大块空白反过来留在右边（用户截图里的红框）。
     *
     * 早先这里另有一个无名 `flex-1` 空白 div 承担同一职责；本轮去掉它——
     * 两个 `flex-1` 会**平分**富余宽度，等于把一半空间又还给了空白。 */
    const group = levelButton("全部").parentElement!;
    expect(group.className).toContain("flex-1");
    expect(order.indexOf(group)).toBeGreaterThanOrEqual(0);
    expect(order.indexOf(group)).toBeLessThan(search);
    /* 行头里不再有第二个无名弹性空白：唯一的弹性项就是级别按钮容器。 */
    const spacers = order.filter(
      (el) =>
        el.className.includes("flex-1") &&
        el.tagName === "DIV" &&
        el.children.length === 0,
    );
    expect(spacers).toHaveLength(0);
  });

  it("来源下拉的弹层与扳机底边对齐，且不向上翻转", async () => {
    act(() =>
      useLogStore.getState().appendFileLogs([makeEntry(1, { origin: "app" })]),
    );
    render(<LogPanel />);
    const user = userEvent.setup();
    await user.click(screen.getByRole("combobox", { name: "按来源筛选" }));

    /* base-ui 把定位参数写在定位层的 data 属性上。两条都要对：
     *   - `side=bottom`：弹层在扳机**下面**（用户要求「弹出下拉菜单的最上方和
     *     下拉按钮的最下方对齐」）；
     *   - `align=trigger` 为假：不覆盖扳机本身。默认为真时，头部贴着窗口顶端
     *     会让弹层只能向上生长，实测直接顶到窗口最上方、盖住左侧的标题。
     * 真实浏览器里「撞到底部也不翻上去」由 §7.22 的现场复核兜底
     * （jsdom 不做布局，量不出坐标）。 */
    const positioner = document.querySelector(
      '[data-slot="select-content"]',
    )!.parentElement!;
    expect(positioner.getAttribute("data-side")).toBe("bottom");
    expect(
      document
        .querySelector('[data-slot="select-content"]')!
        .getAttribute("data-align-trigger"),
    ).toBe("false");
  });

  it("翻页后停在历史页仍能翻回来，且页码始终在范围内", async () => {
    seed(LOG_PAGE_SIZE * 3);
    render(<LogPanel />);
    const user = userEvent.setup();

    /* 用户反馈「日志这里没法翻页」。这条把「来回翻 + 首末页禁用」钉住：
     * 水位的改动不该让 page 被钳回第 1 页（旧实现里两者互相牵连）。 */
    await user.click(screen.getByTitle("更早的一页"));
    expect(screen.getByText(/第 2 \/ 3 页/)).toBeInTheDocument();
    await user.click(screen.getByTitle("更早的一页"));
    expect(screen.getByText(/第 3 \/ 3 页/)).toBeInTheDocument();
    await user.click(screen.getByTitle("更新的一页"));
    expect(screen.getByText(/第 2 \/ 3 页/)).toBeInTheDocument();

    /* 已经是最新一页时「更新的一页」禁用；最早一页时「更早的一页」禁用 */
    await user.click(screen.getByTitle("更新的一页"));
    expect(screen.getByText(/第 1 \/ 3 页/)).toBeInTheDocument();
    expect(screen.getByTitle("更新的一页")).toBeDisabled();

    /* 翻到历史页后停留期间有新日志：页码不跳、提示出现（用户要的是「我在这看，
     * 别把我拽走」）。 */
    await user.click(screen.getByTitle("更早的一页"));
    expect(screen.getByText(/第 2 \/ 3 页/)).toBeInTheDocument();
    act(() =>
      useLogStore
        .getState()
        .appendFileLogs([makeEntry(9_999, { message: "新来的" })]),
    );
    /* 正好来了 1 条新的（页面仍停在第 2 页，因为还没点「回到最新」） */
    expect(screen.getByText(/第 2 \/ 4 页/)).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /有 1 条新的日志/ }),
    ).toBeInTheDocument();

    /* 点一下就能回到最新一页 */
    await user.click(screen.getByRole("button", { name: /回到最新/ }));
    expect(screen.getByText(/第 1 \/ 4 页/)).toBeInTheDocument();
  });

  it("日志行正文带选区标记，贴底前据此避让（选中时内容不被刷新冲走）", () => {
    seed(5);
    const { container } = render(<LogPanel />);
    /* 行正文必须带 `data-log-text`：面板贴底前要问「用户是不是正在框选日志」，
     * 而这个属性就是那件事的落点（见 selectionInsideLogs）。
     * 真实浏览器里「框住之后内容不再自己上移」由 §7.22 的现场复核兜底 ——
     * jsdom 既不实现 selection 也不做滚动，量不出「选择有没有被冲掉」。 */
    const rows = container.querySelectorAll("[data-log-text]");
    expect(rows.length).toBeGreaterThan(0);
    expect(rows[0]?.textContent).toContain("事件");
  });

  /* ISSUE #360 复审：候选列表要能当表读，且每项都要写清「切过去有多少」。
     这是全文唯一真正展开下拉的用例，且刻意排在最后：base-ui 的弹层关闭要等过渡
     结束（jsdom 不会派发那个事件），展开过一次就会给后续用例留下一份没摘除的
     弹层宿主。只影响测试环境，真实浏览器里过渡会正常结束。 */
  it("弹层定位层的层级高于面板遮罩（否则被遮罩压住、点不动）", async () => {
    act(() =>
      useLogStore.getState().appendFileLogs([makeEntry(1, { origin: "app" })]),
    );
    const { container } = render(<LogPanel />);

    /* 面板遮罩：overlayClass("modal", …) 拼出的最外层，层级取自同一份契约。 */
    const overlay = container.querySelector(
      `[class*="z-${LOG_PANEL_OVERLAY_Z}"]`,
    );
    expect(overlay).not.toBeNull();

    const user = userEvent.setup();
    await user.click(screen.getByRole("combobox", { name: "按来源筛选" }));

    /* 层级必须给在**定位层**（Popup 的父节点）而不是 Popup 自身：
       Popup 的 z 只在定位层建立的 stacking context 内部比较，改它越不出去。 */
    const positioner = document.querySelector<HTMLElement>(
      '[data-slot="select-content"]',
    )?.parentElement;
    expect(positioner?.className ?? "").toContain(LOG_PANEL_POPUP_Z_CLASS);
    expect(Number(LOG_PANEL_POPUP_Z_CLASS.slice(2))).toBeGreaterThan(
      LOG_PANEL_OVERLAY_Z,
    );
  });

  /* 零条目同样不留占位：胶囊已删，所以「警告 0 / 错误 0」在任何地方都不出现，
   * 标题行不会因为一个恒在的徽标被挤（列宽也就不会被逼到省略号）。 */
  it("警告/错误都为零时标题行不留占位", () => {
    act(() =>
      useLogStore
        .getState()
        .appendFileLogs([
          makeEntry(1, { level: "info", origin: "app" }),
          makeEntry(2, { level: "info", origin: "app" }),
        ]),
    );
    render(<LogPanel />);

    expect(document.querySelector("span.rounded-full")).toBeNull();
    /* 级别按钮上仍然是 `警告0`（`0` 与「切过去是空的」互相印证），
     * 但按钮不会把它单独摆成一行的宽度。 */
    expect(levelButton("警告").textContent).toBe("警告0");
  });
});
