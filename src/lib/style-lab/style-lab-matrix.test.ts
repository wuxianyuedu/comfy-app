// 组合与预算判据（纯函数，node 档）——规范 17 §17.1「删掉 JSX 还能不能跑测试」。
//
// 这一层是界面每个数字的唯一出处，所以「空维按 1 计」与「叉积长度恒等于 combinationCount」
// 这两条必须钉死：前者决定「只挑风格、没勾特征」不会被显示成 0 格，后者决定
// 界面上的「K 格」与真会展开出来的清单永远对得上（同一个形状写两处就会漂）。
//
// 批量扇出的三条派生（投影成角色卡、特征键文案、seed 档位）也住在本目录，因此逐档
// 都有用例 —— `src/lib/style-lab/**` 的覆盖率门槛是满档，漏一支分支就是漏一条判据。
import { describe, expect, it, vi } from "vitest";

import { randomSeed } from "~/lib/comfyui/random-seed";
import {
  batchBaseSeed,
  cellMatchKey,
  cellTaskSeed,
  cellToCharacter,
  cellTraitKey,
  combinationCount,
  enumerateCombinations,
  medianSeconds,
  planStyleLabSeats,
} from "./style-lab-matrix";

describe("combinationCount —— 空维按 1 计", () => {
  it("没有任何维度时返回 1（一套风格、不约束特征 ⇒ 一格），不是 0", () => {
    expect(combinationCount({})).toBe(1);
  });

  it("某一维没选任何值按 1 计，不会把整个乘积归零", () => {
    expect(combinationCount({ costume: [], appearance: ["长发", "短发"] })).toBe(
      2,
    );
  });

  it("单维多选就是那一维的取值数", () => {
    expect(combinationCount({ costume: ["唐装", "汉服", "旗袍"] })).toBe(3);
  });

  it("多维相乘（含一维不约束）", () => {
    expect(
      combinationCount({ a: ["1", "2"], b: ["x", "y", "z"], c: [] }),
    ).toBe(6);
  });
});

/* ETA 的唯一数据来源，所以「没历史 ⇒ null」这一档必须钉死：
   界面拿 null 显示「暂无耗时参考」，拿数字显示分钟数。若这里退化成 0，
   用户会看到「预计不到 1 分钟」——一个假快比没有数更有害。 */
describe("medianSeconds —— 实测中位数", () => {
  it("空样本返回 null（不是 0，让界面如实说暂无参考）", () => {
    expect(medianSeconds([])).toBeNull();
  });

  it("奇数个取正中那一枚", () => {
    expect(medianSeconds([30, 12, 45])).toBe(30);
  });

  it("偶数个取中间两枚的均值（中位数的定义）", () => {
    expect(medianSeconds([10, 20, 30, 40])).toBe(25);
  });

  it("乱序输入照样取对（内部排序，不要求调用方先排）", () => {
    expect(medianSeconds([90, 10, 50, 30, 70])).toBe(50);
  });

  it("离群慢样本抬不动它（这正是取中位数而非均值的理由）", () => {
    const durations = [38, 41, 39, 40, 900];
    const mean = durations.reduce((a, b) => a + b, 0) / durations.length;
    expect(medianSeconds(durations)).toBe(40);
    expect(medianSeconds(durations)).toBeLessThan(mean);
  });

  it("不改动调用方的数组（排序在副本上做）", () => {
    const source = [5, 1, 3];
    medianSeconds(source);
    expect(source).toEqual([5, 1, 3]);
  });
});

describe("enumerateCombinations —— 与 combinationCount 同一条判据", () => {
  it("叉积长度恒等于 combinationCount", () => {
    const traits = { a: ["1", "2"], b: ["x", "y", "z"], c: [] };
    expect(enumerateCombinations(traits)).toHaveLength(
      combinationCount(traits),
    );
  });

  it("空维在结果里落成空串（不约束的显式标记），键不消失", () => {
    const combos = enumerateCombinations({ a: ["1", "2"], b: [] });
    expect(combos).toHaveLength(2);
    for (const combo of combos) {
      expect(Object.keys(combo).sort()).toEqual(["a", "b"]);
      expect(combo.b).toBe("");
    }
  });

  it("没有任何维度时给出一个空组合（对应 combinationCount 的 1）", () => {
    expect(enumerateCombinations({})).toEqual([{}]);
  });

  it("两维各两个值 → 四个组合，覆盖全部配对", () => {
    const combos = enumerateCombinations({ a: ["1", "2"], b: ["x", "y"] });
    expect(combos).toHaveLength(4);
    const keys = combos.map((c) => `${c.a}/${c.b}`).sort();
    expect(keys).toEqual(["1/x", "1/y", "2/x", "2/y"]);
  });
});

