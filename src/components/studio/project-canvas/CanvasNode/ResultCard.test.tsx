// @vitest-environment jsdom
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ResultCard } from "./ResultCard";

// vitest globals: false 下 RTL 不会自动 cleanup,需手动注册
afterEach(cleanup);

beforeAll(() => {
  // jsdom 不实现媒体播放,屏蔽 <video autoPlay> 触发的 notImplemented 噪音
  window.HTMLMediaElement.prototype.play = vi.fn(() => Promise.resolve());
  window.HTMLMediaElement.prototype.load = vi.fn(() => undefined);
});

describe("ResultCard", () => {
  it("image 卡片:渲染图片(相对路径加前缀)、名称、状态徽标,替换按钮触发回调", async () => {
    const onReplace = vi.fn();
    render(
      <ResultCard
        kind="image"
        name="主视觉"
        status="done"
        path="outputs/a.png"
        onReplace={onReplace}
      />,
    );
    expect(screen.getByRole("img", { name: "result" })).toHaveAttribute(
      "src",
      "/outputs/a.png",
    );
    expect(screen.getByText("主视觉")).toBeInTheDocument();
    expect(screen.getByText("运行后生成")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "替换" }));
    expect(onReplace).toHaveBeenCalledOnce();
  });

  it("path 已是绝对路径时不重复加前缀", () => {
    render(
      <ResultCard
        kind="image"
        status="idle"
        path="/outputs/b.png"
        onReplace={vi.fn()}
      />,
    );
    expect(screen.getByRole("img", { name: "result" })).toHaveAttribute(
      "src",
      "/outputs/b.png",
    );
    expect(screen.getByText("待开始")).toBeInTheDocument();
  });

  it("kind=video 渲染 <video> 且 src 加前缀", () => {
    const { container } = render(
      <ResultCard
        kind="video"
        status="running"
        path="out/video.mp4"
        onReplace={vi.fn()}
      />,
    );
    expect(container.querySelector("video")).toHaveAttribute(
      "src",
      "/out/video.mp4",
    );
    expect(screen.getByText("生成中…")).toBeInTheDocument();
  });

  it("mediaType=video 强制走视频分支(即使 path 是图片后缀)", () => {
    const { container } = render(
      <ResultCard
        kind="image"
        mediaType="video"
        status="idle"
        path="frame.png"
        onReplace={vi.fn()}
      />,
    );
    expect(container.querySelector("video")).toHaveAttribute(
      "src",
      "/frame.png",
    );
    expect(container.querySelector("img")).toBeNull();
  });

  it("path 后缀 .webm 也视为视频", () => {
    const { container } = render(
      <ResultCard
        kind="image"
        status="idle"
        path="clip.webm"
        onReplace={vi.fn()}
      />,
    );
    expect(container.querySelector("video")).not.toBeNull();
  });

  it("无 path 时渲染占位图标(无 img / video)", () => {
    const { container } = render(
      <ResultCard kind="image" status="idle" onReplace={vi.fn()} />,
    );
    expect(container.querySelector("img")).toBeNull();
    expect(container.querySelector("video")).toBeNull();
    // 占位 image 图标是 lucide svg
    expect(container.querySelector("svg")).not.toBeNull();
  });

  it("未传 name 时回退为类型的中文标签", () => {
    render(<ResultCard kind="image" status="idle" onReplace={vi.fn()} />);
    expect(screen.getByText("生图")).toBeInTheDocument();
  });

  it("script 卡片:渲染文本内容、编辑工具栏与替换按钮(name 回退类型标签)", async () => {
    const onReplace = vi.fn();
    render(
      <ResultCard
        kind="script"
        status="running"
        text="第一幕:夜。内心独白。"
        onReplace={onReplace}
      />,
    );
    expect(screen.getByText("第一幕:夜。内心独白。")).toBeInTheDocument();
    expect(screen.getByText("生成中…")).toBeInTheDocument();
    expect(screen.getByText("生成剧本")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "A-" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "A+" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "编辑" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "下载" })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "替换" }));
    expect(onReplace).toHaveBeenCalledOnce();
  });

  it("script 无文本时显示占位文案", () => {
    render(<ResultCard kind="script" status="idle" onReplace={vi.fn()} />);
    expect(screen.getByText("尚无文本输出")).toBeInTheDocument();
  });

  it("agent 卡片走文本分支", () => {
    render(
      <ResultCard
        kind="agent"
        status="error"
        text="回复内容"
        onReplace={vi.fn()}
      />,
    );
    expect(screen.getByText("回复内容")).toBeInTheDocument();
    expect(screen.getByText("生成失败")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "编辑" })).toBeInTheDocument();
  });

  it("非 script/agent 类型但携带文本(且无 src)时也走文本分支", () => {
    render(
      <ResultCard
        kind="text"
        status="done"
        text="参考文案"
        onReplace={vi.fn()}
      />,
    );
    expect(screen.getByText("参考文案")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "A-" })).toBeInTheDocument();
  });
});
