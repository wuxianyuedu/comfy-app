// ── 风格实验室 · 共享类型（§17.2 第①层的一部分：无 React、无 IO）──────────
//
// 这一层为什么单独立一个文件：视图、容器、tRPC 路由、以及服务端的取数面**都要读
// 同一套形状**（一行试验长什么样、创建入参长什么样）。把这份声明放在 `src/lib` 的
// style-lab 子域里，是为了让两侧共用一个出处 —— 视图 import 服务端类型会越过
// eslint 的 components→server 边界（硬规则 22），所以这里放的是**与存储无关的 DTO**：
// 路由把 Drizzle 行映射成它们，视图只消费它们，两边都不碰 `~/server/db/schema`。
//
// 词表（特征维度 / 风格标签）**只 import、不复制**：见下方对
// `~/lib/workshop/character-options` 的 re-export。复制一份词表 = 造出第二份真值
// （规范 §12.12），而角色卡生成那一步将来要吃的是同一份。

import type {
  AttributeOptionSet,
  OptionGroup,
} from "~/lib/workshop/character-options";
import {
  CHARACTER_ATTRIBUTES,
  STYLE_TAG_OPTIONS,
} from "~/lib/workshop/character-options";

/* re-export：视图从这里拿词表，而不是各自去 workshop 域取（把「这一屏用哪套词」
 * 这件事归到 style-lab 自己名下，将来换词表只改这一处）。 */
export { CHARACTER_ATTRIBUTES, STYLE_TAG_OPTIONS };
export type { AttributeOptionSet, OptionGroup };

/**
 * 特征维度的选中值集合：`{ 维度 id: 选中值[] }`。
 *
 * 空数组 = 这一维「不约束」（见 `style-lab-matrix` 的组合数判据）—— 它不是「这一维没选」，
 * 而是「这一维不参与扇出、由工作流默认值兜底」，两种含义在界面上要分得开。
 */
export type StyleLabTraits = Record<string, string[]>;

/**
 * 一行试验（列表项与详情共用）。JSON 列已在服务端解成对象 / 数组，
 * 视图拿到的就是可直接渲染的形状（不需要再 `JSON.parse`）。
 */
export interface StyleLabExperimentRow {
  id: string;
  name: string;
  /** 跑这套组合用的工作流 id。 */
  workflowId: string;
  /** 用的哪个模式（与模式契约同一口径的码）。 */
  mode: string;
  /** 风格标签（取自 `STYLE_TAG_OPTIONS` 的词表）。 */
  styles: string[];
  /** 角色特征：按维度归拢的选中值。 */
  traits: StyleLabTraits;
  /** 生图参数快照（steps / cfg / sampler / size…）；本屏只存不解释。 */
  params: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
}

/** 列表项 = 试验行 + 两枚派生计数（由服务端从格子聚合，视图不再自己数）。 */
export interface StyleLabListItem extends StyleLabExperimentRow {
  /** 这一试验已登记的格子总数。 */
  cellCount: number;
  /** 其中已绑定任务（已出图）的格子数，用于「完成度 x/y」。 */
  doneCount: number;
}

/**
 * 一格 = 「某个风格 × 某组特征」这一组合及其归属任务。
 * 本批不落格子也不读格子，因此这一行的**视图形状**随 PR#2（批量扇出）一起加回，
 * 避免留下没有消费方的导出（规范 §12.16 硬闸）。
 */

/**
 * 创建试验的入参（与 `create` procedure 的 zod 形状对齐）。
 *
 * 刻意不含 `styles` 之外的派生字段（组合数、格子清单）—— 那些是**判据**不是**输入**，
 * 由服务端与 `style-lab-matrix` 现算；把算出来的东西当输入传一遍就会有第二份真值。
 */
export interface StyleLabCreateInput {
  name: string;
  workflowId: string;
  mode: string;
  styles: string[];
  traits: StyleLabTraits;
  params?: Record<string, unknown>;
}