/* 投影成角色卡这一刀是批量出图唯一把「组合」翻译成「提示词输入」的地方，
   所以四条判据都要钉住：① 座位 id 与 styleTags 的形状（重跑判重与提示词都读它）；
   ② 两个 prompt 字段必须是空串 —— 它们是下游 buildCharacterPrompt 的输出，
   这里填了就等于承认有两处真值；③ ageGender / skillSlug 只从 params 快照来，
   且非字符串一律不采信（快照是 JSON 列，形状由用户与历史数据决定，不可信）。 */
describe("cellToCharacter —— 一格投影成角色卡", () => {
  const combo = {
    appearance: "长发",
    costume: "唐装",
    personality: "内敛",
    temperament: "清冷",
  };

  it("四个维度按轴 id 落到对应字段，id 是「试验#座位号」", () => {
    const c = cellToCharacter({
      experimentId: "exp-1",
      style: "赛博朋克",
      combo,
      index: 3,
      params: {},
    });
    expect(c.id).toBe("exp-1#3");
    expect(c.name).toBe("赛博朋克");
    expect(c.appearance).toBe("长发");
    expect(c.costume).toBe("唐装");
    expect(c.personality).toBe("内敛");
    expect(c.temperament).toBe("清冷");
    expect(c.styleTags).toEqual(["赛博朋克"]);
  });

  it("两个 prompt 字段留空串（它们是提示词构建器的输出，不是输入）", () => {
    const c = cellToCharacter({
      experimentId: "exp-1",
      style: "厚涂",
      combo,
      index: 0,
      params: {},
    });
    expect(c.positivePrompt).toBe("");
    expect(c.negativePrompt).toBe("");
  });

  it("combo 里缺的维度落成空串，而不是 undefined（提示词组装按 filter(Boolean) 跳过）", () => {
    const c = cellToCharacter({
      experimentId: "exp-1",
      style: "厚涂",
      combo: { costume: "旗袍" },
      index: 1,
      params: {},
    });
    expect(c.costume).toBe("旗袍");
    expect(c.appearance).toBe("");
    expect(c.personality).toBe("");
    expect(c.temperament).toBe("");
  });

  it("params.ageGender 是字符串时采信", () => {
    const c = cellToCharacter({
      experimentId: "exp-1",
      style: "厚涂",
      combo: {},
      index: 0,
      params: { ageGender: "青年女性" },
    });
    expect(c.ageGender).toBe("青年女性");
  });

  it("params.ageGender 非字符串（数字）时按缺席处理，落空串", () => {
    const c = cellToCharacter({
      experimentId: "exp-1",
      style: "厚涂",
      combo: {},
      index: 0,
      params: { ageGender: 42 },
    });
    expect(c.ageGender).toBe("");
  });

  it("params 没给 ageGender 时落空串", () => {
    const c = cellToCharacter({
      experimentId: "exp-1",
      style: "厚涂",
      combo: {},
      index: 0,
      params: {},
    });
    expect(c.ageGender).toBe("");
  });

  it("params.skillSlug 是字符串时挂上这个键", () => {
    const c = cellToCharacter({
      experimentId: "exp-1",
      style: "厚涂",
      combo: {},
      index: 0,
      params: { skillSlug: "ghibli" },
    });
    expect(c.skillSlug).toBe("ghibli");
  });

  it("params.skillSlug 缺席或非字符串时不挂这个键（不写一个值为 undefined 的键）", () => {
    const absent = cellToCharacter({
      experimentId: "exp-1",
      style: "厚涂",
      combo: {},
      index: 0,
      params: {},
    });
    expect("skillSlug" in absent).toBe(false);

    const wrongType = cellToCharacter({
      experimentId: "exp-1",
      style: "厚涂",
      combo: {},
      index: 0,
      params: { skillSlug: 7 },
    });
    expect("skillSlug" in wrongType).toBe(false);
  });

  it("params 原样带进角色卡（快照不在这里被改写）", () => {
    const params = { steps: 30, cfg: 7 };
    const c = cellToCharacter({
      experimentId: "exp-1",
      style: "厚涂",
      combo: {},
      index: 0,
      params,
    });
    expect(c.params).toBe(params);
  });
});

