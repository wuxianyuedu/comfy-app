/* IO 暴露条目的显示名派生 —— 纯函数，无 React、无副作用。
 *
 * 工作流编辑器里同一个 pin 有三个层级的「名字」：
 *   ① 服务端富化 label（workflow-detail-io 的 label → localized → name 回退链）
 *   ② 画布勾选那一刻写进本地 workflowIO 的 label（IoCheckbox 的 ioRef.label）
 *   ③ 真正的 ComfyUI pin 名（entry.name）
 *
 * ① 只在「服务端能把这个 pin 解析回原始节点」时才等于 ③（例如普通节点的
 * `seed`）。带子工作流的封装节点（class_type 为 UUID）的暴露口是包装层
 * 自己的槽位名，子工作流内部节点拿不到对应字段，富化于是回退成 ③ 之外
 * 的姿势——画布上显示 `seed`（ioRef 传来的业务名），IO 面板里却变成
 * `value_1`，用户看到两处对不上、还改不动。
 *
 * 因此显示名以 ②（本地 label）为准：它就是画布上作者认得的那个名字，
 * 未被重命名时也是 IO 面板重命名框里显示的名字；缺失时才依次回退 ① → ③。 */
import {
  ioLabel,
  type WorkflowIOEntry,
} from "~/components/studio/shared/workflow-io";
import { sanitizeComboLabel } from "~/components/studio/workflow-utils";

/** 本地勾选态在显示名上真正携带的字段（`toggleIO` 写入的 label +
 *  画布勾选时透传的类型，后者缺省时不该把富化类型盖掉）。 */
export interface ExposedLabelSource {
  label?: string;
  type?: string;
}

/** 显示名判定要用到的全部事实（同一份「事实源」，本地 / 服务端通用）。
 *
 *  一个已暴露 pin 的名字有三种可能，各由不同来源给出：
 *    · `name`          真实 pin 名 / 槽位名（ComfyUI 的机器名）；
 *    · `enrichedLabel` 富化链给出的显示名（作者命名 → 子图内部业务名 →
 *                      本层 label/localized → 别名）；
 *    · `slotLabel`     勾选那一刻画布透传的显示名（本层作者业务名）。
 *
 *  判定必须建立在整组字段上，不能只看名字相不相等 —— 见 below。 */
export interface ExposedNameFacts {
  /** 真实 pin 名 / 槽位名（机器名）。缺失时不做任何别名判定。 */
  name?: string;
  /** 富化链给出的显示名。 */
  enrichedLabel?: string;
  /** 本层槽位上作者写的业务名（与槽位名不同才有值）。 */
  slotLabel?: string;
  /** 产出口所属节点的类名 —— 用于识别「宿主是子工作流封装节点」。
   *
   *  只有封装节点的槽位名才可能是 ComfyUI 自动编号的 `value_1` 别名；
   *  普通节点（`LoadImage.image`、`KSampler.seed`）的 pin 名由插件作者定义，
   *  即使长得像也不能当机器名（ISSUE #349）。 */
  classType?: string;
}

/** 手写名与机器槽位别名「同名」时的去重后缀。
 *
 *  `pinName` 本身就是作者能想到的名字（`LoadImage.image`、`seed`…）。
 *  真手写一个逐字相同的名字时把它加后缀而不是丢弃 —— 否则作者改完名一看
 *  没生效，回头再找就是第二轮「改了也不行」（ISSUE #349）。 */
export const HOMONYM_LABEL_SUFFIX = "（自定义）";

/** 显示名候选串：去空白、剥掉 COMBO 候选串，空串视为无。 */
function cleanName(value: string | undefined | null): string {
  return sanitizeComboLabel(value);
}

