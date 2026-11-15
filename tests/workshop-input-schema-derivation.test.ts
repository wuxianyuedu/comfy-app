/**
 * 工坊写侧 schema ⇄ 消费侧类型：派生后「同一枚输入同读数」的判据（台账 E4 的形状，ISSUE #2499）。病是 `Character` / `Shot` interface 与 MCP 写侧 schema 各写一遍、加字段谁也不红，却喂同一条草稿；类型现由 `z.output` 派生。
 * ① 同读数：最小合法输入过 schema 后，「缺省补值」与「键根本不出现」分得清（后者是草稿 JSON 的形状）。② 该不同的那一半：可选键在派生类型里必须可选（`{ motion?: … }`），而非「必带、值可 undefined」—— 后者正是 #2499 那 25 处 tsc 错根因，运行时 parse 完全同形，只有 `tsc` 看得见（`expectTypeOf` 借 `tsc` 当执行者）。
 * 另判 `createdAt` 默认值下沉后 SDK 的 JSON Schema 仍是可选字段，否则外部 agent 被要求自己造时间戳（`.default()` 只在解析时生效）。
 */
import { describe, expect, expectTypeOf, it } from "vitest";
import * as z4mini from "zod/v4-mini";

import {
  characterInputSchema,
  characterPortraitInputSchema,
  shotInputSchema,
  type Character,
  type CharacterPortrait,
  type MotionLevel,
  type Shot,
  type ShotStatus,
} from "~/lib/workshop/types";

function parseShot(value: unknown) {
  const parsed = shotInputSchema.safeParse(value);
  expect(parsed.success, `写侧判据当场拒了：${String(parsed.error)}`).toBe(true);
  /* expect 没有断言收窄的能力；真没过就当场炸出来（B5 清账：不再 undefined as never）。 */
  if (!parsed.success) {
    throw new Error(`写侧判据当场拒了：${String(parsed.error)}`);
  }
  return parsed.data;
}

describe("工坊写侧 schema ⇄ 派生类型：同读数且可选性方向一致（§E4 / #2499）", () => {
  it("最小输入：缺省补值、可选键不出现（不是写成 undefined）", () => {
    const shot = parseShot({ id: "s1", index: 3 });

    expect(shot.status).toBe("idle");
    expect(shot.shotType).toBe("medium");
    expect(shot.sceneId).toBe("");
    expect(shot.params).toEqual({});
    expect(shot.characterIds).toEqual([]);
    expect(shot.prompt).toBe("");
    expect(shot.negativePrompt).toBe("");

    /* 「这个键不在」与「这个键是 undefined」在 JSON.stringify 上都是不写，
     * 但在草稿合并 / 覆盖语义里是两件事；判据钉后者不存在。 */
    expect("motion" in shot).toBe(false);
    expect("transition" in shot).toBe(false);
    expect("clipStatus" in shot).toBe(false);
    expect("skillSlug" in shot).toBe(false);
  });

  it("可选枚举认不出 ⇒ 读作「没给」，不把脏值落进草稿", () => {
    const shot = parseShot({
      id: "s1",
      index: 0,
      motion: "huge",
      transition: "wipe",
      clipStatus: "whatever",
    });

    /* 给了脏值时键会**在场但值为 undefined**（缺省时键根本不出现）——两者在
     * `JSON.stringify` 落库后同形，所以判的是「读出来是不是没给」，不是键的形状本身。 */
    expect(shot.motion).toBeUndefined();
    expect(shot.transition).toBeUndefined();
    expect(shot.clipStatus).toBeUndefined();
  });

  it("角色：缺省 portraits 不写键；给了就必带 createdAt", () => {
    const none = characterInputSchema.parse({ id: "c1", name: "阿岚" });
    expect("portraits" in none).toBe(false);

    const withPortrait = characterInputSchema.parse({
      id: "c1",
      name: "阿岚",
      portraits: [{ url: "/api/generated/a.png", source: "local" }],
    });
    expect(withPortrait.portraits).toHaveLength(1);
    const [portrait] = withPortrait.portraits ?? [];
    expect(typeof portrait?.createdAt).toBe("number");
    expect(portrait?.createdAt ?? 0).toBeGreaterThan(0);
  });

  it("派生类型里可选键是可选（不是必带 + undefined）—— 25 处 tsc 错的根因", () => {
    expectTypeOf<Pick<Shot, "motion">>().toEqualTypeOf<{
      motion?: MotionLevel;
    }>();
    expectTypeOf<Pick<Shot, "motion">>().not.toEqualTypeOf<{
      motion: MotionLevel | undefined;
    }>();
    expectTypeOf<Pick<Shot, "clipStatus">>().toEqualTypeOf<{
      clipStatus?: ShotStatus;
    }>();
    expectTypeOf<Pick<Shot, "clipStatus">>().not.toEqualTypeOf<{
      clipStatus: ShotStatus | undefined;
    }>();
    expectTypeOf<Pick<Character, "portraits">>().toEqualTypeOf<{
      portraits?: Array<CharacterPortrait>;
    }>();
    expectTypeOf<Pick<Character, "portraits">>().not.toEqualTypeOf<{
      portraits: Array<CharacterPortrait> | undefined;
    }>();
    /* 补值那一侧的语义要留住：输入可缺、输出必有。 */
    expectTypeOf<Pick<CharacterPortrait, "createdAt">>().toEqualTypeOf<{
      createdAt: number;
    }>();
  });

  it("MCP 入参面：createdAt 仍在可选字段里（.default 不许把键变成 required）", () => {
    /* SAFETY: 类型断言已复核 */
    const json = z4mini.toJSONSchema(characterPortraitInputSchema, {
      target: "draft-7",
      io: "input",
    }) as { properties?: Record<string, unknown>; required?: Array<string> };

    expect(json.properties?.createdAt).toBeDefined();
    expect(json.required ?? []).not.toContain("createdAt");
    expect(json.required ?? []).toContain("url");
  });
});
