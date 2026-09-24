/* ── 统一对外参数契约（按模式，与具体工作流无关）──
 *
 * 「对外参数」是产品对用户承诺的那几个口子（提示词、尺寸、首帧…），不是某个
 * 工作流碰巧暴露了哪些 widget。此前对外参数是按工作流富化出来的 pin 聚类生成的
 * ——同一个「提示词」在不同工作流里叫 `text` / `positive_prompt` / `value_1`，
 * 卡片列表于是变成工作流内部参数名的大杂烩（`value` / `value_2` /
 * `resolution_preset`…），用户读到的是一份「与这个工作流绑定」的清单，而不是
 * 「这一类模式统一能给什么」。
 *
 * 本模块给出**唯一的契约表**：给定模式码，返回该模式对外暴露的参数集合（顺序即
 * 展示顺序）。工作流只决定「每个统一参数落到哪一行端口」（见
 * `workflow-param-mapping` 的映射模型），不决定「对外有哪些参数」。
 *
 * **契约口一律常驻，判据里不含任何「工作流能不能承接」的推导**：契约列了哪些
 * 对外参数，页面就显示哪些，落点为空就如实显示成「未配置」（作者在库里把这一口
 * 连到工作流的哪一行，是**落点**问题，不是「这一口存不存在」的问题）。此前负向
 * 提示词被标成「可选口」，只有工作流内部被推出负向角色（或名字里写了 negative）
 * 时才出现 —— 显示与否跟着工作流内容走，同一件事在两个页签上还对不上
 * （ISSUE #620）。
 *
 * 无 React、无 IO（规范 §17.2 第①层），可直接单测。
 */

/* ── 视频模式判定 ──
 *
 * 工坊的视频通道有两个模式：文生视频（无首帧）与图生视频（有首帧）。模式码就是
 * 工作流库的 taskType / modes（T2V / I2V / TI2V / FLF2V / S2V …）。判定刻意只看
 * 这套码，不看工作流的 taskType 之上再包一层「内容分类」（image/video）—— 那层
 * 分类是工作流库的展示维度，不是生成模式的判据。
 *
 * 原先住 `workflow-encapsulation`（工坊封装层）：它们是**模式码 → 契约口**的判定，
 * 与这张契约表同源；留在封装层会让契约表反向依赖封装层（环）。 */

/** 视频类模式码（前缀式，兼容 T2V / TI2V / FLF2V / FMF2V / S2V / V2V …）。 */
const VIDEO_MODE_RE =
  /^(t2v|i2v|ti2v|flf2v|fmf2v|v2v|r2v|rv2v|vi2v|mv2v|vrc2v|ads2v|s2v|ia2v|a2v)$/i;

/** 该模式码是否属于视频生成。 */
export function isVideoMode(code: string | null | undefined): boolean {
  return typeof code === "string" && VIDEO_MODE_RE.test(code.trim());
}

/** 该模式是否自带首帧图（图生视频 / 图文生视频 / 首尾帧）。 */
export function modeUsesFirstFrame(code: string | null | undefined): boolean {
  if (typeof code !== "string") return false;
  return /^(i2v|ti2v|flf2v|fmf2v|r2v|s2v|ia2v)$/i.test(code.trim());
}

/** 该模式是否需要尾帧图（首尾帧视频）。 */
export function modeUsesLastFrame(code: string | null | undefined): boolean {
  if (typeof code !== "string") return false;
  return /^(flf2v|fmf2v)$/i.test(code.trim());
}

/** 统一对外参数的种类（`ParamClass` 的对外子集）。
 *
 *  `size-*` 四类聚合为一个「尺寸」参数：宽度 / 高度 / 宽高比 / 像素量是同一个
 *  语义（画面尺寸）的四种落点形态，工作流用哪种由它自己决定，对外只报「尺寸」。 */
export type ExposedParamClass =
  | "prompt"
  | "negative"
  | "size"
  | "reference-image"
  | "first-frame"
  | "last-frame"
  /** 视频：时长（秒）。落在工作流的 duration / length / frames 类端口上。 */
  | "duration"
  /** 采样种子（INT）。作者把这一口连到工作流的 seed / noise_seed 端口，工坊才能
   *  按次指定种子（如「抽卡重生成」换种子重出）；**没连这一口的工作流不受影响**
   *  —— 用其图内自带的 seed 配置，实际是否可换由工作流决定。 */
  | "seed";

export interface ExposedParamDef {
  cls: ExposedParamClass;
  /** 契约内的稳定 id，直接作为映射表的键（`source.mode:<模式>` 的值域）。
   *  多张参考图时第二张起带序号（`reference-image-2`），仍是同一类。 */
  id: string;
  /** 对外展示名（与具体工作流无关）。 */
  label: string;
}