/** 封装节点（子工作流 wrapper）槽位名是不是 ComfyUI 自动编号的机器别名。
 *
 *  ComfyUI 把子工作流暴露的 widget 逐槽编号成 `value_1` / `value_2`…（部分
 *  导出干脆是裸序号 `1` / `2`）。这一族名字是平台生成的，作者不会手写；
 *  因此只要宿主节点是封装节点（`class_type` 是子图 UUID），槽位名命中这个
 *  形状就是机器名，无需任何其他证据（ISSUE #349）。
 *
 *  只对封装节点的槽位生效：普通节点（`LoadImage.image`、`KSampler.seed`）
 *  的 pin 名是插件作者定的，可能恰好长成 `value_1`，不能一概而论，因此
 *  调用方必须给出宿主类名。
 *
 *  `classType` 是子图 UUID（`8-4-4-4-12`）时才算封装节点；缺失或非 UUID 时
 *  一律返回 false。 */
export function isWrapperAliasName(
  name: string | undefined | null,
  classType?: string,
): boolean {
  const slot = cleanName(name);
  if (!slot) return false;
  if (!isSubgraphWrapperClassType(classType)) return false;
  return /^value_\d+$/.test(slot) || /^\d+$/.test(slot);
}

/** 节点类名是不是子图封装节点（`class_type` 是子图 UUID）。
 *
 *  封装节点在画布上渲染成紫色整卡，`class_type` 就是子图定义的 UUID ——
 *  ComfyUI 不在这里放插件类名。用它区分「槽位名是平台自动编号的别名」
 *  （只能是机器名）与「槽位名是插件作者定的 pin 名」（可能是作者手写的
 *  任意字符串，不能当机器名清掉）。 */
export function isSubgraphWrapperClassType(
  classType: string | undefined,
): boolean {
  if (!classType) return false;
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
    classType.trim(),
  );
}

/** `candidate` 是不是一个「机器生成的名字」。
 *
 *  判据是**把名字互相比较**，而不是拿其中一个去和一个未知基准比，也不是
 *  「我们记住了哪个键写过脏值」—— 脏值在本地 store 里没有痕迹（可能来自
 *  上一次会话、来自取消勾选前的旧条目、或来自服务端回读），任何依赖本地
 *  记忆的判据都会在「重开工作流 / 取消勾选再勾」之后失效，那正是它一直复活
 *  的原因（ISSUE #349）。
 *
 *  三条能判定「这串是机器名」，共同前提是**候选串就是真实 pin 名/槽位名**：
 *
 *    ① 富化链另外给得出一个不同的名字 —— 说明这个槽位确实有作者命名，
 *       候选串只是从槽位名抄下来的（`Last Frame Image` vs `image`）；
 *    ② 富化名也停在同一个名字，但勾选那一刻画布透传的作者名不是它 ——
 *       说明画布上显示的是别的名字（`Seed` vs `value_1`）；
 *    ③ 槽位名本身就是封装节点（子工作流）的自动编号别名（`value_1` / `1`）——
 *       它由 ComfyUI 生成，不可能是作者命名，无论另两个来源能不能给出更好的
 *       名字。
 *
 *  判据③是必需的：封装节点的作者名可能整体回收不到（子图导出里没有
 *  `-10` 哨兵边，`proxyAuthorLabels` 于是为空），此时①与②都无从作证，别名
 *  就被当成了「作者命名」固化回库 —— 这正是「切一次 seed 行为名字就变回
 *  `value_1`」在上一版修完后仍然复现的原因（ISSUE #349）。
 *
 *  两个别的来源**都**指不出另一个名字、且槽位名不像自动编号别名时，无从判定，
 *  原样保留 —— 宁可留着旧值，也不误删作者命名。作者手写的名字永远不满足前提
 *  （它不等于 pin 名），因此不会被误伤。 */
