/* ── 正 / 负向提示词端口的分类池（唯一事实源）────────────────────────────
 *
 * 同一对 `CLIPTextEncode` 的 pin 名与显示名完全一样（都叫 `text` / 「文本」），
 * 正负只由导入图里 KSampler 的 `positive` / `negative` 连线决定。名字层面分不出
 * 正负时，只能按**图内角色**定夺 —— 本模块把它折成可打印的同义关键词，让
 * `classifyPin`（对外参数映射）与 `classifyWorkshopPin`（工坊封装）同源生效。
 *
 * 角色关键词的取值池只有两份：
 *   · 图内**正 / 负文本编码节点自身**的条目 —— 由富化链沿 `paramMap`
 *     （`detectParamMap`）投影出 `role`；
 *   · 富化链判定不出的情形（API-only 导入无 rawJson、旧数据、子图内部节点）——
 *     按「图内的文本编码节点」这个封闭池 + 正 / 负节点序号兜底，
 *     见 `enrichWorkflowIO` 的 `isTextNode` 投影。
 *
 * 兜底为什么必要（ISSUE #620）：`role` 只下发到**工作流自己**那两个文本编码节点
 * 上。大量 T2I 工作流把正向写死在自己的 CLIPTextEncode、另接一个第三方节点
 * （提示词润色 / 翻译 / 模型自带负向）承接负向 —— 承载负向的那一行拿不到 `role`，
 * 于是「工坊封装」页签判不出这一口（判据来自图内角色），而工作流的 content
 * 里又有 `negative` 这类名字，显示与否就跟着工作流内容走。**负向提示词是工坊的
 * 统一配置口，与工作流内部长什么样无关**：判不出图内角色时按「文本编码节点 +
 * 正 / 负节点序号」兜底，让两个页签说同一套话。
 *
 * 纯函数、无 React 无 IO（规范 §17.2 第①层），可直接单测。
 */

/** 图内文本编码节点（承接提示词的那一类节点）的类名判据。
 *
 *  与 `comfyui/workflow.ts` 的 `findTextEncoder` 同口径：ComfyUI 家族里
 *  带 `TextEncode` 的节点都是「一段文本 → conditioning」，它旁边的第三方
 *  自定义节点（提示词润色 / 翻译 / 模型自带负向）不属于这一类。 */
export function isTextEncoderClass(
  classType: string | null | undefined,
): boolean {
  return /text_?encode/i.test(classType ?? "");
}

/** 图内语义角色的两个取值（与 `WorkflowIOEntry.role` 同一值域）。 */
export type WorkflowTextRole = "positive" | "negative";

/** 角色 → 并进名字判据的同义关键词（正 `prompt` / 负 `negative`）。
 *
 *  刻意与名字判据里的关键词同形：分不出正负时由角色定夺，名字里写明正负时
 *  仍以名字为准（角色只是给判据串补一个词，不是覆盖作者写的名字）。 */
export function roleKeyword(role: WorkflowTextRole | undefined): string {
  if (role === "negative") return "negative";
  if (role === "positive") return "prompt";
  return "";
}

/** 名字层面是否显式写了负向（与 `classifyPin` / `classifyWorkshopPin` 同一串关键词）。 */
export function nameSaysNegative(name: string | undefined | null): boolean {
  return /negative|负向|负面|反向/.test((name ?? "").toLowerCase());
}

/** 兜底用的最小条目形状（只读客户端可拿到的字段）。 */
export interface TextSlotCandidate {
  ioKey: string;
  name?: string;
  label?: string;
  role?: WorkflowTextRole;
  isTextNode?: boolean;
}

/**
 * 推断一批 IO 条目里「哪一条该当负向提示词口」。
 *
 * 这是 `classifyPin` 判不出负向时的**客户端兜底**，判据只走「名字 → 图内文本节点
 * 序号」两级，绝不凭 pin 名猜：
 *
 *  1. 图内角色（`role`）判为负向的条目 —— 它由导入图沿 KSampler 的正 / 负连线链
 *     推出，是唯一「确定」的正负判据；
 *  2. 名字里明确写了负向的条目（`negative_prompt` / 负向提示词）；
 *  3. 都没有时，在「图内的文本编码节点」（`isTextNode`）这一小撮里按出现顺序取
 *     **第二个**当负向：`detectParamMap` 在没有采样器时就是「前两个 CLIPTextEncode
 *     按 id 序 = 正 / 负」，它是客户端能拿到坐标的同一套图内顺序。
 *
 * 为什么不在 (3) 里连正向一起重排：正向口本来就能靠 pin 名 / 长默认值判出来
 * （`classifyPin` 的既有启发式），这里只补「负向提示词」这一条 —— 它没有名字
 * 线索、又必须与工作流长得什么样无关（ISSUE #620）。
 *
 * 少于两个文本节点（纯 prompt 工作流 / 只有第三方节点）时返回 `null`：宁可显式
 * 不显示，也不把唯一的那个提示词节点当成负向。
 */
export function inferNegativeSlot(
  candidates: readonly TextSlotCandidate[],
): string | null {
  const byRole = candidates.find((entry) => entry.role === "negative");
  if (byRole) return byRole.ioKey;

  /* 名字判据看**显示名 + 端口名两处**（任一命中即认）：只认显示名的话，
   *  标签被翻译成「文本」而端口名明明写着 `negative_prompt` 的条目会被漏掉。 */
  const byName = candidates.find(
    (entry) => nameSaysNegative(entry.label) || nameSaysNegative(entry.name),
  );
  if (byName) return byName.ioKey;

  /* 图内文类编码节点按出现顺序排，**取第二个**当负向：图内第一个是正向（作者
   *  把正向写死在自己的 CLIPTextEncode 上是常规做法），第二个才是承接负向的那
   *  一行；只有两个以上候选时才有「第二个」，故 `length < 2` 直接判不出来。 */
  const pool = candidates.filter((entry) => entry.isTextNode);
  return pool.length >= 2 ? (pool[1]?.ioKey ?? null) : null;
}
