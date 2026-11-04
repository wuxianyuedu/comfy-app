/**
 * **类型层契约**（规范 11 §11.20）：`as const` + 派生联合 + `Record` / 类型守卫都有静默失效方向 —— 摘掉 `as const` 就
 * 宽化成 `string`、守卫退成 `value is string`，消费点按 `readonly string[]` 用无感；`vitest run` 与 `@ts-expect-error` 都看不出，
 * 唯一有效是 `expectTypeOf`（vitest 里没牙）；执行者 `tsc --noEmit`，include 面由 `scripts/check-type-assertion-executor.cjs` 守。
 */
import { describe, expectTypeOf, it } from "vitest";

import type { RemoteModelKind, REMOTE_MODEL_KINDS } from "~/lib/llm/types";
import type { ProductionStage, PRODUCTION_STAGES } from "~/lib/production/progress";
import type { WindowButtonKind, WINDOW_BUTTON_LABELS } from "~/lib/shell/title-bar-derive";
import type { ShotStatus, SHOT_STATUSES } from "~/lib/workshop/types";

describe("as const 元组 → 派生联合：宽化成 string 必须编译不过", () => {
  it("ShotStatus 恰好是那六个字面量", () => {
    expectTypeOf<ShotStatus>().toEqualTypeOf<
      "idle" | "queued" | "running" | "done" | "failed" | "stale"
    >();
    // 关键的一条：证明它**没有**变宽成 string
    expectTypeOf<ShotStatus>().not.toEqualTypeOf<string>();
  });

  it("ProductionStage 恰好是那六档", () => {
    expectTypeOf<ProductionStage>().toEqualTypeOf<
      "script" | "character" | "storyboard" | "shots" | "video" | "render"
    >();
    expectTypeOf<ProductionStage>().not.toEqualTypeOf<string>();
  });

  it("RemoteModelKind 恰好是那三种用途", () => {
    expectTypeOf<RemoteModelKind>().toEqualTypeOf<"chat" | "image" | "video">();
    expectTypeOf<RemoteModelKind>().not.toEqualTypeOf<string>();
  });

  it("元组本身的元素类型也被钉住（不只靠派生类型）", () => {
    // 全部写成 `expectTypeOf<typeof X>()` 这一侧：断言**只活在类型空间**，
    // 连运行时值都不需要 import（`expectTypeOf(值)` 会要求真值在场，
    // 而本文件要钉的恰恰是「类型层」这件事）。
    expectTypeOf<typeof REMOTE_MODEL_KINDS>().toEqualTypeOf<readonly ["chat", "image", "video"]>();
    expectTypeOf<(typeof SHOT_STATUSES)[number]>().toEqualTypeOf<ShotStatus>();
    expectTypeOf<(typeof PRODUCTION_STAGES)[number]>().toEqualTypeOf<ProductionStage>();
  });
});

describe("用派生联合当索引键的 Record：宽化会让「漏成员」静默通过", () => {
  /**
   * 这是本文件最值钱的一条：`Record<WindowButtonKind, string>` 的全部价值是「漏一个成员就报错」。
   * 实测摘掉 `as const` 后 kind 变成 `string`，`Record<string, string>` 会收下一份只有一半键的字面量 ——
   * 漏成员守卫当场退化成装饰品，而 tsc 一个字都不说。
   */
  it("WindowButtonKind 是四个字面量（Record 守卫才有意义）", () => {
    expectTypeOf<WindowButtonKind>().toEqualTypeOf<"minimize" | "maximize" | "restore" | "close">();
    expectTypeOf<WindowButtonKind>().not.toEqualTypeOf<string>();
  });

  it("键集恰好等于四个按钮（漏一个就该红）", () => {
    expectTypeOf<keyof typeof WINDOW_BUTTON_LABELS>().toEqualTypeOf<WindowButtonKind>();
  });
});
