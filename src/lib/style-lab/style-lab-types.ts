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
  /** 生图参数快照。扇出只**读**其中四个键（`seed` / `seedMode` / `ageGender` /
   *  `skillSlug`）：前两个决定这批的 seed 怎么派生，后两个补角色卡投影。其余键
   *  （steps / cfg / sampler…）不是契约的对外口，落库只为「当时打算用什么」可回看。 */
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
 *
 * 与 `styleExperimentCell` 的列一一对应（`prompt` 是这一格真正提交给工作流的那一句，
 * 落库是为了回看与复投）。图片本体**不在这里**：产物仍只落在 `task` / `taskImage`
 * 那一处，再抄一份路径就会出现在「删了任务、格子还指着没了的图」的那类事故上。
 */
export interface StyleLabCellRow {
  id: string;
  experimentId: string;
  /** 这一格的风格标签（与试验 `styles` 里那一项同值；不约束风格时是空串）。 */
  style: string;
  /** 特征**身份键**（`轴id=值` 用 `;` 连，不约束特征时是空串），见
   *  `style-lab-matrix` 的 `cellTraitKey`。它不是给人读的那句 —— 屏上的文案由视图
   *  层从这个键现推（把「怎么显示」放进身份键里，改一次文案就得迁一次库）。 */
  traitKey: string;
  prompt: string;
  /** 代表整组展示的那一枚（浏览位）。 */
  isRepresentative: boolean;
  /** 这一格由哪条任务跑出；从没入过队时为 `null`。 */
  taskId: string | null;
  createdAt: Date;
}

/**
 * 详情用的格子行 = 格子本体 + 它那条任务的当前状态。
 *
 * `status` **不是** `styleExperimentCell` 的列，而是按 `taskId` 从 `task` 联表读回来的
 * （状态归任务域管，格子表只记归属）。这里仍把它并进同一份 DTO，是因为视图要按格显示
 * 「排队中 / 生成中 / 已完成」——让视图自己去发第二次任务查询，就等于把这一屏的读
 * 拆成两个来源，两边各拿到不同时点的状态时，界面上会出现「格子说在跑、任务说没了」。
 *
 * 没任务的格子给显式 `null` 而不是缺键：视图要分得开「还没入队」与「查不到状态」。
 */
export type StyleLabCellWithStatus = StyleLabCellRow & {
  status: string | null;
  /**
   * 这一格产出的第一张图（浏览器可直接引用的地址）；没出图、或产物不是图片时为 `null`。
   *
   * 它是**读时派生**、不是第三份存储：地址从那条任务的 `resultImages` 里取（任务域
   * 是产物路径的唯一真值），格子表照旧只存 `taskId`。矩阵按格显示成品的代价就是
   * 详情要多联一次任务表，换掉的是「格子表自己抄一份路径」那种会漂的写法。
   */
  imageUrl: string | null;
};

/**
 * 创建试验的入参（与 `create` procedure 的 zod 形状对齐）。
 *
 * 刻意不含 `styles` 之外的派生字段（组合数、格子清单）—— 那些是**判据**不是**输入**，
 * 由服务端与 `style-lab-matrix` 现算；把算出来的东西当输入传一遍就会有第二份真值。
 */
export interface StyleLabCreateInput {
  /** 归属用户。由路由从会话（`ctx.user.id`）取，视图层传不进来 —— 它是权限边界，
   *  不是表单字段。 */
  userId: string;
  name: string;
  workflowId: string;
  mode: string;
  styles: string[];
  traits: StyleLabTraits;
  params?: Record<string, unknown>;
}

/**
 * 一次矩阵扇出的结果。
 *
 * 形状声明在这里而不是只写在那份批量模块里：视图要读同一份数字（那三句话），而
 * `~/server/lib/**` 带 `server-only` —— 视图 import 它会当场炸（§18.4 那条三选一
 * 里的第一档）。服务端实现 `import type` 这一份，两边不会漂。
 */
export interface StyleLabBatchOutcome {
  /** 这批新入队的格数。 */
  enqueued: number;
  /** 因为已绑任务而跳过的格数（重跑时那一档）。 */
  skipped: number;
  /** 整批展开出来的总格数。 */
  planned: number;
  /** 这一批共用的基准 seed（`unmatched` 里有 `seed` 时它其实没落到端口上）。 */
  baseSeed: number;
  /** 给了值却落不到端口的契约口（界面必须把这一串如实上屏）。 */
  unmatched: string[];
}

/** 一次「停这批」的结果。 */
export interface StyleLabStopOutcome {
  /** 真的被取消的任务数。 */
  cancelled: number;
  /** 已经终态、没有动的任务数（说给人听的「那些已经出完了」）。 */
  alreadyDone: number;
}