/* 特征键是**身份**：落库、重跑判重都读它，所以它必须按构造唯一。屏上那句文案不在这里
   生成（那属于视图层），这一组用例钉的是「两格会不会撞成同一个键」。 */
describe("cellTraitKey —— 带轴 id 的身份键", () => {
  it("空组合给空串（「不约束特征」那一档），不给一个假的占位词", () => {
    expect(cellTraitKey({})).toBe("");
  });

  it("值为空串的维度整对省略", () => {
    expect(cellTraitKey({ costume: "唐装", appearance: "" })).toBe(
      "costume=唐装",
    );
  });

  it("每维都有值时按插入顺序用 ; 连起来", () => {
    expect(cellTraitKey({ costume: "唐装", temperament: "清冷" })).toBe(
      "costume=唐装;temperament=清冷",
    );
  });

  it("两个维度撞同一个词时键仍然不同 —— 身份键带轴 id 的唯一理由", () => {
    /* 四轴今天的词表互不重字；将来加词不保证。只拼取值时这两格会撞成一键，
       重跑判重把第二格当成「已经跑过」，于是矩阵静默少出一张图。 */
    expect(cellTraitKey({ costume: "清冷", temperament: "" })).not.toBe(
      cellTraitKey({ costume: "", temperament: "清冷" }),
    );
  });
});

describe("cellMatchKey —— 风格 + 特征键的组合键", () => {
  it("同风格同特征给同一个键（重跑判重读的就是这一条）", () => {
    expect(cellMatchKey("厚涂", "costume=唐装")).toBe(
      cellMatchKey("厚涂", "costume=唐装"),
    );
  });

  it("风格与特征键互相冒充时键不同 —— 分隔符不能是特征键自己的 ;", () => {
    expect(cellMatchKey("a;costume=b", "")).not.toBe(
      cellMatchKey("a", "costume=b"),
    );
  });
});

/* 座位表是「界面报 K 格」与「服务端真跑 K 格」之间的那道对齐：这里展开多少枚，
   批量层就登记多少格。提示词不在这里另拼一份 —— 读的是工坊那个 buildCharacterPrompt
   的顺序，将来那侧改顺序，这一屏跟着变，不会出现两份秩序。 */
describe("planStyleLabSeats —— 整批座位", () => {
  it("风格 × 特征的叉积，座位号连续从 0 起", () => {
    const seats = planStyleLabSeats({
      experimentId: "exp-1",
      styles: ["厚涂", "赛博朋克"],
      traits: { costume: ["唐装", "汉服"], temperament: ["清冷"] },
      params: {},
    });
    expect(seats).toHaveLength(4);
    expect(seats.map((s) => s.index)).toEqual([0, 1, 2, 3]);
    expect(seats.map((s) => s.style)).toEqual([
      "厚涂",
      "厚涂",
      "赛博朋克",
      "赛博朋克",
    ]);
  });

  it("没选风格时按「不约束风格」占一列，不是展开成 0 格", () => {
    const seats = planStyleLabSeats({
      experimentId: "exp-1",
      styles: [],
      traits: { costume: ["唐装", "汉服"] },
      params: {},
    });
    expect(seats).toHaveLength(2);
    expect(seats.every((s) => s.style === "")).toBe(true);
  });

  it("提示词按工坊那份组装顺序：身份 → 氛围 → 风格标签", () => {
    const [seat] = planStyleLabSeats({
      experimentId: "exp-1",
      styles: ["厚涂"],
      traits: { costume: ["唐装"], temperament: ["清冷"] },
      params: {},
    });
    expect(seat?.prompt).toBe("唐装, mood: 清冷, 厚涂");
  });

  it("什么都没选时提示词是空串 —— 批量层据此拒跑，不拿空值去覆盖工作流图内内容", () => {
    const [seat] = planStyleLabSeats({
      experimentId: "exp-1",
      styles: [],
      traits: {},
      params: {},
    });
    expect(seat?.prompt).toBe("");
  });

  it("每个风格的第一枚是代表位，其余不是", () => {
    const seats = planStyleLabSeats({
      experimentId: "exp-1",
      styles: ["厚涂", "水彩"],
      traits: { costume: ["唐装", "汉服"] },
      params: {},
    });
    expect(seats.map((s) => s.isRepresentative)).toEqual([
      true,
      false,
      true,
      false,
    ]);
  });

  it("座位键与 cellMatchKey 同一口径（重跑判重比的就是这个值）", () => {
    const seats = planStyleLabSeats({
      experimentId: "exp-1",
      styles: ["厚涂"],
      traits: { costume: ["唐装"] },
      params: {},
    });
    const [seat] = seats;
    expect(seat?.seatKey).toBe(cellMatchKey("厚涂", "costume=唐装"));
  });
});

