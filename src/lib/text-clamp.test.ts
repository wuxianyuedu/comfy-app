/**
 * 「把一段文本按最大长度截断」出口的判据（规范 16 §16.2.4.48）。
 *
 * 本条账的形状与 `progress` / `error-message` 同族：**不是重复代码，是口径**。
 * 全库十余处各写一遍「超长就切一刀」，而三件事各写各的：
 *
 *   · 上限（600 / 2000 / 4000 / 8000 …）—— 取值**不该统一**，它们被不同的东西
 *     约束（人读一行的预算 / 日志文件体积 / DB 列体积 / 诊断文件体积）。
 *     出口的职责不是把数字改一样，而是让「为什么是这个数」只有一处能说清。
 *   · 方向 —— 保留头部 vs 保留**尾部**。两者在界面上看不出差别，改错了也
 *     不会有人发现（这是本用例要钉住的那一点）。
 *   · 标记 —— `…` / `…(truncated)` / **什么都不加**。最后一档最危险：
 *     用户看到一段被腰斩的内容，却不知道它被切过。
 *
 * 用例重点即：
 *   1. `maxLength` 是**返回值**的上限（标记自己也占额度）；
 *   2. `direction="tail"` 保留尾部 —— 且标记在**前**；
 *   3. 不传标记时不加标记（保留既有行为，用于「截断后仍是完整单元」的场景）；
 *   4. 病态输入（`maxLength` ≤ 0 / 标记比上限还长）不返回更长的串。
 */
import { describe, expect, it } from "vitest";

import {
  ELLIPSIS,
  LOG_DETAIL_MAX,
  RUNTIME_LOG_MESSAGE_MAX,
  TASK_ERROR_MAX,
  TRACE_LINE_MAX,
  clampText,
} from "./text-clamp";

describe("clampText", () => {
  it("不超上限时原样返回（不裁剪、不加标记）", () => {
    expect(clampText("短文本", { maxLength: 10 })).toBe("短文本");
    expect(clampText("", { maxLength: 10 })).toBe("");
    /* 恰好等于上限：也不截断（边界不该多出一个省略号）。 */
    expect(clampText("0123456789", { maxLength: 10 })).toBe("0123456789");
  });

  it("超上限时保留头部并加省略标记", () => {
    expect(clampText("0123456789abc", { maxLength: 10 })).toBe("012345678…");
  });

  it("maxLength 是返回值上限 —— 标记占掉自己的额度", () => {
    /* 若「先 slice 再拼标记」，返回值会比 maxLength 长，这与「上限」的语义相悖。 */
    const out = clampText("0123456789abc", { maxLength: 10 });
    expect(out.length).toBe(10);
  });

  it('direction="tail" 保留尾部、标记在**前**', () => {
    /* 日志会话这类「最新的在最后」的内容必须保留尾部 —— 保留头部截出来的
     * 全是无关的上古内容。两者在界面上看不出差别，只有这里能钉住。 */
    /* 13 字符、上限 10、标记占 1 → 正文 9 → 保留最后 9 个。 */
    expect(
      clampText("0123456789abc", { maxLength: 10, direction: "tail" }),
    ).toBe("…456789abc");
  });

  it('marker: "" 表示不标记（保留既有行为）', () => {
    /* 用于「截断后仍是完整单元」的场景（如按行取整）。 */
    expect(clampText("0123456789abc", { maxLength: 10, marker: "" })).toBe(
      "0123456789",
    );
  });

  it("annotation 拼成 `…(内容)`，供诊断通道带上「被切了多少」", () => {
    /* 不超上限时原样返回（标记只在**截断**时出现）。 */
    expect(
      clampText("0123456789abc", {
        maxLength: 30,
        annotation: "truncated, 原始 13 字符",
      }),
    ).toBe("0123456789abc");
    /* 超上限时标记带上原始长度 —— 诊断通道最想知道的那一个数。
     * 正文额度 = maxLength - 标记长度 = 14 - 12 = 2。 */
    const long = "0123456789abcdefghij"; // 20 字符
    const out = clampText(long, {
      maxLength: 14,
      annotation: "truncated",
    });
    expect(out).toBe("01…(truncated)");
    expect(out.length).toBeLessThanOrEqual(14);
    /* 带原始长度的那一大串：标记更长，正文额度相应变短。 */
    const out2 = clampText(long, {
      maxLength: 30,
      annotation: "truncated, 原始 20 字符",
    });
    expect(out2.endsWith("…(truncated, 原始 20 字符)")).toBe(false);
    /* maxLength 大于正文时**不截断**，annotation 自然不出现。 */
    expect(clampText("短", { maxLength: 30, annotation: "truncated" })).toBe(
      "短",
    );
  });

  it("病态输入不返回更长的串", () => {
    /* maxLength ≤ 0：给空串（调用处把上限传错时不该反过来撑大）。 */
    expect(clampText("abc", { maxLength: 0 })).toBe("");
    expect(clampText("abc", { maxLength: -3 })).toBe("");
    /* 标记比上限还长：不留标记，只裁到上限。 */
    const out = clampText("abcdefgh", {
      maxLength: 2,
      marker: "非常长的省略标记非常长的省略标记",
    });
    expect(out.length).toBeLessThanOrEqual(2);
  });

  it("默认标记就是 ELLIPSIS 单个字符", () => {
    expect(ELLIPSIS).toBe("…");
    expect(clampText("abcdefgh", { maxLength: 4 })).toBe(`abc${ELLIPSIS}`);
  });
});

describe("具名上限（这是本条账的核心：取值不同、且各有约束来源）", () => {
  it("四个上限互不相同 —— 它们被不同的东西约束，不该被压成一个数", () => {
    const values = [
      LOG_DETAIL_MAX, // 人读一行的预算
      RUNTIME_LOG_MESSAGE_MAX, // 日志文件体积
      TASK_ERROR_MAX, // DB 列体积
      TRACE_LINE_MAX, // 诊断文件体积
    ];
    expect(new Set(values).size).toBe(values.length);
  });

  it("顺序符合约束的松紧：一行 < 文件 < 列 < 诊断", () => {
    /* 这不是「审美排序」，而是四条约束实际给出的量级 —— 把它写进用例，
     * 是因为「谁大谁小」正是原来看不出来的那一层（散在各处只有裸数字）。 */
    expect(LOG_DETAIL_MAX).toBeLessThan(RUNTIME_LOG_MESSAGE_MAX);
    expect(RUNTIME_LOG_MESSAGE_MAX).toBeLessThan(TASK_ERROR_MAX);
    expect(TASK_ERROR_MAX).toBeLessThan(TRACE_LINE_MAX);
  });
});