export function isMachineName(
  candidate: string | undefined,
  facts: ExposedNameFacts,
): boolean {
  const local = cleanName(candidate);
  const base = cleanName(facts.name);
  if (!local || !base) return false;
  /* 前提：候选串必须与真实 pin 名逐字相同。作者手写的名字（`我的种子`、
   *  `Seed`）与 pin 名不同，这里直接放行。 */
  if (local !== base) return false;
  /* ③ 槽位名本身就是封装节点（子工作流）的自动编号别名：ComfyUI 为
   *  `proxyWidgets` 逐槽编号，名字是 `value_1` / `1` 这类纯机器产物，作者
   *  不可能「手写」成它。判据不依赖任何其他来源，因此在作者名整体回收不到
   *  （子图导出缺 `-10` 哨兵边）时照样成立 —— 少了它，别名会以「未命名」
   *  的名义一直活下去（ISSUE #349）。 */
  if (isWrapperAliasName(base, facts.classType)) return true;
  const enriched = cleanName(facts.enrichedLabel);
  const slot = cleanName(facts.slotLabel);
  if (enriched && enriched !== local) return true;
  if (slot && slot !== local) return true;
  return false;
}

/** 保留兼容名的别名判定（本地候选串 → 事实源）。
 *
 *  与 `isMachineName` 同源：候选串明显是机器名时返回 true。参数顺序沿用旧
 *  调用点（`label, aliasBase, enrichedLabel, slotLabel`），行为与重构前一致。 */
export function isStaleExposedAlias(
  label: string | undefined,
  aliasBase: string | undefined,
  enrichedLabel?: string,
  slotLabel?: string,
  classType?: string,
): boolean {
  if (label === undefined || aliasBase === undefined) return false;
  const local = cleanName(label);
  const base = cleanName(aliasBase);
  if (!local || !base) return false;
  /* 本地存的不是这个 pin 的名字 → 不可能是这个 pin 的机器名。 */
  if (local !== base) return false;
  return isMachineName(label, {
    name: aliasBase,
    enrichedLabel,
    slotLabel,
    classType,
  });
}

/** 一个已暴露条目的显示名，与画布上该 pin 的标签逐字一致。
 *
 *  回退链：本地 label → 富化名 → 真实 pin 名。两个取舍：
 *  ① 本地 label 明显是机器名（见 `isMachineName`）时让位给富化名；
 *  ② **本地 label 与富化名逐字相同，不代表作者命名过** —— 勾选那一刻写进去的
 *     就是画布显示名，而那个名字正是从同一个槽位读出来的。所以这里返回
 *     富化名 / 真实 pin 名，绝不把本地存的那串再竖起来当作者命名。
 *
 *  历史事故（ISSUE #349）：「本地 label === 别名」被当成作者命名，于是切一次
 *  seed 行为就被整体写回，重新固化那串机器名，显示名退回 `value_1`。让位要
 *  在**显示与写入两处**都成立，否则取消勾选再勾选（重开工作流）就会复活。 */
export function resolveExposedLabel(
  local: ExposedLabelSource | undefined | null,
  enriched: WorkflowIOEntry | undefined | null,
  fallbackName: string,
): string {
  const localLabel = cleanName(local?.label);
  const enrichedLabel = enriched ? cleanName(ioLabel(enriched)) : "";
  const base = cleanName(fallbackName);
  const facts: ExposedNameFacts = {
    name: base,
    enrichedLabel,
    ...(enriched?.slotLabel
      ? { slotLabel: cleanName(enriched.slotLabel) }
      : {}),
    ...(enriched?.classType ? { classType: enriched.classType } : {}),
  };
  /* ① 本地那串明显是机器名：让位，走富化链。 */
  if (localLabel && isMachineName(localLabel, facts)) {
    return enrichedLabel || base || localLabel;
  }
  /* ② 本地那串与富化名同源（名字相同）：它不携带任何作者意图，一律以富化链
   *    为准 —— 富化名缺失时退到真实 pin 名，而不是把这串竖起来。 */
  if (localLabel && enrichedLabel && localLabel === enrichedLabel) {
    if (enrichedLabel === base) return base;
    return enrichedLabel;
  }
  if (localLabel) return localLabel;
  return enrichedLabel || base;
}

/** 把本地勾选态与服务端富化条目合并成 IO 编辑面板用的条目：
 *  本地字段（label / value / required / seedMode / modes…）整体覆盖在富化
 *  结果之上——本地才是作者编辑态的唯一事实源；只有 `label` 需要额外兜住
 *  「本地没重命名过」的情形（此时取富化名，没有富化名再回退原始 pin 名）。
 *  `type` 单独处理：本地缺省时保留富化类型，否则控件会从 select 退化成文本框。 */