/** 统一对外参数的**基础名**。
 *
 *  ⚠️ 这一份只给「id → 基础名」的映射用，**不是任何界面的展示名** —— 界面一律
 *  经 `exposedParamDisplayLabel` 取（见下方）。两处直接读它会话术再次漂移：
 *  「尺寸」在工坊里是一个「比例 + 分辨率 / (百万像素 + 倍数)」的组合控件，
 *  只写「尺寸」用户答不出这个控件到底要填什么。 */
export const EXPOSED_PARAM_LABEL: Record<ExposedParamClass, string> = {
  prompt: "提示词",
  negative: "负面提示词",
  size: "尺寸",
  "reference-image": "参考图",
  "first-frame": "首帧",
  "last-frame": "尾帧",
  duration: "时长",
  seed: "种子",
};

/** 各口的**界面展示名** —— 整个仓库的**唯一出处**。
 *
 *  同一张契约清单会出现在三处（工坊封装的对外口一览、工作流库「画布节点」的
 *  卡片列、模式契约编辑器），三处各写一份字符串必然漂移：ISSUE #596 现场就是
 *  「尺寸」在工坊封装页写成 `尺寸（比例 + 分辨率 / (百万像素 + 倍数)）`、在同一
 *  页面的画布节点卡片上只写 `尺寸`，用户读到的像是两个不同的口。
 *
 *  另外「负向提示词」（契约编辑器）与「负面提示词」（契约表）本来就是同一个口
 *  的两种叫法，在这里统一为一套措辞。
 *
 *  措辞与具体形态无关的一律不带括号：括号是给「同一类的多种写法」用的，
 *  只有 `size` 与 `duration` 各有两类等价表达，需要在这里说清。 */
export const EXPOSED_PARAM_DISPLAY_LABEL: Record<ExposedParamClass, string> = {
  prompt: "提示词",
  negative: "负向提示词",
  size: "尺寸（比例 + 分辨率 / (百万像素 + 倍数)）",
  "reference-image": "参考图",
  "first-frame": "首帧图片",
  "last-frame": "尾帧图片",
  duration: "时长（秒）",
  seed: "种子",
};

/** 内置默认给几张参考图槽 —— 只是默认值，契约编辑器里可以继续加，不设上限。 */
const REFERENCE_IMAGE_DEFAULT_COUNT = 2;

/** 一个模式是否属于「图生图类」——需要一张参考图输入。
 *
 *  这些模式的输入本身就是一张图，对外就必须暴露「参考图」；纯文生图（T2I）
 *  没有这个口子。 */
function isImageEditMode(code: string | null | undefined): boolean {
  if (typeof code !== "string") return false;
  return /^(i2i|inpaint|outpaint|upscale|e2i|d2i|p2i|r2i|c2i)$/i.test(
    code.trim(),
  );
}

/** 一个模式是否支持多张参考图（图生图类通常多图）。 */
function allowsReferenceImages(code: string | null | undefined): boolean {
  return isImageEditMode(code) || modeUsesFirstFrame(code);
}

/** 给定模式码，返回该模式统一对外暴露的参数（顺序即展示顺序）。
 *
 *  模式为空（工作流没声明模式）时退到最保守的一套（提示词 + 尺寸），
 *  与工作流无关 —— 「对外参数只跟模式有关」，没有模式就只说最通用的两样。 */
export function exposedParamsForMode(
  code: string | null | undefined,
): ExposedParamDef[] {
  const out: ExposedParamDef[] = [
    { cls: "prompt", id: "prompt", label: EXPOSED_PARAM_DISPLAY_LABEL.prompt },
    {
      cls: "negative",
      id: "negative",
      label: EXPOSED_PARAM_DISPLAY_LABEL.negative,
    },
  ];

  if (isVideoMode(code)) {
    if (modeUsesFirstFrame(code)) {
      out.push({
        cls: "first-frame",
        id: "first-frame",
        label: EXPOSED_PARAM_DISPLAY_LABEL["first-frame"],
      });
    }
    if (modeUsesLastFrame(code)) {
      out.push({
        cls: "last-frame",
        id: "last-frame",
        label: EXPOSED_PARAM_DISPLAY_LABEL["last-frame"],
      });
    }
    out.push({
      cls: "size",
      id: "size",
      label: EXPOSED_PARAM_DISPLAY_LABEL.size,
    });
    /* 视频还有时长口（秒）。落点由契约映射决定（duration / length / frames 类
     * 端口都算），值由调用方按该端口的单位折算后落下去。 */
    out.push({
      cls: "duration",
      id: "duration",
      label: EXPOSED_PARAM_DISPLAY_LABEL.duration,
    });
    /* 种子口：作者连到工作流的 seed / noise_seed 端口才生效，没连的工作流用其图内
     * seed 配置（实际是否可换由工作流决定）。 */
    out.push({
      cls: "seed",
      id: "seed",
      label: EXPOSED_PARAM_DISPLAY_LABEL.seed,
    });
    return out;
  }

  if (isImageEditMode(code)) {
    for (
      let i = 0;
      i < (allowsReferenceImages(code) ? REFERENCE_IMAGE_DEFAULT_COUNT : 1);
      i += 1
    ) {
      out.push({
        cls: "reference-image",
        id: i === 0 ? "reference-image" : `reference-image-${i + 1}`,
        label: exposedParamDisplayLabel(
          i === 0 ? "reference-image" : `reference-image-${i + 1}`,
        ),
      });
    }
  }
  out.push({
    cls: "size",
    id: "size",
    label: EXPOSED_PARAM_DISPLAY_LABEL.size,
  });
  /* 种子口：作者连到工作流的 seed / noise_seed 端口才生效，没连的工作流用其图内
   * seed 配置（实际是否可换由工作流决定）。 */
  out.push({
    cls: "seed",
    id: "seed",
    label: EXPOSED_PARAM_DISPLAY_LABEL.seed,
  });
  return out;
}