/* seed 是「这批能不能复现」的落点：基准每批只定一次（否则「共用基准」这一档就成了
   每格各随机），档位由试验存的 params.seedMode 决定。非法/缺席的值一律按缺省档。

   走随机的那两条分支要能断言出**确定值**才有意义：只断言「是整数且 ≥0」的话，
   缺省档被写成随机也测不出来。这里打桩 `Math.random`（而不是打桩 `randomSeed` 模块），
   期望值取同一次打桩窗口内 `randomSeed()` 的返回 —— 不把它的算式抄进用例，
   否则将来换算法这里会假红。 */
function withStubbedRandom(assert: (expectedRandom: number) => void): void {
  const spy = vi.spyOn(Math, "random").mockReturnValue(0.5);
  try {
    assert(randomSeed());
  } finally {
    spy.mockRestore();
  }
}

describe("batchBaseSeed —— 基准 seed 每批只定一次", () => {
  it("快照里是数字时截断取整（seed 只能是整数）", () => {
    expect(batchBaseSeed({ seed: 42.7 })).toBe(42);
    expect(batchBaseSeed({ seed: 0 })).toBe(0);
  });

  it("快照里的 seed 非数字 / 不是有限数时现定一枚随机基准", () => {
    withStubbedRandom((expected) => {
      for (const params of [
        {},
        { seed: "42" },
        { seed: NaN },
        { seed: Infinity },
      ]) {
        expect(batchBaseSeed(params)).toBe(expected);
      }
    });
  });

  it("同一批里定两次基准拿到同一个值（seed 不是每格现算的）", () => {
    const params = { seed: 2026 };
    expect(batchBaseSeed(params)).toBe(batchBaseSeed(params));
  });
});

describe("cellTaskSeed —— 按 seedMode 派生这一格的 seed", () => {
  it("没存 seedMode：整批共用基准 —— 这一屏比较的是风格，seed 必须钉住", () => {
    expect(cellTaskSeed({ params: {}, baseSeed: 100, index: 7 })).toBe(100);
    expect(cellTaskSeed({ params: {}, baseSeed: 100, index: 0 })).toBe(100);
  });

  it("increment：基准 + 座位号", () => {
    expect(
      cellTaskSeed({
        params: { seedMode: "increment" },
        baseSeed: 100,
        index: 3,
      }),
    ).toBe(103);
  });

  it("decrement：基准 − 座位号，压到 0 为止（ComfyUI 不收负 seed）", () => {
    expect(
      cellTaskSeed({
        params: { seedMode: "decrement" },
        baseSeed: 100,
        index: 30,
      }),
    ).toBe(70);
    expect(
      cellTaskSeed({
        params: { seedMode: "decrement" },
        baseSeed: 5,
        index: 30,
      }),
    ).toBe(0);
  });

  it("显式 random：每格各取一枚，而不是基准", () => {
    withStubbedRandom((expected) => {
      expect(
        cellTaskSeed({
          params: { seedMode: "random" },
          baseSeed: expected + 1,
          index: 2,
        }),
      ).toBe(expected);
    });
  });

  it("seedMode 是不认识的值：按缺省档（共用基准），不静默换成另一种语义", () => {
    withStubbedRandom(() => {
      for (const params of [
        { seedMode: "fixed" },
        { seedMode: 5 },
        { seedMode: null },
      ]) {
        expect(cellTaskSeed({ params, baseSeed: 100, index: 2 })).toBe(100);
      }
    });
  });
});
