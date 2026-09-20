/**
 * COMBO 候选项解析器 —— 从 workflow-detail.ts 拆出。
 *
 * ComfyUI 的 COMBO 控件（unet_name / clip_name / vae_name / ckpt_name …）
 * 在原始 JSON 里**不带**候选列表 —— 唯一的权威来源是 /api/object_info。
 * 每个解析器实例拉一次它（fetchObjectInfo 自身缓存 5 分钟，ComfyUI 连不上时
 * 降级为 null），再把「classType + 字段名」解析成候选数组，好让画布表单与
 * 子图 wrapper 节点渲染出真正的 <select>，而不是一个自由文本框。
 * 缺失或连不上时落到 undefined，消费方优雅回落到纯文本控件。
 */
import { union, uniqueSorted } from "~/lib/ordered-set";
import { fetchObjectInfo } from "~/lib/comfyui/raw";
import { localModelFileNames } from "~/lib/models";
import { modelFoldersForField } from "~/lib/model-types";

/* 从 object_info 的 spec 元组里抽出候选列表。
 *  旧形态：`[["option-a", "option-b"], {...extra}]`（head 即选项数组）。
 *  新形态（ComfyUI V3 combo，0.13+ 实测）：`["COMBO", {options:[...]}, ...]`
 *  —— head 是类型名字符串，候选挂在第二元素对象的 `options` 字段。
 *  只认这两种；其它类型（FLOAT/INT/STRING 的 spec）返回 undefined。
 *  若只认旧形态，新版服务器的 COMBO 会解析失败，按 class 的候选查询
 *  整体落空，退到 field-name 全库 union——把其它节点同名字段的选项
 *  混进候选表（如 aspect_ratio 混出简写 "16:9"），用户照着选就会提交
 *  服务器不认的值。 */
const comboOptionsFromSpec = (spec: unknown): string[] | undefined => {
  if (!Array.isArray(spec)) return undefined;
  const head: unknown = spec[0];
  if (Array.isArray(head)) {
    const opts = head.filter((x): x is string => typeof x === "string");
    return opts.length ? opts : undefined;
  }
  const extra: unknown = spec[1];
  if (extra != null && typeof extra === "object") {
    const opts = (extra as Record<string, unknown>).options;
    if (Array.isArray(opts)) {
      const list = opts.filter((x): x is string => typeof x === "string");
      return list.length ? list : undefined;
    }
  }
  return undefined;
};

/* 工厂：返回一组「由 object_info 支撑」的新解析器。
 *
 * object_info 缓存存在返回的实例内部（与 workflow-detail.ts 里原来「每请求
 * 一个闭包」的做法一致）：每次构建都从冷的 `_comboObjectInfo` 开始，
 * 于是长驻进程不会跨请求钉住一份过期的 object_info 快照。
 *
 *  两类解析共用这一次 fetch（同一份对象、同一个缓存）：
 *    · `comboOptionsFor*` —— COMBO 候选表；
 *    · `multilineForClassField` —— STRING 输入是否声明了
 *      `{"multiline": true}`（多行文本框的**类型事实**，见 types.ts 的
 *      `inferIsMultiline`）。 */
