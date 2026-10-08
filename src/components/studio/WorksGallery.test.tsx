/* 「所有项目」屏的**渲染**判据（ISSUE #1522 收尾）。
 *
 * 分层：逻辑层（取数 / 确认流 / 出处标注）由 `works/hooks/UseWorksGallery.test.tsx`
 * 守，`canvas-store.test.ts` 守并集与「两侧一起删」的口径；这里只断言**用户看得见
 * 的那一层** —— 这一屏此前没有任何视图层用例，于是「渲染出来才发现」的错在它上面
 * 没有判据（#1522 收尾那一轮撞到的 Markdown 星号就是这么漏出来的：类型检查、lint、
 * 逻辑层用例一个字都不看渲染结果）。
 *
 * 铺的是**这一屏自己独有的出口**，不是把 controller 的返回值再念一遍：
 *   · 说明句与它的降级那一句 —— 拉不到服务端时「看不到」不许被说成「不存在」；
 *   · 三种出处标 —— 只标「只在一侧」的行，`both` 是正常行（标出来是噪声）；
 *   · 删除的**两步** —— 点「删除」只弹确认框（此时一个删除都不该发生），
 *     而确认框的标题按出处分叉：删「仅服务端」那一行动的是**服务端**那份
 *     （本机没有副本可回退），说成同一句会让用户在删完一个别处的画布之后
 *     才知道删的是什么；
 *   · 空态与加载态 —— 这两种档下上面那些行一个都不该在。
 *
 * 判据打在**渲染出来的文本 / 可访问名**上（§11.2 行为断言），不 dump DOM 结构
 * （§11.9 禁止拿快照当结构基线）。
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

import { ToastProvider } from "./ToastProvider";
import { WorksGallery } from "./WorksGallery";
import type { ProjectListEntry } from "~/lib/project-canvas/canvas-store";
import {
  defaultData,
  type CanvasNodeType,
} from "~/lib/project-canvas/canvas-types";
import type { WorksGalleryController } from "./works/hooks/use-works-gallery";

const controllerMock = vi.hoisted(() => vi.fn<() => WorksGalleryController>());

vi.mock("./works/hooks/use-works-gallery", () => ({
  useWorksGallery: (): WorksGalleryController => controllerMock(),
}));

/* 用**真** ToastProvider 包一层，而不是把提示通道 mock 掉：这一屏的删除确认流
 * 会用到它，mock 掉就等于换掉被渲染的那棵树（本文件断言的正是渲染结果）。 */
function renderScreen(): HTMLElement {
  const { container } = render(
    <ToastProvider>
      <WorksGallery />
    </ToastProvider>,
  );
  return container;
}

/** 渲染一屏：controller 的返回值由调用方给定（这一屏的入口就是它）。 */
function renderWith(over: Partial<WorksGalleryController> = {}): void {
  controllerMock.mockReturnValue(controller(over));
  renderScreen();
}

function controller(
  over: Partial<WorksGalleryController> = {},
): WorksGalleryController {
  return {
    projects: [],
    loading: false,
    serverOk: true,
    openProject: () => undefined,
    requestDelete: () => undefined,
    pendingDelete: null,
    cancelDelete: () => undefined,
    confirmDelete: async () => null,
    deleting: false,
    refresh: () => undefined,
    ...over,
  };
}

function entry(over: Partial<ProjectListEntry> = {}): ProjectListEntry {
  return {
    id: "proj_a",
    name: "山与海",
    updatedAt: Date.now(),
    nodes: [],
    edges: [],
    origin: "both",
    ...over,
  };
}

/* 卡片只数「有几个节点 / 几条线」，不读节点结构 —— 数据用全库唯一的构造出口
 * `defaultData(kind)` 生成（§12.18：别为了凑类型手搓一份缺字段的假节点，
 * 那会随严格声明加字段而过期）。 */
function node(id: string): CanvasNodeType {
  return {
    id,
    type: "canvasNode",
    data: defaultData("image"),
    position: { x: 0, y: 0 },
  };
}

