import { useEffect } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

/* MediaThumbnail 打桩：挂载后（effect 里，只一次）以假尺寸回调 onLoad
 * （happy-dom 里真图片不会加载；渲染期同步回调会让 setState 无限重渲染）。 */
vi.mock("~/components/ui/media-thumbnail", () => ({
  MediaThumbnail: (props: {
    onLoad?: (media: { naturalHeight: number; naturalWidth: number }) => void;
  }) => {
    useEffect(() => {
      props.onLoad?.({ naturalWidth: 1360, naturalHeight: 768 });
      // oxlint-disable-next-line react/exhaustive-deps -- 桩只按挂载一次的假媒体回调
    }, []);
    return <div data-testid="stub-thumbnail" />;
  },
}));

import { WorkflowImagePreview } from "./WorkflowImagePreview";
import type { RawInputMeta } from "./workflow-types";

// vitest globals: false 下 RTL 不会自动 cleanup,需手动注册
afterEach(cleanup);

describe("WorkflowImagePreview 尺寸行（#4549）", () => {
  it("自然尺寸读出后随预览盒居中显示", () => {
    const entry = {
      name: "image",
      type: "IMAGE",
      isConnection: false,
      preview: true,
      imageRef: { filename: "vintage_yellow_taxi.png", subfolder: "", type: "input" },
    } as RawInputMeta;
    render(<WorkflowImagePreview entry={entry} />);
    expect(screen.getByTestId("stub-thumbnail")).toBeInTheDocument();
    const line = screen.getByText("1360 × 768");
    expect(line.className).toContain("text-center");
    expect(line.className).not.toContain("text-right");
  });
});
