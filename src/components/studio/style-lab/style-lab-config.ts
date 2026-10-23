// ── 风格实验室 · 第①层（纯派生，无 React / 无 IO）──────────────────────
//
// 规范 17 §17.1 的判据是「删掉 JSX 还能不能跑测试」：这一屏界面上每一个数字
// （格数、预计耗时、完成度、那条校验提示）都必须能落到下面某个纯函数的入参上。
// 组合数与预算三常量本身住在 `~/lib/style-lab/style-lab-matrix`（服务端 `create`
// 也吃它，两处同一个判据），这里只把「怎么显示给人看」那一层薄派生收在屏内。
//
// 词表（特征维度 / 风格标签）只经 `~/lib/style-lab/style-lab-types` 的 re-export
// 取用、绝不复制（规范 §12.12）——将来角色卡生成吃的还是同一份词。

import {
  CHARACTER_ATTRIBUTES,
  STYLE_TAG_OPTIONS,
  type AttributeOptionSet,
  type OptionGroup,
  type StyleLabTraits,
} from "~/lib/style-lab/style-lab-types";
import { taskStatusLabel } from "~/lib/task-state";
import { describeUnmatchedInputs } from "~/lib/workshop/workflow-encapsulation";
import {
  combinationCount,
  MATRIX_HARD_LIMIT,
  MATRIX_SOFT_LIMIT,
} from "~/lib/style-lab/style-lab-matrix";

export { CHARACTER_ATTRIBUTES, STYLE_TAG_OPTIONS };
export type { AttributeOptionSet, OptionGroup };

/**
 * 特征轴 = `CHARACTER_ATTRIBUTES` 去掉 `styleTags` 那一维。
 *
 * 为什么去掉：这一屏把「风格」当独立入参（`styles[]`，取自 `STYLE_TAG_OPTIONS`），
 * 而 `styleTags` 那一维的候选集正是同一份 `STYLE_TAG_OPTIONS` —— 留着会让同一组
 * 标签既进 `styles` 又进 `traits`，组合数被重复乘一遍（两处表达同一件事必漂）。
 */
export const TRAIT_AXES: AttributeOptionSet[] = CHARACTER_ATTRIBUTES.filter(
  (axis) => axis.id !== "styleTags",
);

/** 创建表单的初始态（第②层的 useState 初值从这里取，视图不自己造空对象）。 */
export interface StyleLabCreateForm {
  name: string;
  workflowId: string;
  mode: string;
  styles: string[];
  traits: StyleLabTraits;
}

export const EMPTY_FORM: StyleLabCreateForm = {
  name: "",
  workflowId: "",
  mode: "",
  styles: [],
  traits: {},
};

/**
 * 一次扇出结果在屏上那三句话（第①层派生，视图只渲染）。
 *
 * 为什么由纯函数拼而不是写在视图里：这三句是这一屏唯一能告诉用户「这批到底发生了
 * 什么」的地方，写进 JSX 就没法用例如判（规范 17 §17.1「删掉 JSX 还能不能跑测试」）。
 */
export interface StyleLabBatchSummary {
  /** 「已把 N 格排进队列」那一句（含没有新格可跑那一档）。 */
  queuedText: string;
  /** 这批共用的基准 seed；`null` = 整批一格都没入队，报这个数没有意义。 */
  seedText: string | null;
  /**
   * 「给了值但没落到端口」那一句 —— 复用 `describeUnmatchedInputs` 那份唯一出口。
   *
   * `seed` 出现在这一档时含义很具体：**这批并没有真的共用同一枚 seed**，那句
   * 「控制变量」的承诺落空了。不报出来，用户就会拿一张随机差异去比风格。
   */
  unmatchedText: string | null;
}

export function summarizeBatch(outcome: {
  enqueued: number;
  skipped: number;
  baseSeed: number;
  unmatched: readonly string[];
}): StyleLabBatchSummary {
  const queuedText =
    outcome.enqueued > 0
      ? `已把 ${String(outcome.enqueued)} 格排进队列` +
        (outcome.skipped > 0
          ? `，跳过 ${String(outcome.skipped)} 格已出图的`
          : "")
      : /* 一格都没新入队。两种形状在这一句上不分开说：库里那批格子本来就都跑过了，
           界面要说的是「没有新东西要跑」而不是假装开始了一批。 */
        `这批没有新格子要跑（${String(outcome.skipped)} 格已排过队）`;
  return {
    queuedText,
    seedText:
      outcome.enqueued > 0
        ? `这批共用基准 seed ${String(outcome.baseSeed)}`
        : null,
    unmatchedText: describeUnmatchedInputs(outcome.unmatched),
  };
}

/** 某一维参与扇出的取值个数：没选 = 1（不约束），与 `style-lab-matrix` 同一条口径。 */
function axisCount(n: number): number {
  return n > 0 ? n : 1;
}

/** 把「秒」翻成一句人话；不足一分钟就明说，不给一个假的「1 分钟」。 */
function etaText(seconds: number): string {
  if (seconds < 60) return "不到 1 分钟";
  return `约 ${String(Math.round(seconds / 60))} 分钟`;
}

/** 提交前的矩阵预览（格数 / 耗时 / 是否越过预算线）。 */
export interface StyleLabMatrixPreview {
  /** 已选风格数（原样，用于「N 风格」那句）。 */
  styleCount: number;
  /** 特征维度的叉积数（用于「M 特征」那句）。 */
  comboCount: number;
  /** 计划展开的格数 =（风格按不约束记 1）× 特征叉积。与 `create` 的算术闸同一口径。 */
  cellCount: number;
  /** 预计整批耗时；`null` = 本机还没有可参考的实测耗时（不拿编的数冒充估计）。 */
  etaText: string | null;
  overSoft: boolean;
  overHard: boolean;
}

