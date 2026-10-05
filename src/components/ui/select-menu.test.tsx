/**
 * `SelectMenu` 的**弹层定位口径**：弹层位置必须与「选中了哪一项」无关。
 *
 * base-ui Select 的 `alignItemWithTrigger` **默认为 true** —— 它会把
 * **已选项**对齐到触发器上（原生 `<select>` 的观感）。对「选项多、触发器在
 * 页面中部」的下拉来说，这等于弹层位置随选中项上下移动：选中末尾项时弹层被
 * 顶到视口上方、前半截出屏（用户实测工作流库页头筛选下拉）。
 *
 * jsdom 不做布局，量不出「弹层有没有被顶出去」；能钉的是我们**显式关掉了
 * 这个默认**这件事在 DOM 上留下的标记（`data-align-trigger="false"`，与
 * `ui/select` 的 `SelectContent` 同款口径）。少了它，真实浏览器里就会退回
 * 「弹层随选中项漂移」。
 */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { SelectMenu } from "./select-menu";

afterEach(cleanup);

const OPTIONS = ["qwen_image_2_1", "z-Anime", "z-Image"];

function renderMenu(value = "qwen_image_2_1") {
  render(
    <SelectMenu
      value={value}
      onChange={vi.fn()}
      options={OPTIONS}
      labels={{
        qwen_image_2_1: "qwen_image_2_1",
        "z-Anime": "z-Anime",
        "z-Image": "z-Image",
      }}
    />,
  );
}

/** 打开下拉，返回弹层（带定位标记的那个元素）。 */
function openPopup(): HTMLElement {
  fireEvent.click(screen.getByRole("combobox"));
  const popup = document.querySelector("[data-align-trigger]");
  expect(popup, "点开后应当渲染出弹层").not.toBeNull();
  return popup as HTMLElement;
}

describe("SelectMenu 的弹层定位", () => {
  it("关掉 alignItemWithTrigger：弹层不把已选项对齐到触发器（位置与选中项无关）", () => {
    renderMenu();
    expect(openPopup().getAttribute("data-align-trigger")).toBe("false");
  });

  it("选中末尾项时弹层口径不变（漂移的成因是定位口径，不是选中项）", () => {
    cleanup();
    renderMenu("z-Image");
    expect(openPopup().getAttribute("data-align-trigger")).toBe("false");
  });
});