export function createObjectInfoResolvers(): {
  comboOptionsForClassField: (
    classType: string | undefined,
    field: string,
  ) => Promise<string[] | undefined>;
  comboOptionsForFieldName: (field: string) => Promise<string[] | undefined>;
  multilineForClassField: (
    classType: string | undefined,
    field: string,
  ) => Promise<boolean | undefined>;
} {
  let _comboObjectInfo: Awaited<ReturnType<typeof fetchObjectInfo>> | undefined;
  const ensureObjectInfo = async () => {
    if (_comboObjectInfo === undefined)
      _comboObjectInfo = await fetchObjectInfo();
    return _comboObjectInfo;
  };

  /**
   * 解析 wrapper 控件字段的 COMBO 候选项。
   *
   * P4：把「节点声明的 object_info 候选」与「映射到该字段的本地已同步模型文件」
   * 取并集（例如 `ckpt_name` 对应 CHECKPOINT 文件）。ComfyUI 自己的 COMBO 列表
   * 永远只是 object_info 里随附的默认集；用户真正装在磁盘上的模型**不在**其中，
   * 因此不取并集的话，画布下拉框会悄悄漏掉所有本地模型。
   * 两个来源都原样返回（保留扩展名），再去重 + 排序；
   * 两边都取不到时返回 `undefined`，消费方随即回落到纯文本控件。
   */
  /** 某 class 某字段在 object_info 里的原始 spec（`[类型, 选项对象, …]`）。
   *  查不到（未注册 / 该字段不存在 / ComfyUI 未启动）时 undefined。 */
  const specForClassField = async (
    classType: string | undefined,
    field: string,
  ): Promise<unknown> => {
    if (!classType) return undefined;
    const oi = await ensureObjectInfo();
    if (!oi) return undefined;
    const def = oi[classType];
    if (!def?.input) return undefined;
    return def.input.required?.[field] ?? def.input.optional?.[field];
  };

  const comboOptionsForClassField = async (
    classType: string | undefined,
    field: string,
  ): Promise<string[] | undefined> => {
    const [specOpts, localOpts] = await Promise.all([
      (async () =>
        comboOptionsFromSpec(await specForClassField(classType, field)))(),
      localModelFileNames(modelFoldersForField(field)),
    ]);

    /* 「多路来源取并集 + 去重 + 按当前区域设置升序」走
     * `~/lib/ordered-set`（规范 16 §16.2.4.55）。优先级是域判据：
     * 服务端声明的候选排在磁盘实测的前面。 */
    const out = uniqueSorted(union(specOpts ?? [], localOpts));
    return out.length ? out : undefined;
  };

  /**
   * 按类型查不到任何东西时用的兜底 COMBO 解析器 —— 例如某个 `comfy-core`
   * 子图节点（v0.7.0）的 `properties.proxyWidgets` 缺失或被隔离，于是我们
   * 学不到内部节点的类型，`comboOptionsForClassField(wrapperClass, field)`
   * 也就找不到该字段。
   *
   * 这里扫描**每一个**把 `field` 声明为 COMBO 的 object_info 类，
   * 把它们的候选列表取并集。对名字唯一的字段（例如只被一个类声明的
   * `resolution_preset`）能还原出完整选项；对共享的模型字段（例如 `unet_name`）
   * 会把所有已知默认值并起来 —— 这无害，因为下面的本地模型并集已经覆盖了
   * 现实中磁盘上的那批。object_info 只拉一次并缓存，因此重复调用很便宜。
   */
  const comboOptionsForFieldName = async (
    field: string,
  ): Promise<string[] | undefined> => {
    const oi = await ensureObjectInfo();
    if (!oi) return undefined;
    const declared: string[] = [];
    let found = false;
    for (const def of Object.values(oi)) {
      const inp = def.input;
      if (!inp) continue;
      const spec = inp.required?.[field] ?? inp.optional?.[field];
      const opts = comboOptionsFromSpec(spec);
      if (opts) {
        found = true;
        declared.push(...opts);
      }
    }
    if (!found) return undefined;
    /* 同上一处：并集 + 去重 + 字典序走 `~/lib/ordered-set`。 */
    const out = uniqueSorted(
      union(declared, await localModelFileNames(modelFoldersForField(field))),
    );
    return out.length ? out : undefined;
  };

  /** STRING 输入是否声明了 `{"multiline": true}`（多行文本框的类型事实）。
   *
   *  与 COMBO 候选读的是同一份 object_info 缓存，所以每个请求仍只 fetch 一次。
   *  查不到时返回 `undefined`（而不是 false）：调用方据此退回「值很长」这条
   *  数据判据，不会因为「没查到声明」就把长文本框降级成单行。 */
  const multilineForClassField = async (
    classType: string | undefined,
    field: string,
  ): Promise<boolean | undefined> => {
    const spec = await specForClassField(classType, field);
    if (!Array.isArray(spec)) return undefined;
    const extra: unknown = spec[1];
    if (extra == null || typeof extra !== "object") return undefined;
    return (extra as Record<string, unknown>).multiline === true;
  };

  return {
    comboOptionsForClassField,
    comboOptionsForFieldName,
    multilineForClassField,
  };
}
