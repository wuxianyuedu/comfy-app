import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

import { ChannelSwitch } from "./VideoStudio.parts";
import type { ApiChannelsView } from "~/lib/workshop/api-channel-shared";

afterEach(cleanup);

/**
 * 工坊「生成通道」那一排的回归判据（ISSUE #1925 第三批收口 / ISSUE #1423）：手搓的 `Button variant="outline"` 选中三元没钉悬停值，划过**已选中**的那枚时
 * 悬停档胜出，紫色选中翻成白字灰底；现整排交给 `ui/select-chip`。这里钉两件事：① 单选语义（`radiogroup` + `aria-checked`）；② 选中档**自带与常态同值的悬停值**。
 */
const apiChannels: ApiChannelsView = {
  image: {
    configured: true,
    baseUrl: "https://api.example.com",
    path: "/images/generations",
    model: "",
    hasApiKey: true,
  },
  video: {
    configured: false,
    baseUrl: "",
    path: "",
    model: "",
    hasApiKey: false,
  },
};

/** `ChannelSwitch` 是影片台的通道切换（三处同族里最完整的一处：带放行提示）。 */
function renderChannelSwitch(channel: "local" | "api" = "local") {
  const onChannelChange = vi.fn();
  render(
    <ChannelSwitch
      apiChannels={apiChannels}
      apiReady
      batchRunning={false}
      channel={channel}
      fps={16}
      onChannelChange={onChannelChange}
      onFpsChange={() => undefined}
      onGenerateBatch={() => undefined}
      onNextStage={() => undefined}
      onOpenModelAdapters={() => undefined}
      pendingCount={0}
      workflowSelected
    />,
  );
  return { onChannelChange };
}

describe("工坊生成通道 chip（ISSUE #1925）", () => {
  it("是单选语义的 radiogroup，两枚各自带 aria-checked", () => {
    renderChannelSwitch("local");
    const group = screen.getByRole("radiogroup", { name: "生成通道" });
    expect(group).toBeTruthy();
    const chips = screen.getAllByRole("radio");
    expect(chips).toHaveLength(2);
    expect(chips.map((c) => c.getAttribute("aria-checked"))).toEqual(["true", "false"]);
  });

  it("选中档四层俱在，且悬停值钉回常态（幽灵悬停改写不会再回来）", () => {
    renderChannelSwitch("api");
    const checked = screen
      .getAllByRole("radio")
      .find((c) => c.getAttribute("aria-checked") === "true")!;
    for (const layer of [
      "aria-checked:bg-primary-soft",
      "aria-checked:text-primary-strong",
      "aria-checked:border-primary",
      "aria-checked:font-semibold",
      "aria-checked:hover:bg-primary-soft",
      "aria-checked:hover:text-primary-strong",
    ]) {
      expect(checked.className).toContain(layer);
    }
    /* 反向：选中档不得残留手搓时代那串「只写了一半」的类。 */
    expect(checked.className).not.toContain("bg-primary-solid");
  });
});