/* ── 自定义对外参数口（`custom-<类型>-<序号>`）──
 *
 * 「预制口就那么几个，往后想加个新口还得改代码」——自定义口让作者在「模式契约」
 * 里自己声明一个口（起名 + 选简单类型），类型只影响两件事：① 工坊用什么控件录入；
 * ② 它接受哪一族的端口。两件事都从下面这张「类型 → 已有类」的表派生，下游
 * （映射 / 封装 / 适配器）因此不必认识「自定义口」这个概念。
 *
 * **为什么复用已有的类，而不是新增 `custom-*` 类**：`ExposedParamClass` 的成员
 * 同时承担「端口族」与「卡片上的类型展示」两个职责，自定义口的两件事与它同构，
 * 映射过去即可。只有 `reference-image` 不能复用 —— 那一类带「第 N 张」的槽位语义
 * （`workflow-encapsulation` 按它逐槽取 `referenceImages[i]`），自定义图片口蹭上
 * 去会读到别的口的值，所以图片口映射到同样吃图片行、但没有槽位语义的 `first-frame`。
 */

/** 自定义对外参数口的简单类型。 */
export type ExposedCustomKind = "text" | "image" | "number";

const EXPOSED_CUSTOM_ID_RE = /^custom-(text|image|number)-(\d+)$/;

/** 自定义口 id 的类型；不是自定义口返回 null。 */
export function exposedCustomKindOf(id: string): ExposedCustomKind | null {
  const matched = EXPOSED_CUSTOM_ID_RE.exec(id);
  return matched ? (matched[1] as ExposedCustomKind) : null;
}

/** 自定义口类型 → 复用的对外参数类（见上方注释）。 */
const EXPOSED_CUSTOM_CLASS: Record<ExposedCustomKind, ExposedParamClass> = {
  text: "prompt",
  image: "first-frame",
  number: "duration",
};

/** 任意契约口 id 的**界面展示名**（带序号的参考图口显示为「参考图 2」）。
 *
 *  未知 id（历史落库键）原样返回 —— 界面读不出名字时宁可显示键本身，也不凭空
 *  编一个名字。自定义口给一条中性兜底：它的名字只有模式契约知道（作者起的名），
 *  落到下面按「类」取会张冠李戴（把 `custom-text-1` 显示成「提示词」）。 */
export function exposedParamDisplayLabel(id: string): string {
  if (exposedCustomKindOf(id)) return "自定义参数";
  const cls = exposedClassOf(id);
  if (!cls) return id;
  const slot = referenceImageSlotIndex(id);
  if (slot > 1)
    return `${EXPOSED_PARAM_DISPLAY_LABEL["reference-image"]} ${slot}`;
  return EXPOSED_PARAM_DISPLAY_LABEL[cls];
}

/** 带序号的参考图口的序号（`reference-image-2` → 2；其余口返回 0）。
 *  第一张不带序号，故「序号 > 1」才是「参考图 2」这种带序号的槽位。 */
export function referenceImageSlotIndex(id: string): number {
  const m = /^reference-image-(\d+)$/.exec(id);
  return m ? Number(m[1]) : 0;
}

/** 契约里给定 id 的基础名（未知 id 原样返回，兼容历史落库键）。
 *
 *  **界面不要用它**：请走 `exposedParamDisplayLabel`。 */
export function exposedParamLabel(id: string): string {
  const cls = id as ExposedParamClass;
  return EXPOSED_PARAM_LABEL[cls] ?? id;
}

/** 某个统一参数 id 属于哪一类（`reference-image-2` 这类带序号的口归到同一类，
 *  自定义口按它的简单类型归到同族的那一类，见 `EXPOSED_CUSTOM_CLASS`）。 */
export function exposedClassOf(id: string): ExposedParamClass | null {
  const custom = exposedCustomKindOf(id);
  if (custom) return EXPOSED_CUSTOM_CLASS[custom];
  if (id in EXPOSED_PARAM_LABEL) return id as ExposedParamClass;
  if (/^reference-image-\d+$/.test(id)) return "reference-image";
  return null;
}
