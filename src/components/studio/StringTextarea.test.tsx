import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render } from "@testing-library/react";

import { StringTextarea } from "./StringTextarea";

// vitest globals: false 下 RTL 不会自动 cleanup,需手动注册
afterEach(cleanup);

describe("StringTextarea（#4548）", () => {
  it("hasSize 路径保留 28px 高度下限，flex 压不扁多行 STRING 块", () => {
    /* ComfyUI 保存的 size 是固定盒：同一节点堆多个 STRING 行时
     * `flex: 1 1 0` 按 basis 0 均分，某一行会被压到只剩一条缝、内容完全
     * 看不见（StringReplace 的「查找」）。下限保证最差也是「一行高 + 内部滚动」。 */
    const { container } = render(<StringTextarea hasSize value="{input text}" />);
    const textarea = container.querySelector("textarea");
    expect(textarea).not.toBeNull();
    expect(textarea?.style.minHeight).toBe("28px");
  });

  it("内容自适应路径（无保存尺寸）同样带下限，内容短时高度照常自适应", () => {
    const { container } = render(<StringTextarea hasSize={false} value="hello" />);
    const textarea = container.querySelector("textarea");
    expect(textarea).not.toBeNull();
    expect(textarea?.style.minHeight).toBe("28px");
  });
});
