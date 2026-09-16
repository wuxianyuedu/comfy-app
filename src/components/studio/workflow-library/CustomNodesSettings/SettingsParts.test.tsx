// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import {
  ManifestSummary,
  ParseProgressBanner,
  PortRow,
  ReportCards,
  WidgetValueChip,
} from "./SettingsParts";
import type { ParseProgress, ParseReport, SettingsResp } from "./types";

// vitest globals: false 下 RTL 不会自动 cleanup,需手动注册
afterEach(cleanup);

/* ── 按 types.ts 真实类型构造的测试数据 ── */

const SUMMARY: NonNullable<SettingsResp["summary"]> = {
  generatedAt: null,
  totalNodes: 42,
  packages: [],
  missingPaths: [],
  parseErrors: [],
  sources: [],
};

const PROGRESS: ParseProgress = {
  phase: "",
  done: 0,
  total: 0,
  discovered: 0,
  parent: "",
  msg: "",
};

function pkg(status: "ok" | "missing" | "error" | "empty", name: string) {
  return {
    path: `C:/ComfyUI/custom_nodes/${name}`,
    name,
    exists: true,
    status,
    nodeCount: 0,
    nodeTypes: [] as string[],
    errors: [] as { file: string; error: string }[],
  };
}

const REPORT: ParseReport = {
  generatedAt: "2026-08-29T10:00:00Z",
  totalNodes: 12,
  pathCount: 3,
  errorCount: 0,
  packages: [],
};

describe("PortRow", () => {
  it("输入行:色点用入参 color,类型徽标大写展示,name 带 title", () => {
    const { container } = render(
      <PortRow side="in" color="#FF9C5B" type="CONDITIONING" name="positive" />,
    );
    expect(screen.getByText("positive")).toHaveAttribute("title", "positive");
    expect(screen.getByText("CONDITIONING")).toBeInTheDocument();
    const dot = container.querySelector("span.rounded-full")!;
    expect(dot).toHaveStyle({ background: "#FF9C5B" });
  });

  it("输出行:色点固定为青色 #06B6D4(与入参 color 无关)", () => {
    const { container } = render(
      <PortRow side="out" color="#FF0000" type="IMAGE" name="IMAGE_FINAL" />,
    );
    const dot = container.querySelector("span.rounded-full")!;
    expect(dot).toHaveStyle({ background: "#06B6D4" });
    expect(screen.getByText("IMAGE")).toBeInTheDocument();
    expect(screen.getByText("IMAGE_FINAL")).toBeInTheDocument();
  });
});

describe("WidgetValueChip", () => {
  it('toggle:truthy 值渲染 ✓(含字符串 "true"/"True")', () => {
    const { rerender } = render(
      <WidgetValueChip widget="toggle" value={true} />,
    );
    expect(screen.getByText("✓")).toBeInTheDocument();
    rerender(<WidgetValueChip widget="toggle" value="True" />);
    expect(screen.getByText("✓")).toBeInTheDocument();
  });

  it("toggle:falsy 值渲染 ✗", () => {
    render(<WidgetValueChip widget="toggle" value={false} />);
    expect(screen.getByText("✗")).toBeInTheDocument();
  });

  it("select:值经 String() 渲染并同步 title,null 显示 —", () => {
    const { rerender } = render(
      <WidgetValueChip widget="select" value="sdxl" />,
    );
    expect(screen.getByText("sdxl")).toHaveAttribute("title", "sdxl");
    rerender(<WidgetValueChip widget="select" value={null} />);
    expect(screen.getByText("—")).toBeInTheDocument();
  });

  it("number:数值渲染为字符串", () => {
    render(<WidgetValueChip widget="number" value={25} />);
    expect(screen.getByText("25")).toBeInTheDocument();
  });

  it("其他 widget(string/text/未知):null 显示 —,标量显示 String 值", () => {
    const { rerender } = render(<WidgetValueChip widget={null} value={null} />);
    expect(screen.getByText("—")).toBeInTheDocument();
    rerender(<WidgetValueChip widget="text" value="hello world" />);
    expect(screen.getByText("hello world")).toBeInTheDocument();
  });
});

describe("ManifestSummary", () => {
  it("渲染节点总数,无 generatedAt / missingPaths 时不追加后缀", () => {
    render(<ManifestSummary summary={SUMMARY} />);
    expect(screen.getByText(/当前清单/)).toBeInTheDocument();
    expect(screen.getByText("42")).toBeInTheDocument();
    expect(screen.queryByText(/生成于/)).not.toBeInTheDocument();
    expect(screen.queryByText(/个目录未找到/)).not.toBeInTheDocument();
  });

  it("generatedAt 与 missingPaths 存在时追加「生成于」与「⚠️ N 个目录未找到」", () => {
    render(
      <ManifestSummary
        summary={{
          ...SUMMARY,
          generatedAt: "2026-08-29 10:00",
          missingPaths: ["a", "b"],
        }}
      />,
    );
    const box = screen.getByText(/当前清单/);
    expect(box.textContent).toContain("共 42 个节点类型");
    expect(box.textContent).toContain("生成于 2026-08-29 10:00");
    expect(box.textContent).toContain("⚠️ 2 个目录未找到");
  });
});

