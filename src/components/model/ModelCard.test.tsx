// 模型卡片：只钉三件用户看得见、且此前各自出过问题的事。
//
//   1. 整张卡是**打开详情**的触发器，不再指向 `/models/[id]` —— 那条路由不存在，
//      原先点任何一张卡都是 404；
//   2. 基座未知时给占位符，不写死「SDXL」（那会把一个 SD1.5 模型在卡面上说成 SDXL）；
//   3. 封面按库里的真字段 `coverUrl` 取 —— 此前读的是 `cover`，于是封面从来没
//      渲染出来过，每张卡都在走渐变兜底。
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

import { ModelCard, type ModelCardData } from "./ModelCard";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function model(over: Partial<ModelCardData> = {}): ModelCardData {
  return {
    id: "m1",
    name: "juggernaut_reborn.safetensors",
    type: "CHECKPOINT",
    fileName: "juggernaut_reborn.safetensors",
    baseModel: "SDXL",
    ...over,
  };
}

describe("ModelCard", () => {
  it("点击整张卡打开详情，并把这一条模型交出去", () => {
    const onOpen = vi.fn();
    const data = model();
    render(<ModelCard model={data} onOpen={onOpen} />);
    fireEvent.click(screen.getByRole("button", { name: /juggernaut_reborn/ }));
    expect(onOpen).toHaveBeenCalledWith(data);
  });

  it("不再渲染指向 /models/[id] 的链接（那条路由不存在）", () => {
    const { container } = render(
      <ModelCard model={model()} onOpen={vi.fn()} />,
    );
    expect(container.querySelector('a[href^="/models/"]')).toBeNull();
  });

  it("类型徽标用中文档位名，而不是数据库枚举值", () => {
    render(<ModelCard model={model({ type: "UPSCALE" })} onOpen={vi.fn()} />);
    expect(screen.getByText("放大")).toBeTruthy();
    expect(screen.queryByText("UPSCALE")).toBeNull();
  });

  it("基座未知给占位符，不写死 SDXL", () => {
    render(<ModelCard model={model({ baseModel: null })} onOpen={vi.fn()} />);
    expect(screen.getByText("—")).toBeTruthy();
    expect(screen.queryByText("SDXL")).toBeNull();
  });

  it("有 coverUrl 才渲染封面图（字段名与库里一致）", () => {
    const withCover = render(
      <ModelCard
        model={model({ coverUrl: "/api/outputs/c/a.png" })}
        onOpen={vi.fn()}
      />,
    );
    expect(
      withCover.container.querySelector('img[src="/api/outputs/c/a.png"]'),
    ).toBeTruthy();
    withCover.unmount();

    const noCover = render(
      <ModelCard model={model({ coverUrl: null })} onOpen={vi.fn()} />,
    );
    expect(noCover.container.querySelector("img")).toBeNull();
  });
});
