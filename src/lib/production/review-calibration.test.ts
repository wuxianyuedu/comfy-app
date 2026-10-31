// review-calibration 纯逻辑单测（FR-QA-07 人工侧 · #2480）：人评分 ⇄ AI 评分的聚合。
import { describe, expect, it } from "vitest";

import { calibrateFromShots, emptyCalibrationReport } from "./review-calibration";

/** 一条有 AI 视觉判定（可带维度分）与人评分的镜头记录。 */
function shot(
  id: string,
  opts: {
    aiMean: number; // 各维度都给同一分，均分即此值
    aiPass: boolean;
    human: number | null;
  },
): unknown {
  return {
    humanRating: opts.human,
    id,
    imageReview: {
      issues: [],
      pass: opts.aiPass,
      scoredAt: "t",
      scores: {
        characterConsistency: { note: "", score: opts.aiMean },
        promptAlignment: { note: "", score: opts.aiMean },
      },
      suggestion: "",
    },
    imageUrl: `/${id}.png`,
  };
}

describe("calibrateFromShots（#2480 校准读数）", () => {
  it("空 / 全是没对齐样本 → 全 null 读数，不硬造", () => {
    expect(calibrateFromShots([])).toEqual(emptyCalibrationReport());
    // 只有 AI 判定、没人评分 → 样本 0
    const onlyAi = calibrateFromShots([shot("a", { aiMean: 4, aiPass: true, human: null })]);
    expect(onlyAi.samples).toBe(0);
    expect(onlyAi.mae).toBeNull();
    expect(onlyAi.decisionAgreement).toBeNull();
    // perDimension 仍给 AI 侧读数（维度聚合不要求人有分）
    expect(onlyAi.perDimension).toHaveLength(2);
    expect(onlyAi.perDimension[0]).toMatchObject({ aiAvg: 4, humanAvg: null });
  });

  it("样本对齐：MAE 与判定一致率只在「AI 判定 × 人评分」齐全的镜头上算", () => {
    const report = calibrateFromShots([
      shot("a", { aiMean: 5, aiPass: true, human: 5 }), // 人映射 5 → MAE 0，一致
      shot("b", { aiMean: 5, aiPass: true, human: 1 }), // 人映射 1.8 → MAE 3.2；AI 过人 1 星 → 不一致
      shot("c", { aiMean: 2, aiPass: false, human: 2 }), // 人映射 2.6 → MAE 0.6；AI 不过人 2 星 → 一致
      shot("d", { aiMean: 2, aiPass: false, human: null }), // 没人评 → 不进样本
    ]);
    // aiMeanAvg 是「有 AI 判定」全样本（含没人评分的 d）口径：(5+5+2+2)/4
    expect(report.aiMeanAvg).toBeCloseTo(3.5, 5);
    // 对齐样本（两个均值要对齐才可比）只有 3 条
    expect(report.samples).toBe(3);
    // humanAvg 用 0~5 原量纲
    expect(report.humanAvg).toBeCloseTo((5 + 1 + 2) / 3, 5);
    // MAE = (|5-5| + |5-1.8| + |2-2.6|) / 3
    expect(report.mae).toBeCloseTo((0 + 3.2 + 0.6) / 3, 5);
    expect(report.decisionAgreement).toBeCloseTo(2 / 3, 5);
  });

  it("按维度聚合：每个 rubric 维度给 AI 均分与同样本集人评均分（1~5 映射）", () => {
    const report = calibrateFromShots([
      shot("a", { aiMean: 4, aiPass: true, human: 5 }),
      shot("b", { aiMean: 2, aiPass: true, human: 3 }),
    ]);
    const dims = Object.fromEntries(report.perDimension.map((d) => [d.key, d]));
    expect(dims.promptAlignment?.aiAvg).toBeCloseTo(3, 5);
    expect(dims.promptAlignment?.humanAvg).toBeCloseTo((5 + 3.4) / 2, 5);
    expect(dims.promptAlignment?.samples).toBe(2);
    // 同一判定里的两个维度读数一致
    expect(dims.characterConsistency?.aiAvg).toBe(dims.promptAlignment?.aiAvg);
    expect(dims.characterConsistency?.humanAvg).toBe(dims.promptAlignment?.humanAvg);
    // 维度按 key 排序，读数稳定
    expect(report.perDimension.map((d) => d.key)).toEqual([
      "characterConsistency",
      "promptAlignment",
    ]);
  });

  it("畸形记录（非对象 / 判定缺 pass）跳过，不抛", () => {
    const report = calibrateFromShots([
      "垃圾",
      null,
      { id: "x", imageReview: { note: "缺 pass" } },
      shot("ok", { aiMean: 4, aiPass: true, human: 4 }),
    ]);
    expect(report.samples).toBe(1);
    expect(report.decisionAgreement).toBe(1);
  });
});