describe("ParseProgressBanner", () => {
  it("hash 阶段:显示 done/total 包数、父目录末两段与确定进度条宽度", () => {
    const { container } = render(
      <ParseProgressBanner
        progress={{
          ...PROGRESS,
          phase: "hash",
          done: 3,
          total: 8,
          parent: "C:\\ComfyUI\\custom_nodes\\ipadapter_plus",
          msg: "hashing packages…",
        }}
      />,
    );
    expect(screen.getByText(/正在处理/)).toBeInTheDocument();
    expect(screen.getByText("3/8")).toBeInTheDocument();
    // 父路径只保留最后两段(支持 \ 与 / 两种分隔符)
    expect(
      screen.getByText("· custom_nodes/ipadapter_plus"),
    ).toBeInTheDocument();
    // 进度条为确定宽度 min(100, done/total*100)%
    const bar = container.querySelector("div.transition-all")!;
    expect(bar).toHaveStyle({ width: "37.5%" });
    expect(screen.getByTitle("hashing packages…")).toBeInTheDocument();
  });

  it("scan 阶段:显示已发现包数与「总数待定」提示,进度条为不定态(无确定宽度)", () => {
    const { container } = render(
      <ParseProgressBanner
        progress={{
          ...PROGRESS,
          phase: "scan",
          discovered: 5,
          parent: "C:/ComfyUI/custom_nodes",
        }}
      />,
    );
    expect(screen.getByText(/已发现/)).toBeInTheDocument();
    expect(screen.getByText("5")).toBeInTheDocument();
    expect(screen.getByText("（总数待定，正在扫描…）")).toBeInTheDocument();
    // 不定态:宽 1/3 的动画条,而非按百分比设置的确定条
    expect(container.querySelector("div.transition-all")).toBeNull();
    expect(container.querySelector("div.w-1\\/3")).not.toBeNull();
  });

  it("queue/初始阶段:渲染「首次扫描」兜底文案", () => {
    const { container } = render(
      <ParseProgressBanner progress={{ ...PROGRESS, phase: "queue" }} />,
    );
    expect(screen.getByText("首次扫描目录中的节点包…")).toBeInTheDocument();
    expect(container.querySelector("div.transition-all")).toBeNull();
  });
});

describe("ReportCards", () => {
  it("渲染「最近解析结果」头部统计与每个包卡片(状态徽标 / 路径 / 节点数 / 类型 chips / 错误)", () => {
    const report: ParseReport = {
      ...REPORT,
      totalNodes: 30,
      pathCount: 3,
      errorCount: 1,
      packages: [
        {
          ...pkg("ok", "ipadapter"),
          nodeCount: 18,
          nodeTypes: ["IPAdapter", "KSampler"],
        },
        {
          ...pkg("error", "broken_pkg"),
          nodeCount: 4,
          errors: [{ file: "foo.py", error: "boom" }],
        },
      ],
    };
    render(<ReportCards report={report} />);

    expect(screen.getByText("最近解析结果")).toBeInTheDocument();
    expect(
      screen.getByText("3 个目录 · 30 个节点 · 1 个错误"),
    ).toBeInTheDocument();

    const okCard = screen
      .getByText("ipadapter")
      .closest<HTMLDivElement>("div.rounded-xl")!;
    expect(within(okCard).getByText("已加载")).toBeInTheDocument(); // STATUS_STYLE.ok
    expect(
      within(okCard).getByText("C:/ComfyUI/custom_nodes/ipadapter"),
    ).toBeInTheDocument();
    expect(within(okCard).getByText("18")).toBeInTheDocument();
    expect(within(okCard).getByText("IPAdapter")).toBeInTheDocument();
    expect(within(okCard).getByText("KSampler")).toBeInTheDocument();

    const errCard = screen
      .getByText("broken_pkg")
      .closest<HTMLDivElement>("div.rounded-xl")!;
    expect(within(errCard).getByText("解析出错")).toBeInTheDocument(); // STATUS_STYLE.error
    expect(within(errCard).getByText("⚠ foo.py: boom")).toBeInTheDocument();

    // 每个包卡片右下角都有「节点类型」计数标签
    expect(screen.getAllByText("节点类型")).toHaveLength(2);
  });

  it("包状态映射:missing → 「目录不存在」徽标", () => {
    render(
      <ReportCards
        report={{
          ...REPORT,
          packages: [{ ...pkg("missing", "gone_pkg"), nodeCount: 0 }],
        }}
      />,
    );
    const card = screen
      .getByText("gone_pkg")
      .closest<HTMLDivElement>("div.rounded-xl")!;
    expect(within(card).getByText("目录不存在")).toBeInTheDocument();
  });

  it("nodeTypes 超过 24 个时截断并显示 +N 计数 chip", () => {
    const types = Array.from({ length: 26 }, (_, i) => `Node${i + 1}`);
    render(
      <ReportCards
        report={{
          ...REPORT,
          packages: [{ ...pkg("ok", "big_pkg"), nodeTypes: types }],
        }}
      />,
    );
    expect(screen.getByText("Node1")).toBeInTheDocument();
    expect(screen.getByText("Node24")).toBeInTheDocument();
    expect(screen.queryByText("Node25")).not.toBeInTheDocument();
    expect(screen.getByText("+2")).toBeInTheDocument();
  });

  it("mode=subset(增量解析)时头部改为「增量 +N」而非目录统计", () => {
    const subset: ParseReport = {
      ...REPORT,
      mode: "subset",
      addedNodes: 4,
    };
    render(<ReportCards report={subset} />);
    expect(screen.getByText("增量 +4")).toBeInTheDocument();
    expect(screen.queryByText(/个目录/)).not.toBeInTheDocument();
  });

  it("无 packages 时仅渲染空头部", () => {
    render(<ReportCards report={REPORT} />);
    expect(screen.getByText("最近解析结果")).toBeInTheDocument();
    expect(screen.getByText("3 个目录 · 12 个节点")).toBeInTheDocument();
  });
});