function edge(id: string): ProjectListEntry["edges"][number] {
  return { id, source: "a", target: "b" };
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("WorksGallery 说明文案", () => {
  /* 判据是**渲染后的可见文本**，不是源码字符串：源码里「有没有星号」可以靠
   * 肉眼核，但「星号会不会被渲染出来」只有这一层答得了。 */
  it("把「服务端」排成强调，而不是把 Markdown 星号印到界面上", () => {
    renderWith();
    const text = screen.getByText(/列表以/).textContent ?? "";
    expect(text).toContain("列表以服务端为准");
    expect(text, "裸的 Markdown 星号会原样显示给用户").not.toContain("**");
  });

  it("词边界没有让 JSX 缩进带出多余空白", () => {
    renderWith();
    const text = screen.getByText(/列表以/).textContent ?? "";
    // 中文句子里不该出现词间空格（JSX 会把换行处的空白当内容渲染）。
    expect(text).not.toContain("服务端 为准");
    expect(text).not.toContain("列表以 服务端");
  });

  it("服务端那一轮没拉到：明说这一屏此刻只列本机项目（不把「看不到」说成「不存在」）", () => {
    renderWith({ serverOk: false });
    expect(
      screen.getByText(/服务端列表这一轮没拉到/),
      "降级那一句不在，用户会以为服务端本来就没有这些项目",
    ).toBeInTheDocument();
  });

  it("拉到了就不出现降级那一句（它对正常态是噪声）", () => {
    renderWith({ serverOk: true });
    expect(
      screen.queryByText(/服务端列表这一轮没拉到/),
    ).not.toBeInTheDocument();
  });
});

describe("WorksGallery 出处标", () => {
  it("三种出处各标各的：只在一侧的行标出来，两侧都有的不标", () => {
    renderWith({
      projects: [
        entry({ id: "srv", name: "只在服务端", origin: "server" }),
        entry({ id: "loc", name: "只在本地", origin: "local" }),
        entry({ id: "both", name: "两侧都有", origin: "both" }),
      ],
    });
    // 两张标各一份、且只有两张 —— `both` 也标出来就是噪声，且会让人分不清
    // 「这一行到底从哪来」。
    expect(screen.getAllByText("仅服务端")).toHaveLength(1);
    expect(screen.getAllByText("未同步")).toHaveLength(1);
    expect(screen.getByText("两侧都有")).toBeInTheDocument();
  });

  it("出处标带悬停说明：说清删它动的是哪一份", () => {
    renderWith({
      projects: [entry({ id: "srv", name: "只在服务端", origin: "server" })],
    });
    const badge = screen.getByText("仅服务端");
    expect(badge.getAttribute("title")).toMatch(/服务端/);
  });

  it("每张卡的删除入口带上这一行的名字（多处同名时读屏也分得清）", () => {
    renderWith({
      projects: [
        entry({ id: "a", name: "未命名", origin: "server" }),
        entry({ id: "b", name: "未命名", origin: "server" }),
      ],
    });
    const buttons = screen.getAllByRole("button", {
      name: /删除项目「未命名」/,
    });
    expect(buttons).toHaveLength(2);
  });
});

describe("WorksGallery 卡片", () => {
  it("有内容与空画布两种体量各说各的，别把空的说成 0 节点 0 连线", () => {
    renderWith({
      projects: [
        entry({
          id: "filled",
          name: "有内容",
          nodes: [node("n1"), node("n2")],
          edges: [edge("e1")],
        }),
        entry({ id: "empty", name: "空的那张", origin: "local" }),
      ],
    });
    expect(screen.getByText("2 节点 · 1 连线")).toBeInTheDocument();
    expect(screen.getByText("空画布")).toBeInTheDocument();
  });

  it("名字为空时给一个读得懂的兜底名，而不是把空字符串排出来", () => {
    renderWith({ projects: [entry({ id: "noname", name: "" })] });
    expect(screen.getByText("未命名项目")).toBeInTheDocument();
  });

  it("点卡片把这一行的 id 交给 controller（打开项目不是视图自己的事）", () => {
    const openProject = vi.fn();
    renderWith({
      projects: [entry({ id: "proj_x", name: "山与海" })],
      openProject,
    });
    /* 按可访问名精确取卡片那颗：同一行还有一颗「删除项目「山与海」」，
     * 模糊匹配会同时命中（而点错那颗的后果是删掉用户的项目）。 */
    screen.getByRole("button", { name: "山与海 空画布 刚刚修改" }).click();
    expect(openProject).toHaveBeenCalledWith("proj_x");
  });
});

describe("WorksGallery 删除确认", () => {
  it("点删除只**请求**删除：弹确认框，这一下不该发生任何删除", () => {
    const requestDelete = vi.fn();
    renderWith({
      projects: [entry({ id: "proj_a", name: "山与海" })],
      requestDelete,
    });
    screen.getByRole("button", { name: "删除项目「山与海」" }).click();
    expect(requestDelete).toHaveBeenCalledWith("proj_a");
    // 确认框还没挂（controller 的 pendingDelete 仍为 null）。
    expect(
      screen.queryByRole("button", { name: "删除项目" }),
    ).not.toBeInTheDocument();
  });

  it("确认框按出处分叉：删「仅服务端」那一行说的是服务端，不是普通那句", () => {
    renderWith({
      projects: [entry({ id: "srv", name: "未命名", origin: "server" })],
      pendingDelete: entry({ id: "srv", name: "未命名", origin: "server" }),
    });
    expect(
      screen.getByText("删除服务端上的这条项目？"),
      "删服务端那份却说成「此画布项目」，用户会在删完别处的画布之后才知道删的是什么",
    ).toBeInTheDocument();
    expect(screen.getByText(/本机没有它的副本/)).toBeInTheDocument();
  });

  it("两侧都有的正常行走普通文案（说「服务端」会让人以为本机那份还在）", () => {
    renderWith({
      projects: [entry({ id: "both", name: "山与海" })],
      pendingDelete: entry({ id: "both", name: "山与海" }),
    });
    expect(screen.getByText("删除此画布项目？")).toBeInTheDocument();
    expect(
      screen.getByText(/画布内的节点与连线将一并丢失/),
    ).toBeInTheDocument();
  });

  it("确认框关着的时候一个字都不该出现（controller 说没有待删项）", () => {
    renderWith({ projects: [entry()], pendingDelete: null });
    expect(screen.queryByText("删除此画布项目？")).not.toBeInTheDocument();
    expect(
      screen.queryByText("删除服务端上的这条项目？"),
    ).not.toBeInTheDocument();
  });
});

describe("WorksGallery 空态与加载态", () => {
  it("一条项目都没有：给空态，而不是只剩一个标题", () => {
    renderWith({ projects: [] });
    expect(screen.getByText("还没有画布项目")).toBeInTheDocument();
    // 列表那一节的小标题（「画布项目 (N)」）在这档下不该在。
    expect(screen.queryByRole("heading", { name: /画布项目/ })).toBeNull();
  });

  it("首次取数未落定：说「正在读取」，不是把空列表当成结论", () => {
    renderWith({ loading: true, projects: [] });
    expect(screen.getByText(/正在读取项目列表/)).toBeInTheDocument();
    expect(screen.queryByText("还没有画布项目")).not.toBeInTheDocument();
  });
});

describe("WorksGallery 头部动作", () => {
  it("「刷新」把重取交给 controller", () => {
    const refresh = vi.fn();
    renderWith({ refresh });
    screen.getByRole("button", { name: /刷新/ }).click();
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("「新建创作」通知容器（视图自己不知道跳到哪去）", () => {
    const onOpenTask = vi.fn();
    controllerMock.mockReturnValue(controller());
    render(
      <ToastProvider>
        <WorksGallery onOpenTask={onOpenTask} />
      </ToastProvider>,
    );
    screen.getByRole("button", { name: "新建创作" }).click();
    expect(onOpenTask).toHaveBeenCalledTimes(1);
  });
});
