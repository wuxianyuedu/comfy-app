import { expect, test } from "@playwright/test";

import { stubTrpc } from "../support/trpc-stub";
import { settle, unstableChromeMasks } from "./support/page-baseline";

/**
 * 模型库（`/models`）像素基线 —— 「空态」这一档（§11.8）。
 *
 * §11.8 的基线范围点名了「空态/空画布提示」，而这一屏是**唯一能把空态钉死**的
 * 页面：`useModelLibrary` 走 `vanillaApi.model.list.query()`，把这一条过程桩成
 * 空列表，画布上就一定是空态那张卡。
 *
 * ⚠️ **桩不是可选项**：不桩的话这一屏渲染的是**本机真实模型库**，基线随
 * 「跑像素的机器上装了几个模型」变 —— 这不是「红先定性」能救的，是基线本身不成立。
 * 桩走 `../support/trpc-stub` 的 `stubTrpc()`（按 `httpBatchStreamLink` 真正读的
 * JSON Lines 协议产出），不是 JSON 数组（数组形态喂不进去，ISSUE #1442）。
 *
 * 空态文案是**这一屏被钉住的那一格**，不是副作用：改文案会让这条用例红，那是要的
 * （空态文案是用户唯一的下一步指引）。改文案时同批重录并在 PR 标注原因。
 */

test.describe("模型库空态视觉基线", () => {
  test("空库下的空态全页基线", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await stubTrpc(page, { "model.list": { models: [] } });
    await page.goto("/models");
    await settle(page, "暂无可用的本地模型");
    await expect(page).toHaveScreenshot("models-empty.png", {
      fullPage: true,
      mask: await unstableChromeMasks(page),
    });
  });
});