/**
 * 由当前选择算出「这套会展开成多少格、大概多久」。
 *
 * 风格那一维也走 `axisCount`（选了 N 个按 N、没选按 1），因为矩阵语义是「没选＝不约束、
 * 每个特征组合各出一张」——把它算成 0 会让「只挑了风格、没勾特征」显示成 0 格，
 * 与 `combinationCount` 对空维给 1 的判据自相矛盾。
 */
export function plannedMatrixPreview(
  styles: readonly string[],
  traits: StyleLabTraits,
  /** 本机已完成出图的实测中位耗时（秒）；null = 暂无参考。 */
  medianSecPerImage: number | null,
): StyleLabMatrixPreview {
  const styleCount = styles.length;
  const comboCount = combinationCount(traits);
  const cellCount = axisCount(styleCount) * comboCount;
  return {
    styleCount,
    comboCount,
    cellCount,
    /* 耗时只从实测来：没有历史时返回 null，由界面说「暂无参考」——
       拿一个拍出来的秒数算「约 34 分钟」，用户会照着它决定要不要分批，
       那就是用一个编造的数驱动真实决策。 */
    etaText:
      medianSecPerImage == null
        ? null
        : etaText(cellCount * medianSecPerImage),
    overSoft: cellCount > MATRIX_SOFT_LIMIT,
    overHard: cellCount > MATRIX_HARD_LIMIT,
  };
}

/** 列表行那句「N 风格 × M 特征 = K 格」——直接复用预览，避免两处各数一遍。 */
export function matrixFormulaText(
  styles: readonly string[],
  traits: StyleLabTraits,
): string {
  /* 这一句只报格数，不报耗时：ETA 属于「提交前」那一屏的决策信息，列表行不需要，
     所以显式传 null（而不是给个假样本量去算一个用不上的数）。 */
  const p = plannedMatrixPreview(styles, traits, null);
  return `${String(p.styleCount)} 风格 × ${String(p.comboCount)} 特征 = ${String(
    p.cellCount,
  )} 格`;
}

/** 轴 id → 屏上的维度名（读词表的 `label`，不在这里另存一份对照表）。 */
const AXIS_LABEL_BY_ID: Record<string, string> = Object.fromEntries(
  CHARACTER_ATTRIBUTES.map((axis) => [axis.id, axis.label]),
);

/**
 * 特征**身份键** → 屏上那句「这一格是什么组合」。
 *
 * 库里存的是 `costume=汉服;temperament=清冷`（带轴 id 才按构造唯一，理由见
 * `style-lab-matrix` 的 `cellTraitKey`），而屏上要的是「服装：汉服 · 气质：清冷」。
 * 两者分开的理由与那条同源：把文案塞进身份键，将来想改一个字面就得迁一次库。
 *
 * 认不出的轴 id（词表改过名、旧行还在库里）原样显示那一段的值而不是整段丢掉 ——
 * 那格确实出过图，只是这一屏暂时说不出它属于哪一维。
 */
export function traitKeyDisplayText(traitKey: string): string {
  const pairs = traitKey.split(";").filter((pair) => pair !== "");
  if (pairs.length === 0) return "仅风格";
  return pairs
    .map((pair) => {
      const at = pair.indexOf("=");
      if (at <= 0) return pair;
      const axisId = pair.slice(0, at);
      const value = pair.slice(at + 1);
      const label = AXIS_LABEL_BY_ID[axisId];
      return label ? `${label}：${value}` : value;
    })
    .join(" · ");
}

/** 风格那一列的显示（不约束风格时给一句人话，而不是一个空白）。 */
export function styleDisplayText(style: string): string {
  return style === "" ? "不限风格" : style;
}

/** 一格在屏上的状态文案。
 *
 * 三档分开的理由都在用户那侧：
 *  · 没绑任务 ⇒「未入队」——这一格只是矩阵里的一个座位，还没跑过；
 *  · 绑了任务但读不到状态 ⇒「任务已不在」——通常是历史被清了。显示成「未知」会把
 *    「格子指向一条没了的任务」这件真实的事藏起来（它意味着这一格永远不会自己变绿）；
 *  · 其余一律读 `taskStatusLabel` 那张全库唯一的表，不在这一屏再造第五份措辞。 */
export function cellStatusText(cell: {
  taskId: string | null;
  status: string | null;
}): string {
  if (cell.taskId === null) return "未入队";
  if (cell.status === null) return "任务已不在";
  return taskStatusLabel(cell.status);
}

/** 完成度：已绑任务的格子 / 已登记的格子。跑过一批之后这两个数才真的非零。 */
export function completionText(doneCount: number, cellCount: number): string {
  return `完成度 ${String(doneCount)} / ${String(cellCount)}`;
}

/**
 * 创建表单的校验（哪些字段必填、必填到什么程度）。
 *
 * 与路由 `create` 的 zod 入参对齐（name 非空且 ≤80、workflowId / mode 非空），但这里
 * 只做「能不能提交」的浅闸：真正的「就绪校验」由服务端拿真数据判（见 style-lab 路由），
 * 客户端不复制那份判据 —— 否则就会出现「界面放行、后端拒绝」或反之的两份真值。
 */
export function validateCreateForm(
  form: StyleLabCreateForm,
): { ok: boolean; message: string | null } {
  const name = form.name.trim();
  if (name.length === 0) return { ok: false, message: "请填写试验名称" };
  if (name.length > 80) return { ok: false, message: "名称不超过 80 个字" };
  if (form.workflowId.trim() === "")
    return { ok: false, message: "请选择一个已封装就绪的工作流" };
  if (form.mode.trim() === "") return { ok: false, message: "请选择一个模式" };
  return { ok: true, message: null };
}
