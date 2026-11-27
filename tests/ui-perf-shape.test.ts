/**
 * 工作区帧预算的形状守卫（#5121）：队列页 700+ 行时，视图每次渲染重建六个
 * handler / 重扫三段列表会击穿已 memo 的行组件。这里钉住「稳定身份 + 记忆化
 * 过滤」的写法，防止后来者顺手改回普通函数又让整表重渲。
 */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const view = fs.readFileSync(
  path.join(process.cwd(), "src/components/studio/queue/QueueMonitorView.tsx"),
  "utf8",
);

describe("队列视图的逐行 props 身份（#5121）", () => {
  it("六个逐行 handler 全部经 useCallback 稳定", () => {
    for (const name of [
      "handleToggleParams",
      "handleCancel",
      "handleMoveUp",
      "handleCopy",
      "handleOpenFolder",
      "handleOpenLog",
    ]) {
      expect(view, `${name} 必须是 useCallback`).toMatch(
        new RegExp(`const ${name} = useCallback\\(`),
      );
    }
  });

  it("三段列表过滤都在 useMemo 里，不是裸 filter", () => {
    for (const name of ["runningRows", "queued", "recent"]) {
      expect(view, `${name} 必须记忆化`).toMatch(new RegExp(`const ${name} = useMemo\\(`));
    }
  });
});
