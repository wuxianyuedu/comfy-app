// 人工评分 ⇄ AI 评分的校准读数（FR-QA-07 人工侧 · #2480）。
//
// AI 评审（P8-2 生图 rubric）好不好，只能靠「人评过的样本集」对照：本文件把
// 「同一批镜头上的 AI 维度评分」与「人工 0~5 星评分」聚合成只读偏差读数，作为调
// rubric / 评审提示词的依据。**只读**：不做自动调参（单子明说先不做）。
//
// 本文件是**纯逻辑**（无 React、无 IO，§18）：输入 `production.shots` 的未知记录
// 数组，输出聚合读数；不抛——单个样本畸形就跳过（校准读数宁缺毋假）。
//
// 量纲：AI 维度分 1~5，人评 0~5（0 起步是「这张废」的显式档）。对比前把人分线性
// 映射到 1~5（`1 + rating × 0.8`）：0→1、5→5，MAE 才有可比性；人评原值也照实
// 输出，映射口径写在字段注释里，不藏在代码里。
import { isRecord } from "~/lib/is-record";
import {
  getRecordHumanRating,
  getRecordImageReview,
  normalizeHumanRating,
  reviewScoreMean,
  type ReviewScore,
} from "./review-types";

/** 人侧「通过」档位：≥ 3 星算人认可（0~5 的中位偏上，与 AI 的 pass 对齐用）。 */
export const HUMAN_PASS_THRESHOLD = 3;

/** 人评 0~5 → AI 量纲 1~5 的线性映射（0→1、5→5）。 */
export function humanRatingOnScale5(rating: number): number {
  return 1 + rating * 0.8;
}

/** 单个维度的偏差读数：AI 在该维度上的均分 vs 同样本集人评均分（映射到 1~5）。 */
export interface DimensionCalibration {
  /** rubric 维度 key（生图 rubric 的 promptAlignment 等）。 */
  key: string;
  /** AI 在该维度上的均分（1~5）。 */
  aiAvg: number;
  /** 同一批镜头的人评均分（已映射到 1~5）；这批镜头全都没人评分 → null。 */
  humanAvg: number | null;
  /** 参与该维度聚合的样本数。 */
  samples: number;
}

/** 校准读数（只读查询的回包形状）。样本 = 同时有 AI 视觉判定与人评分的镜头。 */
export interface CalibrationReport {
  /** 样本数（有 AI 判定且有人评分的镜头数）；0 → 其余读数全 null（样本不足，不硬造）。 */
  samples: number;
  /** AI 维度均分的均值（1~5）。 */
  aiMeanAvg: number | null;
  /** 人评均分（0~5 原量纲）。 */
  humanAvg: number | null;
  /** 平均绝对偏差：|AI 均分 − 人评映射分| 的均值（1~5 同量纲）。 */
  mae: number | null;
  /** 判定一致率：AI pass ↔ 人评 ≥ `HUMAN_PASS_THRESHOLD` 的吻合比例（0~1）。 */
  decisionAgreement: number | null;
  /** 按维度聚合：每个 rubric 维度的 AI 均分 vs 人评均分（偏差大的维度先调）。 */
  perDimension: DimensionCalibration[];
}

/** 空读数（没样本时的回落，各读数 null 不硬造）。 */
export function emptyCalibrationReport(): CalibrationReport {
  return {
    samples: 0,
    aiMeanAvg: null,
    humanAvg: null,
    mae: null,
    decisionAgreement: null,
    perDimension: [],
  };
}

function avg(values: number[]): number | null {
  return values.length === 0
    ? null
    : values.reduce((sum, value) => sum + value, 0) / values.length;
}

/**
 * 校准聚合主入口：扫一遍镜头记录，把「AI 视觉判定（`imageReview`）+ 人评分
 * （`humanRating`）」都齐全的镜头收进样本，出总体偏差与按维度偏差。
 * 没有视觉判定 / 没有人评分的镜头不进样本（各算各的会假对齐）。
 */
export function calibrateFromShots(shots: unknown[]): CalibrationReport {
  const aiMeans: number[] = [];
  /** 有人评分的样本对（MAE 与判定一致率只在这上面算——两个均值要对齐才可比）。 */
  const pairs: {
    ai: number;
    human: number;
    rating: number;
    aiPass: boolean;
  }[] = [];
  /** 维度 key → { ai 总分, ai 样本数, 人映射分累计, 人样本数 }。 */
  const dimAcc = new Map<
    string,
    { aiSum: number; aiCount: number; humanSum: number; humanCount: number }
  >();

  for (const raw of shots) {
    if (!isRecord(raw)) continue;
    const verdict = getRecordImageReview(raw);
    if (!verdict) continue;
    const mean = reviewScoreMean(verdict);
    if (mean === null) continue;
    const rating = normalizeHumanRating(getRecordHumanRating(raw));
    const hasHuman = rating !== null;

    aiMeans.push(mean);
    if (hasHuman && rating !== null) {
      pairs.push({
        ai: mean,
        human: humanRatingOnScale5(rating),
        rating,
        aiPass: verdict.pass,
      });
    }
    for (const [key, item] of Object.entries(verdict.scores ?? {})) {
      const acc = dimAcc.get(key) ?? {
        aiSum: 0,
        aiCount: 0,
        humanSum: 0,
        humanCount: 0,
      };
      acc.aiSum += item.score;
      acc.aiCount += 1;
      if (hasHuman && rating !== null) {
        acc.humanSum += humanRatingOnScale5(rating);
        acc.humanCount += 1;
      }
      dimAcc.set(key, acc);
    }
  }

  const samples = pairs.length;
  const perDimension: DimensionCalibration[] = [...dimAcc.entries()]
    .map(([key, acc]) => ({
      key,
      aiAvg: acc.aiSum / acc.aiCount,
      humanAvg: acc.humanCount > 0 ? acc.humanSum / acc.humanCount : null,
      samples: acc.aiCount,
    }))
    .sort((a, b) => a.key.localeCompare(b.key));

  return {
    samples,
    aiMeanAvg: avg(aiMeans),
    humanAvg: avg(pairs.map((p) => p.rating)),
    mae: samples > 0 ? avg(pairs.map((p) => Math.abs(p.ai - p.human))) : null,
    decisionAgreement:
      samples > 0
        ? pairs.filter((p) => p.rating >= HUMAN_PASS_THRESHOLD === p.aiPass)
            .length / samples
        : null,
    perDimension,
  };
}

/** 维度分条目类型仅在展示侧用（度对齐说明）；导出以免消费方重复声明。 */
export type { ReviewScore };
