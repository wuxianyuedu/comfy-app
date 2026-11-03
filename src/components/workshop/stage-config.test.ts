// 「缺失素材 / 下一步」清单的判据单测。固定目标（2 角色卡 / 3 场景 / 16 镜头，
// 16 是被删的「默认 16 镜占位」留下的孤儿常数）会对真实项目喊出编出来的缺口，
// 比不报更糟。这里锁：① 唯一有目标的是镜头数，目标由场景派生不是常数；
// ② 没有可派生目标的项必须给 null；③ 本模块不再输出颜色值。
import { describe, expect, it } from "vitest";

import { buildMissingSummary, type StageViewContext } from "./stage-config";

function ctx(over: Partial<StageViewContext> = {}): StageViewContext {
  return {
    scriptReady: false,
    characterCount: 0,
    sceneCount: 0,
    shotCount: 0,
    shotTarget: 0,
    imageDoneCount: 0,
    clipDoneCount: 0,
    ...over,
  };
}

const byLabel = (items: ReturnType<typeof buildMissingSummary>, label: string) =>
  items.find((item) => item.label === label);

describe("buildMissingSummary", () => {
  it("镜头有可派生目标时报准确缺口：目标 9、已排 4 ⇒ 差 5", () => {
    const item = byLabel(
      buildMissingSummary(ctx({ sceneCount: 4, shotCount: 4, shotTarget: 9 })),
      "分镜脚本",
    );
    expect(item?.gap).toBe(5);
    expect(item?.done).toBe(false);
  });

  it("镜头排满即完成，且不会因为「比目标多」报负数缺口", () => {
    const over = byLabel(
      buildMissingSummary(ctx({ sceneCount: 4, shotCount: 12, shotTarget: 9 })),
      "分镜脚本",
    );
    expect(over?.gap).toBe(0);
    expect(over?.done).toBe(true);
  });

  it("场景还没拆出来时不给镜头目标 —— 宁可不说，也不编一个数", () => {
    const item = byLabel(buildMissingSummary(ctx({ shotCount: 3 })), "分镜脚本");
    expect(item?.gap).toBeNull();
    // 有镜头就算就绪：没有可信目标时不该拿一个常数去喊「还差 16 项」
    expect(item?.done).toBe(true);
  });

  it("角色卡与场景没有可派生目标，只报是否已建立", () => {
    const items = buildMissingSummary(ctx({ characterCount: 7, sceneCount: 2 }));
    const characters = byLabel(items, "角色卡");
    const scenes = byLabel(items, "场景");
    expect(characters?.gap).toBeNull();
    expect(characters?.done).toBe(true);
    expect(scenes?.gap).toBeNull();
    // 0 个角色卡是真空缺，报「尚未建立」而不是「还差 2」
    expect(byLabel(buildMissingSummary(ctx()), "角色卡")?.done).toBe(false);
  });

  it("输出里不含任何颜色（色档由视图按 done 取语义 token）", () => {
    const json = JSON.stringify(buildMissingSummary(ctx({ sceneCount: 3, shotTarget: 6 })));
    expect(json).not.toMatch(/#|rgb/);
    expect(json).not.toContain("color");
  });
});
