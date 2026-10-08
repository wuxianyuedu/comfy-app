/**
 * **类型层契约**：`expectTypeOf` 的落点（规范 11 §11.20）。
 *
 * ── 为什么这份文件必须存在 ──────────────────────────────────────────────
 *
 * 仓里有 20 多处「`as const` 元组 → 派生联合 → 用它当索引键的 `Record`」
 * 或「派生联合 → 类型守卫 `value is Xxx`」的形状。它们**全都有一个静默失效
 * 方向**，而且它不需要有人写错代码就会发生：
 *
 *   ① `SHOT_STATUSES` 这类 `as const` 被摘掉（prettier 折行重排、或有人觉得
 *      「`as const` 是多余的」）→ `ShotStatus` 从六个字面量变成 **`string`**；
 *   ② `isProductionStage(value): value is ProductionStage` 于是变成
 *      `value is string` —— 交集类型守卫的语义**整个消失**，而 tsc 完全接受；
 *   ③ 消费点大多把清单当 `readonly string[]` 用（`.includes` / `.indexOf` /
 *      `.length`），**宽化在那条路径上无感**。
 *
 * 实测过三条判据各自的态度（vitest 5.0.3）：
 *
 *   · `vitest run`     —— 运行时行为与摘掉 `as const` **完全一致**（`z.enum`
 *                        两种写法的 parse 结果逐条相同），所以**运行时断言永远
 *                        看不出这件事**；
 *   · `@ts-expect-error` —— 它管的是「这里必须有错」。宽化是**去掉**了错误，
 *                         没有错可抑制，那个指令反而自己报红 —— 报出的信息
 *                         与「类型契约被破坏」对不上；
 *   · `expectTypeOf`   —— 正向断言「就是这六个字面量，不是 `string`」。这是
 *                         唯一对得上的判据。
 *
 * ── ⚠️ 这份文件里的断言**借 `tsc` 当执行者** ───────────────────────────
 *
 * `expectTypeOf` 在 vitest 里**没有牙**：实测
 * `expectTypeOf<string>().toEqualTypeOf<number>()` 在 `vitest run` 下
 * **Tests 1 passed**（vitest 只擦类型，不做类型检查）。它的执行者只有
 * `tsc --noEmit`（pre-commit A 组），而 tsc 按 `tsconfig.json` 的 include 面收文件。
 *
 * 所以这份文件的「有执行者」这件事由 `scripts/check-type-assertion-executor.cjs`
 * 守着（pre-commit D 组）—— 站点一旦落到 include 面之外，全仓的断言会**同时
 * 变成装饰品且没有任何一处报错**。
 */
import { describe, expectTypeOf, it } from "vitest";

import type { RemoteModelKind, REMOTE_MODEL_KINDS } from "~/lib/llm/types";
import type {
  ProductionStage,
  PRODUCTION_STAGES,
} from "~/lib/production/progress";
import type {
  WindowButtonKind,
  WINDOW_BUTTON_LABELS,
} from "~/lib/shell/title-bar-derive";
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
    expectTypeOf<RemoteModelKind>().toEqualTypeOf<
      "chat" | "image" | "video"
    >();
    expectTypeOf<RemoteModelKind>().not.toEqualTypeOf<string>();
  });

  it("元组本身的元素类型也被钉住（不只靠派生类型）", () => {
    // 全部写成 `expectTypeOf<typeof X>()` 这一侧：断言**只活在类型空间**，
    // 连运行时值都不需要 import（`expectTypeOf(值)` 会要求真值在场，
    // 而本文件要钉的恰恰是「类型层」这件事）。
    expectTypeOf<typeof REMOTE_MODEL_KINDS>().toEqualTypeOf<
      readonly ["chat", "image", "video"]
    >();
    expectTypeOf<(typeof SHOT_STATUSES)[number]>().toEqualTypeOf<ShotStatus>();
    expectTypeOf<(typeof PRODUCTION_STAGES)[number]>().toEqualTypeOf<ProductionStage>();
  });
});

describe("用派生联合当索引键的 Record：宽化会让「漏成员」静默通过", () => {
  /**
   * 这是本文件里最值钱的一条。
   *
   * `Record<WindowButtonKind, string>` 的**全部价值**是「漏一个成员就报错」。
   * 实测：`as const` 一旦被摘掉，`WindowButtonKind` 变成 `string`，于是
   * `Record<string, string>` 收下一份**只有一半键**的字面量对象 ——
   * 漏成员的守卫**当场退化成装饰品**，而 tsc 一个字都不说。
   */
  it("WindowButtonKind 是四个字面量（Record 守卫才有意义）", () => {
    expectTypeOf<WindowButtonKind>().toEqualTypeOf<
      "minimize" | "maximize" | "restore" | "close"
    >();
    expectTypeOf<WindowButtonKind>().not.toEqualTypeOf<string>();
  });

  it("键集恰好等于四个按钮（漏一个就该红）", () => {
    expectTypeOf<keyof typeof WINDOW_BUTTON_LABELS>().toEqualTypeOf<
      WindowButtonKind
    >();
  });
});