export function mergeExposedEntry<T extends WorkflowIOEntry>(
  local: (ExposedLabelSource & Partial<WorkflowIOEntry>) | undefined | null,
  enriched: T,
): T {
  return {
    ...enriched,
    ...local,
    label: resolveExposedLabel(local, enriched, enriched.name),
    type: local?.type ?? enriched.type,
  };
}

/** 本地条目的别名判定基准（ioKey → 该条目现在的原始槽位名 + 本层作者名）。
 *
 *  两个字段都来自富化（或视图就地派生的同一份事实源），缺一不可：
 *    · `name`      原始槽位名 —— 判定「本地存的是不是那串机器名」的基准；
 *    · `slotLabel` 本层槽位上作者写的名字（无则缺省）—— 富化链把它排在
 *      `localized` 之后，够不着，但它足以说明本层槽位确实有作者命名，
 *      是「本地这串要不要让位」的第二判据（见 isStaleExposedAlias）。 */
export interface ExposedAliasBase {
  name: string;
  /** 富化链现在给这个条目的显示名（作者命名 → 子图内部业务名 → 本层
   *  label/localized → 别名）。与 `name` 不同 = 富化确实知道一个更好的名字，
   *  本地存着那串机器名时应当让位。 */
  enrichedLabel?: string;
  /** 本层槽位上作者写的名字（与槽位名不同才有值）。富化链把它排在
   *  `localized` 之后够不着，但它足以说明本层确实有作者命名。 */
  slotLabel?: string;
  /** 宿主节点类名 —— 用于识别「槽位名是子工作流封装节点的自动编号别名」。
   *  封装节点的 `value_N` 与裸序号槽位只能是机器名，判定不依赖另两个来源，
   *  因此作者名整体回收不到时照样清得掉（ISSUE #349）。 */
  classType?: string;
}

/** 视图内节点元数据 → 可当「服务端富化」用的最小 IO 表（纯函数）。
 *
 *  IO 预览面板的数据源是服务端富化的 `detail.workflowIO`。下钻到子工作流
 *  后，详情响应里没有这份富化（子图路由不产出 workflowIO：它按整份工作流
 *  的下标打键，带进内层视图会误伤顶层未保存的编辑）——面板只能回落到本地
 *  存的 label，于是修复前落库的槽位名/别名（`value_1`）会一直显示（ISSUE #349）。
 *
 *  子图详情的 `nodes[].raw_inputs[]` 里本来就带着内部节点的真实 label /
 *  localized / type，这里就地派生一份，让内层视图与顶层视图的取名口径一致。
 *  只补「服务端富化查不到」的字段，不覆盖已有值。 */
export function enrichFromViewNodes(
  nodes:
    | {
        id: string;
        class_type?: string;
        raw_inputs?: {
          name: string;
          label?: string;
          localized?: string;
          type?: string;
          defaultValue?: unknown;
          multiline?: boolean;
          widgetValue?: unknown;
        }[];
      }[]
    | null
    | undefined,
): Record<string, WorkflowIOEntry> {
  const out: Record<string, WorkflowIOEntry> = {};
  for (const node of nodes ?? []) {
    if (!node?.id) continue;
    for (const input of node.raw_inputs ?? []) {
      if (!input?.name) continue;
      const label =
        sanitizeComboLabel(input.label) ||
        sanitizeComboLabel(input.localized) ||
        input.name;
      const value = input.defaultValue ?? input.widgetValue;
      out[`${node.id}::widget::${input.name}`] = {
        direction: "input",
        kind: "widget",
        nodeId: node.id,
        name: input.name,
        label,
        type: input.type ?? "*",
        ...(input.multiline !== undefined
          ? { multiline: input.multiline }
          : {}),
        ...(value !== undefined ? { defaultValue: value } : {}),
        ...(node.class_type ? { classType: node.class_type } : {}),
      };
    }
  }
  return out;
}
