// 首页「继续最近项目」大卡与小卡栅格的分工。
//
// 两块守的是同一件事的两面：
//   · 同一条项目不许在同一页出现两次（大卡占了第一个位置，栅格就得从第二个取）；
//   · 两个入口必须走同一条打开规则（画布项目进画布视图，其余进 `/create/{id}`）——
//     这条判别此前内联在小卡里，大卡要复用就得抄一遍，而两个入口对同一个项目
//     做出不同行为是最难发现的一类漂移。

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

import { HomePage, type RecentProject } from "./HomePage";

/* 首页上另有两张只读卡（本机算力 / 模型概览），它们各自取数；本文件只关心
   项目区，逐个换成静默桩。 */
vi.mock("./hooks/use-comfy-readiness", () => ({
  useComfyReadiness: () => ({
    stats: null,
    online: false,
    connecting: false,
    stale: false,
    cudaVram: null,
    smiVram: null,
    ram: null,
    degradedNote: "ComfyUI 未运行，显存/内存暂不可用",
  }),
}));
vi.mock("./hooks/use-model-overview", () => ({
  useModelOverview: () => ({
    groups: [],
    total: 0,
    emptyFolderCount: 0,
    loading: false,
    error: null,
  }),
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function project(over: Partial<RecentProject> = {}): RecentProject {
  return {
    id: "p1",
    name: "山与海",
    updatedAt: "2 小时前",
    kind: "canvas",
    subtitle: "12 节点",
    ...over,
  };
}

describe("HomePage 项目区", () => {
  it("最近项目只在大卡里出现一次，栅格从第二条开始", () => {
    render(
      <HomePage
        recentProjects={[
          project({ id: "a", name: "第一条" }),
          project({ id: "b", name: "第二条" }),
        ]}
      />,
    );
    /* 大卡的可访问名是「继续编辑 X」，小卡是普通按钮 —— 两条都在页面上。 */
    expect(
      screen.getByRole("button", { name: "继续编辑 第一条" }),
    ).toBeTruthy();
    expect(screen.getAllByText("第二条").length).toBe(1);
    /* 第一条不能再以栅格小卡的身份出现第二次。 */
    expect(screen.getAllByText("第一条")).toHaveLength(1);
  });

  it("画布项目走画布入口，非画布项目走 /create 入口 —— 两个入口同一条规则", () => {
    const onOpenCanvasProject = vi.fn();
    const onOpenProject = vi.fn();
    render(
      <HomePage
        recentProjects={[
          /* 第一条进大卡、第二条进栅格 —— 栅格里**必须**也放一条画布项目：
             只有它能暴露「栅格绕过共用规则、自己又写一遍三元式」。实测把
             onClick 换成 `onOpenProject?.(proj.id)` 之后，原来那版夹具（栅格里
             只有非画布项）四条全绿 —— 那等于没在判这件事。 */
          project({ id: "c1", name: "画布大卡那条", kind: "canvas" }),
          project({ id: "c2", name: "画布栅格那条", kind: "canvas" }),
          project({ id: "g1", name: "生成那条", kind: "generation" }),
        ]}
        onOpenCanvasProject={onOpenCanvasProject}
        onOpenProject={onOpenProject}
      />,
    );
    fireEvent.click(
      screen.getByRole("button", { name: "继续编辑 画布大卡那条" }),
    );
    expect(onOpenCanvasProject).toHaveBeenCalledWith("c1");

    /* 栅格里的画布项目：必须走同一个入口。 */
    fireEvent.click(screen.getByRole("button", { name: /画布栅格那条/ }));
    expect(onOpenCanvasProject).toHaveBeenCalledWith("c2");
    expect(onOpenProject).not.toHaveBeenCalled();

    /* 栅格里的非画布项目：走另一个回调。 */
    fireEvent.click(screen.getByRole("button", { name: /生成那条/ }));
    expect(onOpenProject).toHaveBeenCalledWith("g1");
  });

  it("没有任何项目时不出现大卡，栅格落回占位卡", () => {
    const { container } = render(<HomePage recentProjects={[]} />);
    expect(screen.queryByRole("button", { name: /^继续编辑/ })).toBeNull();
    expect(container.textContent).toContain("新建画布项目");
  });

  it("只有一条项目时：大卡在，栅格不重复它（只剩新建入口）", () => {
    render(
      <HomePage recentProjects={[project({ id: "only", name: "唯一那条" })]} />,
    );
    expect(
      screen.getByRole("button", { name: "继续编辑 唯一那条" }),
    ).toBeTruthy();
    expect(screen.getAllByText("唯一那条")).toHaveLength(1);
  });
});

describe("首页背景（极光光斑已撤）", () => {
  /* 判据取「内联样式里不许出现 radial-gradient」而不是数类名：那团光斑的实质就是
     内联径向渐变（`AuroraGlow` 把 radial-gradient 写在 style 上），类名怎么换都逃不掉
     这条。它此前是 `mix-blend-screen` + 饱和色、**没有浅色回落** —— 浅色主题下右上角
     糊成一块粉，而首页正是浅色态最常落的屏。 */
  it("首页不再渲染任何径向渐变光斑", () => {
    const { container } = render(<HomePage recentProjects={[]} />);
    const withRadial = Array.from(
      container.querySelectorAll<HTMLElement>("div[style]"),
    ).filter((el) =>
      (el.getAttribute("style") ?? "").includes("radial-gradient"),
    );
    expect(withRadial.map((el) => el.getAttribute("class"))).toEqual([]);
  });

  /* 替代物也要钉住 —— 否则「撤掉光斑」会被连背景一起删干净：顶部那条渐隐带是首页
     与下方内容之间唯一的纵深分隔，且它只该有类、不该有内联样式。 */
  it("顶部渐隐带仍在（只给纵深、不给颜色，也不带内联样式）", () => {
    const { container } = render(<HomePage recentProjects={[]} />);
    const band = container.querySelector("div[aria-hidden]");
    expect(band?.className).toContain("bg-linear-to-b");
    expect(band?.className).toContain("from-surface-1");
    expect(band?.getAttribute("style")).toBeNull();
  });
});
