// buildProductionPayload 的契约（Phase 3b-2 抽出，3c-2b 复用）：
// 把工坊草稿摊平成生产数据写入载荷，进度取入参的 stage/rendered。
import { describe, expect, it } from "vitest";

import { buildProductionPayload } from "./payload";
import {
  emptyWorkshopDraft,
  type WorkshopDraft,
} from "~/lib/workshop/draft-store";
import type { Shot } from "~/lib/workshop/types";

describe("buildProductionPayload", () => {
  it("摊平 meta / 剧本 / 场景 / 角色 / 镜头，进度用入参 stage + rendered", () => {
    const draft: WorkshopDraft = {
      ...emptyWorkshopDraft(),
      meta: {
        ...emptyWorkshopDraft().meta,
        title: "我的短剧",
        type: "short_video",
        tone: "轻松",
        logline: "一句话",
      },
      scriptMarkdown: "# 剧本",
      shots: [{ id: "a" } as Shot],
    };
    const payload = buildProductionPayload(draft, "storyboard", true);
    expect(payload).toMatchObject({
      title: "我的短剧",
      type: "short_video",
      tone: "轻松",
      logline: "一句话",
      scriptMarkdown: "# 剧本",
      shots: [{ id: "a" }],
      progress: { stage: "storyboard", rendered: true },
    });
  });
});
